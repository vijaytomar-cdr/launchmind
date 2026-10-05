/** Structured strategy contract consumed before copy or visual rendering. */
import type { ContentBrief } from './briefComposition';
import type { ContentStrategy } from './strategyComposition';
import type { ProductContentContext } from './productContentContext';
import type { ConceptShape } from './creativeConcepts';

export const CREATIVE_OBJECTIVES = [
  'REACH', 'ENGAGEMENT', 'TRAFFIC', 'LEADS', 'INSTALLS', 'BOOKINGS', 'RETENTION',
] as const;
export type CreativeObjective = typeof CREATIVE_OBJECTIVES[number];

export interface CreativeBriefContract {
  objective: CreativeObjective;
  channel: string;
  format: string;
  audience: string;
  businessContext: string | null;
  campaignThesis: string;
  hookStrategy: string;
  emotionalMechanism: string;
  messageHierarchy: string[];
  verifiedProductTruth: string[];
  permittedCapabilities: string[];
  prohibitedClaims: string[];
  authorizedAssets: string[];
  brandConstraints: string[];
  ctaDestination: string | null;
  creativePatterns: string[];
  firstPartyLearning: string[];
  marketEvidenceAvailable: boolean;
  desiredViewerAction: string | null;
  successMetric: string;
  conceptRole: ConceptShape['name'];
}

export function normalizeCreativeObjective(raw: string | null | undefined): CreativeObjective {
  const s = String(raw ?? '').toLowerCase();
  if (/book/.test(s)) return 'BOOKINGS';
  if (/install|download/.test(s)) return 'INSTALLS';
  if (/lead|request|enquir|inquir/.test(s)) return 'LEADS';
  if (/traffic|visit|click/.test(s)) return 'TRAFFIC';
  if (/retain|retention|churn/.test(s)) return 'RETENTION';
  if (/engag|comment|save|share/.test(s)) return 'ENGAGEMENT';
  return 'REACH';
}

function metricFor(objective: CreativeObjective): string {
  return ({ REACH: 'qualified reach / 3-second hold', ENGAGEMENT: 'saves, shares or responses',
    TRAFFIC: 'qualified clicks', LEADS: 'qualified leads', INSTALLS: 'verified installs',
    BOOKINGS: 'verified bookings', RETENTION: 'retained customers' } as const)[objective];
}

export function buildCreativeBriefContract(input: {
  brief: ContentBrief; strategy: ContentStrategy; ctx: ProductContentContext;
  concept: ConceptShape; creativePatterns?: readonly string[]; firstPartyLearning?: readonly string[];
}): CreativeBriefContract {
  const objective = normalizeCreativeObjective(input.brief.objective);
  return {
    objective,
    channel: input.brief.channel,
    format: input.brief.channel === 'SHORT_FORM_VIDEO_SCRIPT' ? 'vertical short-form'
      : input.brief.channel === 'META_AD' ? 'feed static' : input.brief.contentFamily.toLowerCase(),
    audience: input.brief.audience,
    businessContext: input.ctx.founderDirection.contextDelta,
    campaignThesis: input.strategy.campaignThesis,
    hookStrategy: input.concept.hookDirection,
    emotionalMechanism: input.concept.narrativeFrame === 'RECOGNITION' ? 'recognition'
      : input.concept.narrativeFrame === 'ASPIRATION' ? 'relief' : 'comprehension',
    messageHierarchy: [input.concept.messageStructure, ...input.strategy.messageHierarchy],
    verifiedProductTruth: [input.ctx.application.description, ...input.strategy.proofAvailable].filter((x): x is string => !!x),
    permittedCapabilities: input.ctx.application.description ? [input.ctx.application.description] : [],
    prohibitedClaims: [...input.strategy.proofUnavailable, ...input.strategy.prohibitedTerminology],
    authorizedAssets: [...input.brief.authorizedAssetRefs],
    brandConstraints: [...input.brief.brandConstraints],
    ctaDestination: input.brief.ctaDestination,
    creativePatterns: [...(input.creativePatterns ?? [])],
    firstPartyLearning: [...(input.firstPartyLearning ?? [])],
    marketEvidenceAvailable: input.ctx.marketIntelligenceAvailable,
    desiredViewerAction: input.brief.ctaIntent,
    successMetric: metricFor(objective),
    conceptRole: input.concept.name,
  };
}
