/**
 * @file services/onboardingService.ts
 * @description Phase 1 onboarding state machine and data management service.
 *   All state transitions go through this service — never mutate state directly.
 *   Uses optimistic concurrency (lock_version) to prevent conflicting transitions.
 * @security All operations verify founder_id matches session. No cross-founder access.
 * @dependencies supabase, aiPlatform, types/onboarding
 */

import {
  OnboardingSession, OnboardingState, DiscoveryJob, ProductClaim,
  StrategyDirection, PreliminaryReport, VALID_TRANSITIONS, CandidateMatch,
  isOwnerAssertedChannel,
} from '../types/onboarding';
import { callSonnet, callHaiku } from '../lib/aiPlatform';
import type { AuditContext } from '../lib/aiPlatform';
import { consumeTokens } from '../lib/tokens';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { resolveMemoryWorkspace } from './memory/workspaceResolver';
import {
  admitFounderBootstrap, BOOTSTRAP_SOURCE, type FounderBootstrapCandidate,
} from './memory/founderBootstrapPolicy';

function getSupabase() {
  return getSupabaseAdmin();
}

// ── Session Management ────────────────────────────────────────────────────

/**
 * Returns the active onboarding session for a founder, creating one if none exists.
 * @param founderId - authenticated founder UUID
 * @returns OnboardingSession
 */
export async function createOrResumeSession(founderId: string): Promise<OnboardingSession> {
  const supabase = getSupabase();

  // Look for an existing active (non-complete) session
  const { data: existing } = await supabase
    .from('onboarding_sessions')
    .select('*')
    .eq('founder_id', founderId)
    .neq('current_state', 'PHASE_1_COMPLETE')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) return existing as OnboardingSession;

  // Create a new session
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .insert({ founder_id: founderId, current_state: 'WORKSPACE_SETUP' })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create onboarding session: ${error.message}`);
  return data as OnboardingSession;
}

/**
 * Fetches a session, verifying ownership.
 */
export async function getSession(sessionId: string, founderId: string): Promise<OnboardingSession> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('founder_id', founderId)
    .single();

  if (error || !data) throw Object.assign(new Error('Session not found'), { statusCode: 404 });
  return data as OnboardingSession;
}

/**
 * Returns the session plus all related alignment data (founder_context, business_goals,
 * approval_boundary_policies, competitor_relationships) needed for the final review page.
 * Uses parallel queries — non-fatal if a related table has no row yet.
 */
export async function getSessionWithContext(sessionId: string, founderId: string): Promise<OnboardingSession> {
  const supabase = getSupabase();

  const [
    { data: sessionRow, error: sessionErr },
    { data: founderCtx },
    { data: goal },
    { data: boundary },
    { data: competitors },
  ] = await Promise.all([
    supabase.from('onboarding_sessions').select('*').eq('id', sessionId).eq('founder_id', founderId).single(),
    supabase.from('founder_context').select('audience_confirmed,audience_additions,context_delta,hidden_strengths,recent_wins,working_style').eq('session_id', sessionId).maybeSingle(),
    supabase.from('business_goals').select('goal_type,custom_metric,baseline_value,target_value,unit,time_horizon_days,motivation').eq('session_id', sessionId).maybeSingle(),
    supabase.from('approval_boundary_policies').select('working_style,weekly_spend_cap_usd,founder_acknowledged').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('competitor_relationships').select('id,name,relationship,key_differentiator,discovered_by').eq('session_id', sessionId).neq('relationship', 'REJECTED'),
  ]);

  if (sessionErr || !sessionRow) throw Object.assign(new Error('Session not found'), { statusCode: 404 });

  return {
    ...(sessionRow as OnboardingSession),
    founder_context:  founderCtx  ?? null,
    business_goal:    goal        ?? null,
    approval_boundary: boundary   ?? null,
    competitor_set:   competitors ?? [],
  } as OnboardingSession;
}

/**
 * Applies a state transition with optimistic locking.
 * @throws if transition is invalid or lock_version mismatch
 */
export async function transitionState(
  sessionId: string,
  founderId: string,
  newState:  OnboardingState,
  extraData?: Record<string, unknown>,
): Promise<OnboardingSession> {
  const supabase = getSupabase();
  const session  = await getSession(sessionId, founderId);

  const allowed = VALID_TRANSITIONS[session.current_state];
  if (!allowed.includes(newState)) {
    throw Object.assign(
      new Error(`Invalid transition: ${session.current_state} → ${newState}`),
      { statusCode: 409 },
    );
  }

  const stepsMap: Record<OnboardingState, number> = {
    WORKSPACE_SETUP: 0, DISCOVERY_PENDING: 1, DISCOVERY_IN_PROGRESS: 2,
    DISCOVERY_MATCH_NEEDED: 2, DISCOVERY_FAILED: 2,
    PRELIMINARY_REPORT: 3, BELIEF_REVIEW: 4, ALIGNMENT_AUDIENCE: 5,
    // Positioning shares step 5 with audience: it is the same "who and why"
    // stage of the flow, and giving it its own number would make the progress
    // bar look longer than the flow actually got.
    ALIGNMENT_POSITIONING: 5,
    ALIGNMENT_CONTEXT: 6, ALIGNMENT_GOAL: 7, ALIGNMENT_COMPETITORS: 8,
    BOUNDARIES_SETUP: 9, FINAL_REVIEW: 10, DIRECTION_GENERATING: 11,
    DIRECTION_COMPLETE: 12, PHASE_1_COMPLETE: 15,
  };

  const { data, error } = await supabase
    .from('onboarding_sessions')
    .update({
      current_state:  newState,
      lock_version:   session.lock_version + 1,
      step_completed: stepsMap[newState] ?? session.step_completed,
      updated_at:     new Date().toISOString(),
      ...extraData,
    })
    .eq('id', sessionId)
    .eq('founder_id', founderId)
    .eq('lock_version', session.lock_version)  // optimistic lock
    .select('*')
    .single();

  // A LOST OPTIMISTIC LOCK AND A REJECTED WRITE ARE NOT THE SAME FAILURE.
  // This previously reported every failure as "modified concurrently", so a
  // CHECK-constraint violation (23514 — the state missing from the constraint,
  // fixed in migration 104) told the owner to refresh and try again, which could
  // never succeed. A lost lock returns no error and no row; anything with an
  // error code is a real database rejection and must say so.
  if (error) {
    throw Object.assign(
      new Error(`Failed to advance onboarding to ${newState}: ${error.message}`),
      { statusCode: 500, dbCode: (error as { code?: string }).code },
    );
  }
  if (!data) {
    throw Object.assign(new Error('Session was modified concurrently — please refresh'), { statusCode: 409 });
  }
  return data as OnboardingSession;
}

// ── Tenancy ───────────────────────────────────────────────────────────────

/**
 * The tenant every business-context row written during onboarding must carry.
 *
 * THIS IS THE ONE PLACE THE ANSWER IS DERIVED. Migration 103 gave
 * `founder_context` and `approval_boundary_policies` a workspace and product,
 * and the readers now filter on them — but a column the writers never populate
 * is worse than no column at all: the reads simply return nothing, and business
 * context silently disappears rather than visibly breaking. Every writer below
 * goes through here so a future writer cannot forget.
 *
 * FAILS CLOSED. A session with no workspace cannot have its context stored
 * somewhere plausible, because "plausible" is precisely the defect being fixed —
 * context attaching to the wrong business. `saveWorkspace` sets the workspace at
 * step 1, so any session that has reached an alignment step has one; a session
 * that has not is a real inconsistency and says so.
 *
 * @param session - the session being written through, already ownership-verified
 * @returns the tenant columns to spread into the write
 * @throws {Error} 409 when the session carries no workspace
 * @security The tenant comes from the SESSION ROW, never from client input. A
 *   caller cannot direct another business's context into their own workspace.
 */
function tenantColumns(session: OnboardingSession): { workspace_id: string; product_id: string | null } {
  const workspaceId = (session as { workspace_id?: string | null }).workspace_id ?? null;
  if (!workspaceId) {
    throw Object.assign(
      new Error(
        `Onboarding session ${session.id} has no workspace, so its business context has no ` +
        `owner. Complete the workspace step before saving alignment answers.`),
      { statusCode: 409 },
    );
  }
  // product_id is legitimately null until discovery creates the product. It is
  // written whenever known so later readers can scope to the product, and the
  // 103 trigger rejects a pairing where the product is not in the workspace.
  return { workspace_id: workspaceId, product_id: session.product_id ?? null };
}

// ── Step 2: Workspace ─────────────────────────────────────────────────────

export async function saveWorkspace(
  sessionId:       string,
  founderId:       string,
  workspaceName:   string,
  productMaturity?: string,
): Promise<OnboardingSession> {
  const supabase = getSupabase();

  // Create the workspace
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces')
    .insert({ founder_id: founderId, name: workspaceName })
    .select('id')
    .single();

  if (wsErr) throw new Error(`Failed to create workspace: ${wsErr.message}`);

  // G3. Held on the session until a product exists (discovery creates it), then
  // copied across. Storing it now rather than asking again later is the whole
  // point of collecting it at the first step.
  return transitionState(sessionId, founderId, 'DISCOVERY_PENDING', {
    workspace_id:   ws.id,
    workspace_name: workspaceName,
    ...(productMaturity ? { product_maturity: productMaturity } : {}),
  });
}

// ── Step 3-5: Discovery ───────────────────────────────────────────────────

/**
 * Creates a discovery_job row and queues the BullMQ discovery job.
 * SSRF protection: URLs are validated before queuing.
 */
export async function startDiscovery(
  sessionId:          string,
  founderId:          string,
  urls:               string[],
  privateDescription: string | undefined,
): Promise<DiscoveryJob> {
  const supabase = getSupabase();

  // Validate URLs for SSRF (see validatePublicUrl helper)
  for (const url of urls) {
    validatePublicUrl(url);
  }

  // Create discovery job row
  const { data: job, error } = await supabase
    .from('discovery_jobs')
    .insert({
      session_id:          sessionId,
      founder_id:          founderId,
      status:              'queued',
      urls_submitted:      urls,
      private_description: privateDescription ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create discovery job: ${error.message}`);

  // Transition session state
  await transitionState(sessionId, founderId, 'DISCOVERY_IN_PROGRESS', {
    urls_submitted:      urls,
    private_description: privateDescription ?? null,
  });

  // The actual queuing is handled by the discovery worker — we import lazily
  // to avoid circular dep issues and Redis being unavailable in tests
  try {
    const { enqueueDiscovery } = await import('../workers/discoveryWorker');
    const queueJobId = await enqueueDiscovery({ jobId: job.id, sessionId, founderId, urls, privateDescription });
    await supabase.from('discovery_jobs').update({ queue_job_id: queueJobId }).eq('id', job.id);
  } catch {
    // If queuing fails (Redis unavailable), job stays in 'queued' state for retry
    console.warn('[onboardingService] Could not enqueue discovery job — Redis may be unavailable');
  }

  return job as DiscoveryJob;
}

