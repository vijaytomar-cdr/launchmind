/**
 * @file qualitativeCorpus.ts
 * @description CONTROLLED_SYNTHETIC_QUALITATIVE corpus — 36 frozen scenarios.
 *
 *   THIS IS SYNTHETIC. It is not real customer history. It exists because the
 *   Canva corpus is public-company chronology (funding, launches, dated scalars)
 *   and structurally cannot exercise recurring qualitative marketing knowledge —
 *   which is what LaunchMind's Marketing Memory will actually accumulate.
 *
 *   TWO ISOLATED LAB BUSINESSES so cross-business isolation is measurable.
 *   Neither is an owner workspace; no owner row is ever written.
 *
 *   EVIDENCE IS DISTINCT FROM THE CLAIM. The previous harness set each
 *   candidate's evidence text to the claim itself, making every claim trivially
 *   self-supporting (`support: {SUPPORTED: 85}` was the tell). Here every
 *   scenario carries evidence written separately from the assertion, and the
 *   adversarial cases carry evidence that genuinely does NOT support them.
 *
 *   INCUMBENTS ARE NEVER CANDIDATES. Seeded incumbents are excluded from the
 *   candidate set, so a self-match cannot inflate REINFORCE.
 *
 *   Labels are frozen by `QUALITATIVE_CORPUS_HASH` over inputs AND expectations.
 *
 * @security Synthetic lab data only. No owner memory, no production workspace.
 * @dependencies consumed by scripts/qualitativeEvaluation.ts
 */

import { createHash } from 'crypto';

export type Category =
  | 'A_DUPLICATE_PARAPHRASE' | 'B_REINFORCEMENT' | 'C_TRUE_CONTRADICTION'
  | 'D_DIFFERENT_TIMEFRAME' | 'E_DIFFERENT_CHANNEL' | 'F_DIFFERENT_AUDIENCE'
  | 'G_SCOPED_EXCEPTION' | 'H_DIFFERENT_MEASURE' | 'I_AUTHORITY_CONFLICT'
  | 'J_LEXICALLY_DISTANT' | 'K_LEXICALLY_SIMILAR' | 'L_PRESSURE_ISOLATION'
  | 'M_UNSUPPORTED_EVIDENCE';

/** Expected SEMANTIC relation. A safe deferral is NOT semantic success. */
export type ExpectedRelation =
  | 'REINFORCE' | 'CHALLENGE' | 'CREATE_NEW' | 'CREATE_SCOPED_EXCEPTION'
  | 'DEFER' | 'REJECTED_AT_GATE_A' | 'NOT_RETRIEVED';

export interface Scenario {
  id: string;
  category: Category;
  /** 'A' or 'B' — the synthetic lab business. */
  ws: 'A' | 'B';
  /** Incumbent seeded before the run. Null when the candidate should be new. */
  incumbent: string | null;
  incumbentTier?: string;
  incumbentScope?: Record<string, string>;
  /** The candidate observation submitted to the pipeline. */
  claim: string;
  tier: string;
  scope: Record<string, string>;
  /** Evidence text — ALWAYS written separately from the claim. */
  evidence: string;
  independenceKey: string;
  expected: ExpectedRelation;
  /** Acceptable promotion outcomes (semantic). */
  acceptable: string[];
  /** True when any non-mutating outcome is safe regardless of semantics. */
  safeIfDeferred: boolean;
}

const s = (
  id: string, category: Category, incumbent: string | null, claim: string,
  evidence: string, expected: ExpectedRelation, acceptable: string[],
  over: Partial<Scenario> = {},
): Scenario => ({
  id, category, ws: 'A', incumbent, claim, evidence,
  tier: 'OBSERVED_FIRST_PARTY',
  incumbentTier: 'OBSERVED_FIRST_PARTY',
  scope: { channel: 'meta' }, incumbentScope: { channel: 'meta' },
  independenceKey: `qual:${id}`,
  expected, acceptable, safeIfDeferred: true, ...over,
});

