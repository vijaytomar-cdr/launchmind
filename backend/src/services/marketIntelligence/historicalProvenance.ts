/**
 * @file historicalProvenance.ts
 * @description Owner-visible CURRENT lifecycle for evidence a HISTORICAL
 *   recommendation cited — Phase 3.4C case G.
 *
 *   THE PROBLEM. A recommendation is a frozen record of what LaunchMind said and
 *   why, at a moment. The source it rested on keeps living: it can be corrected,
 *   superseded, withdrawn or erased afterwards. The snapshot correctly does not
 *   change — but an owner reading it months later was told nothing about the
 *   source having been retracted since.
 *
 *   THE CONSTRAINT THAT SHAPES THE SOLUTION. `supported_by` is an input to
 *   `fingerprintOf`, so storing a source reference inside the provenance entry
 *   would change every recommendation's fingerprint — i.e. its identity, and
 *   with it action equivalence and settled decisions. That is forbidden, and it
 *   would also be wrong: identity must not depend on something that changes
 *   after the fact.
 *
 *   So nothing is written. The current lifecycle is resolved at READ time from
 *   the source records for the product's own entities, and matched to the frozen
 *   provenance entry by the two things the snapshot already carries — the entity
 *   label and the store it came from. Two timelines, joined for display only.
 *
 *   FAILING HONESTLY. If the source cannot be looked up, the owner is told the
 *   status could not be confirmed. Silence would read as "still valid", which is
 *   the one answer this module exists to stop.
 *
 * @security Adds owner-safe COPY only. No source record id, resolution id,
 *   subject key, lifecycle enum or policy version reaches the response.
 * @dependencies marketIntelligence/contract, subjectResolver, supabaseAdmin
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { lifecycleDisclosure, type LifecycleState } from './contract';
import { resolveProductSubjects } from './subjectResolver';

/** One frozen provenance entry, as persisted. Shape is not modified. */
export interface ProvenanceEntry {
  kind: string;
  label: string;
  detail?: string | null;
  [k: string]: unknown;
}

/** What the owner is told when the source's standing cannot be established. */
export const UNKNOWN_SOURCE_NOTICE =
  'The current status of this source could not be confirmed.';

/** Store wording as it appears in a frozen label. */
function providerOf(label: string): 'app_store' | 'play_store' | null {
  if (label.includes('App Store observation')) return 'app_store';
  if (label.includes('Play Store observation')) return 'play_store';
  return null;
}

/** The entity part of "Rival — App Store observation". */
function entityOf(label: string): string {
  return label.split('—')[0].trim().toLowerCase();
}

/**
 * Annotates historical market provenance with the source's CURRENT standing.
 *
 * @param productId - the product the recommendations belong to
 * @param recommendations - rows carrying frozen `supportedBy` entries
 * @returns the same rows, with `currentLifecycleNotice` added to market entries
 *   that are no longer ACTIVE. Entries whose source is still ACTIVE are
 *   returned untouched, so the common case adds nothing to the payload.
 * @security Never mutates the persisted snapshot; annotation is display-only.
 */
export async function annotateHistoricalProvenance<
  T extends { supportedBy?: unknown },
>(productId: string | null, recommendations: T[]): Promise<T[]> {
  if (!productId || recommendations.length === 0) return recommendations;

  // Does any recommendation actually cite market evidence? If not, nothing to
  // resolve and no query to run.
  const hasMarket = recommendations.some(r =>
    Array.isArray(r.supportedBy)
    && (r.supportedBy as ProvenanceEntry[]).some(p => p?.kind === 'MARKET_INTELLIGENCE'));
  if (!hasMarket) return recommendations;

  // Current state of the entities THIS product is allowed to see. Anything
  // outside that set is not resolvable here, which is also the isolation rule.
  let byEntity = new Map<string, LifecycleState>();
  let lookupFailed = false;
  try {
    const subjects = await resolveProductSubjects(productId);
    if (subjects.allSubjectKeys.length === 0) {
      lookupFailed = true;
    } else {
      const { data, error } = await getSupabaseAdmin()
        .from('market_intelligence_source_records')
        .select('subject_key, subject_label, source_provider, lifecycle_state')
        .in('subject_key', subjects.allSubjectKeys);
      if (error) throw new Error(error.message);

      for (const row of (data ?? []) as Array<Record<string, unknown>> ) {
        const subjectKey = String(row.subject_key);
        const label = (subjects.labels[subjectKey] ?? row.subject_label ?? '') as string;
        const key = `${label.trim().toLowerCase()}::${String(row.source_provider)}`;
        const state = row.lifecycle_state as LifecycleState;
        // Worst standing wins: if ANY observation for this entity+store has been
        // withdrawn, the owner is told, rather than being reassured by whichever
        // row happened to be read last.
        const prior = byEntity.get(key);
        if (!prior || (prior === 'ACTIVE' && state !== 'ACTIVE')) byEntity.set(key, state);
      }
    }
  } catch {
    lookupFailed = true;
    byEntity = new Map();
  }

  return recommendations.map(r => {
    if (!Array.isArray(r.supportedBy)) return r;
    const entries = r.supportedBy as ProvenanceEntry[];
    let changed = false;

    const annotated = entries.map(p => {
      if (p?.kind !== 'MARKET_INTELLIGENCE') return p;
      const provider = providerOf(String(p.label ?? ''));
      if (!provider) return p;

      const state = byEntity.get(`${entityOf(String(p.label ?? ''))}::${provider}`);

      // Not found, or the whole lookup failed → say so. Never assume ACTIVE.
      if (!state) {
        changed = true;
        return { ...p, currentLifecycleNotice: UNKNOWN_SOURCE_NOTICE };
      }
      const notice = lifecycleDisclosure(state);
      if (!notice) return p;             // ACTIVE — nothing to disclose
      changed = true;
      return { ...p, currentLifecycleNotice: notice };
    });

    void lookupFailed;
    return changed ? { ...r, supportedBy: annotated } : r;
  });
}

/**
 * THE ONE settled-history composition, shared by the route and its tests.
 *
 * MEASURED WEAKNESS this closes: the route composed product resolution, churn
 * dedup and lifecycle annotation inline, and the regression test re-implemented
 * that composition in a helper. A test that copies the logic it checks proves
 * only that the copy agrees with itself — dropping the annotation from the
 * ROUTE would not have failed anything. Both now call this.
 *
 * @param workspaceId - a VERIFIED workspace context, never a client hint
 * @returns settled decisions for the workspace's active product, one row per
 *   owner action, each with the source's current lifecycle disclosed
 * @security Product is derived from the workspace here, so history cannot be
 *   widened by a caller that forgets to pass one (the P1-23 defect).
 */
export async function listSettledHistory(
  workspaceId: string,
): Promise<Array<Record<string, unknown>>> {
  const db = getSupabaseAdmin();
  const { data: prod } = await db
    .from('products').select('id')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1).maybeSingle();
  const productId = (prod as { id?: string } | null)?.id ?? null;

  const { listRecommendationDecisions } = await import('../growthBrainDecisionService');
  const settled = await listRecommendationDecisions({ workspaceId, productId });

  // Churn control (P1-13): the owner decided an ACTION, not a wording. Two
  // settled rows sharing an action_key are one decision recorded twice.
  const byAction = new Map<string, typeof settled[number]>();
  for (const r of settled) {
    const key = r.actionKey ?? r.id;
    if (!byAction.has(key)) byAction.set(key, r);
  }

  return annotateHistoricalProvenance(
    productId, [...byAction.values()] as unknown as Array<Record<string, unknown>>);
}
