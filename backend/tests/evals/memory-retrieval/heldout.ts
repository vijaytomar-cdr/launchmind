/**
 * @file heldout.ts
 * @description Expanded HELD-OUT retrieval evaluation — Phase 3.1G §2.
 *
 *   84 queries, none of which appear in `dataset.ts`. The 32-query set in
 *   dataset.ts was written before the retriever existed and was then used
 *   throughout 3.1D while RRF, the rerank rules and the AND→OR tsquery
 *   relaxation were being built. Numbers from a set you developed against
 *   measure fit, not generalisation. This set is scored ONCE, after the
 *   retriever was frozen.
 *
 *   HONEST LIMIT ON THE WORD "HELD-OUT". These queries are held out from
 *   TUNING — no retrieval parameter was changed after seeing them — but they
 *   are not held out from AUTHORSHIP: the same person who knows the corpus
 *   wrote them. That is the standard practice for an internal eval and it is
 *   still weaker than queries collected from real owners. The mitigations are
 *   (a) the labels name fixture ids, so a query cannot be quietly re-pointed at
 *   whatever came back, (b) the paraphrase and out-of-scope categories were
 *   written to be adversarial to the retriever, not friendly to it, and (c) any
 *   parameter change made after this run invalidates it and it must be re-run.
 *
 *   Two categories exist only in this set:
 *
 *   `out_of_scope` — the corpus genuinely does not know the answer. `required`
 *     is empty, so recall is trivially 1 and is NOT reported for these; what is
 *     measured is how much noise comes back. A retriever that confidently
 *     returns five marketing memories for "what is our server uptime" is worse
 *     than one that returns nothing, and no recall-based metric can see that.
 *
 *   `multi_hop` — the answer requires two records that share no vocabulary,
 *     which is where a single-arm retriever typically fails.
 *
 * @security Contains no real founder data. Same synthetic corpus as fixtures.ts.
 * @dependencies fixtures.ts, dataset.ts (type only)
 */

import type { EvalQuery } from './dataset';

export type HeldOutCategory =
  | 'positioning' | 'audience' | 'channel' | 'campaign_learning'
  | 'founder_preference' | 'historical_learning' | 'contradiction'
  | 'paraphrase' | 'multi_hop' | 'negation' | 'scope_sensitive' | 'out_of_scope';

export interface HeldOutQuery extends Omit<EvalQuery, 'category'> {
  category: HeldOutCategory;
}

const CANARIES = ['memory_other_workspace_positioning', 'memory_other_workspace_search'];

/** Every in-tenant query carries the cross-tenant canaries. */
const q = (
  id: string, category: HeldOutCategory, query: string,
  required: string[], acceptable: string[] = [],
  expected_baseline: 'hit' | 'miss' | 'partial' = 'partial', note?: string,
): HeldOutQuery => ({
  id, category, query, expected_baseline, note,
  expected: { required, acceptable, must_not_include: CANARIES },
});

/** Out-of-scope: nothing is required, and nothing is acceptable either. */
const oos = (id: string, query: string, note: string): HeldOutQuery => ({
  id, category: 'out_of_scope', query, expected_baseline: 'miss', note,
  expected: { required: [], acceptable: [], must_not_include: CANARIES },
});

