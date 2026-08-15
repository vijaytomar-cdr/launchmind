/**
 * @file contextEngineAdapter.ts
 * @description The cutover seam between the legacy Context Engine and
 *   ContextPackage V2 — Phase 3.1E.
 *
 *   Exists so the cutover is ONE decision in ONE place rather than five call
 *   sites each deciding for themselves. Domain services ask for context by
 *   INTENT and get back model-safe text plus a package id for provenance; they
 *   do not know which engine produced it.
 *
 *   THREE MODES (Step 3.1E §28), via `CONTEXT_ENGINE_MODE`:
 *
 *     legacy  the pre-3.1E path, unchanged. The rollback position.
 *     shadow  BOTH are built; legacy text is used; the comparison is recorded.
 *             For validating on real traffic without depending on the new path.
 *     v2      ContextPackage V2 is used and persisted. The target state.
 *
 *   Default is `v2`: 3.1E's objective is the cutover, and a flag that defaults
 *   to off is a flag nobody exercises. Rollback is a single env var, no deploy.
 *
 *   Shadow mode deliberately uses the LEGACY output even though it built both.
 *   A shadow that silently served the new path would not be a shadow.
 *
 * @security V2 resolves the workspace SERVER-SIDE from the product or the
 *   authenticated founder. No caller may pass a workspace id in.
 * @dependencies contextEngine (legacy), contextPackageV2, contextFormatter
 */

import * as Sentry from '@sentry/node';
import { buildContextPackage, formatContextForPrompt } from '../contextEngine';
import { buildContextPackageV2, type ContextPackageV2 } from './contextPackageV2';
import { formatContextPackageForModel, describePackage } from './contextFormatter';
import { resolveMemoryWorkspace } from '../../services/memory/workspaceResolver';
import type { ContextIntent } from './contextIntents';

export type ContextEngineMode = 'legacy' | 'shadow' | 'v2';

/**
 * Resolves the active mode.
 *
 * An empty env var is NOT nullish, so `??` alone would yield '' and fall through
 * to the unknown-value branch — the trap already hit twice in this codebase.
 */
export function contextEngineMode(): ContextEngineMode {
  const raw = (process.env.CONTEXT_ENGINE_MODE ?? '').trim().toLowerCase();
  if (raw === 'legacy' || raw === 'shadow' || raw === 'v2') return raw;
  return 'v2';
}

export interface ContextRequest {
  founderId: string;
  productId: string | null;
  intent: ContextIntent;
  /** Retrieval query — owner text or a task phrase. NEVER a system prompt (§8). */
  query: string;
  traceId?: string;
}

export interface ContextResult {
  /** Model-safe text, to be appended AFTER the system instruction. */
  text: string;
  /** Null in legacy mode, or when persistence failed. */
  contextPackageId: string | null;
  mode: ContextEngineMode;
  /** Present in v2 and shadow. */
  package: ContextPackageV2 | null;
}

/**
 * Builds context for a model call.
 *
 * Never throws: a context failure degrades to whatever could be assembled. A
 * Morning Brief must not disappear because retrieval had a bad minute (§15).
 */
export async function buildContextForPrompt(req: ContextRequest): Promise<ContextResult> {
  const mode = contextEngineMode();

  if (mode === 'legacy') {
    const legacy = await buildContextPackage(req.founderId, req.productId);
    return { text: formatContextForPrompt(legacy), contextPackageId: null, mode, package: null };
  }

  // v2 and shadow both need the workspace, resolved server-side.
  let workspaceId: string;
  try {
    workspaceId = await resolveMemoryWorkspace(req.founderId, req.productId);
  } catch {
    // No workspace ⇒ V2 cannot run. Fall back to legacy rather than returning
    // nothing: an owner with an unusual workspace state still gets their brief.
    Sentry.captureMessage('context v2 fell back to legacy: workspace unresolved', {
      level: 'warning', tags: { founderId: req.founderId },
    });
    const legacy = await buildContextPackage(req.founderId, req.productId);
    return { text: formatContextForPrompt(legacy), contextPackageId: null, mode: 'legacy', package: null };
  }

  const pkg = await buildContextPackageV2({
    workspaceId,
    founderId: req.founderId,
    productId: req.productId,
    intent: req.intent,
    query: req.query,
    traceId: req.traceId,
    persist: true,
  });

  if (mode === 'shadow') {
    // Build the legacy package too and record the difference, but SERVE LEGACY.
    try {
      const legacy = await buildContextPackage(req.founderId, req.productId);
      const legacyText = formatContextForPrompt(legacy);
      recordShadowComparison(legacyText, pkg);
      return { text: legacyText, contextPackageId: pkg.id, mode, package: pkg };
    } catch {
      return { text: formatContextPackageForModel(pkg), contextPackageId: pkg.id, mode, package: pkg };
    }
  }

  return {
    text: formatContextPackageForModel(pkg),
    contextPackageId: pkg.id,
    mode,
    package: pkg,
  };
}

/** Comparison shape for shadow mode and the offline shadow harness. */
export interface ShadowComparison {
  legacyChars: number;
  v2Chars: number;
  legacyTokensEstimate: number;
  v2TokensEstimate: number;
  v2Memories: number;
  retrievalMode: string;
  /** Authoritative facts present in legacy that V2 dropped — must stay empty. */
  missingAuthoritative: string[];
}

/**
 * Compares the two renderings on facts, not on prose quality.
 *
 * The question that matters at cutover is not "does V2 read better" — it is
 * "did V2 lose anything the model needs". Subjective prose comparison would
 * answer neither.
 */
export function compareRenderings(legacyText: string, pkg: ContextPackageV2): ShadowComparison {
  const v2Text = formatContextPackageForModel(pkg);

  // Facts that must survive the cutover, checked by presence of their VALUE.
  const required: Array<[string, string | null]> = [
    ['productName', pkg.authoritative.productName],
    ['plan', pkg.authoritative.plan],
    ['audienceConfirmed', pkg.founderContext.audienceConfirmed],
    ['primaryGoal', pkg.founderContext.primaryGoal],
    ['contextDelta', pkg.founderContext.contextDelta],
  ];

  const missingAuthoritative = required
    .filter(([, value]) => {
      if (!value) return false;                       // absent from both — not a loss
      const inLegacy = legacyText.includes(value.slice(0, 40));
      const inV2     = v2Text.includes(value.slice(0, 40));
      return inLegacy && !inV2;                       // present before, gone now
    })
    .map(([name]) => name);

  return {
    legacyChars: legacyText.length,
    v2Chars: v2Text.length,
    legacyTokensEstimate: Math.ceil(legacyText.length / 4),
    v2TokensEstimate: Math.ceil(v2Text.length / 4),
    v2Memories: pkg.retrievedMemories.length,
    retrievalMode: pkg.retrieval.mode,
    missingAuthoritative,
  };
}

function recordShadowComparison(legacyText: string, pkg: ContextPackageV2): void {
  const cmp = compareRenderings(legacyText, pkg);
  if (cmp.missingAuthoritative.length > 0) {
    // Loud: this is the condition §27 says must block a cutover.
    Sentry.captureMessage('context shadow: V2 dropped authoritative context', {
      level: 'error',
      tags: { intent: pkg.contextType },
      extra: { missing: cmp.missingAuthoritative },
    });
  }
  Sentry.addBreadcrumb({
    category: 'context.shadow',
    message: describePackage(pkg),
    data: { ...cmp } as Record<string, unknown>,
  });
}
