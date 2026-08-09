/**
 * @file growthBrainLearningService.ts
 * @description Writes and reads the Growth Brain learning log — the record of what
 *   LaunchMind believed, what changed it, and what it believes now (spec §4.3, §16).
 *
 *   This is an explainability surface, so it is held to a stricter standard than a
 *   normal audit table:
 *
 *     - It never invents a confidence movement. When a change did not measurably move
 *       the Growth Brain score, prior/new confidence are NULL and the UI says
 *       "no measured change" rather than showing a fabricated "+5 points".
 *     - It always records whether the change was concluded by LaunchMind ('system')
 *       or entered by a person ('founder'). That distinction is the whole point.
 *     - Writes are best-effort and never fail the operation that triggered them.
 *       Losing a log line is bad; losing an owner's imported data or context edit
 *       because the log write failed would be worse.
 *
 * @security Reads require a verified WorkspaceContext and are filtered by
 *   workspace_id at the query layer as well as by RLS. Writes go through the service
 *   role because the table is append-only to authenticated roles.
 * @dependencies growth_brain_learning_events (migration 085), saved_opportunities,
 *   missions, intelligenceService (confidence snapshots)
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import type { WorkspaceContext } from './workspaceAuthService';

export const LEARNING_EVENT_TYPES = [
  'source_connected',
  'source_synced',
  'source_disconnected',
  'source_reauthorized',
  'context_updated',
  'context_delta_updated',
  'recommendation_updated',
  'authority_changed',
] as const;

export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

/** One { label, value } pair, matching connection_insights.evidence exactly. */
export interface LearningEvidenceItem {
  label: string;
  value: string | number;
}

export interface RecordLearningEventInput {
  workspaceId:   string;
  founderId:     string;
  productId?:    string | null;
  eventType:     LearningEventType;
  /** Owner-facing one-liner. Must describe what happened, not the code path. */
  trigger:       string;
  provider?:     string | null;
  connectionId?: string | null;
  syncRunId?:    string | null;
  triggerSignalId?: string | null;
  traceId?:      string | null;
  evidence?:     LearningEvidenceItem[];
  previousState?: string | null;
  newState?:     string | null;
  /** 0–100. Omit both when the change did not move measured confidence. */
  priorConfidence?: number | null;
  newConfidence?:   number | null;
  recommendationIdsAffected?: string[];
  missionIdsAffected?:        string[];
  createdByType: 'system' | 'founder';
  createdBy?:    string | null;
}

export interface LearningLogEntry {
  id:            string;
  createdAt:     string;
  eventType:     LearningEventType;
  trigger:       string;
  provider:      string | null;
  providerLabel: string | null;
  connectionId:  string | null;
  syncRunId:     string | null;
  traceId:       string | null;
  evidence:      LearningEvidenceItem[];
  previousState: string | null;
  newState:      string | null;
  priorConfidence: number | null;
  newConfidence:   number | null;
  /**
   * Pre-computed so every surface phrases it the same way. NULL when confidence was
   * not measured on both sides — the UI must not subtract from a missing number.
   */
  confidenceDelta: number | null;
  /** 'automatic' when LaunchMind concluded it; 'founder_confirmed' when a person did. */
  changeOrigin:  'automatic' | 'founder_confirmed';
  affectedRecommendations: Array<{ id: string; title: string | null }>;
  affectedMissions:        Array<{ id: string; title: string | null }>;
}

/** Owner-facing provider names. Kept here so the log reads like the rest of the app. */
const PROVIDER_LABELS: Record<string, string> = {
  app_store_connect: 'App Store Connect',
  revenue_cat:       'RevenueCat',
  ga4:               'Google Analytics',
  stripe:            'Stripe',
  search_console:    'Search Console',
  google_ads:        'Google Ads',
  meta_ads:          'Meta',
  hubspot:           'HubSpot',
  mailchimp:         'Mailchimp',
};

/**
 * Appends one learning-log entry.
 *
 * @param input - What changed, why, and on whose authority
 * @returns The new row id, or null when the write failed
 * @security Never throws. Callers are mid-operation (a sync, a context save) and a
 *   log failure must not roll back real work the owner asked for.
 */
export async function recordLearningEvent(
  input: RecordLearningEventInput,
): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('growth_brain_learning_events')
      .insert({
        workspace_id:      input.workspaceId,
        founder_id:        input.founderId,
        product_id:        input.productId ?? null,
        event_type:        input.eventType,
        trigger:           input.trigger,
        provider:          input.provider ?? null,
        connection_id:     input.connectionId ?? null,
        sync_run_id:       input.syncRunId ?? null,
        trigger_signal_id: input.triggerSignalId ?? null,
        trace_id:          input.traceId ?? null,
        evidence:          input.evidence ?? [],
        previous_state:    input.previousState ?? null,
        new_state:         input.newState ?? null,
        // Only recorded when BOTH sides are known. A one-sided confidence reads as a
        // movement from zero, which would be a lie about what LaunchMind measured.
        prior_confidence:
          input.priorConfidence != null && input.newConfidence != null ? input.priorConfidence : null,
        new_confidence:
          input.priorConfidence != null && input.newConfidence != null ? input.newConfidence : null,
        recommendation_ids_affected: input.recommendationIdsAffected ?? [],
        mission_ids_affected:        input.missionIdsAffected ?? [],
        created_by_type:   input.createdByType,
        created_by:        input.createdBy ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[growthBrainLearning] write failed:', error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.warn('[growthBrainLearning] write threw:', (err as Error).message);
    return null;
  }
}

