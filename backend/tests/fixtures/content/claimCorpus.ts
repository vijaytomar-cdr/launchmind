/**
 * @file claimCorpus.ts
 * @description TRAIN and HELD-OUT corpora for copy-shaped claim classification.
 *
 *   TRAIN is the 3.5A baseline set — the sentences the classifier was written
 *   against. HELD-OUT was authored to be structurally different: different verbs,
 *   different phrasings, fragments, questions and imperatives that the lexicons
 *   were not built from. Held out from TUNING, not from authorship — that is the
 *   main caveat on every number derived from it.
 *
 *   ACCEPTANCE THRESHOLDS ARE FROZEN HERE, ABOVE THE RESULTS, so a disappointing
 *   run cannot be rescued by relaxing a gate afterwards.
 */

export type Cat =
  | 'QUANTIFIED_PERFORMANCE' | 'CUSTOMER_COUNT' | 'SOCIAL_PROOF' | 'SUPERLATIVE'
  | 'COMPARATIVE' | 'EXCLUSIVITY' | 'CAPABILITY' | 'PRICING'
  | 'GEOGRAPHIC_AVAILABILITY' | 'FIRST_PARTY_PERFORMANCE' | 'COMPETITOR_CLAIM'
  | 'SECURITY' | 'COMPLIANCE_CERTIFICATION' | 'GUARANTEE' | 'ENDORSEMENT'
  | 'SCARCITY_URGENCY' | 'REGULATED_VERTICAL' | 'LEGAL_APPROVAL' | 'CREATIVE';

export interface Case { text: string; expect: Cat }

/** Categories where a miss is most dangerous — 100% recall required. */
export const ZERO_MISS_CATEGORIES: Cat[] = [
  'QUANTIFIED_PERFORMANCE', 'CUSTOMER_COUNT', 'COMPLIANCE_CERTIFICATION',
  'GUARANTEE', 'PRICING', 'CAPABILITY', 'FIRST_PARTY_PERFORMANCE',
];
/** Overall recall gate across every dangerous class. */
export const MIN_RECALL = 0.95;
/** Creative copy wrongly flagged as a claim. */
export const MAX_FALSE_POSITIVE = 0.05;

export const TRAIN: Case[] = [
  { text: 'LaunchMind increases conversion by 31%.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Cut your cost per install by half.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Stop wasting 30% of your ad budget.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Get results in days, not months.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Join thousands of founders.', expect: 'CUSTOMER_COUNT' },
  { text: 'Over 10,000 teams plan their week with us.', expect: 'CUSTOMER_COUNT' },
  { text: 'Used by more than 500 SMBs.', expect: 'CUSTOMER_COUNT' },
  { text: 'Trusted by teams everywhere.', expect: 'SOCIAL_PROOF' },
  { text: 'Rated 4.9 by marketers.', expect: 'SOCIAL_PROOF' },
  { text: 'The fastest way to grow your app.', expect: 'SUPERLATIVE' },
  { text: 'The best AI CMO for small teams.', expect: 'SUPERLATIVE' },
  { text: 'Better results than agencies.', expect: 'COMPARATIVE' },
  { text: 'Outperforms traditional marketing tools.', expect: 'COMPARATIVE' },
  { text: 'The only platform that connects your data to a daily plan.', expect: 'EXCLUSIVITY' },
  { text: 'Nobody else does this.', expect: 'EXCLUSIVITY' },
  { text: 'Bank-grade encryption keeps your data safe.', expect: 'SECURITY' },
  { text: 'SOC 2 Type II compliant.', expect: 'COMPLIANCE_CERTIFICATION' },
  { text: 'GDPR ready out of the box.', expect: 'COMPLIANCE_CERTIFICATION' },
  { text: 'Money-back guarantee, no questions asked.', expect: 'GUARANTEE' },
  { text: 'Guaranteed to improve your ROAS.', expect: 'GUARANTEE' },
  { text: 'Only 3 spots left this month.', expect: 'SCARCITY_URGENCY' },
  { text: 'Offer ends Friday.', expect: 'SCARCITY_URGENCY' },
  { text: 'Connects to Google Ads, Meta and Stripe.', expect: 'CAPABILITY' },
  { text: 'Automatically launches your campaigns.', expect: 'CAPABILITY' },
  { text: 'Free forever for solo founders.', expect: 'PRICING' },
  { text: 'Starting at $19/month.', expect: 'PRICING' },
  { text: 'Available in the US and India.', expect: 'GEOGRAPHIC_AVAILABILITY' },
  { text: 'Your campaigns improved last week.', expect: 'FIRST_PARTY_PERFORMANCE' },
  { text: 'Turn scattered marketing signals into a clear daily plan.', expect: 'CREATIVE' },
  { text: 'Marketing that thinks with you.', expect: 'CREATIVE' },
  { text: 'Know what to do next.', expect: 'CREATIVE' },
  { text: 'Stop guessing. Start deciding.', expect: 'CREATIVE' },
];

