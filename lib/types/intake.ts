/**
 * @file lib/types/intake.ts
 * @description TypeScript types for the 7-step product intake flow.
 *   State is persisted in sessionStorage between steps.
 * @dependencies None — pure types.
 */

export type IntakeStep =
  | 'urls'         // Step 1: URL entry
  | 'context'      // Step 2: 5 conversations
  | 'analysing'    // Step 3: live analysis progress
  | 'icp_review'   // Step 4: interactive ICP review
  | 'competitors'  // Step 5: competitor confirm/reject/add
  | 'markets'      // Step 6: market + channel selection
  | 'confirm';     // Step 7: confirmation summary

export const INTAKE_STEP_LABELS: Record<IntakeStep, string> = {
  urls:        'URLs',
  context:     'Your story',
  analysing:   'Analysis',
  icp_review:  'ICP review',
  competitors: 'Competitors',
  markets:     'Markets',
  confirm:     'Confirm',
};

export const INTAKE_STEP_ORDER: IntakeStep[] = [
  'urls', 'context', 'analysing', 'icp_review', 'competitors', 'markets', 'confirm',
];

export interface FounderContext {
  budget?: string;
  stage?: string;
  primaryGoal?: string;
  audienceSize?: string;
  warmNetwork?: string[];
  geography?: string;
  language?: string[];
  channelsTried?: string[];
  channelsToAvoid?: string[];
  monetization?: string;
  dropOffPoint?: string;
  firstUserAction?: string;
  moat?: string;
  peakSeason?: string;
  bestCustomerQuote?: string;
  contentFormats?: string[];
}

export interface ScrapeJobStatus {
  status:
    | 'queued'
    | 'scraping_play_store'
    | 'scraping_app_store'
    | 'scraping_website'
    | 'analysing_reviews'
    | 'finding_competitors'
    | 'matching_playbook'
    | 'building_icp'
    | 'complete'
    | 'completed'   // backend uses 'completed'
    | 'active'
    | 'waiting'
    | 'failed';
  progress: number;
  productId?: string;
  partialResult?: ScrapedProduct;
  result?: ScrapedProduct;
  error?: string;
}

export interface ScrapedProduct {
  appName?: string;
  name?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  ratingCount?: number;
  installRange?: string;
  painPoints?: string[];
  copySignals?: string[];
  competitors?: Competitor[];
  icpDraft?: ICPDraft;
  // Backend-shaped fields
  scraped?: {
    name: string;
    developer: string;
    description: string;
    category: string;
    rating: number;
    ratingCount: number;
    priceTier: string;
    screenshots: string[];
    platform?: string;
    storeUrl?: string;
  };
  icpBrief?: {
    targetUser: string;
    geography: string[];
    priceTier: string;
    painPoints: string[];
    competitorGaps: string[];
    suggestedMarkets: string[];
  };
}

export interface Competitor {
  name: string;
  gap?: string;
  developer?: string;
  rating: number;
  topComplaint?: string;
  category?: string;
  priceTier?: string;
  platform?: string;
  confirmed?: boolean;
}

export interface ICPDraft {
  targetUser: string;
  targetUserReasoning?: string;
  primaryMarket: string;
  painPoints: Array<{ text: string; source?: string; count?: number }>;
  copySignals: Array<{ text: string; accepted: boolean }>;
  priceTier: string;
  category: string;
}

/** Keys used for sessionStorage persistence across intake steps */
export const INTAKE_STORAGE = {
  productId:    'lm_intake_productId',
  jobId:        'lm_intake_jobId',
  urls:         'lm_intake_urls',
  scrapeResult: 'lm_intake_scrapeResult',
  context:      'lm_intake_context',
  editedIcp:    'lm_intake_editedIcp',
  competitors:  'lm_intake_competitors',
  markets:      'lm_intake_markets',
} as const;
