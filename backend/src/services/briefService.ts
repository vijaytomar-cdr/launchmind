/**
 * @file briefService.ts
 * @description Steps 6–10 of the weekly brief pipeline.
 *   Step 6: generateBriefNarrative() — Claude Haiku: what_worked / what_to_kill / next_actions
 *   Step 7: insertPlaybookSignals() — anonymize → auditForPII → INSERT playbook_signals
 *   Step 8: upsertWeeklyBrief() — write weekly_briefs row (status: 'draft')
 *   Step 9: sendBriefEmail() — Resend transactional email, update status → 'sent'
 *   Step 10: writeBriefAuditLog() — immutable audit_log entry
 * @security
 *   - insertPlaybookSignals() always calls auditForPII() before INSERT; throws on PII.
 *   - No founder PII is written to playbook_signals under any circumstance.
 *   - founderId + productId are used for weekly_briefs only (founder-scoped table, RLS).
 *   - Email content is generated per-founder; never shared across founders.
 *   - consumeTokens() called before every Claude API call (20 tokens for brief).
 * @dependencies @anthropic-ai/sdk, resend, anonymizationService, supabaseAdmin, tokens, Sentry
 */

import { callMessages } from '../lib/aiPlatform';
import { Resend } from 'resend';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { consumeTokens } from '../lib/tokens';
import { anonymizeAndAudit, PIIDetectedError } from './anonymizationService';

function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CampaignMetricRow {
  campaignId: string;
  channel: string;
  market: string;
  hookType: string | null;
  priceTier: string | null;
  category: string;
  impressions: number;
  clicks: number;
  installs: number;
  cpi: number | null;
  ctr: number | null;
  roas: number | null;
  weekStart: string;
}

export interface BriefInput {
  productId: string;
  founderId: string;
  founderEmail: string;
  productName: string;
  category: string;
  weekOf: string;
  metrics: CampaignMetricRow[];
  topPerformers: CampaignMetricRow[];
  bottomPerformers: CampaignMetricRow[];
  competitorDiff?: string;
}

export interface BriefNarrative {
  whatWorked: string;
  whatToKill: string;
  nextActions: Array<{ channel: string; hookType: string; rationale: string; market: string }>;
  tokensConsumed: number;
}

// ── Step 6: Generate AI narrative ─────────────────────────────────────────────

const BRIEF_SYSTEM = `You are a concise performance marketing analyst.
Given campaign metrics for the past week, summarise performance and recommend next actions.
Return ONLY valid JSON — no markdown, no explanation.
Be specific: name channels and hook types. Keep each text field under 200 characters.`;

/**
 * Step 6: Calls Claude Haiku to generate the weekly brief narrative.
 * 20 tokens consumed — Haiku is used for cost efficiency on this recurring job.
 * @param input - Brief input with top/bottom performers
 * @returns     BriefNarrative with what_worked, what_to_kill, next_actions
 * @throws {Error} If Claude returns invalid JSON
 */
