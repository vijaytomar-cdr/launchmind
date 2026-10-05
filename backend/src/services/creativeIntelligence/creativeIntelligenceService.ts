/**
 * @file creativeIntelligenceService.ts
 * @description Creative Intelligence persistence and read path — §14, §15, §19.
 *
 *   The service layer is deliberately thin. Everything that decides anything —
 *   what counts as a pattern, what an influence may say, what may not be
 *   imitated — is pure and lives in contract.ts, patternDerivation.ts and
 *   copyrightBoundary.ts, so those decisions are testable without a database
 *   and cannot be quietly bypassed by a different caller.
 *
 *   READ FAILURE IS NEVER FATAL. Every read here returns an empty result on
 *   error rather than throwing. Content creation has to work identically when
 *   Creative Intelligence is unavailable, empty, or switched off — if a
 *   creative-observation outage could block an owner from making an advert,
 *   this subsystem would have become load-bearing for something it has no
 *   business being load-bearing for.
 *
 * @security Workspace scope is a parameter and is applied to every query.
 *   Observations are recorded ONLY through `recordObservations`, which passes
 *   the ingestion boundary; there is no other write path.
 * @dependencies supabaseAdmin, contract, patternDerivation, copyrightBoundary
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import {
  publisherIndependenceKey, resolveCreativeIntelligenceMode,
  CREATIVE_INTELLIGENCE_POLICY_VERSION, ENGAGEMENT_LIMITATION_NOTES,
  CREATIVE_SOURCE_CLASSES,
  type CreativeObservation, type CreativePattern,
} from './contract';
import { derivePatterns } from './patternDerivation';
import { assessAbstraction } from './copyrightBoundary';

/** What a caller may offer. Everything is validated before it becomes a row. */
export type ObservationInput = Omit<CreativeObservation, 'id'>;

export class CreativeIngestionError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'CreativeIngestionError'; }
}

const MAX_TEXT = 400;

/**
 * The ingestion boundary for a creative observation.
 *
 * Modelled on marketIntelligence/ingestionBoundary: an allow-list of typed
 * fields, hard caps, and REJECTION rather than repair. A source that has to be
 * cleaned up to be acceptable is a source whose remaining fields do not deserve
 * trust either.
 *
 * @throws {CreativeIngestionError}
 */