/**
 * Pre-launch path — the owner has no public product to research yet.
 *
 * LaunchMind itself is the motivating case: it is not launched, so there is no
 * store listing and no public site. The honest response is to say so and learn
 * the business from the owner, NOT to manufacture the evidence the rest of the
 * flow expects.
 *
 * So this deliberately does the opposite of startDiscovery:
 *   · no URLs, no scraping, no outbound request of any kind
 *   · NO product_claims — a claim implies observed evidence, and there is none.
 *     A "suggestion" here would be the model describing a product it has never
 *     seen, shown to the owner at a confidence it cannot justify.
 *   · no ratings, competitors, channels or market inferences
 *   · maturity recorded as pre_launch so downstream copy stops implying history
 *
 * The product row IS created — the business is real even though its evidence is
 * not yet public — and Alignment then runs founder-guided, with every card in
 * the "I'm not confident enough to suggest this" state that already exists.
 * Real sources can enrich it later; nothing here has to be unpicked first.
 *
 * @param productName - what the owner calls it. The only thing we know.
 * @param privateDescription - the owner's own description, evidence not truth
 * @throws {Error} when the session has no workspace (fails closed, as ever)
 * @security Creates no claims, so nothing fabricated can later be confirmed by
 *   an owner skimming the Alignment cards. Writes no Marketing Memory.
 */
export async function startPreLaunchDiscovery(
  sessionId:          string,
  founderId:          string,
  productName:        string | undefined,
  privateDescription: string | undefined,
): Promise<{ productId: string }> {
  const supabase = getSupabase();
  const session  = await getSession(sessionId, founderId);
  const tenant   = tenantColumns(session);   // throws when there is no workspace

  // The company name the owner typed at the workspace step. Owner-authored, so
  // using it as the product name invents nothing — and the pre-launch screen
  // deliberately asks for a description rather than a name.
  const resolvedName = (productName ?? '').trim()
    || (session as { workspace_name?: string | null }).workspace_name?.trim()
    || 'My product';

  let productId = session.product_id ?? null;
  if (!productId) {
    const { data: product, error } = await supabase
      .from('products')
      .insert({
        founder_id:   founderId,
        workspace_id: tenant.workspace_id,
        name:         resolvedName,
        // No public URL exists. A placeholder would be a lie the scraper could
        // later try to fetch, so the column records exactly that.
        store_url:    'not-public-yet',
        platform:     'app_store',
        // canonical_identity stays NULL: identity comes from a platform id, and
        // there is no platform yet. The partial unique index permits NULL, so a
        // manually created product stays insertable.
        canonical_identity: null,
        maturity:     'pre_launch',
        maturity_confirmed_at: new Date().toISOString(),
        scraped_meta: {
          preLaunch: true,
          ownerDescription: privateDescription ?? null,
          // Explicitly empty rather than absent, so downstream readers can tell
          // "we looked and found nothing public" from "we never looked".
          stores: [], websiteMeta: {}, storeFailures: [],
        },
      })
      .select('id')
      .single();
    if (error) throw new Error(`Could not create product: ${error.message}`);
    productId = (product as { id: string }).id;
  }

  await supabase.from('onboarding_sessions')
    .update({ product_id: productId, product_maturity: 'pre_launch' })
    .eq('id', sessionId);

  // Walk the same states a public discovery would, so resume, Back and the
  // progress rail behave identically — only the evidence differs.
  //
  // FORWARD ONLY. Comparing against each target individually meant a session
  // already at ALIGNMENT_AUDIENCE tried to go back to DISCOVERY_IN_PROGRESS and
  // threw "Invalid transition" — so re-submitting the description, or retrying
  // after a dropped response, failed with a 409 on a screen the owner had
  // already completed. Position in the chain decides what remains.
  const CHAIN: OnboardingState[] = [
    'DISCOVERY_PENDING', 'DISCOVERY_IN_PROGRESS', 'PRELIMINARY_REPORT',
    'BELIEF_REVIEW', 'ALIGNMENT_AUDIENCE',
  ];
  const current = await getSession(sessionId, founderId);
  const at = CHAIN.indexOf(current.current_state);
  // Already past this stage (or on a branch the chain does not cover): nothing
  // to advance, and the product above was reused rather than duplicated.
  if (at !== -1) {
    for (const state of CHAIN.slice(at + 1)) {
      await transitionState(sessionId, founderId, state);
    }
  }

  return { productId: productId! };
}

export async function getDiscoveryJob(sessionId: string, founderId: string): Promise<DiscoveryJob | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('discovery_jobs')
    .select('*')
    .eq('session_id', sessionId)
    .eq('founder_id', founderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return (data as DiscoveryJob | null);
}

