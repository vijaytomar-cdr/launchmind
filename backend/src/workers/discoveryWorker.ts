/**
 * @file workers/discoveryWorker.ts
 * @description BullMQ worker for Phase 1 discovery jobs.
 *   Runs 11 progress stages: URL validation, platform detection, app scraping,
 *   review scraping, website scraping, ICP generation, competitor discovery,
 *   preliminary report generation, claim extraction, claim scoring, and finalization.
 *   Each stage updates discovery_jobs.progress and .progress_message.
 *   All 9 error scenarios from the spec are mapped to structured error_code values.
 * @security SSRF protection applied before any outbound request.
 *   Phase 1 cannot create platform tokens or trigger ad spend (see spec §28).
 * @dependencies bullmq, supabase, onboardingService, icpService
 */

import { Queue, Worker, Job } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import { validatePublicUrl, generatePreliminaryReport, extractAndStoreClaims } from '../services/onboardingService';

const DISCOVERY_QUEUE = 'launchmind-discovery';

export interface DiscoveryJobPayload {
  jobId:              string;
  sessionId:          string;
  founderId:          string;
  urls:               string[];
  privateDescription?: string;
}

let discoveryQueue: Queue | null = null;
let discoveryWorker: Worker | null = null;

function getQueue(): Queue {
  if (!discoveryQueue) {
    discoveryQueue = new Queue(DISCOVERY_QUEUE, {
      connection: { url: process.env.REDIS_URL },
    });
  }
  return discoveryQueue;
}

/**
 * Enqueues a discovery job and returns the BullMQ job ID.
 */
export async function enqueueDiscovery(payload: DiscoveryJobPayload): Promise<string> {
  const queue  = getQueue();
  const job    = await queue.add('discovery', payload, {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 },
    removeOnFail:     { age: 604800 },
  });
  return job.id!;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function updateJobProgress(
  jobId:   string,
  stage:   number,
  pct:     number,
  message: string,
  extra?:  Record<string, unknown>,
) {
  const supabase = getSupabase();
  await supabase.from('discovery_jobs').update({
    status:           'running',
    progress:         pct,
    progress_stage:   stage,
    progress_message: message,
    last_attempted_at: new Date().toISOString(),
    ...extra,
  }).eq('id', jobId);
}

async function failJob(jobId: string, errorCode: string, errorMessage: string) {
  const supabase = getSupabase();
  await supabase.from('discovery_jobs').update({
    status:        'failed',
    error_code:    errorCode,
    error_message: errorMessage,
  }).eq('id', jobId);
}

