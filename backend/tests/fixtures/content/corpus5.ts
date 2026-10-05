/**
 * @file corpus5.ts
 * @description CORPUS #5 — authored AFTER the three-signal contract was frozen
 *   at 9d7e3d5431da6cec, evaluated exactly once.
 *
 *   HELD OUT FROM TUNING, NOT FROM AUTHORSHIP. I wrote these having read the
 *   classifier, which is the standing caveat on every corpus in this subsystem
 *   and is repeated here rather than buried in a report. What the freeze buys is
 *   narrower and still worth having: the code cannot be changed to fit these
 *   sentences, because changing it changes the hash and voids the run.
 *
 *   STRUCTURALLY DIFFERENT FROM #1–#4 BY CONSTRUCTION: second-person questions,
 *   testimonial fragments, em-dash constructions, verb-first imperatives,
 *   comparative fragments with no verb, and metaphors that promise a business
 *   result without naming one. Corpus #4's residual errors clustered in
 *   figurative outcome copy, so this set deliberately over-samples it — a corpus
 *   that avoided the known weak spot would measure nothing worth knowing.
 *
 *   `dangerous` marks items where a MISS puts an unsubstantiated factual claim
 *   in front of a customer. Those drive ALL_SIGNAL_ESCAPE_COUNT.
 */

export interface Corpus5Case {
  text: string;
  /** Expected primary category. Detection of ANY claim counts for recall. */
  expect: string;
  /** A miss here is a safety failure, not a quality one. */
  dangerous: boolean;
}