export async function retryDiscovery(sessionId: string, founderId: string): Promise<DiscoveryJob> {
  const supabase = getSupabase();
  const existing = await getDiscoveryJob(sessionId, founderId);
  if (!existing) throw Object.assign(new Error('No discovery job found'), { statusCode: 404 });
  if (existing.status !== 'failed') throw Object.assign(new Error('Job is not in failed state'), { statusCode: 409 });
  if (existing.retry_count >= existing.max_retries) {
    throw Object.assign(new Error('Max retries reached — please contact support'), { statusCode: 422 });
  }

  await supabase
    .from('discovery_jobs')
    .update({ status: 'queued', progress: 0, progress_stage: 0, error_code: null, error_message: null })
    .eq('id', existing.id);

  await transitionState(sessionId, founderId, 'DISCOVERY_IN_PROGRESS');

  try {
    const { enqueueDiscovery } = await import('../workers/discoveryWorker');
    await enqueueDiscovery({ jobId: existing.id, sessionId, founderId, urls: existing.urls_submitted, privateDescription: existing.private_description ?? undefined });
  } catch { /* Redis unavailable */ }

  return { ...existing, status: 'queued', progress: 0, retry_count: existing.retry_count + 1 };
}

export async function selectMatch(
  sessionId: string,
  founderId: string,
  matchId:   string,
): Promise<DiscoveryJob> {
  const supabase = getSupabase();
  const job = await getDiscoveryJob(sessionId, founderId);
  if (!job) throw Object.assign(new Error('No discovery job found'), { statusCode: 404 });

  // Validate match exists in candidate list
  const matches = (job.candidate_matches as CandidateMatch[] | null) ?? [];
  const match   = matches.find(m => m.id === matchId);
  if (!match) throw Object.assign(new Error('Match not found'), { statusCode: 404 });

  await supabase
    .from('discovery_jobs')
    .update({ selected_match_id: matchId, status: 'running' })
    .eq('id', job.id);

  await transitionState(sessionId, founderId, 'DISCOVERY_IN_PROGRESS');

  try {
    const { enqueueDiscovery } = await import('../workers/discoveryWorker');
    await enqueueDiscovery({ jobId: job.id, sessionId, founderId, urls: [match.url], privateDescription: job.private_description ?? undefined });
  } catch { /* Redis unavailable */ }

  return { ...job, selected_match_id: matchId };
}

// ── Step 6: Preliminary Report ────────────────────────────────────────────