async function updateSessionState(sessionId: string, state: string) {
  const supabase = getSupabase();
  await supabase.from('onboarding_sessions')
    .update({ current_state: state, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
}

/**
 * Detects the platform from a submitted URL.
 */
function detectPlatform(url: string): { platform: string; storeUrl: string | null } {
  const lower = url.toLowerCase();
  if (lower.includes('apps.apple.com') || lower.includes('itunes.apple.com')) {
    return { platform: 'app_store', storeUrl: url };
  }
  if (lower.includes('play.google.com')) {
    return { platform: 'play_store', storeUrl: url };
  }
  return { platform: 'web_only', storeUrl: null };
}

/**
 * Main discovery job processor.
 * 11 stages, each with progress updates.
 */
async function processDiscoveryJob(job: Job<DiscoveryJobPayload>): Promise<void> {
  const { jobId, sessionId, founderId, urls, privateDescription } = job.data;

  try {
    // Stage 1: Validate URLs (SSRF protection)
    await updateJobProgress(jobId, 1, 5, 'Validating app URL…');
    for (const url of urls) {
      try {
        validatePublicUrl(url);
      } catch {
        await failJob(jobId, 'INVALID_URL', `The URL "${url}" is not accessible.`);
        await updateSessionState(sessionId, 'DISCOVERY_FAILED');
        return;
      }
    }

    // Stage 2: Detect platform
    await updateJobProgress(jobId, 2, 12, 'Identifying app store platform…');
    const detection = detectPlatform(urls[0]);
    const websiteUrl = urls.find(u => !detectPlatform(u).storeUrl) ?? null;

    await getSupabase().from('discovery_jobs').update({
      detected_platform: detection.platform,
      store_url:         detection.storeUrl ?? null,
      website_url:       websiteUrl,
    }).eq('id', jobId);

    if (detection.platform === 'web_only' && urls.length === 1) {
      // No app store URL — can still proceed with website-only discovery
      await updateJobProgress(jobId, 2, 15, 'Website URL detected — scraping site…');
    }

    // Stage 3: Scrape app metadata (reuse existing icpService scraper)
    await updateJobProgress(jobId, 3, 22, 'Reading your app listing…');
    let appMetadata: Record<string, unknown> = {};
    let scraped: Record<string, unknown> = {};

    if (detection.storeUrl) {
      try {
        const { scrapeAppStore, scrapePlayStore } = await import('../workers/scraperWorker');
        const rawScraped = detection.platform === 'app_store'
          ? await scrapeAppStore(detection.storeUrl)
          : await scrapePlayStore(detection.storeUrl);
        scraped     = rawScraped as unknown as Record<string, unknown>;
        appMetadata = scraped;
      } catch (scrapeErr) {
        const msg = (scrapeErr as Error).message ?? 'Unknown error';
        if (msg.includes('not found') || msg.includes('404')) {
          await failJob(jobId, 'APP_NOT_FOUND', 'Could not find the app on the store. Check the URL and try again.');
        } else if (msg.includes('parse') || msg.includes('schema')) {
          await failJob(jobId, 'STORE_PARSE_FAILED', 'Could not read the app listing. The store may have changed format.');
        } else {
          await failJob(jobId, 'SCRAPE_FAILED', `App scraping failed: ${msg}`);
        }
        await updateSessionState(sessionId, 'DISCOVERY_FAILED');
        return;
      }
    }

    // Stage 4: Analyse reviews
    await updateJobProgress(jobId, 4, 38, 'Analysing user reviews…');
    const reviews = (scraped.reviews as Array<{rating:number;text:string;date:string}>) ?? [];

    // Stage 5: Scrape website (if URL provided)
    await updateJobProgress(jobId, 5, 48, 'Reading your website…');
    let websiteMeta: Record<string, unknown> = {};
    if (websiteUrl) {
      try {
        const { scrapeWebsite } = await import('../services/icpService');
        websiteMeta = await scrapeWebsite(websiteUrl) as unknown as Record<string, unknown>;
      } catch {
        // Website scraping is best-effort — failure doesn't block discovery
        websiteMeta = {};
      }
    }

    // Stage 6: Generate ICP from scraped data + review analysis
    await updateJobProgress(jobId, 6, 58, 'Building your ideal customer profile…');
    let icpData: Record<string, unknown> = {};
    try {
      const { analyseReviews } = await import('../services/reviewAnalysis');
      const { buildICPBrief } = await import('../services/icpService');
      const { ScrapedAppDataSchema } = await import('../types/scraper');
      const parsed = ScrapedAppDataSchema.safeParse(scraped);
      if (parsed.success) {
        const reviewAnalysis = await analyseReviews(parsed.data.reviews ?? [], founderId);
        icpData = buildICPBrief(parsed.data, reviewAnalysis) as unknown as Record<string, unknown>;
      }
    } catch {
      // ICP generation failure is non-fatal — proceed with empty ICP
      icpData = {};
    }

    // Stage 7: Infer competitors via Claude Haiku — works even with 0 reviews
    await updateJobProgress(jobId, 7, 68, 'Identifying competitors…');
    let competitorData: Record<string, unknown> = {};
    try {
      const { inferCompetitors } = await import('../services/icpService');
      const competitors = await inferCompetitors({
        appName:            String(appMetadata.name ?? ''),
        category:           String(appMetadata.category ?? ''),
        description:        String(appMetadata.description ?? ''),
        targetUser:         typeof icpData.targetUser === 'string' ? icpData.targetUser : undefined,
        privateDescription: privateDescription,
      });
      if (competitors.length > 0) {
        competitorData = { competitors };
      }
    } catch {
      // Best-effort — competitor inference failure never blocks discovery
    }

    // Stage 8: Generate preliminary report
    await updateJobProgress(jobId, 8, 76, 'Generating growth insights…');
    const combinedAppData = {
      ...appMetadata,
      name:      appMetadata.name ?? (scraped.name as string),
      reviews,
      icp:       icpData,
      metadata:  appMetadata,
    };

    // generatePreliminaryReport persists the report itself; nothing downstream in
    // this worker reads its return value. The previous code assigned it, and on
    // failure built a whole fallback object that was then discarded — so the
    // "show partial report" the comment promised never actually happened.
    try {
      await generatePreliminaryReport(jobId, founderId, combinedAppData);
    } catch (err) {
      // Non-fatal: discovery continues and the report page renders its own empty
      // state. Logged so a silent absence is still traceable.
      console.warn(`[discoveryWorker] preliminary report failed job=${jobId}:`, (err as Error).message);
    }

    // Stage 9: Extract claims
    await updateJobProgress(jobId, 9, 85, 'Extracting key beliefs…');
    const session = await getSupabase()
      .from('onboarding_sessions')
      .select('product_id')
      .eq('id', sessionId)
      .single();

    const productId = session.data?.product_id ?? null;

    // Create the product if it doesn't exist yet
    let resolvedProductId = productId;
    if (!resolvedProductId && (appMetadata.name || detection.storeUrl)) {
      const { data: newProduct } = await getSupabase()
        .from('products')
        .insert({
          founder_id:   founderId,
          name:         (appMetadata.name as string) ?? 'My App',
          store_url:    detection.storeUrl ?? urls[0],
          platform:     detection.platform === 'web_only' ? 'app_store' : detection.platform,
          scraped_meta: { ...appMetadata, websiteMeta, reviews },
          last_scraped_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (newProduct) {
        resolvedProductId = newProduct.id;
        await getSupabase().from('onboarding_sessions')
          .update({ product_id: resolvedProductId })
          .eq('id', sessionId);
      }
    }

    await extractAndStoreClaims(sessionId, founderId, resolvedProductId, combinedAppData);

    // Stage 10: Score and rank claims (lightweight — already confidence-scored during extraction)
    await updateJobProgress(jobId, 10, 93, 'Scoring insights…');

    // Stage 11: Finalize
    await updateJobProgress(jobId, 11, 100, 'Discovery complete!', {
      status:          'completed',
      app_metadata:    appMetadata,
      icp_data:        icpData,
      competitor_data: competitorData,
      website_meta:    websiteMeta,
    });

    await updateSessionState(sessionId, 'PRELIMINARY_REPORT');

  } catch (err) {
    const msg = (err as Error).message ?? 'Unknown error';
    await failJob(jobId, 'UNEXPECTED_ERROR', msg);
    await updateSessionState(sessionId, 'DISCOVERY_FAILED');
    throw err; // BullMQ will retry
  }
}

/**
 * Starts the discovery BullMQ worker.
 * Called from server.ts when Redis is configured.
 */
export function startDiscoveryWorker(): void {
  if (discoveryWorker) return;

  discoveryWorker = new Worker(
    DISCOVERY_QUEUE,
    processDiscoveryJob,
    {
      connection:  { url: process.env.REDIS_URL },
      concurrency: 3,
    },
  );

  discoveryWorker.on('failed', (job, err) => {
    console.error(`[discoveryWorker] Job ${job?.id} failed:`, err.message);
  });

  discoveryWorker.on('completed', (job) => {
    console.log(`[discoveryWorker] Job ${job.id} completed`);
  });
}

export function stopDiscoveryWorker(): Promise<void> | undefined {
  return discoveryWorker?.close();
}
