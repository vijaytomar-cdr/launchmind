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
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { validatePublicUrl, generatePreliminaryReport, extractAndStoreClaims } from '../services/onboardingService';
import { canonicalIdentityFromUrls, allCanonicalIdentities } from '../services/productIdentity';

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

/**
 * The service-role client.
 *
 * WAS: `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` — a fresh
 * client on every call, keyed on a NEXT_PUBLIC_ (frontend) variable. This was
 * the ONLY backend file reading that var, so a deployment that set SUPABASE_URL
 * but not NEXT_PUBLIC_SUPABASE_URL would run fine everywhere else and fail here
 * with "supabaseUrl is required" — at the moment a founder submits discovery,
 * which is the first thing a new owner does. Found by the E2E in this pass.
 *
 * getSupabaseAdmin() is the codebase's canonical accessor: same env contract as
 * every other service, and a lazily-initialised singleton rather than a new
 * client per query.
 */
function getSupabase() {
  return getSupabaseAdmin();
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
/**
 * Resolves the product an onboarding session is about, creating it only when it
 * does not already exist in the workspace.
 *
 * EXTRACTED FROM processDiscoveryJob UNCHANGED so it can be exercised directly.
 * The rest of that function scrapes the public web, and a test that had to stub
 * scraping to reach this logic would end up asserting against a copy of it —
 * which is how the original defect (workspace_id never selected) survived.
 * This is the code that actually runs in production.
 *
 * @param input.workspaceId - from the SESSION row, never from the job payload
 * @returns the resolved product id, or null when there was nothing to create
 * @throws {Error} when the session has no workspace, the workspace does not
 *   exist, or the founder does not own it — all refusals, never a fallback
 * @security Re-verifies workspace ownership against the workspaces row. An
 *   untenanted product is invisible to every workspace-scoped surface, so
 *   creating one "for now" is refused rather than deferred.
 */
export async function resolveOrCreateProduct(input: {
  sessionId:   string;
  founderId:   string;
  workspaceId: string | null;
  urls:        string[];
  storeUrl:    string | null;
  platform:    string;
  name:        string | null;
  scrapedMeta: Record<string, unknown>;
}): Promise<string | null> {
  const { sessionId, founderId, workspaceId, urls, storeUrl, platform, name, scrapedMeta } = input;

  // ── Tenant validation. Refuse rather than create an unscoped product ──
  // An untenanted product is invisible to every workspace-scoped surface
  // (Marketing Memory, evidence, shadow proposals, connections), so creating
  // one "for now" produces a product that silently cannot participate.
  if (!workspaceId) {
    throw new Error(
      'discovery cannot create a product: the onboarding session carries no workspace. ' +
      'Complete the workspace step first.');
  }
  const { data: ws } = await getSupabase()
    .from('workspaces').select('id, founder_id').eq('id', workspaceId).maybeSingle();
  if (!ws) throw new Error(`workspace ${workspaceId} does not exist`);
  // Ownership is re-verified against the workspace row, never taken from the
  // session payload alone.
  if (ws.founder_id !== founderId) {
    throw new Error('onboarding session founder does not own the target workspace');
  }

  let resolvedProductId: string | null = null;

  // ── BLOCKER 3 · duplicate prevention ──────────────────────────────────
  // Look the identity up FIRST rather than relying on ON CONFLICT: the unique
  // index is partial over two nullable columns, and inference against such an
  // index is the Phase 2 mistake. The 23505 catch below is the race backstop,
  // not the primary mechanism.
  const identity = canonicalIdentityFromUrls([storeUrl, ...urls]);
  // Matched against EVERY identity these URLs yield, not just the stored one.
  // A product on both stores has one canonical identity (apple:) but is equally
  // findable by its Play id — so a founder re-onboarding with only the Play link
  // must adopt the existing product instead of creating a second one.
  const candidateIdentities = allCanonicalIdentities([storeUrl, ...urls]);
  if (identity) {
    const { data: existing } = await getSupabase()
      .from('products')
      .select('id, name, archived_at')
      .eq('workspace_id', workspaceId)
      .in('canonical_identity', candidateIdentities)
      .maybeSingle();

    if (existing) {
      // Archived products are matched too — archiving must not become a way to
      // create duplicates. Nothing is overwritten either way; the existing
      // product is adopted and its context left untouched.
      resolvedProductId = existing.id;
      await getSupabase().from('onboarding_sessions')
        .update({ product_id: resolvedProductId }).eq('id', sessionId);
      console.log('[discovery] adopted existing product instead of duplicating:',
        JSON.stringify({
          sessionId, workspaceId, identity, productId: existing.id,
          outcome: existing.archived_at ? 'PRODUCT_ARCHIVED' : 'PRODUCT_ALREADY_EXISTS',
        }));
    }
  }

  if (!resolvedProductId) {
    const { data: newProduct, error: insertErr } = await getSupabase()
      .from('products')
      .insert({
        founder_id:   founderId,
        workspace_id: workspaceId,
        name:         name ?? 'My App',
        store_url:    storeUrl ?? urls[0],
        platform:     platform === 'web_only' ? 'app_store' : platform,
        canonical_identity: identity,
        scraped_meta: scrapedMeta,
        last_scraped_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // 23505 = two concurrent discoveries for the same identity. The other one
    // won; adopt its product rather than failing the owner's run.
    if (insertErr?.code === '23505' && identity) {
      const { data: raced } = await getSupabase()
        .from('products').select('id')
        .eq('workspace_id', workspaceId).eq('canonical_identity', identity).maybeSingle();
      if (raced) resolvedProductId = raced.id;
    } else if (insertErr) {
      throw new Error(`product creation failed: ${insertErr.message}`);
    } else if (newProduct) {
      resolvedProductId = newProduct.id;
    }

    if (resolvedProductId) {
      await getSupabase().from('onboarding_sessions')
        .update({ product_id: resolvedProductId })
        .eq('id', sessionId);
    }
  }

  return resolvedProductId;
}

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

    // Stage 2: Detect platforms
    //
    // EVERY url is classified, not just urls[0]. Previously `detectPlatform(urls[0])`
    // decided the whole run, so a founder who pasted App Store + Play Store + website
    // had the second store silently ignored — never scraped, never counted, absent
    // from the "channels observed" fact. Which store survived depended only on the
    // order the owner happened to type them in.
    await updateJobProgress(jobId, 2, 12, 'Identifying app store platforms…');
    const storeTargets = urls
      .map(u => detectPlatform(u))
      .filter((d): d is { platform: string; storeUrl: string } => Boolean(d.storeUrl))
      // One listing per platform: a repeated link must not be scraped twice.
      .filter((d, i, all) => all.findIndex(x => x.platform === d.platform) === i);
    const websiteUrl = urls.find(u => !detectPlatform(u).storeUrl) ?? null;

    // The PRIMARY store still drives the single-valued columns (products.platform,
    // store_url). App Store wins when both exist — a deterministic rule, so the
    // same three URLs always produce the same product regardless of input order.
    const primary = storeTargets.find(d => d.platform === 'app_store') ?? storeTargets[0] ?? null;

    await getSupabase().from('discovery_jobs').update({
      detected_platform: primary?.platform ?? 'web_only',
      store_url:         primary?.storeUrl ?? null,
      website_url:       websiteUrl,
    }).eq('id', jobId);

    if (!primary && urls.length >= 1) {
      // No app store URL — can still proceed with website-only discovery
      await updateJobProgress(jobId, 2, 15, 'Website URL detected — scraping site…');
    }

    // Stage 3: Scrape every store listing the owner gave us
    await updateJobProgress(jobId, 3, 22,
      storeTargets.length > 1 ? 'Reading your app listings…' : 'Reading your app listing…');
    let appMetadata: Record<string, unknown> = {};
    let scraped: Record<string, unknown> = {};
    /** Raw payload per platform, preserved so nothing the owner supplied is lost. */
    const storeResults: Array<{ platform: string; storeUrl: string; data: Record<string, unknown> }> = [];
    const storeFailures: Array<{ platform: string; message: string }> = [];

    if (storeTargets.length > 0) {
      const { scrapeAppStore, scrapePlayStore } = await import('../workers/scraperWorker');
      for (const target of storeTargets) {
        try {
          const raw = target.platform === 'app_store'
            ? await scrapeAppStore(target.storeUrl)
            : await scrapePlayStore(target.storeUrl);
          storeResults.push({ platform: target.platform, storeUrl: target.storeUrl,
                              data: raw as unknown as Record<string, unknown> });
        } catch (scrapeErr) {
          // PARTIAL FAILURE IS NOT TOTAL FAILURE. One dead listing must not discard
          // a good one — that would be worse than the old behaviour, which at least
          // finished with a single store.
          storeFailures.push({ platform: target.platform,
                               message: (scrapeErr as Error).message ?? 'Unknown error' });
        }
      }

      // Only fail the job when NOTHING could be read.
      if (storeResults.length === 0) {
        const msg = storeFailures[0]?.message ?? 'Unknown error';
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
      if (storeFailures.length > 0) {
        console.warn('[discovery] some store listings could not be read:',
          JSON.stringify({ jobId, failed: storeFailures, succeeded: storeResults.map(r => r.platform) }));
      }

      // Merge. The primary listing supplies the scalar fields (name, category,
      // description, price tier); the others contribute their reviews and are kept
      // verbatim under `stores` so nothing is thrown away.
      const primaryResult = storeResults.find(r => r.platform === primary?.platform) ?? storeResults[0];
      scraped     = primaryResult.data;
      appMetadata = { ...primaryResult.data };
    }

    // Stage 4: Analyse reviews — pooled across every listing that was read.
    // A Play-only review corpus was previously invisible whenever an App Store URL
    // was listed first.
    await updateJobProgress(jobId, 4, 38, 'Analysing user reviews…');
    const reviews = storeResults.flatMap(r =>
      (r.data.reviews as Array<{rating:number;text:string;date:string}>) ?? []);

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
      // DEFECT 3: websiteMeta was scraped successfully and then dropped here. It was
      // passed to resolveOrCreateProduct on a DIFFERENT object, so it reached
      // products.scraped_meta but never the claim builder — whose `hasWebsite` check
      // reads appData.websiteMeta and was therefore always false. The website was
      // read, stored, and still reported as "not a channel".
      websiteMeta,
      // DEFECT 2: the claim builder tested a single scalar `platform` with two
      // mutually exclusive ifs, so it could never name two stores. It now reads this
      // set; the scalar stays for callers that still pass one (intakeWorker).
      platforms: storeResults.map(r => r.platform),
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
      // workspace_id was previously NOT selected, so the product below was
      // inserted with no tenant at all. The workspace exists — saveWorkspace
      // writes it here at step 1 — it was simply never read. That is BLOCKER 2,
      // and it is why three AllignX products have workspace_id = null.
      .select('product_id, workspace_id, founder_id')
      .eq('id', sessionId)
      .single();

    const productId   = session.data?.product_id ?? null;
    const workspaceId = session.data?.workspace_id ?? null;

    // Create the product if it doesn't exist yet
    let resolvedProductId = productId;
    if (!resolvedProductId && (appMetadata.name || primary?.storeUrl)) {
      resolvedProductId = await resolveOrCreateProduct({
        sessionId, founderId, workspaceId,
        urls, storeUrl: primary?.storeUrl ?? null, platform: primary?.platform ?? 'web_only',
        name: (appMetadata.name as string) ?? null,
        // `stores` keeps every listing verbatim. products.platform and store_url
        // remain single-valued (the schema's CHECK allows one), so this is where
        // the second listing survives rather than being discarded.
        scrapedMeta: {
          ...appMetadata, websiteMeta, reviews,
          platforms: storeResults.map(r => r.platform),
          stores: storeResults.map(r => ({ platform: r.platform, storeUrl: r.storeUrl, data: r.data })),
          storeFailures,
        },
      });
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