export function validateObservation(o: ObservationInput): ObservationInput {
  if (!(CREATIVE_SOURCE_CLASSES as readonly string[]).includes(o.sourceClass)) {
    throw new CreativeIngestionError(`source class ${o.sourceClass} is not permitted`);
  }
  // PUBLIC AND UNAUTHENTICATED. A non-http reference cannot be checked by
  // anyone reading the record later, which defeats the point of recording it.
  let url: URL;
  try { url = new URL(o.sourceRef); }
  catch { throw new CreativeIngestionError('source reference must be a public URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CreativeIngestionError('source reference must be a public web URL');
  }
  // Credentials in a source URL mean the source was NOT public.
  if (url.username || url.password || /[?&](token|auth|session|key)=/i.test(url.search)) {
    throw new CreativeIngestionError('source reference carries credentials, so it was not public');
  }
  if (!o.observedAt || Number.isNaN(new Date(o.observedAt).getTime())) {
    throw new CreativeIngestionError('an observation must record when it was observed');
  }
  // AN ENGAGEMENT COUNT WITHOUT ITS LIMITS IS A PERFORMANCE CLAIM. The database
  // enforces this too; doing it here as well means the caller gets a reason
  // rather than a constraint violation.
  if (o.publicEngagement && (o.signalLimitations ?? []).length === 0) {
    throw new CreativeIngestionError(
      'a public engagement figure must be recorded with what it cannot tell us');
  }
  const cap = (s: string | null) => (s == null ? null : s.slice(0, MAX_TEXT));
  return {
    ...o,
    hookStructure: cap(o.hookStructure), firstFrame: cap(o.firstFrame),
    visualComposition: cap(o.visualComposition), pacing: cap(o.pacing),
    ctaStyle: cap(o.ctaStyle), notes: cap(o.notes),
    publisher: o.publisher ? o.publisher.slice(0, 200) : null,
    signalLimitations: o.publicEngagement
      ? [...new Set([...(o.signalLimitations ?? []), ...ENGAGEMENT_LIMITATION_NOTES])]
      : (o.signalLimitations ?? []),
  };
}

/**
 * Records observations and re-derives this workspace's patterns.
 *
 * @returns how many observations were accepted, and the patterns now standing
 * @security Every observation passes `validateObservation`. Derivation runs on
 *   the FULL corpus, not just the new rows, so an added source can raise a
 *   candidate over the independence threshold and a removed one can drop it.
 */
export async function recordObservations(
  workspaceId: string, productId: string | null, inputs: readonly ObservationInput[],
  competitorNames: readonly string[] = [],
): Promise<{ accepted: number; rejected: Array<{ sourceRef: string; reason: string }>;
             patterns: CreativePattern[] }> {
  const db = getSupabaseAdmin();
  const rejected: Array<{ sourceRef: string; reason: string }> = [];
  const rows: Record<string, unknown>[] = [];

  for (const raw of inputs) {
    try {
      const o = validateObservation(raw);
      rows.push({
        workspace_id: workspaceId, product_id: productId,
        source_class: o.sourceClass, source_ref: o.sourceRef, publisher: o.publisher,
        independence_key: publisherIndependenceKey(o.publisher, o.sourceRef),
        channel: o.channel, category: o.category, format: o.format,
        observed_at: o.observedAt,
        narrative_shape: o.narrativeShape, hook_structure: o.hookStructure,
        first_frame: o.firstFrame, product_reveal_seconds: o.productRevealSeconds,
        caption_density: o.captionDensity, visual_composition: o.visualComposition,
        pacing: o.pacing, duration_seconds: o.durationSeconds, cta_style: o.ctaStyle,
        public_engagement: o.publicEngagement, signal_limitations: o.signalLimitations,
        notes: o.notes, policy_version: CREATIVE_INTELLIGENCE_POLICY_VERSION,
      });
    } catch (e) {
      rejected.push({ sourceRef: raw.sourceRef,
        reason: e instanceof CreativeIngestionError ? e.reason : 'could not be validated' });
    }
  }

  if (rows.length > 0) {
    const { error } = await db.from('creative_observations')
      .upsert(rows, { onConflict: 'workspace_id,source_ref,observed_at,format',
                      ignoreDuplicates: true });
    // Reported, never swallowed. A silent insert failure would leave patterns
    // derived from a corpus nobody can see.
    if (error) throw new CreativeIngestionError(`could not record observations: ${error.message}`);
  }

  const patterns = await rederivePatterns(workspaceId, competitorNames);
  return { accepted: rows.length, rejected, patterns };
}

/** Reads the full observation corpus for a workspace. */
export async function listObservations(
  workspaceId: string, category?: string,
): Promise<CreativeObservation[]> {
  const db = getSupabaseAdmin();
  let q = db.from('creative_observations').select('*').eq('workspace_id', workspaceId);
  if (category) q = q.eq('category', category);
  const { data, error } = await q.order('observed_at', { ascending: false }).limit(500);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    id: String(r.id), sourceClass: r.source_class as CreativeObservation['sourceClass'],
    sourceRef: String(r.source_ref), publisher: (r.publisher as string | null) ?? null,
    channel: String(r.channel), category: String(r.category),
    format: r.format as CreativeObservation['format'],
    observedAt: String(r.observed_at),
    narrativeShape: r.narrative_shape as CreativeObservation['narrativeShape'],
    hookStructure: (r.hook_structure as string | null) ?? null,
    firstFrame: (r.first_frame as string | null) ?? null,
    productRevealSeconds: r.product_reveal_seconds == null ? null : Number(r.product_reveal_seconds),
    captionDensity: r.caption_density as CreativeObservation['captionDensity'],
    visualComposition: (r.visual_composition as string | null) ?? null,
    pacing: (r.pacing as string | null) ?? null,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    ctaStyle: (r.cta_style as string | null) ?? null,
    publicEngagement: (r.public_engagement as CreativeObservation['publicEngagement']) ?? null,
    signalLimitations: (r.signal_limitations as string[]) ?? [],
    notes: (r.notes as string | null) ?? null,
  }));
}

