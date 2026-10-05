/**
 * @file creativeObservationCorpus.ts
 * @description The real observations gathered for §32, in one place so the
 *   acquisition script and any probe read the SAME rows. A second copy would
 *   drift, and a drifted corpus makes a derivation result meaningless.
 */
import type { ObservationInput } from '../src/services/creativeIntelligence/creativeIntelligenceService';

const OBSERVED = '2026-08-24T00:00:00.000Z';
const CATEGORY = 'home_services';

export const LANDING: ObservationInput[] = [
  {
    sourceClass: 'PUBLIC_BRAND_PAGE', sourceRef: 'https://www.thumbtack.com/',
    publisher: 'Thumbtack', channel: 'landing_page', category: CATEGORY,
    format: 'LANDING_PAGE', observedAt: OBSERVED,
    narrativeShape: 'BENEFIT_LED',
    hookStructure: 'A single outcome statement, then an input the visitor can act on',
    firstFrame: 'Headline followed immediately by a project-description input',
    productRevealSeconds: 0, captionDensity: 'LOW',
    visualComposition: 'Large type over generous whitespace, input control centred',
    pacing: null, durationSeconds: null,
    ctaStyle: 'soft invitation to browse for a professional',
    publicEngagement: null, signalLimitations: [],
    notes: 'No old-way / new-way contrast present on the page.',
  },
  {
    sourceClass: 'PUBLIC_BRAND_PAGE', sourceRef: 'https://www.taskrabbit.com/',
    publisher: 'TaskRabbit', channel: 'landing_page', category: CATEGORY,
    format: 'LANDING_PAGE', observedAt: OBSERVED,
    narrativeShape: 'BENEFIT_LED',
    hookStructure: 'An outcome statement above a row of task categories',
    firstFrame: 'Headline with category buttons beneath',
    productRevealSeconds: null, captionDensity: 'LOW',
    visualComposition: 'Minimal copy, category tiles, decorative shapes',
    pacing: null, durationSeconds: null,
    ctaStyle: 'soft invitation to explore categories',
    publicEngagement: null, signalLimitations: [],
    notes: 'Booking interface appears only after a category is chosen.',
  },
  {
    sourceClass: 'PUBLIC_BRAND_PAGE', sourceRef: 'https://porch.com/',
    publisher: 'Porch', channel: 'landing_page', category: CATEGORY,
    format: 'LANDING_PAGE', observedAt: OBSERVED,
    narrativeShape: 'BENEFIT_LED',
    hookStructure: 'A positioning statement followed by an availability check',
    firstFrame: 'Headline with an address input',
    productRevealSeconds: null, captionDensity: 'MEDIUM',
    visualComposition: 'Headline, subhead and a single input field',
    pacing: null, durationSeconds: null,
    ctaStyle: 'hard transactional demand to check availability',
    publicEngagement: null, signalLimitations: [],
    notes: 'No contrast section; benefits presented sequentially.',
  },
  {
    sourceClass: 'PUBLIC_BRAND_PAGE', sourceRef: 'https://www.handy.com/',
    publisher: 'Handy', channel: 'landing_page', category: CATEGORY,
    format: 'LANDING_PAGE', observedAt: OBSERVED,
    narrativeShape: 'BENEFIT_LED',
    hookStructure: 'An ease-and-reliability statement over supporting imagery',
    firstFrame: 'Headline with accompanying image',
    productRevealSeconds: null, captionDensity: 'LOW',
    visualComposition: 'Service category cards beneath a light hero',
    pacing: null, durationSeconds: null,
    ctaStyle: 'soft invitation to browse services',
    publicEngagement: null, signalLimitations: [],
    notes: 'No old-way / new-way contrast present.',
  },
  {
    sourceClass: 'PUBLIC_BRAND_PAGE', sourceRef: 'https://www.housecallpro.com/',
    publisher: 'Housecall Pro', channel: 'landing_page', category: CATEGORY,
    format: 'LANDING_PAGE', observedAt: OBSERVED,
    narrativeShape: 'BENEFIT_LED',
    hookStructure: 'A capability statement with an industry selector',
    firstFrame: 'Headline with rotating industry visuals',
    productRevealSeconds: null, captionDensity: 'MEDIUM',
    visualComposition: 'Headline, subhead, inline signup field',
    pacing: null, durationSeconds: null,
    ctaStyle: 'hard transactional demand to start a free trial',
    publicEngagement: null, signalLimitations: [],
    notes: 'Interface screenshots appear mid-page under feature sections.',
  },
];

/**
 * Published editorial describing how short-form video in this space is built.
 *
 * RECORDED AS STRUCTURE ONLY. These articles also make effectiveness claims —
 * that a given hook converts better, that a length wins. Those claims are NOT
 * recorded and could not be used if they were: an editorial source cannot
 * substantiate a performance claim, and CREATIVE_CANNOT_SUBSTANTIATE refuses
 * one at the influence boundary regardless of where it came from.
 */
export const VIDEO: ObservationInput[] = [
  {
    sourceClass: 'ANALYST_OR_EDITORIAL',
    sourceRef: 'https://adligator.com/blog/short-form-video-ads-facebook-instagram',
    publisher: 'Adligator', channel: 'short_form_video', category: CATEGORY,
    format: 'SHORT_VIDEO', observedAt: OBSERVED,
    narrativeShape: 'PROBLEM_LED',
    hookStructure: 'Opens by naming a pain point, often as a question',
    firstFrame: 'A stated problem or an immediate before/after',
    productRevealSeconds: 3, captionDensity: 'HIGH',
    visualComposition: 'Hook, body showing the service in use, end card',
    pacing: 'quick cuts', durationSeconds: 22,
    ctaStyle: 'hard transactional demand as a closing text overlay',
    publicEngagement: null, signalLimitations: [],
    notes: 'Structure recorded; the article’s performance claims were not.',
  },
  {
    sourceClass: 'ANALYST_OR_EDITORIAL',
    sourceRef: 'https://florafountain.com/short-form-video-hooks-2026-guide/',
    publisher: 'Flora Fountain', channel: 'short_form_video', category: CATEGORY,
    format: 'SHORT_VIDEO', observedAt: OBSERVED,
    narrativeShape: 'PROBLEM_LED',
    hookStructure: 'Opens on a problem or a curiosity gap before the product',
    firstFrame: 'A stated pain point or contradiction',
    productRevealSeconds: null, captionDensity: 'HIGH',
    visualComposition: 'Large legible overlay text carrying the opening idea',
    pacing: null, durationSeconds: null, ctaStyle: null,
    publicEngagement: null, signalLimitations: [],
    notes: 'Reveal timing and duration were not stated by this source.',
  },
  {
    sourceClass: 'ANALYST_OR_EDITORIAL',
    sourceRef: 'https://www.mbadv.agency/tiktok-ads/creative-best-practices',
    publisher: 'MB Advertising', channel: 'short_form_video', category: CATEGORY,
    format: 'SHORT_VIDEO', observedAt: OBSERVED,
    narrativeShape: 'PROBLEM_LED',
    hookStructure: 'Opens by naming the viewer’s own situation',
    firstFrame: 'A short contestable statement, six to ten words',
    productRevealSeconds: 4, captionDensity: 'HIGH',
    visualComposition: 'Hook text, benefit callout, short closing overlay',
    pacing: 'fast', durationSeconds: 12,
    ctaStyle: 'hard transactional demand, two or three words',
    publicEngagement: null, signalLimitations: [],
    notes: 'Structure recorded; the article’s performance claims were not.',
  },
];