export const CORPUS_5: Corpus5Case[] = [
  // ── quantified performance — questions, fragments, em-dashes ─────────────
  { text: 'Still paying $4.10 a click?', expect: 'QUANTIFIED_PERFORMANCE', dangerous: true },
  { text: 'Half the spend — twice the pipeline.', expect: 'QUANTIFIED_PERFORMANCE', dangerous: true },
  { text: 'Three weeks to a 2x return.', expect: 'QUANTIFIED_PERFORMANCE', dangerous: true },
  { text: 'Nine hours back every week.', expect: 'QUANTIFIED_PERFORMANCE', dangerous: true },
  { text: 'Cost per lead down 44 percent since January.', expect: 'QUANTIFIED_PERFORMANCE', dangerous: true },
  { text: 'From 1.2% to 3.8% in a quarter.', expect: 'QUANTIFIED_PERFORMANCE', dangerous: true },

  // ── first-party performance — the owner's own numbers, no digits needed ──
  { text: 'Your best channel is not the one you think.', expect: 'FIRST_PARTY_PERFORMANCE', dangerous: true },
  { text: 'Last month was your strongest yet.', expect: 'FIRST_PARTY_PERFORMANCE', dangerous: true },
  { text: 'Two of your campaigns are quietly losing money.', expect: 'FIRST_PARTY_PERFORMANCE', dangerous: true },
  { text: 'Your retention curve flattened in week three.', expect: 'FIRST_PARTY_PERFORMANCE', dangerous: true },

  // ── outcome promise — figurative, no number, still a business result ─────
  { text: 'Turn a leaky funnel into a working one.', expect: 'OUTCOME_PROMISE', dangerous: true },
  { text: 'Give tired creative a second wind.', expect: 'OUTCOME_PROMISE', dangerous: true },
  { text: 'Stop the slow bleed in your ad account.', expect: 'OUTCOME_PROMISE', dangerous: true },
  { text: 'Watch your pipeline fill while you sleep.', expect: 'OUTCOME_PROMISE', dangerous: true },
  { text: 'Your churn problem, solved.', expect: 'OUTCOME_PROMISE', dangerous: true },
  { text: 'Trade guesswork for growth.', expect: 'OUTCOME_PROMISE', dangerous: true },

  // ── customer count ───────────────────────────────────────────────────────
  { text: 'Now planning growth for 2,400 teams.', expect: 'CUSTOMER_COUNT', dangerous: true },
  { text: 'One in five agencies on this list already uses it.', expect: 'CUSTOMER_COUNT', dangerous: true },
  { text: 'A community of founders, twelve thousand strong.', expect: 'CUSTOMER_COUNT', dangerous: true },

  // ── social proof ─────────────────────────────────────────────────────────
  { text: '"We finally know what to do on Monday." — Priya, agency owner', expect: 'SOCIAL_PROOF', dangerous: true },
  { text: 'Voted the tool marketers keep.', expect: 'SOCIAL_PROOF', dangerous: true },
  { text: 'Loved by the operators who hate marketing tools.', expect: 'SOCIAL_PROOF', dangerous: true },

  // ── superlative / comparative / exclusivity — fragments, no verb ─────────
  { text: 'The sharpest read on your market, anywhere.', expect: 'SUPERLATIVE', dangerous: true },
  { text: 'Faster than the agency you are about to hire.', expect: 'COMPARATIVE', dangerous: true },
  { text: 'More signal than a dashboard. Less noise than a consultant.', expect: 'COMPARATIVE', dangerous: true },
  { text: 'Nothing else reads your store data this way.', expect: 'EXCLUSIVITY', dangerous: true },
  { text: 'The one place your growth decisions actually live.', expect: 'EXCLUSIVITY', dangerous: true },

  // ── competitor ───────────────────────────────────────────────────────────
  { text: 'Everything HubSpot charges for, without the seat count.', expect: 'COMPETITOR_CLAIM', dangerous: true },
  { text: 'Where Mailchimp stops, this starts.', expect: 'COMPETITOR_CLAIM', dangerous: true },

  // ── capability ───────────────────────────────────────────────────────────
  { text: 'Reads your Shopify orders the moment they land.', expect: 'CAPABILITY', dangerous: true },
  { text: 'Writes the ad, checks the claim, waits for your yes.', expect: 'CAPABILITY', dangerous: true },
  { text: 'Works with the tools already open in your browser.', expect: 'CAPABILITY', dangerous: true },
  { text: 'Pulls yesterday\'s numbers before your coffee lands.', expect: 'CAPABILITY', dangerous: true },

  // ── pricing ──────────────────────────────────────────────────────────────
  { text: 'Nothing to pay until your first win.', expect: 'PRICING', dangerous: true },
  { text: 'One flat fee. No seats, no surprises.', expect: 'PRICING', dangerous: true },
  { text: 'Under twenty dollars to start.', expect: 'PRICING', dangerous: true },

  // ── geography ────────────────────────────────────────────────────────────
  { text: 'Live in every market you sell to.', expect: 'GEOGRAPHIC_AVAILABILITY', dangerous: true },
  { text: 'Built for teams in Bengaluru and Brooklyn alike.', expect: 'GEOGRAPHIC_AVAILABILITY', dangerous: true },

  // ── security / compliance — owner-confirmation classes ───────────────────
  { text: 'Your data never leaves your region.', expect: 'SECURITY', dangerous: true },
  { text: 'Encrypted end to end, always.', expect: 'SECURITY', dangerous: true },
  { text: 'Audited annually against SOC 2.', expect: 'COMPLIANCE_CERTIFICATION', dangerous: true },
  { text: 'DPDP-ready for Indian customers.', expect: 'COMPLIANCE_CERTIFICATION', dangerous: true },
  { text: 'HIPAA where you need it.', expect: 'COMPLIANCE_CERTIFICATION', dangerous: true },

  // ── guarantee / endorsement ──────────────────────────────────────────────
  { text: 'If it does not pay for itself, we refund it.', expect: 'GUARANTEE', dangerous: true },
  { text: 'Your first campaign works, or you walk.', expect: 'GUARANTEE', dangerous: true },
  { text: 'Recommended by the Y Combinator growth community.', expect: 'ENDORSEMENT', dangerous: true },

  // ── prohibited classes ───────────────────────────────────────────────────
  { text: 'Doors close Sunday night.', expect: 'SCARCITY_URGENCY', dangerous: true },
  { text: 'Two seats left at this price.', expect: 'SCARCITY_URGENCY', dangerous: true },
  { text: 'Replace your salary in ninety days.', expect: 'REGULATED_VERTICAL', dangerous: true },
  { text: 'A treatment plan your patients will follow.', expect: 'REGULATED_VERTICAL', dangerous: true },
  { text: 'Approved for use under the new advertising rules.', expect: 'LEGAL_APPROVAL', dangerous: true },

  // ── CREATIVE CONTROLS — mood, metaphor, no substantiable assertion ───────
  { text: 'Monday, without the dread.', expect: 'CREATIVE', dangerous: false },
  { text: 'Fewer tabs. Clearer head.', expect: 'CREATIVE', dangerous: false },
  { text: 'Marketing that does not shout.', expect: 'CREATIVE', dangerous: false },
  { text: 'A quieter kind of ambition.', expect: 'CREATIVE', dangerous: false },
  { text: 'Where does your week actually go?', expect: 'CREATIVE', dangerous: false },
  { text: 'Start where you are.', expect: 'CREATIVE', dangerous: false },
  { text: 'Think in weeks, not tabs.', expect: 'CREATIVE', dangerous: false },
  { text: 'Built by people who have run the ads.', expect: 'CREATIVE', dangerous: false },
  { text: 'Less admin. More marketing.', expect: 'CREATIVE', dangerous: false },
  { text: 'Say it plainly. Ship it Monday.', expect: 'CREATIVE', dangerous: false },
  { text: 'The calm before the campaign.', expect: 'CREATIVE', dangerous: false },
  { text: 'Growth is a habit, not a hack.', expect: 'CREATIVE', dangerous: false },
  { text: 'For founders who would rather be building.', expect: 'CREATIVE', dangerous: false },
  { text: 'Your marketing, in one place.', expect: 'CREATIVE', dangerous: false },
  { text: 'Make the next decision the easy one.', expect: 'CREATIVE', dangerous: false },
  { text: 'No dashboards to babysit.', expect: 'CREATIVE', dangerous: false },
  { text: 'Sunday planning, minus the Sunday.', expect: 'CREATIVE', dangerous: false },
  { text: 'Because guessing is expensive.', expect: 'CREATIVE', dangerous: false },
];

export const CORPUS_5_DANGEROUS = CORPUS_5.filter(c => c.dangerous).length;
export const CORPUS_5_CREATIVE = CORPUS_5.filter(c => !c.dangerous).length;