interface LearningEventRow {
  id: string;
  created_at: string;
  event_type: LearningEventType;
  trigger: string;
  provider: string | null;
  connection_id: string | null;
  sync_run_id: string | null;
  trace_id: string | null;
  evidence: unknown;
  previous_state: string | null;
  new_state: string | null;
  prior_confidence: number | string | null;
  new_confidence: number | string | null;
  recommendation_ids_affected: string[] | null;
  mission_ids_affected: string[] | null;
  created_by_type: 'system' | 'founder';
}

/** Coerces a jsonb evidence column into the array shape the UI expects. */
function toEvidence(raw: unknown): LearningEvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { label, value } = item as { label?: unknown; value?: unknown };
    if (typeof label !== 'string') return [];
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    return [{ label, value }];
  });
}

/** Postgres NUMERIC arrives as a string over the wire. */
function toNumberOrNull(raw: number | string | null): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads the learning log for a workspace, newest first.
 *
 * Affected recommendations and missions are resolved to their titles in two batched
 * queries rather than per row, and are filtered by the same workspace/founder scope —
 * a referenced id from another tenant resolves to nothing rather than leaking a title.
 *
 * @param ctx    - Verified workspace context
 * @param opts   - limit (default 20, max 100), before (ISO cursor), productId filter
 * @returns Entries plus a cursor for the next page
 * @security Query is filtered by ctx.workspaceId in addition to RLS.
 */
export async function listLearningEvents(
  ctx: WorkspaceContext,
  opts: { limit?: number; before?: string; productId?: string } = {},
): Promise<{ entries: LearningLogEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  let query = getSupabaseAdmin()
    .from('growth_brain_learning_events')
    .select(
      'id, created_at, event_type, trigger, provider, connection_id, sync_run_id, trace_id, ' +
      'evidence, previous_state, new_state, prior_confidence, new_confidence, ' +
      'recommendation_ids_affected, mission_ids_affected, created_by_type',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    // One extra row tells us whether another page exists without a second count query.
    .limit(limit + 1);

  if (opts.before)    query = query.lt('created_at', opts.before);
  if (opts.productId) query = query.eq('product_id', opts.productId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to read learning log: ${error.message}`);

  const rows = (data ?? []) as unknown as LearningEventRow[];
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.created_at ?? null) : null;

  // Batch-resolve titles for everything the page references.
  const recIds = [...new Set(page.flatMap(r => r.recommendation_ids_affected ?? []))];
  const misIds = [...new Set(page.flatMap(r => r.mission_ids_affected ?? []))];

  /**
   * Resolves referenced ids to titles, scoped to the caller. A reference that belongs
   * to another tenant simply resolves to nothing — the log never renders a title it
   * was not entitled to read.
   */
  const resolveTitles = async (
    table: 'saved_opportunities' | 'missions',
    ids: string[],
  ): Promise<Map<string, string | null>> => {
    if (ids.length === 0) return new Map();
    try {
      const { data: rows } = await getSupabaseAdmin()
        .from(table)
        .select('id, title')
        .eq('founder_id', ctx.actorId)
        .in('id', ids);
      const typed = (rows ?? []) as unknown as Array<{ id: string; title: string | null }>;
      return new Map(typed.map(r => [r.id, r.title]));
    } catch {
      return new Map();
    }
  };

  const [recById, misById] = await Promise.all([
    resolveTitles('saved_opportunities', recIds),
    resolveTitles('missions', misIds),
  ]);

  const entries: LearningLogEntry[] = page.map((row) => {
    const prior = toNumberOrNull(row.prior_confidence);
    const next  = toNumberOrNull(row.new_confidence);

    return {
      id:            row.id,
      createdAt:     row.created_at,
      eventType:     row.event_type,
      trigger:       row.trigger,
      provider:      row.provider,
      providerLabel: row.provider ? (PROVIDER_LABELS[row.provider] ?? row.provider) : null,
      connectionId:  row.connection_id,
      syncRunId:     row.sync_run_id,
      traceId:       row.trace_id,
      evidence:      toEvidence(row.evidence),
      previousState: row.previous_state,
      newState:      row.new_state,
      priorConfidence: prior,
      newConfidence:   next,
      confidenceDelta:
        prior != null && next != null ? Math.round((next - prior) * 100) / 100 : null,
      changeOrigin: row.created_by_type === 'founder' ? 'founder_confirmed' : 'automatic',
      // An id that resolves to nothing (deleted, or another tenant's) is dropped
      // rather than rendered as a dangling reference.
      affectedRecommendations: (row.recommendation_ids_affected ?? [])
        .filter(id => recById.has(id))
        .map(id => ({ id, title: recById.get(id) ?? null })),
      affectedMissions: (row.mission_ids_affected ?? [])
        .filter(id => misById.has(id))
        .map(id => ({ id, title: misById.get(id) ?? null })),
    };
  });

  return { entries, nextCursor };
}

/**
 * Reads the current Growth Brain understanding score, for use as a confidence
 * snapshot either side of a change.
 *
 * @returns The 0–100 score, or null when coverage could not be computed. NULL is
 *   propagated rather than substituted, so a failed snapshot suppresses the
 *   confidence movement instead of inventing one.
 */
export async function snapshotConfidence(ctx: WorkspaceContext): Promise<number | null> {
  try {
    const { getGrowthBrainCoverage } = await import('./intelligenceService');
    const coverage = await getGrowthBrainCoverage(ctx);
    return typeof coverage.overallScore === 'number' ? coverage.overallScore : null;
  } catch {
    return null;
  }
}