export async function acknowledgeReport(sessionId: string, founderId: string): Promise<void> {
  const supabase = getSupabase();
  const job      = await getDiscoveryJob(sessionId, founderId);
  if (!job) throw Object.assign(new Error('No discovery job found'), { statusCode: 404 });

  await supabase.from('discovery_jobs').update({ report_acknowledged: true }).eq('id', job.id);

  // Idempotent: if session is already at BELIEF_REVIEW or beyond, skip transition
  const session = await getSession(sessionId, founderId);
  const pastReport: OnboardingState[] = [
    'BELIEF_REVIEW','ALIGNMENT_AUDIENCE','ALIGNMENT_CONTEXT','ALIGNMENT_GOAL',
    'ALIGNMENT_COMPETITORS','BOUNDARIES_SETUP','FINAL_REVIEW',
    'DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  if (pastReport.includes(session.current_state)) return;
  await transitionState(sessionId, founderId, 'BELIEF_REVIEW');
}

// ── Step 7: Belief Review ─────────────────────────────────────────────────

export async function getClaims(sessionId: string, founderId: string): Promise<ProductClaim[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('product_claims')
    .select('*')
    .eq('session_id', sessionId)
    .eq('founder_id', founderId)
    .order('display_order');
  return (data as ProductClaim[]) ?? [];
}

export async function reviewClaim(
  sessionId:      string,
  founderId:      string,
  claimId:        string,
  status:         'CONFIRMED' | 'CORRECTED' | 'REJECTED',
  correctedValue?: string,
  founderNote?:   string,
): Promise<ProductClaim> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('product_claims')
    .update({
      status,
      corrected_value: correctedValue ?? null,
      founder_note:    founderNote ?? null,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', claimId)
    .eq('session_id', sessionId)
    .eq('founder_id', founderId)
    .select('*')
    .single();

  if (error || !data) throw Object.assign(new Error('Claim not found'), { statusCode: 404 });
  return data as ProductClaim;
}

export async function completeBeliefReview(sessionId: string, founderId: string): Promise<void> {
  // Idempotent: if session is already at ALIGNMENT_AUDIENCE or beyond, skip transition
  const session = await getSession(sessionId, founderId);
  const pastBeliefs: OnboardingState[] = [
    'ALIGNMENT_AUDIENCE','ALIGNMENT_CONTEXT','ALIGNMENT_GOAL','ALIGNMENT_COMPETITORS',
    'BOUNDARIES_SETUP','FINAL_REVIEW','DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  if (pastBeliefs.includes(session.current_state)) return;
  await transitionState(sessionId, founderId, 'ALIGNMENT_AUDIENCE');
}

/**
 * Re-extracts claims from the most recent completed discovery job.
 * Deletes any existing claims for this session first to avoid duplicates.
 * @param sessionId - Onboarding session ID
 * @param founderId - Founder ID (from JWT)
 * @returns Number of claims regenerated
 */
export async function regenerateClaims(sessionId: string, founderId: string): Promise<number> {
  const supabase = getSupabase();
  const job = await getDiscoveryJob(sessionId, founderId);
  if (!job || job.status !== 'completed') {
    throw Object.assign(new Error('No completed discovery job — run discovery first'), { statusCode: 422 });
  }

  // Delete existing claims for this session
  await supabase.from('product_claims').delete().eq('session_id', sessionId).eq('founder_id', founderId);

  // Get the session to find product_id
  const session = await getSession(sessionId, founderId);

  // Re-build combinedAppData from stored job fields
  const appMetadata  = (job.app_metadata  ?? {}) as Record<string, unknown>;
  const icpData      = (job.icp_data      ?? {}) as Record<string, unknown>;
  const websiteMeta  = (job.website_meta ?? {}) as Record<string, unknown>;
  const combinedAppData: Record<string, unknown> = {
    ...appMetadata,
    icp:         icpData,
    metadata:    appMetadata,
    websiteMeta,
  };

  await extractAndStoreClaims(sessionId, founderId, session.product_id, combinedAppData);

  const { data } = await supabase
    .from('product_claims')
    .select('id')
    .eq('session_id', sessionId)
    .eq('founder_id', founderId);
  return data?.length ?? 0;
}

// ── Steps 8–11: Alignment ─────────────────────────────────────────────────

export async function saveAudience(
  sessionId: string,
  founderId: string,
  data:      { audienceConfirmed: string; audienceAdditions?: string; audienceSegments?: unknown[] },
): Promise<void> {
  const supabase = getSupabase();
  // Read before write: the tenant is needed for the row itself, so the session
  // is fetched first rather than after (it was previously read only to decide
  // the transition).
  const session = await getSession(sessionId, founderId);
  await supabase.from('founder_context').upsert({
    session_id:           sessionId,
    founder_id:           founderId,
    ...tenantColumns(session),
    audience_confirmed:   data.audienceConfirmed,
    audience_additions:   data.audienceAdditions ?? null,
    audience_segments:    data.audienceSegments ?? null,
    updated_at:           new Date().toISOString(),
  }, { onConflict: 'session_id' });

  const pastAudience: OnboardingState[] = [
    'ALIGNMENT_POSITIONING','ALIGNMENT_CONTEXT','ALIGNMENT_GOAL','ALIGNMENT_COMPETITORS',
    'BOUNDARIES_SETUP','FINAL_REVIEW','DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  if (pastAudience.includes(session.current_state)) return;
  await transitionState(sessionId, founderId, 'ALIGNMENT_POSITIONING');
}

/**
 * G1 · G2 · G5 · G7 — positioning, value proposition, customer problem,
 * markets and current channels.
 *
 * AUTHORITY COMES FROM CONFIRMATION, NOT FROM PREFILL. `confirmedFields`
 * records which values the owner actually confirmed or corrected on screen; a
 * value that was merely prefilled and left untouched is stored as context but
 * never listed, so a later reader cannot mistake an AI suggestion for a founder
 * fact. This is the same distinction the belief-review step already makes
 * between CONFIRMED and CORRECTED.
 *
 * @param data - positioning, valueProposition, primaryCustomerProblem, markets,
 *   currentChannels, confirmedFields
 * @security Writes owner-confirmed canonical state. Nothing here grants
 *   execution authority; markets are stored structured so a metro is never
 *   silently widened to a country.
 */
/**
 * Strips confirmations the owner did not actually make.
 *
 * Today that means one rule with real consequences: `currentChannels` may only
 * be listed as confirmed when at least one channel carries an OWNER assertion
 * (`using`/`planning`). A payload containing nothing but `observed` entries is
 * LaunchMind reporting the listings it found — if that counted as confirmation,
 * every founder would appear to have confirmed they actively market on the App
 * Store the moment discovery read their listing.
 *
 * Server-side because confirmed_fields is the flag downstream readers consult
 * to decide a value carries founder authority; a client is not allowed to
 * assert that on the owner's behalf.
 *
 * @param claimed - confirmedFields as sent by the client
 * @param channels - the channel payload being saved alongside it
 * @returns the subset that is genuinely owner-asserted
 * @security Removes authority; never adds it.
 */
export function sanitizeConfirmedFields(
  claimed: string[],
  channels: Array<{ channel: string; status: string }>,
): string[] {
  const ownerAsserted = (channels ?? []).some(c => isOwnerAssertedChannel(c.status));
  return (claimed ?? []).filter(f => (f === 'currentChannels' ? ownerAsserted : true));
}

/** Maps a confirmedFields entry to the claim category it backs. */
const CLAIM_FIELD_MAP: Record<string, string> = {
  positioning: 'positioning',
  value_prop:  'valueProposition',
  problem:     'primaryCustomerProblem',
};

/**
 * Writes the owner's card decisions back onto the suggestion claims.
 *
 * CONFIRMED when the owner accepted LaunchMind's wording unchanged; CORRECTED
 * when they replaced it, with the original preserved in `body` and their words
 * in `corrected_value`. That distinction is the whole point of the review step —
 * "the model was right" and "the model was wrong and here is the truth" are
 * different facts about how well LaunchMind understands the business.
 *
 * A card the owner did not act on is left UNREVIEWED. Never throws: a failure
 * here must not lose the owner's saved context, which is already written.
 *
 * @security Only ever sets a status from an explicit owner action.
 */
async function syncAlignmentClaimStatuses(
  sessionId: string,
  founderId: string,
  values: Record<string, string>,
  confirmedFields: string[],
): Promise<void> {
  const supabase = getSupabase();
  try {
    const { data: rows } = await supabase
      .from('product_claims')
      .select('id, category, body, status')
      .eq('session_id', sessionId)
      .in('category', Object.keys(CLAIM_FIELD_MAP));

    for (const row of (rows ?? []) as Array<{ id: string; category: string; body: string; status: string }>) {
      const field = CLAIM_FIELD_MAP[row.category];
      if (!confirmedFields.includes(field)) continue;      // no explicit action
      const finalText = (values[row.category] ?? '').trim();
      if (!finalText) continue;

      const changed = finalText !== (row.body ?? '').trim();
      // `original_value` keeps LaunchMind's wording alongside the owner's, so a
      // correction remains reconstructible rather than overwriting the evidence
      // of what was originally inferred.
      const { error } = await supabase.from('product_claims').update(
        changed
          ? { status: 'CORRECTED', corrected_value: finalText,
              original_value: row.body, updated_at: new Date().toISOString() }
          : { status: 'CONFIRMED', updated_at: new Date().toISOString() },
      ).eq('id', row.id).eq('founder_id', founderId);
      // Surfaced rather than swallowed: a silent failure here is what makes the
      // owner confirm the same card twice.
      if (error) console.warn('[alignment] claim status update failed:', row.category, error.message);
    }
  } catch (err) {
    console.warn('[alignment] could not sync claim statuses:', (err as Error).message);
  }
}

export async function savePositioning(
  sessionId: string,
  founderId: string,
  data: {
    positioning: string; valueProposition: string; primaryCustomerProblem: string;
    markets: Array<{ type: string; value: string; label: string }>;
    currentChannels: Array<{ channel: string; status: string }>;
    confirmedFields: string[];
  },
): Promise<void> {
  const supabase = getSupabase();
  const session  = await getSession(sessionId, founderId);

  await supabase.from('founder_context').upsert({
    session_id:               sessionId,
    founder_id:               founderId,
    ...tenantColumns(session),
    positioning:              data.positioning,
    value_proposition:        data.valueProposition,
    primary_customer_problem: data.primaryCustomerProblem,
    markets:                  data.markets,
    current_channels:         data.currentChannels,
    // SERVER-SIDE PROVENANCE GUARD. `currentChannels` is only a confirmed field
    // when the owner actually asserted a channel — `observed` entries are
    // LaunchMind's own detection of a public listing and must never be counted
    // as the owner telling us they market there. Enforced here rather than
    // trusted from the client, because confirmed_fields is what downstream
    // readers use to decide something carries founder authority.
    confirmed_fields:         sanitizeConfirmedFields(data.confirmedFields ?? [], data.currentChannels),
    updated_at:               new Date().toISOString(),
  }, { onConflict: 'session_id' });

  // Record the owner's card decisions on the CLAIMS as well as in
  // confirmed_fields. Without this the claim rows stay UNREVIEWED forever, so
  // coming back to this screen — via Back, refresh, or resume — re-proposes as
  // "suggestion, not yet confirmed" something the owner already confirmed, and
  // asks them to do it twice. confirmed_fields alone is not enough because the
  // cards read their state from the claims.
  await syncAlignmentClaimStatuses(sessionId, founderId, {
    positioning: data.positioning,
    value_prop:  data.valueProposition,
    problem:     data.primaryCustomerProblem,
  }, data.confirmedFields ?? []);

  // G7. The product's markets are set ONLY here, from an explicit owner choice.
  // The column default was removed in migration 102 precisely so an unanswered
  // flow leaves the market unknown rather than confidently claiming the USA.
  if (session.product_id) {
    const maturity = session.product_maturity;
    await supabase.from('products').update({
      markets:             data.markets.map(m => m.value),
      market_confirmed_at: new Date().toISOString(),
      ...(typeof maturity === 'string'
        ? { maturity, maturity_confirmed_at: new Date().toISOString() }
        : {}),
    }).eq('id', session.product_id).eq('founder_id', founderId);
  }

  const past: OnboardingState[] = [
    'ALIGNMENT_CONTEXT','ALIGNMENT_GOAL','ALIGNMENT_COMPETITORS',
    'BOUNDARIES_SETUP','FINAL_REVIEW','DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  if (past.includes(session.current_state)) return;
  await transitionState(sessionId, founderId, 'ALIGNMENT_CONTEXT');
}

export async function saveContextDelta(
  sessionId: string,
  founderId: string,
  data:      { contextDelta?: string; hiddenStrengths?: string[]; recentWins?: string[] },
): Promise<void> {
  const supabase = getSupabase();
  const session  = await getSession(sessionId, founderId);
  await supabase.from('founder_context').upsert({
    session_id:       sessionId,
    founder_id:       founderId,
    ...tenantColumns(session),
    context_delta:    data.contextDelta ?? null,
    hidden_strengths: data.hiddenStrengths ?? null,
    recent_wins:      data.recentWins ?? null,
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'session_id' });

  const pastContext: OnboardingState[] = [
    'ALIGNMENT_GOAL','ALIGNMENT_COMPETITORS','BOUNDARIES_SETUP',
    'FINAL_REVIEW','DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  if (pastContext.includes(session.current_state)) return;
  await transitionState(sessionId, founderId, 'ALIGNMENT_GOAL');
}

export async function saveGoal(
  sessionId: string,
  founderId: string,
  data:      Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabase();
  const session  = await getSession(sessionId, founderId);

  await supabase.from('business_goals').upsert({
    session_id:        sessionId,
    founder_id:        founderId,
    product_id:        session.product_id ?? null,
    goal_type:         data.goalType,
    custom_metric:     data.customMetric ?? null,
    baseline_value:    data.baselineValue ?? null,
    target_value:      data.targetValue,
    unit:              data.unit,
    time_horizon_days: data.timeHorizonDays ?? 30,
    motivation:        data.motivation ?? null,
    current_blockers:  data.currentBlockers ?? null,
    target_unknown:    data.targetUnknown === true,
    is_primary:        true,
    priority:          1,
    updated_at:        new Date().toISOString(),
  }, { onConflict: 'session_id' });

  // G6. Success definition lives with the other owner-confirmed context, not on
  // the goal row: it is how the owner judges marketing overall, which outlives
  // any single target.
  if (typeof data.successDefinition === 'string' && data.successDefinition.trim()) {
    await supabase.from('founder_context').upsert({
      session_id: sessionId, founder_id: founderId,
      ...tenantColumns(session),
      success_definition: data.successDefinition,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id' });
  }

  // G8. A few supporting goals, ordered. Replaced wholesale on re-save so an
  // edited flow cannot leave orphans from a previous pass. The partial unique
  // index guarantees only one primary exists regardless.
  const supporting = Array.isArray(data.supportingGoals) ? data.supportingGoals : [];
  await supabase.from('business_goals')
    .delete().eq('session_id', sessionId).eq('is_primary', false);
  if (supporting.length) {
    await supabase.from('business_goals').insert(
      supporting.map((g, i) => {
        const goal = g as Record<string, unknown>;
        return {
          session_id: sessionId, founder_id: founderId,
          product_id: session.product_id ?? null,
          goal_type: goal.goalType, custom_metric: goal.customMetric ?? null,
          target_value: goal.targetValue ?? 0,
          target_unknown: goal.targetUnknown === true,
          unit: goal.unit, time_horizon_days: data.timeHorizonDays ?? 30,
          is_primary: false, priority: i + 2,
        };
      }));
  }

  const pastGoal: OnboardingState[] = [
    'ALIGNMENT_COMPETITORS','BOUNDARIES_SETUP','FINAL_REVIEW',
    'DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  if (pastGoal.includes(session.current_state)) return;
  await transitionState(sessionId, founderId, 'ALIGNMENT_COMPETITORS');
}

export async function saveCompetitors(
  sessionId:   string,
  founderId:   string,
  competitors: Array<Record<string, unknown>>,
): Promise<void> {
  const supabase = getSupabase();
  const session  = await getSession(sessionId, founderId);

  // Delete old then insert fresh
  await supabase.from('competitor_relationships').delete()
    .eq('session_id', sessionId).eq('founder_id', founderId);

  if (competitors.length > 0) {
    await supabase.from('competitor_relationships').insert(
      competitors.map((c, i) => ({
        session_id:         sessionId,
        founder_id:         founderId,
        product_id:         session.product_id ?? null,
        name:               c.name,
        store_url:          c.storeUrl ?? null,
        website_url:        c.websiteUrl ?? null,
        platform:           c.platform ?? null,
        relationship:       c.relationship ?? 'CONFIRMED',
        key_differentiator: c.keyDifferentiator ?? null,
        discovered_by:      c.discoveredBy ?? 'AI',
        display_order:      i,
      })),
    );
  }

  const pastCompetitors: OnboardingState[] = [
    'BOUNDARIES_SETUP','FINAL_REVIEW','DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  if (pastCompetitors.includes(session.current_state)) return;
  await transitionState(sessionId, founderId, 'BOUNDARIES_SETUP');
}

// ── Step 12: Boundaries ───────────────────────────────────────────────────

export async function saveBoundaries(
  sessionId: string,
  founderId: string,
  data: {
    workingStyle:        'hands_on' | 'balanced' | 'hands_off';
    notificationCadence: 'daily' | 'weekly' | 'only_critical';
    timeCommitmentHrs?:  number;
    weeklySpendCapUsd:   number;
    weeklySpendCapInr:   number;
    /** G4. Owner-chosen per-capability boundaries. Absent = legacy derived behaviour. */
    explicitCapabilities?: Record<string, string>;
    founderAcknowledged: true;  // server-enforced: literal true required
  },
): Promise<void> {
  const supabase = getSupabase();

  // Build permitted/required lists based on working style
  const permittedByStyle: Record<string, string[]> = {
    hands_on:  [],
    balanced:  ['content_draft','icp_update','weekly_brief','experiment_suggestion'],
    hands_off: ['content_draft','icp_update','weekly_brief','experiment_suggestion','experiment_start'],
  };
  const requiredByStyle: Record<string, string[]> = {
    hands_on:  ['campaign_launch','spend_increase','new_channel','platform_connection','content_publish','experiment_start'],
    balanced:  ['campaign_launch','spend_increase','new_channel','platform_connection','content_publish'],
    hands_off: ['campaign_launch','spend_increase','new_channel','platform_connection'],
  };

  // Check idempotency before any writes — if already past BOUNDARIES_SETUP, skip
  const currentSession = await getSession(sessionId, founderId);
  const pastBoundaries: OnboardingState[] = [
    'FINAL_REVIEW','DIRECTION_GENERATING','DIRECTION_COMPLETE','PHASE_1_COMPLETE',
  ];
  const alreadyPast = pastBoundaries.includes(currentSession.current_state);

  // Save context working style (always upsert — safe to repeat)
  await supabase.from('founder_context').upsert({
    session_id:           sessionId,
    founder_id:           founderId,
    ...tenantColumns(currentSession),
    working_style:        data.workingStyle,
    notification_cadence: data.notificationCadence,
    time_commitment_hrs:  data.timeCommitmentHrs ?? null,
    updated_at:           new Date().toISOString(),
  }, { onConflict: 'session_id' });

  // A capability the owner marked `never` appears in NEITHER list: it is not
  // autonomous, and it is not merely gated behind approval. "Never change ad
  // spend" must not degrade into "ask me before changing ad spend".
  const explicit = data.explicitCapabilities;

  if (!alreadyPast) {
    // Create immutable approval boundary policy record (insert only on first pass)
    await supabase.from('approval_boundary_policies').insert({
      session_id:           sessionId,
      founder_id:           founderId,
      // Without this, "AllignX: never spend autonomously" and "LaunchMind:
      // spend needs approval" resolve by founder identity alone, and whichever
      // is read first governs both businesses.
      ...tenantColumns(currentSession),
      working_style:        data.workingStyle,
      // G4. STYLE is a collaboration preference; AUTHORITY is a permission
      // boundary. When the owner states boundaries explicitly, those win and
      // the style no longer decides what LaunchMind may do. The legacy derived
      // lists are still written so existing readers keep working, but
      // boundaries_source records which one was authoritative — the two can
      // never be confused after the fact.
      autonomous_permitted: explicit
        ? Object.keys(explicit).filter(k => explicit[k] === 'autonomous')
        : permittedByStyle[data.workingStyle],
      approval_required:    explicit
        ? Object.keys(explicit).filter(k => explicit[k] === 'approval_required')
        : requiredByStyle[data.workingStyle],
      explicit_capabilities: explicit ?? null,
      boundaries_source:     explicit ? 'owner_explicit' : 'derived_from_style',
      weekly_spend_cap_usd: data.weeklySpendCapUsd,
      weekly_spend_cap_inr: data.weeklySpendCapInr,
      founder_acknowledged: true,
      confirmed_at:         new Date().toISOString(),
    });
    await transitionState(sessionId, founderId, 'FINAL_REVIEW');
  }
}

// ── Steps 13–14: Generate Direction ──────────────────────────────────────

/**
 * Phase 1 fast-path: transitions state + inserts a placeholder direction row.
 * Returns the direction ID so the background runner can update it.
 * Called by the POST /direction route which immediately returns 202.
 */
export async function prepareDirection(
  sessionId: string,
  founderId: string,
): Promise<{ dirId: string; sessionProductId: string | null }> {
  const supabase = getSupabase();
  const session  = await getSession(sessionId, founderId);

  // Idempotent: if already generating or complete, skip the state transition
  // (handles retries after a failed first attempt that already transitioned).
  const alreadyGenerating = ['DIRECTION_GENERATING', 'DIRECTION_COMPLETE', 'PHASE_1_COMPLETE']
    .includes(session.current_state);
  if (!alreadyGenerating) {
    await transitionState(sessionId, founderId, 'DIRECTION_GENERATING');
  }

  // Insert placeholder row (headline/rationale are NOT NULL — overwritten after generation)
  const { data: dir, error: dirErr } = await supabase
    .from('strategy_directions')
    .insert({
      session_id:  sessionId,
      founder_id:  founderId,
      product_id:  session.product_id ?? null,
      status:      'generating',
      headline:    '',
      rationale:   '',
    })
    .select('id')
    .single();

  if (dirErr) throw new Error(`Failed to create direction: ${dirErr.message}`);
  return { dirId: dir.id as string, sessionProductId: session.product_id ?? null };
}

/**
 * Background phase: calls Claude, writes the result to the direction row, and
 * transitions the session to DIRECTION_COMPLETE. Runs after the HTTP response
 * is already sent (fire-and-forget from the route handler).
 */
export async function runDirectionGeneration(
  sessionId: string,
  founderId: string,
  dirId:     string,
): Promise<void> {
  const supabase = getSupabase();

  // Gather all Phase 1 inputs
  const [
    { data: job },
    { data: claims },
    { data: context },
    { data: goal },
    { data: competitors },
  ] = await Promise.all([
    supabase.from('discovery_jobs').select('*').eq('session_id', sessionId).single(),
    supabase.from('product_claims').select('*').eq('session_id', sessionId).eq('status', 'CONFIRMED').limit(20),
    supabase.from('founder_context').select('*').eq('session_id', sessionId).single(),
    supabase.from('business_goals').select('*').eq('session_id', sessionId).single(),
    supabase.from('competitor_relationships').select('*').eq('session_id', sessionId).eq('relationship', 'CONFIRMED').limit(10),
  ]);

  // Build the generation prompt
  const session2     = await getSession(sessionId, founderId);
  const appName      = (job?.app_metadata as Record<string,unknown> | null)?.name ?? 'your app';
  const topClaims    = (claims ?? []).slice(0, 8).map(c => `• ${c.title}: ${c.body}`).join('\n');
  const goalStr      = goal
    ? `Goal: reach ${goal.target_value} ${goal.unit} in ${goal.time_horizon_days} days (currently ${goal.baseline_value ?? 0})`
    : 'Goal: increase installs';
  const competitorStr = (competitors ?? []).map(c => c.name).join(', ') || 'none identified';
  const workingStyle  = context?.working_style ?? 'balanced';
  const contextDelta  = context?.context_delta ?? '';

  const systemPrompt = `You are the LaunchMind growth strategist. Generate a focused 30-day growth direction for a mobile app founder who just completed Phase 1 onboarding.

RULES:
- Be specific. Name channels, hooks, copy angles. No generic advice.
- Base everything on the founder's actual data provided below.
- The direction must be achievable by one founder with ${workingStyle === 'hands_on' ? '~5 hrs/week' : workingStyle === 'balanced' ? '~3 hrs/week' : '~1 hr/week'} available.
- No invented metrics. Reference only what's in the input.
- Output must be valid JSON matching the schema exactly.`;

  const userPrompt = `App: ${appName}
${goalStr}
Working style: ${workingStyle}
Context from founder: ${contextDelta}
Confirmed beliefs:
${topClaims}
Competitors: ${competitorStr}

Generate a 30-day growth direction. Return ONLY valid JSON with this exact shape:
{
  "headline": "one-sentence north-star direction (max 100 chars)",
  "rationale": "2-3 paragraphs explaining why this direction",
  "primaryChannel": "the single channel to focus on in week 1",
  "primaryMarket": "usa | india | both",
  "primaryObjective": "one sentence — the concrete outcome to hit in 30 days (measurable, specific)",
  "biggestConstraint": "one sentence — the single biggest thing blocking growth right now",
  "firstMission": "one sentence — the first specific action the founder should complete this week",
  "immediateAction": "one sentence — something the founder can do TODAY in under 30 minutes",
  "successSignal": "one sentence — the leading indicator that shows this direction is working",
  "confidenceLevel": 72,
  "week1": { "focus": "...", "tasks": ["...", "...", "..."], "expectedOutcome": "..." },
  "week2": { "focus": "...", "tasks": ["...", "...", "..."], "expectedOutcome": "..." },
  "week3": { "focus": "...", "tasks": ["...", "...", "..."], "expectedOutcome": "..." },
  "week4": { "focus": "...", "tasks": ["...", "...", "..."], "expectedOutcome": "..." },
  "keyAssumptions": ["...", "..."],
  "riskFlags": ["...", "..."]
}`;

  const auditCtx: AuditContext = {
    founderId,
    productId: session2.product_id ?? undefined,
    promptId:  'phase1_direction_generation',
    action:    'direction_generation',
  };

  await consumeTokens(founderId, 'direction_generation', 50);
  const raw = await callSonnet(systemPrompt, userPrompt, 2000, auditCtx);

  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? raw);
  } catch {
    throw new Error('AI returned invalid JSON for direction generation');
  }

  const { error: updateErr } = await supabase
    .from('strategy_directions')
    .update({
      status:             'ready',
      ai_model:           'claude-sonnet-4-6',
      headline:           parsed.headline as string,
      rationale:          parsed.rationale as string,
      primary_channel:    parsed.primaryChannel as string,
      primary_market:     parsed.primaryMarket as string,
      week_1:             parsed.week1,
      week_2:             parsed.week2,
      week_3:             parsed.week3,
      week_4:             parsed.week4,
      key_assumptions:    parsed.keyAssumptions,
      risk_flags:         parsed.riskFlags,
      ai_tokens_consumed: 50,
      updated_at:         new Date().toISOString(),
    })
    .eq('id', dirId);

  if (updateErr) throw new Error(`Failed to save direction: ${updateErr.message}`);

  // Store extended fields in direction_meta — requires migration 071.
  // If the column doesn't exist yet the error is silently ignored; frontend
  // falls back to week_1.tasks / risk_flags for display.
  await supabase
    .from('strategy_directions')
    .update({
      direction_meta: {
        primaryObjective:  parsed.primaryObjective  ?? null,
        biggestConstraint: parsed.biggestConstraint ?? null,
        firstMission:      parsed.firstMission      ?? null,
        immediateAction:   parsed.immediateAction   ?? null,
        successSignal:     parsed.successSignal     ?? null,
        confidenceLevel:   parsed.confidenceLevel   ?? null,
      },
    } as Record<string, unknown>)
    .eq('id', dirId);
  // error intentionally ignored — migration 071 may not be applied yet

  const afterGen = await getSession(sessionId, founderId);
  if (!['DIRECTION_COMPLETE', 'PHASE_1_COMPLETE'].includes(afterGen.current_state)) {
    await transitionState(sessionId, founderId, 'DIRECTION_COMPLETE');
  }
}

export async function getDirection(sessionId: string, founderId: string): Promise<(StrategyDirection & {
  primary_objective?:  string;
  biggest_constraint?: string;
  first_mission?:      string;
  immediate_action?:   string;
  success_signal?:     string;
  confidence_level?:   number;
}) | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('strategy_directions')
    .select('*')
    .eq('session_id', sessionId)
    .eq('founder_id', founderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!data) return null;
  const dir = data as StrategyDirection;
  const meta = (dir.direction_meta ?? {}) as Record<string, unknown>;
  return {
    ...dir,
    primary_objective:  (meta.primaryObjective  as string  | undefined) || undefined,
    biggest_constraint: (meta.biggestConstraint as string  | undefined) || undefined,
    first_mission:      (meta.firstMission      as string  | undefined) || undefined,
    immediate_action:   (meta.immediateAction   as string  | undefined) || undefined,
    success_signal:     (meta.successSignal     as string  | undefined) || undefined,
    confidence_level:   (meta.confidenceLevel   as number  | undefined) || undefined,
  };
}

// ── Step 16: Complete Phase 1 ─────────────────────────────────────────────

export async function completePhase1(
  sessionId:   string,
  founderId:   string,
  directionId: string,
): Promise<OnboardingSession> {
  const supabase = getSupabase();

  // Mark direction acknowledged
  await supabase
    .from('strategy_directions')
    .update({ acknowledged_at: new Date().toISOString(), status: 'acknowledged' })
    .eq('id', directionId)
    .eq('founder_id', founderId);

  // Update founder onboarding_step to 6 so capability status correctly reflects
  // completed discovery + alignment milestones
  await supabase
    .from('founders')
    .update({ onboarding_step: 6, updated_at: new Date().toISOString() })
    .eq('id', founderId);

  // Complete the session first — this is the primary operation
  const completedSession = await transitionState(sessionId, founderId, 'PHASE_1_COMPLETE', {
    completed_at: new Date().toISOString(),
  });

  // Seed Marketing Memory from Phase 1 data so context engine + brief have immediate signal.
  // Non-fatal: Phase 1 completion never fails due to memory seeding.
  try {
    const sessionProductId = (completedSession as unknown as { product_id?: string | null }).product_id ?? null;

    const [fcRes, bgRes, crRes] = await Promise.allSettled([
      supabase.from('founder_context').select('*').eq('session_id', sessionId).eq('founder_id', founderId).maybeSingle(),
      supabase.from('business_goals').select('*').eq('session_id', sessionId).eq('founder_id', founderId).maybeSingle(),
      supabase.from('competitor_relationships').select('name, relationship, key_differentiator').eq('session_id', sessionId).eq('founder_id', founderId),
    ]);

    // GOVERNED BOOTSTRAP ADMISSION (migration 107 + founderBootstrapPolicy).
    //
    // This block used to batch-INSERT legacy-shaped rows: memory_class NULL,
    // authority NULL, no policy version, no provenance, and a hardcoded
    // confidence per category (0.80/0.85/0.90/0.95) that measured nothing. They
    // survived only because the legacy discriminator exempts memory_class IS
    // NULL — an exemption meant for PRE-EXISTING rows, not a licence for a live
    // writer to keep minting new ones.
    //
    // Every candidate now goes through admitFounderBootstrap(), which stamps
    // class, FOUNDER_ASSERTED authority, policy versions, scope and a
    // reconstructible sourceRef, and refuses anything the founder did not
    // explicitly confirm.
    const candidates: FounderBootstrapCandidate[] = [];
    const bootstrapWorkspaceId = await resolveMemoryWorkspace(founderId, sessionProductId ?? null);

    if (fcRes.status === 'fulfilled' && fcRes.value.data) {
      const fc = fcRes.value.data as Record<string, unknown>;
      if (fc.audience_confirmed) {
        candidates.push({
          workspaceId: bootstrapWorkspaceId, productId: sessionProductId, founderId,
          category: 'audience',
          title: 'Primary audience confirmed during onboarding',
          content: { audienceConfirmed: fc.audience_confirmed, workingStyle: fc.working_style ?? null },
          sourceRef: { table: 'founder_context', rowId: String(fc.id), field: 'audience_confirmed' },
          founderConfirmed: true,
        });
      }
      if (fc.context_delta) {
        candidates.push({
          workspaceId: bootstrapWorkspaceId, productId: sessionProductId, founderId,
          category: 'context_delta',
          title: 'Business context change shared during onboarding',
          content: { contextDelta: fc.context_delta, hiddenStrengths: fc.hidden_strengths ?? null, recentWins: fc.recent_wins ?? null },
          sourceRef: { table: 'founder_context', rowId: String(fc.id), field: 'context_delta' },
          founderConfirmed: true,
        });
      }
    }

    if (bgRes.status === 'fulfilled' && bgRes.value.data) {
      const bg = bgRes.value.data as Record<string, unknown>;
      candidates.push({
        workspaceId: bootstrapWorkspaceId, productId: sessionProductId, founderId,
        category: 'goal',
        title: `Primary goal: ${bg.goal_type} → ${bg.target_value} ${bg.unit}`,
        content: { goalType: bg.goal_type, targetValue: bg.target_value, unit: bg.unit, timeHorizonDays: bg.time_horizon_days, motivation: bg.motivation ?? null },
        sourceRef: { table: 'business_goals', rowId: String(bg.id), field: 'goal_type' },
        founderConfirmed: true,
      });
    }

    if (crRes.status === 'fulfilled' && crRes.value.data?.length) {
      const comps = crRes.value.data as Array<Record<string, unknown>>;
      candidates.push({
        workspaceId: bootstrapWorkspaceId, productId: sessionProductId, founderId,
        category: 'competitors',
        title: `${comps.length} competitor(s) confirmed during onboarding`,
        content: { competitors: comps.map(c => ({ name: c.name, relationship: c.relationship, keyDifferentiator: c.key_differentiator })) },
        sourceRef: { table: 'competitor_relationships', rowId: String(sessionId), field: 'name' },
        founderConfirmed: true,
      });
    }

    const memories: Record<string, unknown>[] = [];
    for (const c of candidates) {
      const admission = admitFounderBootstrap(c);
      if (!admission.admit || !admission.row) continue;
      // IDEMPOTENT: keyed on the SOURCE ROW, so resume, refresh or a repeated
      // completePhase1 re-derives the same identity instead of duplicating.
      const { data: existing } = await supabase
        .from('marketing_memories')
        .select('id')
        .eq('workspace_id', c.workspaceId)
        .eq('source', BOOTSTRAP_SOURCE)
        .eq('memory_type', admission.row.memory_type as string)
        .maybeSingle();
      if (existing) continue;
      memories.push(admission.row);
    }

    if (memories.length > 0) {
      await supabase.from('marketing_memories').insert(memories);
    }
  } catch { /* memory seeding is non-fatal — Phase 1 completion always succeeds */ }

  return completedSession;
}

// ── SSRF Protection ───────────────────────────────────────────────────────

/**
 * Validates that a URL resolves to a public internet host.
 * Blocks private IP ranges, localhost, and non-HTTP(S) schemes.
 * @throws if URL is not safe for server-side fetching
 * @security SSRF protection per spec §28
 */
export function validatePublicUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error(`Invalid URL: ${rawUrl}`), { statusCode: 422 });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Only HTTP and HTTPS URLs are allowed'), { statusCode: 422 });
  }

  // URL.hostname keeps the brackets on an IPv6 literal, so `http://[::1]/` arrives
  // here as "[::1]" and never matched the bare '::1' in the list below — IPv6
  // loopback bypassed this guard entirely. Strip them before comparing.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Block localhost variants, IPv4 and IPv6.
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '::', '0:0:0:0:0:0:0:1'].includes(hostname)) {
    throw Object.assign(new Error('URL resolves to a local address'), { statusCode: 422 });
  }

  // Block private IPv4 ranges. Note: this is a literal-address check. A hostname
  // that RESOLVES to a private address (DNS rebinding) still passes — closing that
  // requires resolving and re-checking every address, plus pinning the connection.
  const privateIPv4 = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|127\.)/;
  if (privateIPv4.test(hostname)) {
    throw Object.assign(new Error('URL resolves to a private address'), { statusCode: 422 });
  }

  // Block private/link-local IPv6: loopback, unique-local (fc00::/7), link-local
  // (fe80::/10), and IPv4-mapped forms such as ::ffff:169.254.169.254.
  const privateIPv6 = /^(::1$|::$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|::ffff:)/;
  if (privateIPv6.test(hostname)) {
    throw Object.assign(new Error('URL resolves to a private address'), { statusCode: 422 });
  }

  // Block the cloud instance metadata service (same link-local address on OCI, AWS,
  // GCP and Azure). This matters MORE under OCI Instance Principal than it did under
  // static AWS keys: the metadata service is what vends this workload's short-lived
  // identity, so an owner-supplied URL reaching it would hand over the credentials
  // that unlock the credential vault itself.
  if (hostname === '169.254.169.254') {
    throw Object.assign(new Error('URL resolves to a private address'), { statusCode: 422 });
  }
}

// ── Preliminary Report Generation (called by discoveryWorker) ─────────────

/**
 * Generates the preliminary growth report from scraped app data.
 * Called internally by the discovery worker after data collection.
 */
export async function generatePreliminaryReport(
  jobId:    string,
  founderId: string,
  appData:  Record<string, unknown>,
): Promise<PreliminaryReport> {
  const supabase = getSupabase();

  const appName    = (appData.name as string) ?? 'the app';
  const appDesc    = (appData.description as string) ?? '';
  const reviews    = (appData.reviews as string[]) ?? [];
  const icpData    = (appData.icp as Record<string, unknown>) ?? {};

  const prompt = `You are a mobile growth strategist. Based on this app's data, generate a preliminary growth report.

App: ${appName}
Description: ${appDesc.slice(0, 500)}
Reviews sample: ${reviews.slice(0, 5).join(' | ')}
ICP data: ${JSON.stringify(icpData).slice(0, 500)}

Return ONLY valid JSON:
{
  "headline": "one insight headline about this app's growth opportunity (max 80 chars)",
  "summary": "2-3 sentence summary of what you see",
  "topInsights": ["insight 1", "insight 2", "insight 3"],
  "opportunities": [
    {"title": "...", "description": "...", "confidence": 0.8},
    {"title": "...", "description": "...", "confidence": 0.7}
  ],
  "risks": [
    {"title": "...", "description": "..."}
  ]
}`;

  const auditCtx: AuditContext = { founderId, promptId: 'phase1_preliminary_report', action: 'preliminary_report' };
  const raw = await callHaiku(prompt, 1000, auditCtx);

  let report: PreliminaryReport;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    report = JSON.parse(jsonMatch?.[0] ?? raw) as PreliminaryReport;
  } catch {
    report = {
      headline:      `Key insights for ${appName}`,
      summary:       'Analysis complete. Review your app\'s growth opportunities below.',
      topInsights:   ['Discovery complete'],
      opportunities: [],
      risks:         [],
    };
  }

  await supabase.from('discovery_jobs')
    .update({ report_data: report, ai_tokens_consumed: 15 })
    .eq('id', jobId);

  return report;
}

