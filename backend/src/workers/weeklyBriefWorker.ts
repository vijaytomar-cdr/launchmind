/**
 * @file weeklyBriefWorker.ts
 * @description BullMQ worker for the weekly brief pipeline.
 *   10-step pipeline per product:
 *     1. Fetch product + founder details
 *     2. Fetch all launched campaigns for the product
 *     3. Fetch this week's campaign_metrics
 *     4. Classify top performers (roas > 1 OR installs > 0)
 *     5. Classify bottom performers (impressions > 0, installs = 0)
 *     6. (briefService) Generate AI narrative — Claude Haiku (20 tokens)
 *     7. (briefService) Insert anonymised playbook_signals
 *     8. (briefService) Upsert weekly_briefs row (status: 'draft')
 *     9. (briefService) Send email (status → 'sent')
 *    10. (briefService) Write audit_log
 *
 *   For cron jobs (triggeredBy: 'cron'), fetches ALL active products and runs
 *   the pipeline for each. For manual triggers, runs for the specified product only.
 * @security
 *   - No PII written to playbook_signals (enforced by briefService.insertPlaybookSignals).
 *   - founderId always verified against product.founder_id before processing.
 *   - Errors in individual product pipelines are captured to Sentry; do not abort the batch.
 * @dependencies briefService, scheduler, supabaseAdmin, Sentry
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { BRIEF_QUEUE_NAME, BriefJobData, getCurrentWeekStart } from '../lib/scheduler';
import {
  generateBriefNarrative,
  insertPlaybookSignals,
  upsertWeeklyBrief,
  sendBriefEmail,
  writeBriefAuditLog,
  type CampaignMetricRow,
  type BriefInput,
} from '../services/briefService';

// ── Step 2.5: Competitor re-scrape ───────────────────────────────────────────

interface CompetitorEntry {
  name: string;
  storeUrl?: string;
  rating?: number;
  description?: string;
  [key: string]: unknown;
}

interface CompetitorDiff {
  name: string;
  changes: string[];
}

/**
 * Re-scrapes top 5 competitor App Store pages using Cheerio (lightweight, no Playwright).
 * Diffs new metadata against stored competitor_set.
 * Updates products.competitor_set in the DB.
 * @returns Plain-text diff summary for inclusion in the brief narrative
 */
