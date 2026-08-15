/**
 * @file dataset.ts
 * @description Hand-labelled retrieval evaluation set — 32 owner questions with
 *   expected canonical records.
 *
 *   Labels name `fixture_id`s, never generated prose. A query passes because the
 *   right ROW came back, not because a model produced a plausible sentence about
 *   it. That is the only way the same dataset can score both the current lexical
 *   baseline and the later hybrid retriever on equal terms.
 *
 *   `required` — retrieval is wrong if these are absent.
 *   `acceptable` — legitimately relevant; neither rewarded as required nor
 *     penalised as noise. Without this middle tier, precision would punish
 *     genuinely useful context and push the metric toward a retriever that
 *     returns one row.
 *   `must_not_include` — a hit here is a defect, not a ranking miss. Currently
 *     these are all cross-tenant canaries.
 *
 *   `expected_baseline` records the prediction made BEFORE the run, so the report
 *   can distinguish "the baseline is weak where we expected" from "the baseline
 *   is weak somewhere we did not understand". It is documentation, not a gate.
 *
 * @security Contains no real founder data.
 * @dependencies fixtures.ts
 */

export type EvalCategory =
  | 'positioning' | 'audience' | 'channel' | 'campaign_learning'
  | 'founder_preference' | 'historical_learning' | 'contradiction' | 'paraphrase';

export interface EvalQuery {
  id: string;
  query: string;
  category: EvalCategory;
  /** Prediction recorded before measurement. */
  expected_baseline: 'hit' | 'miss' | 'partial';
  /** Why we predicted that — becomes the failure hypothesis if it misses. */
  note?: string;
  expected: {
    required: string[];
    acceptable?: string[];
    must_not_include?: string[];
  };
}

/** Every Workspace-A query must never surface Workspace B. */
const TENANT_CANARIES = ['memory_other_workspace_positioning', 'memory_other_workspace_search'];