/** Structurally different from TRAIN: new verbs, fragments, questions. */
export const HELD_OUT: Case[] = [
  // quantified performance — none of these verbs/shapes appear in TRAIN
  { text: 'Slash acquisition costs without slashing reach.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Lift retention 2 points in your first quarter.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Ship a working funnel in under an hour.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Recover the 40% of spend that never converts.', expect: 'QUANTIFIED_PERFORMANCE' },
  { text: 'Double your qualified leads.', expect: 'QUANTIFIED_PERFORMANCE' },
  // customer count
  { text: 'Powering marketing for 2,500 independent studios.', expect: 'CUSTOMER_COUNT' },
  { text: 'Millions of decisions made every month.', expect: 'CUSTOMER_COUNT' },
  { text: 'Hundreds of founders start their day here.', expect: 'CUSTOMER_COUNT' },
  // social proof
  { text: 'Award-winning marketing intelligence.', expect: 'SOCIAL_PROOF' },
  { text: 'As seen in TechCrunch.', expect: 'SOCIAL_PROOF' },
  // superlative / comparative / exclusivity
  { text: 'The smartest way to run growth solo.', expect: 'SUPERLATIVE' },
  { text: 'Industry-leading marketing automation.', expect: 'SUPERLATIVE' },
  { text: 'Cheaper than hiring a marketing manager.', expect: 'COMPARATIVE' },
  { text: '10x the output of a spreadsheet.', expect: 'COMPARATIVE' },
  { text: 'No other tool ties your data to your daily plan.', expect: 'EXCLUSIVITY' },
  { text: 'First and only AI CMO built for founders.', expect: 'EXCLUSIVITY' },
  // security / compliance / guarantee / endorsement
  { text: 'End-to-end encrypted, always.', expect: 'SECURITY' },
  { text: 'Your data is never shared with anyone.', expect: 'SECURITY' },
  { text: 'ISO 27001 certified infrastructure.', expect: 'COMPLIANCE_CERTIFICATION' },
  { text: 'HIPAA ready for healthcare teams.', expect: 'COMPLIANCE_CERTIFICATION' },
  { text: 'Risk-free for 30 days.', expect: 'GUARANTEE' },
  { text: 'We promise you will see a difference.', expect: 'GUARANTEE' },
  { text: 'Recommended by leading growth advisors.', expect: 'ENDORSEMENT' },
  { text: 'Backed by Y Combinator.', expect: 'ENDORSEMENT' },
  // capability / pricing / geography
  { text: 'Integrates with your existing ad accounts.', expect: 'CAPABILITY' },
  { text: 'One-click import from your CRM.', expect: 'CAPABILITY' },
  { text: 'No credit card required.', expect: 'PRICING' },
  { text: 'Plans from $9 per user.', expect: 'PRICING' },
  { text: 'Available nationwide.', expect: 'GEOGRAPHIC_AVAILABILITY' },
  { text: 'Now available across Europe.', expect: 'GEOGRAPHIC_AVAILABILITY' },
  // first-party / scarcity / regulated / legal
  { text: 'Your conversion rate deserves better.', expect: 'FIRST_PARTY_PERFORMANCE' },
  { text: 'Last chance to lock in this rate.', expect: 'SCARCITY_URGENCY' },
  { text: 'Clinically proven to reduce burnout.', expect: 'REGULATED_VERTICAL' },
  { text: 'Guaranteed income for every affiliate.', expect: 'REGULATED_VERTICAL' },
  { text: 'Every ad is legally approved before it runs.', expect: 'LEGAL_APPROVAL' },
  // CREATIVE controls — genuinely non-factual, must NOT be flagged
  { text: 'Your morning brief, ready before coffee.', expect: 'CREATIVE' },
  { text: 'Built for founders who wear every hat.', expect: 'CREATIVE' },
  { text: 'Clarity, not dashboards.', expect: 'CREATIVE' },
  { text: 'Marketing should feel like a decision, not a chore.', expect: 'CREATIVE' },
  { text: 'Where scattered signals become a plan.', expect: 'CREATIVE' },
  { text: 'Think like a CMO. Work like a founder.', expect: 'CREATIVE' },
  { text: 'Less noise. More direction.', expect: 'CREATIVE' },
  { text: 'A calmer way to grow.', expect: 'CREATIVE' },
];