async function rescrapeCompetitors(
  productId: string,
  competitorSet: CompetitorEntry[]
): Promise<string> {
  if (!competitorSet || competitorSet.length === 0) return '';

  // Only process App Store competitors (Cheerio-compatible; Play Store needs Playwright)
  const appStoreCompetitors = competitorSet
    .filter((c) => c.storeUrl?.includes('apps.apple.com'))
    .slice(0, 5);

  if (appStoreCompetitors.length === 0) return '';

  const diffs: CompetitorDiff[] = [];

  for (const competitor of appStoreCompetitors) {
    if (!competitor.storeUrl) continue;
    try {
      const { default: fetch } = await import('node-fetch');
      const res = await fetch(competitor.storeUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchMindBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      const { load } = await import('cheerio');
      const $ = load(html);

      // Extract current rating
      const ratingText = $('[class*="rating-count"]').first().text().trim() ||
                         $('figcaption[class*="rating"]').first().text().trim();
      const newRating = parseFloat(ratingText);

      // Extract description snippet
      const newDesc = $('[data-testid="truncated-description"]').first().text().trim().slice(0, 200) ||
                      $('[class*="section__description"]').first().text().trim().slice(0, 200);

      const changes: string[] = [];
      if (!isNaN(newRating) && competitor.rating != null && Math.abs(newRating - competitor.rating) >= 0.1) {
        const direction = newRating > competitor.rating ? 'up' : 'down';
        changes.push(`rating ${direction} from ${competitor.rating} → ${newRating}`);
        competitor.rating = newRating;
      }
      if (newDesc && competitor.description && newDesc !== competitor.description.slice(0, 200)) {
        changes.push('description updated');
        competitor.description = newDesc;
      }

      if (changes.length > 0) {
        diffs.push({ name: competitor.name, changes });
      }
    } catch {
      // Per-competitor errors are non-fatal
    }
  }

  if (diffs.length === 0) return '';

  // Update stored competitor_set
  await getSupabaseAdmin()
    .from('products')
    .update({ competitor_set: competitorSet, updated_at: new Date().toISOString() })
    .eq('id', productId);

  return diffs
    .map((d) => `${d.name}: ${d.changes.join(', ')}`)
    .join('; ');
}

// ── Steps 1–5: Data gathering ─────────────────────────────────────────────────

interface ProductBriefTarget {
  productId: string;
  founderId: string;
  founderEmail: string;
  productName: string;
  category: string;
  competitorSet: CompetitorEntry[];
}

async function fetchAllActiveProducts(): Promise<ProductBriefTarget[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('products')
    .select('id, founder_id, name, category, competitor_set, founders(email)')
    .not('confirmed_icp', 'is', null);

  if (error || !data) {
    throw new Error(`Failed to fetch active products: ${error?.message}`);
  }

  return data.map((row) => ({
    productId: row.id,
    founderId: row.founder_id,
    founderEmail: (row.founders as { email?: string } | null)?.email ?? '',
    productName: row.name,
    category: row.category ?? 'Productivity',
    competitorSet: (row.competitor_set as CompetitorEntry[] | null) ?? [],
  }));
}

async function fetchProductTarget(productId: string, founderId: string): Promise<ProductBriefTarget> {
  const { data, error } = await getSupabaseAdmin()
    .from('products')
    .select('id, founder_id, name, category, competitor_set, founders(email)')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .single();

  if (error || !data) throw new Error(`Product not found: ${productId}`);

  return {
    productId: data.id,
    founderId: data.founder_id,
    founderEmail: (data.founders as { email?: string } | null)?.email ?? '',
    productName: data.name,
    category: data.category ?? 'Productivity',
    competitorSet: (data.competitor_set as CompetitorEntry[] | null) ?? [],
  };
}

async function fetchWeekMetrics(productId: string, weekStart: string): Promise<CampaignMetricRow[]> {
  // Fetch launched campaigns + their metrics for this week via join
  const { data: campaigns } = await getSupabaseAdmin()
    .from('campaigns')
    .select('id, channel, market, hook_type, products(price_tier, category)')
    .eq('product_id', productId)
    .in('status', ['launched', 'completed']);

  if (!campaigns || campaigns.length === 0) return [];

  const campaignIds = campaigns.map((c) => c.id);

  const { data: metrics, error } = await getSupabaseAdmin()
    .from('campaign_metrics')
    .select('campaign_id, week_start, impressions, clicks, installs, cpi, ctr, roas')
    .in('campaign_id', campaignIds)
    .eq('week_start', weekStart);

  if (error || !metrics) return [];

  return metrics.map((m) => {
    const campaign = campaigns.find((c) => c.id === m.campaign_id);
    const product = campaign?.products as { price_tier?: string; category?: string } | null;
    return {
      campaignId: m.campaign_id,
      channel: campaign?.channel ?? 'unknown',
      market: campaign?.market ?? 'usa',
      hookType: campaign?.hook_type ?? null,
      priceTier: product?.price_tier ?? null,
      category: product?.category ?? 'Productivity',
      impressions: m.impressions ?? 0,
      clicks: m.clicks ?? 0,
      installs: m.installs ?? 0,
      cpi: m.cpi,
      ctr: m.ctr,
      roas: m.roas,
      weekStart: m.week_start,
    };
  });
}

function classifyPerformers(metrics: CampaignMetricRow[]): {
  topPerformers: CampaignMetricRow[];
  bottomPerformers: CampaignMetricRow[];
} {
  const withData = metrics.filter((m) => m.impressions > 0);

  const topPerformers = withData
    .filter((m) => (m.roas != null && m.roas > 1) || m.installs > 0)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    .slice(0, 5);

  const bottomPerformers = withData
    .filter((m) => m.installs === 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 3);

  return { topPerformers, bottomPerformers };
}

// ── Full pipeline for one product ─────────────────────────────────────────────

async function runBriefPipeline(
  target: ProductBriefTarget,
  weekOf: string,
  triggeredBy: 'cron' | 'admin'
): Promise<void> {
  const { productId, founderId, founderEmail, productName, category } = target;

  console.log(`[weeklyBriefWorker] Starting brief productId=${productId.substring(0, 8)}… week=${weekOf}`);

  // Step 2.5: Competitor re-scrape (additive, non-fatal)
  let competitorDiff = '';
  try {
    if (target.competitorSet.length > 0) {
      competitorDiff = await rescrapeCompetitors(productId, target.competitorSet);
      if (competitorDiff) {
        console.log(`[weeklyBriefWorker] Competitor changes: ${competitorDiff}`);
      }
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { step: 'rescrapeCompetitors' } });
  }

  // Steps 1–3 already done (target fetched + weekOf set)
  const metrics = await fetchWeekMetrics(productId, weekOf);

  // Step 4–5: Classify
  const { topPerformers, bottomPerformers } = classifyPerformers(metrics);

  const input: BriefInput = {
    productId,
    founderId,
    founderEmail,
    productName,
    category,
    weekOf,
    metrics,
    topPerformers,
    bottomPerformers,
    competitorDiff: competitorDiff || undefined,
  };

  // Step 6: AI narrative
  const narrative = await generateBriefNarrative(input);

  // Step 7: Playbook signals (anonymised, PII-checked)
  try {
    await insertPlaybookSignals(metrics, category);
  } catch (piiErr) {
    // Non-fatal: log PII detection but don't abort the brief
    Sentry.captureException(piiErr, { tags: { step: 'insertPlaybookSignals' } });
    console.error(`[weeklyBriefWorker] PII detected in metrics — signals not written: ${String(piiErr)}`);
  }

  // Step 8: Upsert brief
  const briefId = await upsertWeeklyBrief(productId, founderId, weekOf, narrative, narrative.tokensConsumed);

  // Step 9: Send email (non-fatal)
  await sendBriefEmail(founderEmail, productName, briefId, weekOf, narrative);

  // Step 10: Audit log
  await writeBriefAuditLog(founderId, productId, briefId, narrative.tokensConsumed, triggeredBy);

  // Step 11: Low token balance warning (non-fatal)
  try {
    const TIER_ALLOCATION: Record<string, number> = { free: 50, solo: 300, builder: 1000, studio: 3000 };
    const { data: founderData } = await getSupabaseAdmin()
      .from('founders')
      .select('token_balance, plan, email')
      .eq('id', founderId)
      .single();

    if (founderData && founderData.token_balance !== null) {
      const allocation = TIER_ALLOCATION[founderData.plan ?? 'free'] ?? 50;
      const threshold = Math.floor(allocation * 0.20);
      if (founderData.token_balance < threshold) {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const appUrl = process.env.APP_BASE_URL ?? 'https://app.launchmind.com';
        await resend.emails.send({
          from: 'LaunchMind <notifications@launchmind.com>',
          to: founderData.email,
          subject: 'Your LaunchMind token balance is running low',
          html: `
            <h2>Token balance running low</h2>
            <p>Your balance is <strong>${founderData.token_balance} tokens</strong> — below 20% of your ${founderData.plan} plan allocation.</p>
            <p>Top up now to keep strategies, content, and briefs running without interruption.</p>
            <p><a href="${appUrl}/dashboard/billing">Top up tokens →</a></p>
            <p style="font-size:12px;color:#888">LaunchMind · <a href="${appUrl}/dashboard/settings">Manage notifications</a></p>
          `,
        });
        await getSupabaseAdmin().from('audit_logs').insert({
          founder_id: founderId,
          action: 'low_balance_warning_sent',
          resource_type: 'founder',
          metadata: { balance: founderData.token_balance, threshold, plan: founderData.plan },
        });
      }
    }
  } catch (warningErr) {
    Sentry.captureException(warningErr, { tags: { step: 'lowBalanceWarning', productId } });
  }

  console.log(`[weeklyBriefWorker] Brief complete productId=${productId.substring(0, 8)}… briefId=${briefId.substring(0, 8)}…`);
}

