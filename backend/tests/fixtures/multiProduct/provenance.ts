/**
 * @file provenance.ts
 * @description Provenance model and workspace identity for the three-arm
 *   multi-product shadow validation — §1, §2, §16, §G.
 *
 *   WHY PROVENANCE IS NOT AUTHORITY. A provenance class says WHERE a fact came
 *   from. An authority tier says HOW MUCH WEIGHT it carries. Collapsing the two
 *   is the single most dangerous shortcut available here: it would let an
 *   official public announcement act as a founder confirmation, or a five-star
 *   review act as a first-party outcome. `suggestedAuthority` below is a
 *   STARTING POINT for a candidate builder, never a grant — the authority tier
 *   is still assigned by `authorityPolicy` from the authenticated actor.
 *
 *   Synthetic fixtures stay distinguishable from real evidence at every layer
 *   (§2), so no published figure can silently mix them.
 *
 * @security Isolation constants. The three labs must never share a workspace id;
 *   §16 requires provable zero leakage between them.
 * @dependencies authorityPolicy (types only)
 */

import type { AuthorityTier } from '../../../src/services/memory/authorityPolicy';

/** WHERE a piece of evidence came from. Never a weight. */
export const PROVENANCE_CLASSES = [
  /** Owner-confirmed state from the real onboarding/domain path. */
  'REAL_INTERNAL',
  /** Official first-party publication by the subject company. */
  'REAL_PUBLIC_OFFICIAL',
  /** Public end-user review or rating. One person, not a population. */
  'REAL_PUBLIC_REVIEW',
  /** Authored by this validation to exercise a specific path. Always labelled. */
  'CONTROLLED_SYNTHETIC',
] as const;
export type ProvenanceClass = typeof PROVENANCE_CLASSES[number];

export interface ProvenanceRecord {
  class: ProvenanceClass;
  /** Resolvable source: URL, table+id, or document path. Required for real classes. */
  source: string;
  /** When the SOURCE was published — not when we read it. Drives chronology. */
  observedAt: string | null;
  /** Free-text note on what the source actually supports. */
  supports: string;
  /** True only for CONTROLLED_SYNTHETIC. Kept explicit so it cannot be inferred away. */
  synthetic: boolean;
}

/**
 * The authority a candidate builder may START from for each provenance class.
 *
 * Deliberately conservative:
 * - a public review is DERIVED_INFERENCE, because one reviewer's experience
 *   generalises to nothing on its own; corroboration must earn anything more;
 * - an official announcement is VERIFIED_EXTERNAL — reliable about what the
 *   company SAYS, which is not the same as a measured outcome;
 * - REAL_INTERNAL carries no default at all, because founder authority depends
 *   on the authenticated actor, and reading it off a provenance class is
 *   exactly the forged-authority path §32 tests for.
 */
export const SUGGESTED_AUTHORITY: Record<ProvenanceClass, AuthorityTier | null> = {
  REAL_INTERNAL: null,
  REAL_PUBLIC_OFFICIAL: 'VERIFIED_EXTERNAL',
  REAL_PUBLIC_REVIEW: 'DERIVED_INFERENCE',
  CONTROLLED_SYNTHETIC: 'DERIVED_INFERENCE',
};

/**
 * The three isolated labs (§G).
 *
 * Fixed ids rather than per-run random ones: §16 requires proving that the SAME
 * candidate wording in two labs cannot nominate across them, and that assertion
 * is only meaningful against stable, separately-seeded corpora.
 */
export const LABS = {
  ALLIGNX: {
    key: 'allignx',
    name: 'AllignX Shadow Lab',
    workspaceId: '7f00a11c-0000-4000-8000-00000000a11c',
    maturity: 'live_early_marketing',
  },
  LAUNCHMIND: {
    key: 'launchmind',
    name: 'LaunchMind Shadow Lab',
    workspaceId: '7f001aac-0000-4000-8000-000000001aac',
    maturity: 'pre_launch_cold_start',
  },
  CANVA: {
    key: 'canva',
    name: 'Canva Benchmark Lab',
    workspaceId: '7f00ca77-0000-4000-8000-00000000ca77',
    maturity: 'mature_public',
  },
} as const;

export type LabKey = keyof typeof LABS;

/** Every lab workspace id, for leakage assertions. */
export const ALL_LAB_WORKSPACES = Object.values(LABS).map(l => l.workspaceId);

/** One evidence event before it becomes a candidate. */
export interface EvidenceEvent {
  id: string;
  lab: LabKey;
  /** What the evidence asserts, in the source's own terms. */
  statement: string;
  provenance: ProvenanceRecord;
  /**
   * Chronological stage for the mature benchmark (§9). Null for the other labs.
   * Batches are fed in order and later batches are never visible to earlier ones.
   */
  stage: string | null;
  /**
   * Independence key — two events sharing one key are NOT independent
   * corroboration. A single article republished twice must not corroborate
   * itself, which is the cheapest way to fake a second source.
   */
  independenceKey: string;
}

/** Asserts a corpus never mixes synthetic and real evidence silently. */
export function provenanceBreakdown(events: EvidenceEvent[]): Record<ProvenanceClass, number> {
  const out = { REAL_INTERNAL: 0, REAL_PUBLIC_OFFICIAL: 0, REAL_PUBLIC_REVIEW: 0, CONTROLLED_SYNTHETIC: 0 };
  for (const e of events) out[e.provenance.class]++;
  return out;
}

/**
 * Validates a corpus before it is used (§2, §33).
 *
 * A real-class event with no resolvable source is a seed defect, and finding it
 * after a run would mean re-running everything — so it fails here instead.
 */
export function validateProvenance(events: EvidenceEvent[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id)) problems.push(`${e.id}: duplicate event id`);
    seen.add(e.id);

    const real = e.provenance.class !== 'CONTROLLED_SYNTHETIC';
    if (real && e.provenance.synthetic) {
      problems.push(`${e.id}: real provenance class marked synthetic`);
    }
    if (!real && !e.provenance.synthetic) {
      problems.push(`${e.id}: synthetic event not marked synthetic`);
    }
    if (real && !/^(https?:\/\/|table:|doc:)/.test(e.provenance.source)) {
      problems.push(`${e.id}: ${e.provenance.class} needs a resolvable source, got "${e.provenance.source}"`);
    }
    if (!e.independenceKey) problems.push(`${e.id}: missing independence key`);
  }
  return problems;
}
