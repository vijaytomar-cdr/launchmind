/**
 * @file icpService.ts
 * @description Builds a structured ICP (Ideal Customer Profile) brief from
 *   scraped app metadata and review analysis results.
 *   Pure data transformation — no AI calls in this service.
 *   AI-enrichment happens in reviewAnalysis (Haiku) and strategyService (Sonnet).
 * @security No external calls. Input validated via Zod schemas in the caller.
 * @dependencies types/scraper, services/reviewAnalysis
 */

import type { ScrapedAppData, ICPBrief } from '../types/scraper';
import type { ReviewAnalysis } from './reviewAnalysis';

/**
 * Derives an ICP brief from scraped app data and review analysis.
 * @param scraped        - Validated app store metadata
 * @param reviewAnalysis - Output from analyseReviews()
 * @returns              Structured ICPBrief ready to store in products.confirmed_icp
 * @security             Pure transformation — no DB or network calls.
 */
export function buildICPBrief(
  scraped: ScrapedAppData,
  reviewAnalysis: ReviewAnalysis
): ICPBrief {
  const suggestedMarkets = inferMarkets(scraped);

  return {
    targetUser: inferTargetUser(scraped),
    geography: suggestedMarkets,
    priceTier: scraped.priceTier,
    painPoints: [
      ...reviewAnalysis.painPoints,
      ...inferPainPointsFromDescription(scraped.description),
    ]
      .filter(Boolean)
      .slice(0, 8),
    competitorGaps: reviewAnalysis.marketingOpportunities.slice(0, 5),
    suggestedMarkets,
  };
}

function inferTargetUser(scraped: ScrapedAppData): string {
  const category = scraped.category.toLowerCase();
  const desc = scraped.description.toLowerCase();

  if (category.includes('business') || desc.includes('enterprise')) {
    return 'Small business owners and solo professionals';
  }
  if (category.includes('education') || desc.includes('learning')) {
    return 'Students and lifelong learners';
  }
  if (category.includes('health') || category.includes('fitness')) {
    return 'Health-conscious individuals aged 25–45';
  }
  if (category.includes('finance') || desc.includes('budget')) {
    return 'Young professionals managing personal finances';
  }
  if (category.includes('productivity') || desc.includes('productivity')) {
    return 'Professionals and entrepreneurs seeking efficiency';
  }
  return `Mobile app users interested in ${scraped.category}`;
}

function inferMarkets(scraped: ScrapedAppData): Array<'usa' | 'india'> {
  const desc = scraped.description.toLowerCase();
  const name = scraped.name.toLowerCase();

  const usaSignals = ['usd', '$', 'us dollars', 'american', 'usa'];
  const indiaSignals = ['inr', '₹', 'rupee', 'india', 'bharat', 'upi'];

  const hasUSA = usaSignals.some((s) => desc.includes(s) || name.includes(s));
  const hasIndia = indiaSignals.some((s) => desc.includes(s) || name.includes(s));

  if (hasIndia && !hasUSA) return ['india'];
  if (hasUSA && !hasIndia) return ['usa'];
  return ['usa', 'india'];
}

function inferPainPointsFromDescription(description: string): string[] {
  const painKeywords: Record<string, string> = {
    'hard to': 'Difficulty with manual processes',
    'time consuming': 'Too much time spent on repetitive tasks',
    'forget': 'Forgetting important tasks or deadlines',
    'overwhelm': 'Feeling overwhelmed by complexity',
    'expensive': 'High cost of existing solutions',
    'complicated': 'Existing tools are too complicated',
    'manual': 'Manual effort required for routine tasks',
  };

  const desc = description.toLowerCase();
  return Object.entries(painKeywords)
    .filter(([keyword]) => desc.includes(keyword))
    .map(([, painPoint]) => painPoint)
    .slice(0, 3);
}