// ── BullMQ worker ─────────────────────────────────────────────────────────────

let _worker: Worker<BriefJobData> | null = null;

/**
 * Starts the BullMQ worker that processes weekly brief jobs.
 * Called once at server startup. Idempotent — does not start a second worker.
 * @param redisUrl - Redis connection string (default: process.env.REDIS_URL)
 */
export function startBriefWorker(redisUrl?: string): Worker<BriefJobData> {
  if (_worker) return _worker;

  const connection = new IORedis(redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  _worker = new Worker<BriefJobData>(
    BRIEF_QUEUE_NAME,
    async (job: Job<BriefJobData>) => {
      const { productId, founderId, weekOf: rawWeekOf, triggeredBy } = job.data;
      const weekOf = rawWeekOf || getCurrentWeekStart();

      if (productId === 'ALL') {
        // Cron job: process all active products
        const products = await fetchAllActiveProducts();
        console.log(`[weeklyBriefWorker] Cron: processing ${products.length} products for week=${weekOf}`);

        for (const target of products) {
          try {
            await runBriefPipeline(target, weekOf, triggeredBy);
          } catch (err) {
            Sentry.captureException(err, { extra: { productId: target.productId, weekOf } });
            console.error(`[weeklyBriefWorker] Pipeline failed for ${target.productId}: ${String(err)}`);
            // Continue with next product — don't abort the batch
          }
        }
      } else {
        // Manual trigger: single product
        const target = await fetchProductTarget(productId, founderId);
        await runBriefPipeline(target, weekOf, triggeredBy);
      }
    },
    {
      connection,
      concurrency: 1,
    }
  );

  _worker.on('completed', (job) => {
    console.log(`[weeklyBriefWorker] Job completed jobId=${job.id}`);
  });

  _worker.on('failed', (job, err) => {
    console.error(`[weeklyBriefWorker] Job failed jobId=${job?.id}: ${err.message}`);
    Sentry.captureException(err, { extra: { jobId: job?.id, jobData: job?.data } });
  });

  console.log('[weeklyBriefWorker] Worker started');
  return _worker;
}