export const HELD_OUT: HeldOutQuery[] = [
  // ── Positioning (10) ────────────────────────────────────────────────────────
  q('ho_p01', 'positioning', 'Which message framing drove the biggest lift in signups?',
    ['memory_outcome_positioning'], ['memory_discount_underperformed', 'memory_campaign_b_winner']),
  q('ho_p02', 'positioning', 'Should we lead with features or with results?',
    ['memory_outcome_positioning', 'memory_feature_positioning_rejected']),
  q('ho_p03', 'positioning', 'Why do we emphasise reliability so heavily?',
    ['memory_reliability_emphasis'], ['memory_review_theme_reliability']),
  q('ho_p04', 'positioning', 'Has price-based messaging ever worked for us?',
    ['memory_discount_underperformed'], ['memory_competitor_pricing']),
  q('ho_p05', 'positioning', 'What has the founder ruled out for our positioning?',
    ['memory_feature_positioning_rejected']),
  q('ho_p06', 'positioning', 'What is our core brand promise?',
    ['memory_reliability_emphasis'], ['memory_review_theme_reliability']),
  q('ho_p07', 'positioning', 'Did leading with the end result beat listing capabilities?',
    ['memory_outcome_positioning'], ['memory_feature_positioning_rejected']),
  q('ho_p08', 'positioning', 'Our competitor is cheaper — should we match them on price?',
    ['memory_competitor_pricing', 'memory_discount_underperformed'], [], 'partial',
    'Two records, no shared vocabulary between them.'),
  q('ho_p09', 'positioning', 'Which creative angle has the strongest evidence behind it?',
    ['memory_outcome_positioning'], ['memory_campaign_b_winner', 'memory_reliability_emphasis']),
  q('ho_p10', 'positioning', 'Is discounting a good idea for us?',
    ['memory_discount_underperformed'], ['memory_competitor_pricing']),

  // ── Audience (10) ───────────────────────────────────────────────────────────
  q('ho_a01', 'audience', 'Who are we actually selling to?',
    ['memory_icp_primary'], ['memory_icp_changed']),
  q('ho_a02', 'audience', 'Did our target customer ever change?',
    ['memory_icp_changed'], ['memory_icp_primary']),
  q('ho_a03', 'audience', 'Which customer group is worth the most over time?',
    ['memory_enterprise_segment'], ['memory_retention_signal']),
  q('ho_a04', 'audience', 'What early behaviour tells us someone will stick around?',
    ['memory_retention_signal']),
  q('ho_a05', 'audience', 'Do we still target renters?',
    ['memory_icp_changed'], ['memory_icp_primary']),
  q('ho_a06', 'audience', 'Which segment should we prioritise for expansion?',
    ['memory_enterprise_segment'], ['memory_icp_primary', 'memory_direction_confirmed']),
  q('ho_a07', 'audience', 'What age range do our best customers fall into?',
    ['memory_icp_primary']),
  q('ho_a08', 'audience', 'How can we tell early if a new customer will churn?',
    ['memory_retention_signal']),
  q('ho_a09', 'audience', 'Are property managers a good fit for us?',
    ['memory_enterprise_segment'], ['memory_search_worse_enterprise']),
  q('ho_a10', 'audience', 'Describe our ideal customer profile.',
    ['memory_icp_primary'], ['memory_icp_changed', 'memory_enterprise_segment']),

  // ── Channel (12) ────────────────────────────────────────────────────────────
  q('ho_c01', 'channel', 'Which paid channel gives us the best cost per booking?',
    ['memory_search_high_intent'], ['memory_search_beats_meta']),
  q('ho_c02', 'channel', 'Is Meta or Google better for us?',
    ['memory_search_beats_meta'], ['memory_search_worse_enterprise', 'memory_search_high_intent']),
  q('ho_c03', 'channel', 'Where does Meta actually beat search?',
    ['memory_search_worse_enterprise'], ['memory_search_beats_meta']),
  q('ho_c04', 'channel', 'Why do our social signups convert badly?',
    ['memory_paid_social_low_quality']),
  q('ho_c05', 'channel', 'How often should we refresh Meta creative?',
    ['memory_meta_creative_fatigue']),
  q('ho_c06', 'channel', 'What did we used to think our main channel was?',
    ['memory_belief_superseded_whatsapp'], [], 'miss',
    'The record is ARCHIVED. Retrieval must reach it for a history question without surfacing it as current.'),
  q('ho_c07', 'channel', 'Is WhatsApp still our primary channel?',
    ['memory_belief_superseded_whatsapp']),
  q('ho_c08', 'channel', 'Which keywords perform best for us?',
    ['memory_search_high_intent']),
  q('ho_c09', 'channel', 'Should we increase the paid social budget?',
    ['memory_paid_social_low_quality'], ['memory_no_autonomous_budget', 'memory_approval_preference']),
  q('ho_c10', 'channel', 'Our Meta ads keep getting worse over time — why?',
    ['memory_meta_creative_fatigue'], ['memory_paid_social_low_quality']),
  q('ho_c11', 'channel', 'Rank our channels by lead quality.',
    ['memory_paid_social_low_quality', 'memory_search_high_intent'], ['memory_search_beats_meta']),
  q('ho_c12', 'channel', 'For enterprise buyers, which channel works?',
    ['memory_search_worse_enterprise'], ['memory_enterprise_segment']),

  // ── Campaign learning (10) ──────────────────────────────────────────────────
  q('ho_l01', 'campaign_learning', 'Which campaign won?',
    ['memory_campaign_b_winner']),
  q('ho_l02', 'campaign_learning', 'What did the CTA test tell us?',
    ['memory_experiment_cta']),
  q('ho_l03', 'campaign_learning', 'Did any experiment change our recommended flow?',
    ['memory_experiment_cta']),
  q('ho_l04', 'campaign_learning', 'Compare Campaign A and Campaign B.',
    ['memory_campaign_b_winner']),
  q('ho_l05', 'campaign_learning', 'What have we learned from completed bookings data?',
    ['memory_campaign_b_winner'], ['memory_discount_underperformed', 'memory_search_high_intent']),
  q('ho_l06', 'campaign_learning', 'Which landing flow do we recommend now?',
    ['memory_experiment_cta']),
  q('ho_l07', 'campaign_learning', 'Has any creative stopped working?',
    ['memory_meta_creative_fatigue']),
  q('ho_l08', 'campaign_learning', 'What produced more clicks but fewer bookings?',
    ['memory_discount_underperformed']),
  q('ho_l09', 'campaign_learning', 'Summarise our campaign learnings.',
    ['memory_campaign_b_winner', 'memory_outcome_positioning'], ['memory_discount_underperformed']),
  q('ho_l10', 'campaign_learning', 'Did we run an A/B test recently?',
    ['memory_experiment_cta'], ['memory_campaign_b_winner']),

  // ── Founder preference (10) ─────────────────────────────────────────────────
  q('ho_f01', 'founder_preference', 'Can LaunchMind spend money without asking me?',
    ['memory_approval_preference', 'memory_no_autonomous_budget']),
  q('ho_f02', 'founder_preference', 'Are you allowed to auto-adjust budgets?',
    ['memory_no_autonomous_budget'], ['memory_approval_preference']),
  q('ho_f03', 'founder_preference', 'What did the founder decide about India?',
    ['memory_founder_rejected_india']),
  q('ho_f04', 'founder_preference', 'What is our focus this quarter?',
    ['memory_direction_confirmed']),
  q('ho_f05', 'founder_preference', 'Retention or acquisition?',
    ['memory_direction_confirmed'], ['memory_retention_signal']),
  q('ho_f06', 'founder_preference', 'What has the founder explicitly rejected?',
    ['memory_founder_rejected_india', 'memory_feature_positioning_rejected'], ['memory_icp_changed']),
  q('ho_f07', 'founder_preference', 'Do I need to approve a paid campaign before it launches?',
    ['memory_approval_preference'], ['memory_no_autonomous_budget']),
  q('ho_f08', 'founder_preference', 'Should we expand to India?',
    ['memory_founder_rejected_india']),
  q('ho_f09', 'founder_preference', 'What are my working boundaries with LaunchMind?',
    ['memory_approval_preference', 'memory_no_autonomous_budget']),
  q('ho_f10', 'founder_preference', 'Has the founder ever overruled a recommendation?',
    ['memory_founder_rejected_india'], ['memory_feature_positioning_rejected', 'memory_icp_changed']),

  // ── Historical learning (8) ─────────────────────────────────────────────────
  q('ho_h01', 'historical_learning', 'What beliefs have changed over time?',
    ['memory_belief_superseded_whatsapp'], ['memory_icp_changed']),
  q('ho_h02', 'historical_learning', 'What did we believe last quarter that we no longer believe?',
    ['memory_belief_superseded_whatsapp']),
  q('ho_h03', 'historical_learning', 'Show me superseded assumptions.',
    ['memory_belief_superseded_whatsapp']),
  q('ho_h04', 'historical_learning', 'How has our audience definition evolved?',
    ['memory_icp_changed'], ['memory_icp_primary']),
  q('ho_h05', 'historical_learning', 'What changed after the CTA experiment?',
    ['memory_experiment_cta']),
  q('ho_h06', 'historical_learning', 'Which of our beliefs are weakly supported?',
    ['memory_low_confidence_market']),
  q('ho_h07', 'historical_learning', 'Is there anything we are still unsure about?',
    ['memory_low_confidence_market']),
  q('ho_h08', 'historical_learning', 'What market shift might be happening?',
    ['memory_low_confidence_market']),

  // ── Contradiction / exception preservation (8) ──────────────────────────────
  q('ho_x01', 'contradiction', 'Does search always beat Meta?',
    ['memory_search_beats_meta', 'memory_search_worse_enterprise'], [], 'partial',
    'BOTH sides are required. Returning only the general rule is the failure this category exists to catch.'),
  q('ho_x02', 'contradiction', 'Are there exceptions to our channel ranking?',
    ['memory_search_worse_enterprise'], ['memory_search_beats_meta']),
  q('ho_x03', 'contradiction', 'Where do our channel findings disagree?',
    ['memory_search_beats_meta', 'memory_search_worse_enterprise']),
  q('ho_x04', 'contradiction', 'Is Meta ever the better choice?',
    ['memory_search_worse_enterprise']),
  q('ho_x05', 'contradiction', 'Do we have conflicting evidence about any segment?',
    ['memory_search_worse_enterprise'], ['memory_enterprise_segment', 'memory_search_beats_meta']),
  q('ho_x06', 'contradiction', 'Both search and Meta have been recommended — why?',
    ['memory_search_beats_meta', 'memory_search_worse_enterprise']),
  q('ho_x07', 'contradiction', 'Is discounting effective? I have heard both.',
    ['memory_discount_underperformed'], ['memory_competitor_pricing', 'memory_outcome_positioning']),
  q('ho_x08', 'contradiction', 'Summarise everything we know about search performance.',
    ['memory_search_beats_meta', 'memory_search_high_intent'], ['memory_search_worse_enterprise']),

  // ── Paraphrase — deliberately low keyword overlap (10) ──────────────────────
  q('ho_r01', 'paraphrase', 'How do we win more jobs from the same ad budget?',
    ['memory_search_high_intent'], ['memory_campaign_b_winner', 'memory_outcome_positioning'], 'miss',
    'No shared content word with "High-intent search keywords produce the best cost per booking".'),
  q('ho_r02', 'paraphrase', 'Customers keep complaining — about what?',
    ['memory_review_theme_reliability'], ['memory_reliability_emphasis'], 'miss'),
  q('ho_r03', 'paraphrase', 'When is our busiest time of year?',
    ['memory_seasonality_summer'], [], 'miss'),
  q('ho_r04', 'paraphrase', 'Is there a period we should plan extra spend for?',
    ['memory_seasonality_summer'], [], 'miss'),
  q('ho_r05', 'paraphrase', 'What annoys our users most?',
    ['memory_review_theme_reliability'], ['memory_reliability_emphasis'], 'miss'),
  q('ho_r06', 'paraphrase', 'Who undercuts us?',
    ['memory_competitor_pricing'], [], 'miss'),
  q('ho_r07', 'paraphrase', 'Do people come back?',
    ['memory_retention_signal'], [], 'miss'),
  q('ho_r08', 'paraphrase', 'What makes buyers trust us?',
    ['memory_reliability_emphasis'], ['memory_review_theme_reliability'], 'miss'),
  q('ho_r09', 'paraphrase', 'Are our ads wearing out?',
    ['memory_meta_creative_fatigue'], [], 'miss'),
  q('ho_r10', 'paraphrase', 'Why did we stop pushing a messaging channel?',
    ['memory_belief_superseded_whatsapp'], [], 'miss'),

  // ── Multi-hop — two records, no shared vocabulary (6) ───────────────────────
  q('ho_m01', 'multi_hop', 'Can you raise spend on our best-performing channel?',
    ['memory_search_high_intent', 'memory_no_autonomous_budget'], ['memory_approval_preference'], 'miss',
    'Needs the performance finding AND the authority boundary. Answering with only the first would imply LaunchMind may act.'),
  q('ho_m02', 'multi_hop', 'Should we run a discount campaign in early summer?',
    ['memory_discount_underperformed', 'memory_seasonality_summer'], [], 'miss'),
  q('ho_m03', 'multi_hop', 'Should we target property managers through paid social?',
    ['memory_enterprise_segment', 'memory_paid_social_low_quality'], ['memory_search_worse_enterprise'], 'miss'),
  q('ho_m04', 'multi_hop', 'Write new ad copy and launch it this week.',
    ['memory_approval_preference'], ['memory_outcome_positioning', 'memory_no_autonomous_budget'], 'miss',
    'An imperative, not a question. The approval boundary must still surface.'),
  q('ho_m05', 'multi_hop', 'Why is reliability in our messaging when the competitor competes on price?',
    ['memory_reliability_emphasis', 'memory_competitor_pricing'], ['memory_review_theme_reliability'], 'miss'),
  q('ho_m06', 'multi_hop', 'Our focus is retention — which customers matter most?',
    ['memory_direction_confirmed', 'memory_retention_signal'], ['memory_enterprise_segment'], 'miss'),


  // ── Negation — what NOT to do (10) ─────────────────────────────────────────
  // Retrieval that ignores negation answers "which channel is good?" when asked
  // "which channel is bad?", which is the most expensive kind of wrong.
  q('ho_n01', 'negation', 'Which channels should we NOT use?',
    ['memory_paid_social_low_quality'], ['memory_search_beats_meta'], 'miss'),
  q('ho_n02', 'negation', 'What have we decided against?',
    ['memory_founder_rejected_india', 'memory_feature_positioning_rejected'], ['memory_icp_changed'], 'miss'),
  q('ho_n03', 'negation', 'Is there any market we ruled out?',
    ['memory_founder_rejected_india'], [], 'miss'),
  q('ho_n04', 'negation', 'What should we avoid in our messaging?',
    ['memory_feature_positioning_rejected'], ['memory_discount_underperformed'], 'miss'),
  q('ho_n05', 'negation', 'Which audience are we no longer targeting?',
    ['memory_icp_changed'], ['memory_icp_primary'], 'miss'),
  q('ho_n06', 'negation', 'What must LaunchMind never do on its own?',
    ['memory_no_autonomous_budget'], ['memory_approval_preference']),
  q('ho_n07', 'negation', 'Which creative approach did not work?',
    ['memory_discount_underperformed'], ['memory_feature_positioning_rejected']),
  q('ho_n08', 'negation', 'Where should we not increase spend?',
    ['memory_paid_social_low_quality'], ['memory_no_autonomous_budget'], 'miss'),
  q('ho_n09', 'negation', 'Is there a belief we no longer hold?',
    ['memory_belief_superseded_whatsapp'], [], 'miss'),
  q('ho_n10', 'negation', 'What is NOT our primary channel any more?',
    ['memory_belief_superseded_whatsapp'], [], 'miss'),

  // ── Scope-sensitive — the general rule vs its exception (10) ───────────────
  q('ho_s01', 'scope_sensitive', 'Does the search advantage hold for every segment?',
    ['memory_search_beats_meta', 'memory_search_worse_enterprise']),
  q('ho_s02', 'scope_sensitive', 'Is our channel guidance the same for SMB and enterprise?',
    ['memory_search_worse_enterprise'], ['memory_search_beats_meta', 'memory_enterprise_segment']),
  q('ho_s03', 'scope_sensitive', 'For homeowners specifically, what works?',
    ['memory_icp_primary'], ['memory_outcome_positioning', 'memory_reliability_emphasis'], 'miss'),
  q('ho_s04', 'scope_sensitive', 'Do property managers behave like our main audience?',
    ['memory_enterprise_segment'], ['memory_icp_primary', 'memory_search_worse_enterprise']),
  q('ho_s05', 'scope_sensitive', 'Which findings apply only to one segment?',
    ['memory_search_worse_enterprise'], ['memory_enterprise_segment'], 'miss'),
  q('ho_s06', 'scope_sensitive', 'Does anything change by time of year?',
    ['memory_seasonality_summer'], [], 'miss'),
  q('ho_s07', 'scope_sensitive', 'Is the discount finding true everywhere?',
    ['memory_discount_underperformed'], ['memory_competitor_pricing'], 'miss'),
  q('ho_s08', 'scope_sensitive', 'Which of our beliefs are market-specific?',
    ['memory_founder_rejected_india'], ['memory_seasonality_summer'], 'miss'),
  q('ho_s09', 'scope_sensitive', 'Does high-intent search work for enterprise too?',
    ['memory_search_high_intent', 'memory_search_worse_enterprise'], ['memory_enterprise_segment'], 'miss'),
  q('ho_s10', 'scope_sensitive', 'Are there caveats to the outcome-led messaging result?',
    ['memory_outcome_positioning'], ['memory_discount_underperformed', 'memory_reliability_emphasis'], 'miss'),

  // ── Out of scope — the corpus does not know (6) ─────────────────────────────
  oos('ho_o01', 'What is our server uptime this month?',
      'Infrastructure. Marketing Memory holds nothing about it.'),
  oos('ho_o02', 'How many engineers are on the team?',
      'Headcount. Not a marketing belief.'),
  oos('ho_o03', 'What is our Kubernetes cluster configuration?',
      'Pure infrastructure; shares no vocabulary with the corpus.'),
  oos('ho_o04', 'Summarise the latest corporate tax regulation changes.',
      'External legal information LaunchMind has never observed.'),
  oos('ho_o05', 'What did the CEO say on the last earnings call?',
      'A plausible-sounding business question with no backing record.'),
  oos('ho_o06', 'Which database index should we add to speed up the app?',
      'Engineering. "index" and "app" appear near the domain without being in it.'),
];

export const HELD_OUT_COUNTS = HELD_OUT.reduce<Record<string, number>>((acc, x) => {
  acc[x.category] = (acc[x.category] ?? 0) + 1;
  return acc;
}, {});
