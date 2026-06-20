/**
 * @file intakeWorker.ts
 * @description BullMQ worker for the Phase 5 async product intake scrape pipeline.
 *   Processes jobs enqueued by POST /products/scrape (multi-URL path).
 *   On completion: updates product row with scraped_meta, confirmed_icp, website_meta, intake_step=2.
 *   On failure:    sets intake_step=-1 so the frontend can show an error state.
 * @security
 *   - founderId verified against product.founder_id before any DB write.
 *   - Scraper crash is isolated — does not affect the Fastify API process.
 *   - No PII logged; productId and founderId logged as 8-char prefixes only.
 * @dependencies scraperWorker, reviewAnalysis, icpService, scraperQueue, supabaseAdmin, Sentry
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as Sentry from '@sentry/node';
import { SCRAPE_QUEUE_NAME, type ScrapeJobData, type ScrapeJobResult } from '../lib/scraperQueue';
import {
  detectPlatform,
  scrapeAppStore,
  scrapePlayStore,
  scrapeCompetitors,
} from './scraperWorker';
import { analyseReviews } from '../services/reviewAnalysis';
import { buildICPBrief, scrapeWebsite } from '../services/icpService';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

let _intakeWorker: Worker<ScrapeJobData, ScrapeJobResult> | null = null;

/**
 * Starts the singleton BullMQ intake worker.
 * Idempotent — calling twice is safe (returns early if already running).
 * Should be called once at server startup alongside startBriefWorker().
 */
export function startIntakeWorker(): void {
  if (_intakeWorker) return;

  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => Math.min(times * 500, 30_000),
  });
  let _warnedOnce = false;
  connection.on('error', (err: Error) => {
    if (process.env.NODE_ENV !== 'production' && !_warnedOnce) {
      console.warn('[intakeWorker] Redis unavailable — worker idle:', err.message);
      _warnedOnce = true;
    }
  });

  _intakeWorker = new Worker<ScrapeJobData, ScrapeJobResult>(
    SCRAPE_QUEUE_NAME,
    async (job: Job<ScrapeJobData, ScrapeJobResult>): Promise<ScrapeJobResult> => {
      const { productId, founderId, appStoreUrl, playStoreUrl, websiteUrl } = job.data;

      // Verify product ownership before doing any work
      const { data: product, error: ownerErr } = await getSupabaseAdmin()
        .from('products')
        .select('id, founder_id')
        .eq('id', productId)
        .eq('founder_id', founderId)
        .single();

      if (ownerErr || !product) {
        throw new Error(`Product ${productId.substring(0, 8)} not found or access denied`);
      }

      try {
        // Prefer Play Store when both URLs present — google-play-scraper is a direct API
        // call (~1-2s, no HTML parsing). App Store uses Cheerio which can fail on layout changes.
        const storeUrl = playStoreUrl ?? appStoreUrl;
        if (!storeUrl) throw new Error('No store URL in job data');

        const platform = detectPlatform(storeUrl);
        if (!platform) throw new Error(`Cannot detect platform from URL: ${storeUrl}`);

        await job.updateProgress({ status: platform === 'play_store' ? 'scraping_play_store' : 'scraping_app_store', pct: 10 });

        const scraped =
          platform === 'app_store'
            ? await scrapeAppStore(storeUrl)
            : await scrapePlayStore(storeUrl);

        await job.updateProgress({ status: 'analysing_reviews', pct: 40 });

        const [reviewAnalysis, competitors] = await Promise.all([
          analyseReviews(scraped.reviews, founderId),
          (async () => {
            await job.updateProgress({ status: 'finding_competitors', pct: 55 });
            return scrapeCompetitors(scraped.category, platform).catch(() => []);
          })(),
        ]);

        await job.updateProgress({ status: websiteUrl ? 'scraping_website' : 'matching_playbook', pct: 70 });

        const icpBrief = buildICPBrief(scraped, reviewAnalysis);

        let websiteMeta: unknown = null;
        if (websiteUrl) {
          websiteMeta = await scrapeWebsite(websiteUrl).catch(() => null);
        }

        await job.updateProgress({ status: 'building_icp', pct: 90 });

        await getSupabaseAdmin()
          .from('products')
          .update({
            name: scraped.name,
            store_url: storeUrl,
            platform,
            category: scraped.category,
            price_tier: scraped.priceTier,
            scraped_meta: scraped,
            confirmed_icp: icpBrief,
            competitor_set: competitors,
            website_meta: websiteMeta,
            last_scraped_at: new Date().toISOString(),
            intake_step: 2,
            updated_at: new Date().toISOString(),
          })
          .eq('id', productId)
          .eq('founder_id', founderId);

        await job.updateProgress(100);

        console.log(
          `[intakeWorker] Completed product=${productId.substring(0, 8)}… name="${scraped.name}"`
        );

        return { productId, scraped, icpBrief, competitors, websiteMeta };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { worker: 'intakeWorker', productId: productId.substring(0, 8) },
        });

        await getSupabaseAdmin()
          .from('products')
          .update({ intake_step: -1, updated_at: new Date().toISOString() })
          .eq('id', productId)
          .eq('founder_id', founderId);

        throw err;
      }
    },
    { connection, concurrency: 2 }
  );

  _intakeWorker.on('failed', (job, err) => {
    console.error(`[intakeWorker] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[intakeWorker] Intake worker started');
}