export const DATASET: EvalQuery[] = [
  // ── A. Positioning ──────────────────────────────────────────────────────────
  {
    id: 'retrieval_001', category: 'positioning', expected_baseline: 'miss',
    query: 'What positioning has historically worked best?',
    note: 'No shared keyword with "Outcome-led messaging increased conversion".',
    expected: {
      required: ['memory_outcome_positioning'],
      acceptable: ['memory_campaign_b_winner', 'memory_discount_underperformed'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_002', category: 'positioning', expected_baseline: 'hit',
    query: 'messaging',
    note: 'Bare keyword present in two titles — the case ILIKE handles well.',
    expected: {
      required: ['memory_outcome_positioning', 'memory_discount_underperformed'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_003', category: 'positioning', expected_baseline: 'miss',
    query: 'Why are we emphasizing reliability?',
    note: '"emphasizing" (US) vs stored "emphasis"; ILIKE has no stemming.',
    expected: {
      required: ['memory_reliability_emphasis'],
      acceptable: ['memory_review_theme_reliability'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_004', category: 'positioning', expected_baseline: 'miss',
    query: 'What positioning did the founder reject?',
    note: 'Requires joining "reject" to the founder-preference memory.',
    expected: {
      required: ['memory_feature_positioning_rejected'],
      acceptable: ['memory_founder_rejected_india'],
      must_not_include: TENANT_CANARIES,
    },
  },

  // ── B. Audience / ICP ───────────────────────────────────────────────────────
  {
    id: 'retrieval_005', category: 'audience', expected_baseline: 'miss',
    query: 'Who does LaunchMind believe the primary audience is?',
    note: 'Stored title says "Primary audience is time-poor homeowners"; the question wording differs around it.',
    expected: {
      required: ['memory_icp_primary'],
      acceptable: ['memory_icp_changed'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_006', category: 'audience', expected_baseline: 'miss',
    query: 'Has the founder changed the target audience before?',
    expected: {
      required: ['memory_icp_changed'],
      acceptable: ['memory_icp_primary'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_007', category: 'audience', expected_baseline: 'miss',
    query: 'Which customer segment is worth the most to us?',
    note: 'Paraphrase of "higher lifetime value".',
    expected: {
      required: ['memory_enterprise_segment'],
      acceptable: ['memory_retention_signal'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_008', category: 'audience', expected_baseline: 'hit',
    query: 'homeowners',
    expected: {
      required: ['memory_icp_primary', 'memory_icp_changed'],
      must_not_include: TENANT_CANARIES,
    },
  },

  // ── C. Channel performance ──────────────────────────────────────────────────
  {
    id: 'retrieval_009', category: 'channel', expected_baseline: 'partial',
    query: 'What do we know about Search versus paid social?',
    note: 'Multi-concept query; ILIKE matches the whole string, not its terms.',
    expected: {
      required: ['memory_search_beats_meta', 'memory_paid_social_low_quality'],
      acceptable: ['memory_search_worse_enterprise', 'memory_search_high_intent'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_010', category: 'channel', expected_baseline: 'miss',
    query: 'Which channel has produced higher-quality customers?',
    expected: {
      required: ['memory_paid_social_low_quality'],
      acceptable: ['memory_search_high_intent', 'memory_search_beats_meta'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_011', category: 'channel', expected_baseline: 'miss',
    query: 'What acquisition source has performed poorly?',
    expected: {
      required: ['memory_paid_social_low_quality'],
      acceptable: ['memory_meta_creative_fatigue', 'memory_discount_underperformed'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_012', category: 'channel', expected_baseline: 'partial',
    query: 'What have we learned from Meta?',
    note: '"Meta" appears in three titles, so ILIKE should find some.',
    expected: {
      required: ['memory_meta_creative_fatigue'],
      acceptable: ['memory_search_beats_meta', 'memory_search_worse_enterprise', 'memory_paid_social_low_quality'],
      must_not_include: TENANT_CANARIES,
    },
  },

  // ── D. Campaign learning ────────────────────────────────────────────────────
  {
    id: 'retrieval_013', category: 'campaign_learning', expected_baseline: 'miss',
    query: 'What campaigns performed well?',
    expected: {
      required: ['memory_campaign_b_winner'],
      acceptable: ['memory_outcome_positioning', 'memory_search_high_intent'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_014', category: 'campaign_learning', expected_baseline: 'miss',
    query: 'What messaging underperformed?',
    note: 'Title contains "underperformed" but the query adds "messaging" — a single ILIKE over the joined string fails.',
    expected: {
      required: ['memory_discount_underperformed'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_015', category: 'campaign_learning', expected_baseline: 'miss',
    query: 'What experiment changed our recommendation?',
    expected: {
      required: ['memory_experiment_cta'],
      acceptable: ['learning_experiment_cta'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_016', category: 'campaign_learning', expected_baseline: 'miss',
    query: 'What evidence supports the current campaign strategy?',
    expected: {
      required: ['memory_outcome_positioning'],
      acceptable: ['evidence_outcome_positioning', 'memory_campaign_b_winner'],
      must_not_include: TENANT_CANARIES,
    },
  },

  // ── E. Founder preferences ──────────────────────────────────────────────────
  {
    id: 'retrieval_017', category: 'founder_preference', expected_baseline: 'miss',
    query: 'What recommendations has the founder rejected?',
    expected: {
      required: ['memory_founder_rejected_india', 'memory_feature_positioning_rejected'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_018', category: 'founder_preference', expected_baseline: 'miss',
    query: 'What approval preferences has the founder established?',
    expected: {
      required: ['memory_approval_preference'],
      acceptable: ['memory_no_autonomous_budget'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_019', category: 'founder_preference', expected_baseline: 'miss',
    query: 'What strategic direction did the founder explicitly confirm?',
    expected: {
      required: ['memory_direction_confirmed'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_020', category: 'founder_preference', expected_baseline: 'miss',
    query: 'What should LaunchMind not override automatically?',
    note: 'Safety-critical. A retrieval miss here means a guardrail memory is absent from the model context.',
    expected: {
      required: ['memory_no_autonomous_budget', 'memory_approval_preference'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_021', category: 'founder_preference', expected_baseline: 'hit',
    query: 'approval',
    expected: {
      required: ['memory_approval_preference'],
      must_not_include: TENANT_CANARIES,
    },
  },

  // ── F. Historical learning ──────────────────────────────────────────────────
  {
    id: 'retrieval_022', category: 'historical_learning', expected_baseline: 'miss',
    query: 'Why did LaunchMind change its recommendation?',
    expected: {
      required: ['learning_channel_belief_change'],
      acceptable: ['memory_belief_superseded_whatsapp', 'memory_experiment_cta'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_023', category: 'historical_learning', expected_baseline: 'miss',
    query: 'What did LaunchMind believe about channels before?',
    note: 'The superseded memory is status=archived; searchMemories filters to active only, so this is unreachable by design.',
    expected: {
      required: ['memory_belief_superseded_whatsapp'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_024', category: 'historical_learning', expected_baseline: 'miss',
    query: 'What new evidence changed the belief about our best channel?',
    expected: {
      required: ['memory_search_high_intent'],
      acceptable: ['learning_channel_belief_change'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_025', category: 'historical_learning', expected_baseline: 'miss',
    query: 'When was the WhatsApp channel belief superseded?',
    expected: {
      required: ['memory_belief_superseded_whatsapp'],
      acceptable: ['learning_channel_belief_change'],
      must_not_include: TENANT_CANARIES,
    },
  },

  // ── G. Contradictions ───────────────────────────────────────────────────────
  {
    id: 'retrieval_026', category: 'contradiction', expected_baseline: 'partial',
    query: 'Does Search convert better than Meta?',
    note: 'BOTH sides must return. Returning only the agreeing memory is the dangerous failure this case exists to catch.',
    expected: {
      required: ['memory_search_beats_meta', 'memory_search_worse_enterprise'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_027', category: 'contradiction', expected_baseline: 'miss',
    query: 'Is Search the right channel for property managers?',
    note: 'The enterprise exception must outrank the general rule for this query.',
    expected: {
      required: ['memory_search_worse_enterprise'],
      acceptable: ['memory_enterprise_segment', 'memory_search_beats_meta'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_028', category: 'contradiction', expected_baseline: 'miss',
    query: 'Do we have any conflicting evidence about channel performance?',
    expected: {
      required: ['memory_search_beats_meta', 'memory_search_worse_enterprise'],
      must_not_include: TENANT_CANARIES,
    },
  },

  // ── H. Lexical vs semantic wording ──────────────────────────────────────────
  {
    id: 'retrieval_029', category: 'paraphrase', expected_baseline: 'miss',
    query: 'Do customers respond better when we sell the result instead of the features?',
    note: 'The canonical paraphrase case. Zero token overlap with the stored title.',
    expected: {
      required: ['memory_outcome_positioning'],
      acceptable: ['memory_feature_positioning_rejected'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_030', category: 'paraphrase', expected_baseline: 'miss',
    query: 'Are people cancelling on us?',
    expected: {
      required: ['memory_review_theme_reliability'],
      acceptable: ['memory_reliability_emphasis'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_031', category: 'paraphrase', expected_baseline: 'miss',
    query: 'Is it cheaper to reach someone who already needs us right now?',
    note: 'Paraphrase of high-intent keywords producing the best cost per booking.',
    expected: {
      required: ['memory_search_high_intent'],
      must_not_include: TENANT_CANARIES,
    },
  },
  {
    id: 'retrieval_032', category: 'paraphrase', expected_baseline: 'miss',
    query: 'Should we keep showing the same ad to the same people?',
    note: 'Paraphrase of creative fatigue above frequency 3.',
    expected: {
      required: ['memory_meta_creative_fatigue'],
      must_not_include: TENANT_CANARIES,
    },
  },
];

export const CATEGORY_COUNTS = DATASET.reduce<Record<string, number>>((acc, q) => {
  acc[q.category] = (acc[q.category] ?? 0) + 1;
  return acc;
}, {});