/** Re-derives and persists patterns from the whole corpus. */
export async function rederivePatterns(
  workspaceId: string, competitorNames: readonly string[] = [],
): Promise<CreativePattern[]> {
  const db = getSupabaseAdmin();
  const observations = await listObservations(workspaceId);
  const { patterns } = derivePatterns(observations, competitorNames);

  if (patterns.length > 0) {
    const { error } = await db.from('creative_patterns').upsert(
      patterns.map(p => ({
        workspace_id: workspaceId, pattern_key: p.key, description: p.description,
        dimension: p.dimension, category: p.category, channel: p.channel, format: p.format,
        independent_source_count: p.independentSourceCount,
        first_observed_at: p.firstObservedAt, last_observed_at: p.lastObservedAt,
        quality: p.quality, do_not_imitate: p.doNotImitate,
        policy_version: CREATIVE_INTELLIGENCE_POLICY_VERSION,
        updated_at: new Date().toISOString(),
        // Re-deriving a pattern that had been retracted does NOT resurrect it.
        // A retraction is a judgement about the pattern, not about the corpus.
      })), { onConflict: 'workspace_id,pattern_key' });
    if (error) throw new CreativeIngestionError(`could not persist patterns: ${error.message}`);
  }
  return patterns;
}

/**
 * The patterns available to influence work right now.
 *
 * Retracted patterns are excluded. OFF returns nothing at all, which is how the
 * "content creation still works with no creative intelligence" path is exercised
 * in production rather than only in tests.
 */
export async function activePatterns(
  workspaceId: string, category: string | null,
): Promise<CreativePattern[]> {
  if (resolveCreativeIntelligenceMode() === 'OFF') return [];
  const db = getSupabaseAdmin();
  try {
    let q = db.from('creative_patterns').select('*')
      .eq('workspace_id', workspaceId).is('retracted_at', null);
    if (category) q = q.eq('category', category);
    const { data, error } = await q.order('independent_source_count', { ascending: false }).limit(50);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(r => ({
      id: String(r.id), key: String(r.pattern_key), description: String(r.description),
      dimension: r.dimension as CreativePattern['dimension'],
      category: String(r.category), channel: (r.channel as string | null) ?? null,
      format: (r.format as string | null) ?? null,
      independentSourceCount: Number(r.independent_source_count),
      firstObservedAt: String(r.first_observed_at), lastObservedAt: String(r.last_observed_at),
      quality: (r.quality as CreativePattern['quality']),
      doNotImitate: (r.do_not_imitate as string[]) ?? [],
    }));
  } catch {
    // Unavailable is not empty, but for the CALLER both mean "no direction to
    // apply". The distinction is reported by the health surface, not by making
    // content creation fail.
    return [];
  }
}

/** Withdraws a pattern from influencing new work. History is unaffected. */
export async function retractPattern(
  workspaceId: string, patternKey: string, reason: string,
): Promise<void> {
  const db = getSupabaseAdmin();
  await db.from('creative_patterns')
    .update({ retracted_at: new Date().toISOString(), retraction_reason: reason.slice(0, 400) })
    .eq('workspace_id', workspaceId).eq('pattern_key', patternKey);
}

/** Re-exported so callers do not reach past the service for a pure check. */
export { assessAbstraction };