export async function generateBriefNarrative(input: BriefInput): Promise<BriefNarrative> {
  await consumeTokens(input.founderId, 'weekly_brief', 20);

  const topSummary = input.topPerformers
    .map((m) => `${m.channel}/${m.market} ROAS=${m.roas?.toFixed(2) ?? 'n/a'} installs=${m.installs} hook=${m.hookType ?? 'unknown'}`)
    .join('\n') || 'No top performers this week.';

  const bottomSummary = input.bottomPerformers
    .map((m) => `${m.channel}/${m.market} impressions=${m.impressions} installs=${m.installs} ctr=${m.ctr?.toFixed(3) ?? 'n/a'}`)
    .join('\n') || 'No bottom performers identified.';

  const competitorContext = input.competitorDiff
    ? `\nCompetitor changes this week:\n${input.competitorDiff}`
    : '';

  const prompt = `Product: ${input.productName} (${input.category})
Week of: ${input.weekOf}

Top performers:
${topSummary}

Bottom performers / kill list:
${bottomSummary}${competitorContext}

Return JSON:
{
  "whatWorked": "1–2 sentence summary of what drove results",
  "whatToKill": "1–2 sentence summary of what to pause",
  "nextActions": [
    { "channel": "meta"|"google"|"whatsapp"|"linkedin"|"email", "hookType": "pain_first"|"social_proof"|"fomo"|"outcome"|"curiosity", "rationale": "short reason", "market": "usa"|"india" }
  ]
}
nextActions: 2–4 items maximum. Prioritise pain_first hooks for underperforming channels.`;

  const raw = await callMessages('haiku', [{ role: 'user', content: prompt }], BRIEF_SYSTEM, 600);

  let parsed: { whatWorked: string; whatToKill: string; nextActions: BriefNarrative['nextActions'] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    Sentry.captureMessage('Weekly brief JSON parse failed', { extra: { raw: raw.substring(0, 500) } });
    throw new Error('Claude returned invalid JSON for weekly brief narrative');
  }

  return {
    whatWorked: parsed.whatWorked ?? '',
    whatToKill: parsed.whatToKill ?? '',
    nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
    tokensConsumed: 20,
  };
}

// ── Step 7: Insert playbook_signals (anonymized, PII-checked) ─────────────────

/**
 * Step 7: Converts campaign metrics to anonymised playbook signals and INSERTs them.
 * auditForPII() is called on every row — throws PIIDetectedError if PII found.
 * Skips rows with 0 impressions (no signal to learn from).
 * @param metrics  - Campaign metric rows for the week
 * @param category - App category (for signal context)
 * @throws {PIIDetectedError} If anonymized data still contains PII
 */
export async function insertPlaybookSignals(
  metrics: CampaignMetricRow[],
  category: string
): Promise<void> {
  const rows: Record<string, unknown>[] = [];

  for (const m of metrics) {
    if ((m.impressions ?? 0) === 0) continue;

    const raw: Record<string, unknown> = {
      category,
      market: m.market,
      channel: m.channel,
      hook_type: m.hookType,
      price_tier: m.priceTier,
      install_delta_pct: m.installs > 0 && m.impressions > 0
        ? parseFloat(((m.installs / m.impressions) * 100).toFixed(2))
        : 0,
      conversion_rate: m.ctr ?? 0,
      retention_d7: null,
      week_number: getISOWeekNumber(new Date(m.weekStart)),
    };

    // Anonymize (allowlist filter) then audit — throws on PII
    const safe = anonymizeAndAudit(raw);
    rows.push(safe);
  }

  if (rows.length === 0) return;

  const { error } = await getSupabaseAdmin()
    .from('playbook_signals')
    .insert(rows);

  if (error) {
    Sentry.captureException(new Error(`playbook_signals insert failed: ${error.message}`));
    throw new Error(`Failed to insert playbook_signals: ${error.message}`);
  }
}

// ── Step 8: Upsert weekly_briefs row ─────────────────────────────────────────

/**
 * Step 8: Writes the weekly brief to the weekly_briefs table (status: 'draft').
 * Uses upsert on (product_id, week_of) — idempotent if re-run for the same week.
 * @param productId  - UUID of the product
 * @param founderId  - UUID of the founder
 * @param weekOf     - ISO date YYYY-MM-DD (week_of)
 * @param narrative  - Generated AI narrative
 * @param tokensConsumed - Total AI tokens used
 * @returns          The upserted weekly_brief row id
 */