export const QUALITATIVE_CORPUS: Scenario[] = [
  // ── A. DUPLICATE / PARAPHRASE ─────────────────────────────────────────────
  s('q01', 'A_DUPLICATE_PARAPHRASE',
    'Outcome-focused headlines convert better than feature-led headlines for homeowners',
    'Headlines that lead with the outcome outperform headlines that lead with features for homeowners',
    'Split test across 4,200 homeowner sessions: outcome-led headline variant produced a higher signup rate than the feature-led variant.',
    'REINFORCE', ['REINFORCE', 'NO_OP']),
  s('q02', 'A_DUPLICATE_PARAPHRASE',
    'Testimonial creative outperforms product screenshots on Meta retargeting',
    'On Meta retargeting, creative featuring customer testimonials beats product screenshot creative',
    'Retargeting audit over six weeks: testimonial creative sets recorded stronger downstream booking rates than screenshot sets.',
    'REINFORCE', ['REINFORCE', 'NO_OP']),
  s('q03', 'A_DUPLICATE_PARAPHRASE',
    'Same-day availability matters more than price for emergency plumbing customers',
    'For emergency plumbing enquiries, availability is a stronger driver than price',
    'Post-booking survey of emergency callers: respondents cited fastest availability ahead of lowest quoted price.',
    'REINFORCE', ['REINFORCE', 'NO_OP']),

  // ── B. REINFORCEMENT (independent evidence) ───────────────────────────────
  s('q04', 'B_REINFORCEMENT',
    'Annual-plan savings language improves conversion for price-sensitive SMB buyers',
    'Highlighting annual-plan savings lifts conversion among cost-conscious small business buyers',
    'Independent quarterly cohort: SMB accounts shown annual-savings copy upgraded at a higher rate than the monthly-only cohort.',
    'REINFORCE', ['REINFORCE'], { independenceKey: 'qual:independent-b1' }),
  s('q05', 'B_REINFORCEMENT',
    'Trust signals increase booking intent for first-time customers',
    'Displaying verification badges raises booking intent among first-time customers',
    'A separate landing-page experiment run by the web team recorded higher booking starts when verification badges were present.',
    'REINFORCE', ['REINFORCE'], { independenceKey: 'qual:independent-b2' }),
  s('q06', 'B_REINFORCEMENT',
    'Weekend scheduling reminders reduce no-shows',
    'Sending scheduling reminders before the weekend lowers appointment no-show rates',
    'Operations log comparison across two months shows fewer missed appointments in the reminder-enabled group.',
    'REINFORCE', ['REINFORCE'], { independenceKey: 'qual:independent-b3' }),

  // ── C. TRUE CONTRADICTION ─────────────────────────────────────────────────
  s('q07', 'C_TRUE_CONTRADICTION',
    'Outcome-focused headlines convert better than feature-led headlines for homeowners',
    'Feature-led headlines convert better than outcome-focused headlines for homeowners',
    'Later split test on the same homeowner audience recorded the feature-led variant ahead of the outcome-led variant.',
    'CHALLENGE', ['CHALLENGE', 'SUPERSEDE']),
  s('q08', 'C_TRUE_CONTRADICTION',
    'Testimonial creative outperforms product screenshots on Meta retargeting',
    'Product screenshot creative outperforms testimonial creative on Meta retargeting',
    'Fresh retargeting audit on the same placement recorded screenshot sets ahead of testimonial sets.',
    'CHALLENGE', ['CHALLENGE', 'SUPERSEDE']),
  s('q09', 'C_TRUE_CONTRADICTION',
    'Longer onboarding emails increase activation',
    'Longer onboarding emails decrease activation',
    'Repeat of the original onboarding email test on the same segment recorded lower activation for the longer variant.',
    'CHALLENGE', ['CHALLENGE', 'SUPERSEDE']),

  // ── D. DIFFERENT TIMEFRAME (must NOT contradict) ──────────────────────────
  s('q10', 'D_DIFFERENT_TIMEFRAME',
    'Referral signups peak during the summer months',
    'Referral signups peak during the winter holiday period',
    'Seasonal analysis of referral volume shows a distinct winter peak separate from the summer pattern.',
    'CREATE_NEW', ['CREATE_NEW', 'CREATE_SCOPED_EXCEPTION'],
    { scope: { channel: 'meta', timeframe: 'winter' }, incumbentScope: { channel: 'meta', timeframe: 'summer' } }),
  s('q11', 'D_DIFFERENT_TIMEFRAME',
    'Promotional emails perform best in the first week of the month',
    'Promotional emails perform best in the final week of the month',
    'Send-time analysis across a later period shows end-of-month sends leading on engagement.',
    'CREATE_NEW', ['CREATE_NEW', 'CREATE_SCOPED_EXCEPTION'],
    { scope: { channel: 'email', timeframe: 'month_end' }, incumbentScope: { channel: 'email', timeframe: 'month_start' } }),
  s('q12', 'D_DIFFERENT_TIMEFRAME',
    'Paid search costs are lowest in the off-season',
    'Paid search costs are lowest during the peak season',
    'Cost-per-click review of a later peak period shows lower costs than the preceding off-season.',
    'CREATE_NEW', ['CREATE_NEW', 'CREATE_SCOPED_EXCEPTION'],
    { scope: { channel: 'search', timeframe: 'peak' }, incumbentScope: { channel: 'search', timeframe: 'offseason' } }),

  // ── E. DIFFERENT CHANNEL (no false reinforcement) ─────────────────────────
  s('q13', 'E_DIFFERENT_CHANNEL',
    'Short video creative outperforms static creative on Meta',
    'Short video creative outperforms static creative on LinkedIn',
    'LinkedIn campaign review recorded stronger engagement for short video than for static creative.',
    'CREATE_NEW', ['CREATE_NEW'],
    { scope: { channel: 'linkedin' }, incumbentScope: { channel: 'meta' } }),
  s('q14', 'E_DIFFERENT_CHANNEL',
    'Testimonial creative lifts conversion on Meta',
    'Testimonial creative lifts conversion on Google Display',
    'Google Display placement review recorded higher conversion for testimonial units.',
    'CREATE_NEW', ['CREATE_NEW'],
    { scope: { channel: 'google' }, incumbentScope: { channel: 'meta' } }),
  s('q15', 'E_DIFFERENT_CHANNEL',
    'Urgency language improves click-through on email',
    'Urgency language improves click-through on SMS',
    'SMS broadcast comparison recorded higher tap-through when urgency phrasing was used.',
    'CREATE_NEW', ['CREATE_NEW'],
    { scope: { channel: 'sms' }, incumbentScope: { channel: 'email' } }),

  // ── F. DIFFERENT AUDIENCE / SEGMENT ───────────────────────────────────────
  s('q16', 'F_DIFFERENT_AUDIENCE',
    'ROI proof points convert enterprise buyers',
    'Ease-of-setup messaging converts small business buyers',
    'Segment-split landing test: SMB visitors converted more on setup-simplicity copy than on ROI copy.',
    'CREATE_NEW', ['CREATE_NEW'],
    { scope: { audience_segment: 'smb' }, incumbentScope: { audience_segment: 'enterprise' } }),
  s('q17', 'F_DIFFERENT_AUDIENCE',
    'Free trial messaging improves signup for consumers',
    'Free trial messaging improves signup for agency buyers',
    'Agency-segment funnel review recorded more trial starts when trial framing led the page.',
    'CREATE_NEW', ['CREATE_NEW'],
    { scope: { audience_segment: 'agency' }, incumbentScope: { audience_segment: 'consumer' } }),
  s('q18', 'F_DIFFERENT_AUDIENCE',
    'Discount codes increase first purchase for new customers',
    'Discount codes increase first purchase for returning customers',
    'Returning-customer cohort analysis recorded a lift in repeat first-category purchases when a code was offered.',
    'CREATE_NEW', ['CREATE_NEW'],
    { scope: { audience_segment: 'returning' }, incumbentScope: { audience_segment: 'new' } }),

  // ── G. SCOPED EXCEPTION ───────────────────────────────────────────────────
  s('q19', 'G_SCOPED_EXCEPTION',
    'Discount codes increase first purchase conversion',
    'Discount codes reduce first purchase conversion for enterprise buyers',
    'Enterprise pipeline review recorded lower close rates on deals where a discount code was applied early.',
    'CREATE_SCOPED_EXCEPTION', ['CREATE_SCOPED_EXCEPTION', 'CHALLENGE'],
    { scope: { funnel_stage: 'purchase', audience_segment: 'enterprise' },
      incumbentScope: { funnel_stage: 'purchase' } }),
  s('q20', 'G_SCOPED_EXCEPTION',
    'Faster page load improves conversion',
    'Faster page load does not improve conversion on the pricing page',
    'Pricing-page specific test found no measurable conversion difference between fast and slow variants.',
    'CREATE_SCOPED_EXCEPTION', ['CREATE_SCOPED_EXCEPTION', 'CHALLENGE'],
    { scope: { funnel_stage: 'pricing' }, incumbentScope: {} }),
  s('q21', 'G_SCOPED_EXCEPTION',
    'Live chat increases booking rate',
    'Live chat decreases booking rate for emergency callers',
    'Emergency-line review found callers routed to chat abandoned more often than callers routed to phone.',
    'CREATE_SCOPED_EXCEPTION', ['CREATE_SCOPED_EXCEPTION', 'CHALLENGE'],
    { scope: { audience_segment: 'emergency' }, incumbentScope: {} }),

  // ── H. DIFFERENT MEASURE (must not invent contradiction) ──────────────────
  s('q22', 'H_DIFFERENT_MEASURE',
    'Sending before 9am produces higher open rates',
    'Sending before 9am produces higher unsubscribe rates',
    'List-health review recorded a rise in opt-outs among recipients of the early-morning send window.',
    'DEFER', ['KEEP_AS_EVIDENCE_ONLY', 'CREATE_NEW']),
  s('q23', 'H_DIFFERENT_MEASURE',
    'Discount messaging increases click-through rate',
    'Discount messaging increases customer acquisition cost',
    'Spend reconciliation showed higher blended acquisition cost during the discount-led flight.',
    'DEFER', ['KEEP_AS_EVIDENCE_ONLY', 'CREATE_NEW']),
  s('q24', 'H_DIFFERENT_MEASURE',
    'Retargeting improves conversion rate',
    'Retargeting reduces customer retention',
    'Retention cohort review showed shorter average tenure among customers acquired through retargeting.',
    'DEFER', ['KEEP_AS_EVIDENCE_ONLY', 'CREATE_NEW']),

  // ── I. AUTHORITY CONFLICT ─────────────────────────────────────────────────
  s('q25', 'I_AUTHORITY_CONFLICT',
    'Founder prefers premium positioning over discount messaging',
    'Discount messaging outperforms premium positioning on click-through',
    'Campaign report shows the discount variant recorded a higher click-through rate than the premium variant.',
    'CHALLENGE', ['CHALLENGE', 'KEEP_AS_EVIDENCE_ONLY'],
    { incumbentTier: 'FOUNDER_ASSERTED', tier: 'OBSERVED_FIRST_PARTY' }),
  s('q26', 'I_AUTHORITY_CONFLICT',
    'We do not market to tenants, only property owners',
    'Tenant-focused messaging produces cheaper leads',
    'Lead-source report shows lower cost per lead on the tenant-targeted ad set.',
    'CHALLENGE', ['CHALLENGE', 'KEEP_AS_EVIDENCE_ONLY'],
    { incumbentTier: 'FOUNDER_ASSERTED', tier: 'DERIVED_INFERENCE' }),
  s('q27', 'I_AUTHORITY_CONFLICT',
    'Our brand voice avoids urgency and scarcity language',
    'Scarcity language increases booking completion',
    'Checkout funnel review recorded higher completion when limited-availability wording was shown.',
    'CHALLENGE', ['CHALLENGE', 'KEEP_AS_EVIDENCE_ONLY'],
    { incumbentTier: 'FOUNDER_ASSERTED', tier: 'OBSERVED_FIRST_PARTY' }),

  // ── J. LEXICALLY DISTANT / SEMANTICALLY RELATED ───────────────────────────
  s('q28', 'J_LEXICALLY_DISTANT',
    'Trust messaging improves booking conversion',
    'Emphasising background-checked professionals raises the share of visitors who complete a booking',
    'Landing variant highlighting vetted professionals recorded more completed bookings than the control page.',
    'REINFORCE', ['REINFORCE'], { independenceKey: 'qual:independent-j1' }),
  s('q29', 'J_LEXICALLY_DISTANT',
    'Outcome-focused headlines convert better for homeowners',
    'Leading with the result a customer gets beats describing the product for people who own their home',
    'Copy test across homeowner traffic recorded a higher signup rate for result-first headlines.',
    'REINFORCE', ['REINFORCE'], { independenceKey: 'qual:independent-j2' }),
  s('q30', 'J_LEXICALLY_DISTANT',
    'Same-day availability drives emergency bookings',
    'When a technician can attend within hours, urgent callers are far more likely to book',
    'Dispatch analysis shows urgent enquiries converting more often when a same-day slot was offered.',
    'REINFORCE', ['REINFORCE'], { independenceKey: 'qual:independent-j3' }),

  // ── K. LEXICALLY SIMILAR / SEMANTICALLY DIFFERENT ─────────────────────────
  s('q31', 'K_LEXICALLY_SIMILAR',
    'Email open rates improve with personalised subject lines',
    'Email unsubscribe rates improve with personalised preference centres',
    'Preference-centre rollout coincided with fewer opt-outs across the mailing list.',
    'CREATE_NEW', ['CREATE_NEW', 'KEEP_AS_EVIDENCE_ONLY']),
  s('q32', 'K_LEXICALLY_SIMILAR',
    'Meta campaign spend increased in the spring quarter',
    'Meta campaign creative refresh cadence increased in the spring quarter',
    'Creative operations log shows more frequent asset rotations during the spring period.',
    'CREATE_NEW', ['CREATE_NEW', 'KEEP_AS_EVIDENCE_ONLY']),
  s('q33', 'K_LEXICALLY_SIMILAR',
    'Booking conversion improved after the pricing page redesign',
    'Booking cancellation improved after the reminder workflow redesign',
    'Cancellation tracking shows fewer cancellations following the reminder workflow change.',
    'CREATE_NEW', ['CREATE_NEW', 'KEEP_AS_EVIDENCE_ONLY']),

  // ── M. UNSUPPORTED EVIDENCE (Gate A must reject) ──────────────────────────
  s('q34', 'M_UNSUPPORTED_EVIDENCE', null,
    'Customer acquisition cost decreased 34% and conversion increased 21% this quarter',
    'Quarterly marketing summary describing campaign themes, creative refreshes and channel mix. No cost or conversion figures are stated.',
    'REJECTED_AT_GATE_A', ['REJECTED_AT_GATE_A'], { safeIfDeferred: false }),
  s('q35', 'M_UNSUPPORTED_EVIDENCE', null,
    'Our app moved up 27 positions in the category rankings last week',
    'Store listing notes describing screenshot updates and a revised description. No ranking positions are mentioned.',
    'REJECTED_AT_GATE_A', ['REJECTED_AT_GATE_A'], { safeIfDeferred: false }),
  s('q36', 'M_UNSUPPORTED_EVIDENCE', null,
    'Leadership has approved a Q4 pivot to enterprise-only pricing',
    'Public product page describing current self-serve plans. No roadmap or pricing strategy is stated.',
    'REJECTED_AT_GATE_A', ['REJECTED_AT_GATE_A'], { safeIfDeferred: false }),

  // ── L. ISOLATION ─────────────────────────────────────────────────────────
  // FIXED: this previously had incumbent === claim, seeding its own incumbent
  // and creating exactly the self-match the admissibility gate exists to catch.
  // The candidate is now submitted from workspace A with NO incumbent of its
  // own; the identical text lives in workspace B via INCUMBENT_ONLY below, so a
  // match can only occur by crossing the tenant boundary.
  // Text chosen to exist NOWHERE in workspace A. The first correction reused
  // 'Trust messaging improves booking conversion', which is q28's incumbent and
  // also lives in A — a same-workspace collision, so the gate still fired.
  s('q37', 'L_PRESSURE_ISOLATION', null,
    'Referral incentives increase repeat bookings for property managers',
    'Workspace A partner report recorded more repeat bookings where referral incentives were offered.',
    'CREATE_NEW', ['CREATE_NEW'], { ws: 'A', independenceKey: 'qual:ws-a-iso' }),
];

