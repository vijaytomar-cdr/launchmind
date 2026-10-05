/**
 * @file contentStrategyPolicy.ts
 * @description The proof trust boundary — ADR-070 §4, the load-bearing rule.
 *
 *   A strategy that can list proof it does not have will produce copy asserting
 *   things the business cannot substantiate, and every downstream guard is then
 *   arguing with a premise the model already won. So `proof_available` is not
 *   accepted as written: each entry must RESOLVE to evidence the server issued
 *   for this request. Anything that does not resolve is MOVED to
 *   `proof_unavailable` rather than dropped — the strategy must carry an honest
 *   record of what it cannot prove, because that is what stops the brief from
 *   quietly assuming it.
 *
 *   Deliberately deterministic. The model proposes; this disposes.
 *
 * @security The model cannot mint proof by prose. Resolution is against
 *   server-issued evidence handles only.
 * @dependencies growthBrainOutputGrounding (EvidenceHandle), contract types
 */

import type { EvidenceHandle } from '../growthBrainOutputGrounding';

export interface ProposedStrategy {
  objective: string; audience: string; angle: string;
  messageHierarchy: string[];
  /** What the model CLAIMS it can prove. Never trusted as given. */
  proofAvailable: Array<{ statement: string; evidenceRefs?: string[] }>;
  proofUnavailable?: string[];
  ctaIntent?: string | null;
  constraints?: string[];
}

export interface GovernedStrategy {
  objective: string; audience: string; angle: string;
  messageHierarchy: string[];
  /** Only entries whose cited evidence actually resolved. */
  proofAvailable: Array<{ statement: string; support: string[] }>;
  /** Everything the model could not substantiate, plus what it admitted. */
  proofUnavailable: string[];
  ctaIntent: string | null;
  constraints: string[];
  /** Why each entry moved. Makes the disposition auditable. */
  demoted: Array<{ statement: string; reason: DemotionReason }>;
}

export type DemotionReason =
  | 'NO_EVIDENCE_CITED'
  | 'EVIDENCE_DID_NOT_RESOLVE'
  | 'EVIDENCE_CANNOT_SUPPORT_PROOF';

/**
 * Evidence kinds that can substantiate a PROOF POINT in marketing copy.
 *
 * A goal is an intention and a product profile is a description; neither proves
 * anything to a customer. Founder direction states what the business believes,
 * which is proof of intent, not of outcome — it is admitted because copy may
 * legitimately say what the company stands for, and excluded from numeric
 * support by the existing grounding layer.
 */
const CAN_PROVE: Record<string, boolean> = {
  CAMPAIGN_PERFORMANCE: true,
  MARKET_INTELLIGENCE: true,
  MARKETING_MEMORY: true,
  FOUNDER_DIRECTION: true,
  PRODUCT_CONTEXT: false,
  BUSINESS_GOAL: false,
  ONBOARDING_STRATEGY: false,
  COMPETITOR_CONTEXT: false,
};

/**
 * Governs a proposed strategy against the evidence issued for this request.
 *
 * @param proposed - model output, treated as untrusted
 * @param handles  - the ONLY admissible evidence, server-issued
 * @returns a strategy whose proof_available is earned, not asserted
 */
export function governStrategy(
  proposed: ProposedStrategy, handles: readonly EvidenceHandle[],
): GovernedStrategy {
  const byRef = new Map(handles.map(h => [h.ref, h]));
  const available: GovernedStrategy['proofAvailable'] = [];
  const unavailable: string[] = [...(proposed.proofUnavailable ?? [])];
  const demoted: GovernedStrategy['demoted'] = [];

  for (const entry of proposed.proofAvailable ?? []) {
    const refs = entry.evidenceRefs ?? [];
    if (refs.length === 0) {
      unavailable.push(entry.statement);
      demoted.push({ statement: entry.statement, reason: 'NO_EVIDENCE_CITED' });
      continue;
    }
    const resolved = refs.map(r => byRef.get(r)).filter((h): h is EvidenceHandle => !!h);
    if (resolved.length === 0) {
      unavailable.push(entry.statement);
      demoted.push({ statement: entry.statement, reason: 'EVIDENCE_DID_NOT_RESOLVE' });
      continue;
    }
    const capable = resolved.filter(h => CAN_PROVE[h.kind]);
    if (capable.length === 0) {
      unavailable.push(entry.statement);
      demoted.push({ statement: entry.statement, reason: 'EVIDENCE_CANNOT_SUPPORT_PROOF' });
      continue;
    }
    available.push({ statement: entry.statement, support: capable.map(h => h.label) });
  }

  return {
    objective: proposed.objective, audience: proposed.audience, angle: proposed.angle,
    messageHierarchy: proposed.messageHierarchy ?? [],
    proofAvailable: available,
    // De-duplicated, order preserved: the owner reads this list.
    proofUnavailable: [...new Set(unavailable)],
    ctaIntent: proposed.ctaIntent ?? null,
    constraints: proposed.constraints ?? [],
    demoted,
  };
}

// ── Brief field governance (ADR-070 §9) ─────────────────────────────────────

export const BRIEF_FIELD_CLASS = {
  objective: 'MUST_RESOLVE_FROM_CONTEXT',
  audience: 'MUST_RESOLVE_FROM_CONTEXT',
  keyMessage: 'MAY_INFER',
  tone: 'MAY_INFER',
  ctaText: 'MAY_INFER',
  // The model must never invent what the business is selling or where it sends
  // a customer. These are commitments, not copy.
  offer: 'REQUIRES_OWNER_CONFIRMATION',
  ctaDestination: 'REQUIRES_OWNER_CONFIRMATION',
} as const;
export type BriefField = keyof typeof BRIEF_FIELD_CLASS;

export interface BriefValidation {
  valid: boolean;
  blocked: Array<{ field: BriefField; reason: string }>;
}

/**
 * Refuses a brief that silently invented a commitment.
 *
 * @param brief     proposed field values
 * @param confirmed fields the OWNER explicitly confirmed
 */
export function validateBriefFields(
  brief: Partial<Record<BriefField, string | null>>,
  confirmed: readonly string[],
): BriefValidation {
  const blocked: BriefValidation['blocked'] = [];
  for (const field of Object.keys(BRIEF_FIELD_CLASS) as BriefField[]) {
    const value = brief[field];
    const filled = typeof value === 'string' && value.trim().length > 0;
    if (BRIEF_FIELD_CLASS[field] === 'REQUIRES_OWNER_CONFIRMATION' && filled
        && !confirmed.includes(field)) {
      blocked.push({ field, reason: 'REQUIRES_OWNER_CONFIRMATION' });
    }
    if (BRIEF_FIELD_CLASS[field] === 'MUST_RESOLVE_FROM_CONTEXT' && !filled) {
      blocked.push({ field, reason: 'MUST_RESOLVE_FROM_CONTEXT' });
    }
  }
  return { valid: blocked.length === 0, blocked };
}