export async function upsertWeeklyBrief(
  productId: string,
  founderId: string,
  weekOf: string,
  narrative: BriefNarrative,
  tokensConsumed: number
): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .from('weekly_briefs')
    .upsert(
      {
        product_id: productId,
        founder_id: founderId,
        week_of: weekOf,
        what_worked: narrative.whatWorked,
        what_to_kill: narrative.whatToKill,
        next_actions: narrative.nextActions,
        ai_tokens_consumed: tokensConsumed,
        status: 'draft',
      },
      { onConflict: 'product_id,week_of' }
    )
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert weekly_brief: ${error?.message ?? 'no data'}`);
  }

  // Advance to step 4 (brief_received)
  await getSupabaseAdmin()
    .from('founders')
    .update({ onboarding_step: 4, updated_at: new Date().toISOString() })
    .eq('id', founderId)
    .lt('onboarding_step', 4);

  return data.id;
}

// ── Step 9: Send brief email ──────────────────────────────────────────────────

/**
 * Step 9: Sends the weekly brief email to the founder via Resend.
 * Updates weekly_briefs.status → 'sent' and sets sent_at on success.
 * Silently logs on email failure — does not throw (brief is already saved).
 * @param founderEmail - Founder's email address
 * @param productName  - Product name for subject line
 * @param briefId      - UUID of the weekly_briefs row
 * @param weekOf       - Week date string
 * @param narrative    - Generated narrative content
 */
export async function sendBriefEmail(
  founderEmail: string,
  productName: string,
  briefId: string,
  weekOf: string,
  narrative: BriefNarrative,
  clientName?: string          // White-label: pass workspace.client_name to replace "LaunchMind"
): Promise<void> {
  const resend = getResend();
  const brand = clientName ?? 'LaunchMind';
  const appUrl = process.env.APP_BASE_URL ?? 'https://app.launchmind.com';
  const fromAddress = clientName
    ? `${clientName} Weekly Brief <briefs@launchmind.com>`
    : 'LaunchMind Weekly Brief <briefs@launchmind.com>';

  const nextActionsHtml = narrative.nextActions
    .map(
      (a) =>
        `<li><strong>${a.channel}</strong> (${a.market}): ${a.rationale} — hook: <em>${a.hookType}</em></li>`
    )
    .join('');

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: founderEmail,
    subject: `${productName} — Week of ${weekOf} Brief`,
    html: `
      <h2>${productName} Weekly Brief — ${weekOf}</h2>
      <h3>What Worked</h3>
      <p>${narrative.whatWorked || 'No data for this week.'}</p>
      <h3>What to Kill</h3>
      <p>${narrative.whatToKill || 'Nothing to pause this week.'}</p>
      <h3>Next Actions</h3>
      <ul>${nextActionsHtml || '<li>No recommendations this week.</li>'}</ul>
      <hr/>
      <p style="font-size:12px;color:#888">
        View full brief in your <a href="${appUrl}/dashboard/briefs">${brand} dashboard</a>.
      </p>
    `,
  });

  if (error) {
    console.error(`[briefService] Email send failed for ${briefId}: ${error.message}`);
    Sentry.captureException(new Error(`Brief email failed: ${error.message}`), {
      extra: { briefId, founderEmail: founderEmail.split('@')[1] },
    });
    return; // non-fatal — brief is saved in DB
  }

  // Update status to 'sent'
  await getSupabaseAdmin()
    .from('weekly_briefs')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', briefId);
}

// ── Step 10: Audit log ────────────────────────────────────────────────────────

/**
 * Step 10: Writes an immutable audit_log entry for the completed brief.
 * @param founderId    - UUID of the founder
 * @param productId    - UUID of the product
 * @param briefId      - UUID of the weekly_briefs row
 * @param tokensConsumed - Total AI tokens consumed
 * @param triggeredBy  - 'cron' | 'admin'
 */
export async function writeBriefAuditLog(
  founderId: string,
  productId: string,
  briefId: string,
  tokensConsumed: number,
  triggeredBy: 'cron' | 'admin'
): Promise<void> {
  await getSupabaseAdmin().from('audit_logs').insert({
    founder_id: founderId,
    action: 'weekly_brief_generated',
    resource_type: 'weekly_brief',
    resource_id: briefId,
    metadata: { productId, tokensConsumed, triggeredBy },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