/**
 * Rows seeded as incumbents but NEVER submitted as candidates.
 *
 * The isolation probe needs identical text present in the other business. If it
 * were expressed as a normal scenario it would also become a candidate, which is
 * the self-match that made the previous run inadmissible.
 */
export interface IncumbentOnly {
  id: string;
  ws: 'A' | 'B';
  claim: string;
  tier: string;
  scope: Record<string, string>;
}

export const INCUMBENT_ONLY: IncumbentOnly[] = [
  {
    id: 'iso-b1', ws: 'B',
    claim: 'Referral incentives increase repeat bookings for property managers',
    tier: 'FOUNDER_ASSERTED', scope: { channel: 'meta' },
  },
];

export function corpusHash(): string {
  const isoPart = INCUMBENT_ONLY.map(i => JSON.stringify(i)).sort().join('\n');
  const canonical = isoPart + '\n' + QUALITATIVE_CORPUS.map(c => JSON.stringify({
    id: c.id, category: c.category, ws: c.ws, incumbent: c.incumbent,
    incumbentTier: c.incumbentTier, incumbentScope: c.incumbentScope,
    claim: c.claim, tier: c.tier, scope: c.scope, evidence: c.evidence,
    independenceKey: c.independenceKey, expected: c.expected, acceptable: c.acceptable,
  })).sort().join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

export const QUALITATIVE_CORPUS_HASH = corpusHash();

export function coverage() {
  const by = QUALITATIVE_CORPUS.reduce<Record<string, number>>((a, c) => {
    a[c.category] = (a[c.category] ?? 0) + 1; return a;
  }, {});
  return {
    total: QUALITATIVE_CORPUS.length,
    candidates: QUALITATIVE_CORPUS.length,
    incumbents: QUALITATIVE_CORPUS.filter(c => c.incumbent).length,
    byCategory: by,
    workspaces: [...new Set(QUALITATIVE_CORPUS.map(c => c.ws))],
  };
}
