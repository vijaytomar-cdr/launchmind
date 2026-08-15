/**
 * @file labGuards.ts
 * @description Fail-closed validation guards for the multi-product run — §2, §6.
 *
 *   WHY FAIL-CLOSED. A leaked incumbent does not announce itself. It produces a
 *   plausible REINFORCE against a memory from another product, and every
 *   downstream number then looks normal — the run reports a healthy
 *   reinforcement rate and nobody can tell it was cross-tenant. The only safe
 *   posture is to abort the run rather than publish a figure that might be
 *   contaminated.
 *
 *   This mirrors the lesson from the 3.2A observation, where four consecutive
 *   runs produced publishable-looking output while silently degraded. Each of
 *   those had an error available and unread. These guards read them.
 *
 * @security The isolation boundary for the three validation labs. A guard
 *   failure must abort a run, never warn.
 * @dependencies provenance (LABS), adversarialCorpus (manifest)
 */

import { ALL_LAB_WORKSPACES, LABS, type LabKey } from './provenance';

export class LabIsolationError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`multi-product isolation violated (${violations.length}):\n  ${violations.join('\n  ')}`);
    this.name = 'LabIsolationError';
    this.violations = violations;
  }
}

/** A persisted proposal, reduced to what isolation cares about. */
export interface ProposalIsolationView {
  id: string;
  workspaceId: string;
  claimText: string;
  /** Workspace of every memory the retriever nominated for this candidate. */
  nominatedWorkspaceIds: string[];
  /** Workspace of every memory actually compared. */
  comparedWorkspaceIds: string[];
  /** Workspace of the transition target, when Gate B picked one. */
  targetWorkspaceId: string | null;
  /** Workspaces of evidence rows referenced by the proposal. */
  evidenceWorkspaceIds: string[];
}

/**
 * Asserts a lab's run never touched another workspace — §2, §6.
 *
 * Checks nomination, comparison, the Gate B target and evidence separately
 * rather than as one blended set: they fail for different reasons (a retrieval
 * filter, a governance load, a promotion target, an evidence join), and
 * collapsing them would tell us a leak happened without telling us where.
 */
export function assertLabIsolation(
  lab: LabKey,
  proposals: ProposalIsolationView[],
): void {
  const own = LABS[lab].workspaceId;
  const violations: string[] = [];

  const foreign = (ids: string[]): string[] =>
    [...new Set(ids.filter(Boolean).filter(id => id !== own))];

  for (const p of proposals) {
    if (p.workspaceId !== own) {
      violations.push(`${p.id}: proposal stored in ${p.workspaceId}, expected ${own}`);
    }
    for (const [stage, ids] of [
      ['nominated', p.nominatedWorkspaceIds],
      ['compared', p.comparedWorkspaceIds],
      ['evidence', p.evidenceWorkspaceIds],
      ['target', p.targetWorkspaceId ? [p.targetWorkspaceId] : []],
    ] as const) {
      for (const bad of foreign([...ids])) {
        const otherLab = Object.values(LABS).find(l => l.workspaceId === bad);
        violations.push(
          `${p.id}: ${stage} memory from ${bad}` +
          (otherLab ? ` (${otherLab.name})` : ' (non-lab workspace)') +
          ` — claim "${p.claimText.slice(0, 48)}"`);
      }
    }
  }

  if (violations.length) throw new LabIsolationError(violations);
}

/**
 * Asserts the three labs never share a workspace id, and that none collides
 * with a historical fixture workspace.
 *
 * The 169 local fixture rows live in 13 other workspaces. This is what proves
 * they cannot be reached, rather than assuming it.
 */
export function assertLabWorkspacesDistinct(historicalWorkspaceIds: string[]): void {
  const violations: string[] = [];
  const labs = ALL_LAB_WORKSPACES;

  if (new Set(labs).size !== labs.length) {
    violations.push('two labs share a workspace id');
  }
  for (const h of new Set(historicalWorkspaceIds)) {
    if (labs.includes(h)) {
      violations.push(`historical fixture workspace ${h} collides with a lab workspace`);
    }
  }
  if (violations.length) throw new LabIsolationError(violations);
}

/**
 * Asserts a frozen corpus has not drifted — §2, §3.
 *
 * Compares BOTH the count and the manifest hash. Count alone would miss an
 * edited claim or a relaxed label; hash alone would produce an opaque failure.
 * Together they say what changed and by how much.
 */
export function assertCorpusFrozen(
  name: string,
  expected: { count: number; manifest: string },
  actual: { count: number; manifest: string },
): void {
  const violations: string[] = [];
  if (actual.count !== expected.count) {
    violations.push(`${name}: expected ${expected.count} events, found ${actual.count}`);
  }
  if (actual.manifest !== expected.manifest) {
    violations.push(
      `${name}: manifest drifted — expected ${expected.manifest.slice(0, 16)}, ` +
      `found ${actual.manifest.slice(0, 16)}. A case, its wording, or an expected label changed.`);
  }
  if (violations.length) throw new LabIsolationError(violations);
}

/**
 * Asserts semantic retrieval was genuinely hybrid — §7, §15.
 *
 * The 3.1G held-out evaluation published a lexical score under a hybrid heading
 * because nothing checked. Every published semantic figure passes through here.
 */
export function assertSemanticVerified(
  label: string,
  eligible: Array<{ retrievalMode: string | null; retrievalDegraded: boolean }>,
): { verified: number; total: number } {
  const total = eligible.length;
  const verified = eligible.filter(e => e.retrievalMode === 'HYBRID' && !e.retrievalDegraded).length;
  if (verified !== total) {
    throw new LabIsolationError([
      `${label}: semantic_verified = ${verified}/${total} — REFUSING TO PUBLISH. ` +
      `${total - verified} candidate(s) ran degraded or lexical-only.`,
    ]);
  }
  return { verified, total };
}