/**
 * Extracts and inserts product_claims from discovery output.
 * Called internally by the discovery worker.
 */
export async function extractAndStoreClaims(
  sessionId:  string,
  founderId:  string,
  productId:  string | null,
  appData:    Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabase();
  const icp      = (appData.icp as Record<string, unknown>) ?? {};
  const reviews  = (appData.reviews as Array<{ text?: string; rating?: number }>) ?? [];
  const metadata = (appData.metadata as Record<string, unknown>) ?? {};

  const claims: Array<Record<string, unknown>> = [];
  let order = 0;

  function push(
    claim_type: 'FACT' | 'INFERENCE',
    category: string,
    title: string,
    body: string,
    confidence: number,
    evidenceType: string,
  ) {
    claims.push({
      session_id: sessionId, founder_id: founderId, product_id: productId,
      claim_type, category, title, body, confidence,
      status: 'UNREVIEWED',
      evidence_sources: [{ type: evidenceType, count: 1, excerpt: body.slice(0, 120) }],
      display_order: order++,
    });
  }

  // ── 1. Product category (FACT) ────────────────────────────────────────────
  const category = (metadata.category as string) ?? '';
  if (category) {
    push('FACT', 'feature',
      'Product category',
      category,
      0.99, 'app_store');
  }

  // ── 2. Primary market (FACT) ──────────────────────────────────────────────
  const markets = (icp.geography as string[]) ?? (icp.suggestedMarkets as string[]) ?? [];
  const marketStr = markets.length > 0
    ? markets.map((m: string) => m === 'usa' ? 'United States' : m === 'india' ? 'India' : m).join(', ')
    : null;
  if (marketStr) {
    push('FACT', 'market',
      'Primary market',
      marketStr,
      0.92, 'app_store');
  }

  // ── 3. Business model (ASSUMPTION from price tier + description) ──────────
  const priceTier  = (metadata.priceTier as string) ?? (icp.priceTier as string) ?? '';
  const description = (metadata.description as string) ?? '';
  const modelGuess = priceTier === 'free'
    ? 'Free-to-download with in-app purchases or freemium tier'
    : priceTier === 'paid'
    ? 'Paid upfront with no recurring subscription'
    : description.toLowerCase().includes('subscription')
    ? 'Subscription-based recurring revenue'
    : description.toLowerCase().includes('marketplace')
    ? 'Transaction or commission marketplace model'
    : 'Freemium or in-app purchase monetisation';
  push('INFERENCE', 'pricing',        // 'pricing' is the valid category for business model
    'Business model',
    modelGuess,
    0.68, 'description_analysis');

  // ── 4. Growth stage (ASSUMPTION from rating + review count) ──────────────
  const rating      = Number(metadata.rating ?? 0);
  const reviewCount = Number(metadata.reviewCount ?? reviews.length ?? 0);
  const stageGuess  = reviewCount === 0
    ? 'Early-stage — no public review signal yet'
    : reviewCount < 100
    ? 'Early traction — building initial user base and feedback loop'
    : reviewCount < 1000
    ? 'Growth stage — product-market fit signals emerging'
    : `Scaling — ${reviewCount.toLocaleString()} reviews, rating ${rating}/5`;
  push('INFERENCE', 'other',          // 'other' is the valid category for growth stage
    'Growth stage',
    stageGuess,
    0.70, 'review_signal');

  // ── 5. Primary constraint (ASSUMPTION from pain points) ───────────────────
  const painPoints = (icp.painPoints as string[]) ?? [];
  const topPain = painPoints[0] ?? null;
  if (topPain) {
    push('INFERENCE', 'pain_point',   // constraint maps to pain_point
      'Primary constraint',
      topPain,
      0.72, 'review_analysis');
  }

  // ── 6. Current channels observed (FACT from platforms + website) ──────────
  //
  // WAS: two `if`s against a single scalar `platform`, which are mutually
  // exclusive — so a product listed on BOTH stores could only ever be reported
  // as one of them, at confidence 0.95, as a FACT. LaunchMind was confidently
  // wrong about something the owner had explicitly told it.
  //
  // `platforms` is the set actually scraped. The scalar is still honoured so
  // callers that pass one (intakeWorker) keep working.
  const platformSet = new Set<string>(
    Array.isArray(appData.platforms) ? (appData.platforms as string[]) : [],
  );
  const scalarPlatform = (metadata.platform as string) ?? '';
  if (scalarPlatform) platformSet.add(scalarPlatform);

  const hasWebsite  = Boolean(appData.websiteMeta && Object.keys(appData.websiteMeta as object).length > 0);
  const channelParts: string[] = [];
  if (platformSet.has('app_store'))  channelParts.push('App Store');
  if (platformSet.has('play_store')) channelParts.push('Play Store');
  if (hasWebsite)                    channelParts.push('website');
  if (reviewCount > 0)               channelParts.push('organic reviews');
  if (channelParts.length > 0) {
    push('FACT', 'channel',           // singular 'channel' not 'channels'
      'Current channels observed',
      channelParts.join(', '),
      0.95, 'app_store');
  }

  // ── 7. Additional pain points as INFERENCE claims (up to 2 more) ──────────
  for (const pain of painPoints.slice(1, 3)) {
    push('INFERENCE', 'pain_point',
      pain.length > 70 ? pain.slice(0, 67) + '…' : pain,
      `Identified from ${reviews.length} review signals.`,
      0.65, 'review_analysis');
  }

  // ── 8. Target audience (INFERENCE) — fix: field is targetUser not targetAudience ──
  const targetUser = (icp.targetUser as string) ?? (icp.targetAudience as string) ?? '';
  if (targetUser) {
    push('INFERENCE', 'icp',
      'Target audience',
      targetUser,
      0.78, 'icp_analysis');
  }

  if (claims.length > 0) {
    const { error } = await supabase.from('product_claims').insert(claims);
    if (error) {
      console.error('[extractAndStoreClaims] insert failed:', error.message, error.details);
    }
  }
}
