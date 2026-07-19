/**
 * @file reviewAnalysis.ts
 * @description Analyses app store reviews using Claude Haiku.
 *   Extracts sentiment, pain points, copy signals, and marketing opportunities
 *   from raw review text. Fast and cheap — Haiku is appropriate for this workload.
 * @security
 *   - consumeTokens() called before every Claude API call.
 *   - Review text is capped to prevent prompt injection via unusually long reviews.
 *   - Claude response parsed as JSON; malformed responses caught and sent to Sentry.
 *   - founderId always logged with token consumption.
 * @dependencies @anthropic-ai/sdk, consumeTokens, Sentry
 */

import * as Sentry from '@sentry/node';
import { callMessages } from '../lib/aiPlatform';
import { consumeTokens } from '../lib/tokens';
import type { Review } from '../types/scraper';

export interface ReviewAnalysis {
  sentiment: 'positive' | 'negative' | 'mixed';
  painPoints: string[];
  copySignals: string[];
  marketingOpportunities: string[];
}

const REVIEW_ANALYSIS_SCHEMA = `{
  "sentiment": "positive" | "negative" | "mixed",
  "painPoints": ["string", ...],
  "copySignals": ["string", ...],
  "marketingOpportunities": ["string", ...]
}`;

function formatReviewsForPrompt(reviews: Review[]): string {
  return reviews
    .slice(0, 30)
    .map((r, i) => `Review ${i + 1} (${r.rating}/5): ${r.text.slice(0, 400)}`)
    .join('\n\n');
}

/**
 * Analyses app reviews to extract marketing-relevant signals.
 * @param reviews   - Array of app store reviews (max 30 used)
 * @param founderId - UUID of the requesting founder (for token logging)
 * @returns         Structured ReviewAnalysis with sentiment and signals
 * @throws          Never — errors logged to Sentry, returns safe fallback
 * @security        consumeTokens() called before API call. Review text truncated at 400 chars each.
 */
export async function analyseReviews(
  reviews: Review[],
  founderId: string
): Promise<ReviewAnalysis> {
  const fallback: ReviewAnalysis = {
    sentiment: 'mixed',
    painPoints: [],
    copySignals: [],
    marketingOpportunities: [],
  };

  if (reviews.length === 0) return fallback;

  await consumeTokens(founderId, 'review_analysis', 15);

  try {
    const reviewText = formatReviewsForPrompt(reviews);

    const reviewResponseText = await callMessages('haiku', [
      {
        role: 'user',
        content: `Analyse these app store reviews:\n\n${reviewText}`,
      },
    ], `You are a mobile app marketing analyst. Analyse app store reviews and extract actionable marketing intelligence.
Return ONLY valid JSON matching this schema (no markdown, no explanation):
${REVIEW_ANALYSIS_SCHEMA}

Guidelines:
- painPoints: specific user frustrations that could be used in pain-first ad copy (max 8)
- copySignals: phrases and words users actually use about the app (max 8)
- marketingOpportunities: unmet needs or use cases to highlight in campaigns (max 6)
- sentiment: overall tone of the review set`, 1024);

    const parsed = JSON.parse(reviewResponseText) as ReviewAnalysis;

    return {
      sentiment: ['positive', 'negative', 'mixed'].includes(parsed.sentiment)
        ? parsed.sentiment
        : 'mixed',
      painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints.slice(0, 8) : [],
      copySignals: Array.isArray(parsed.copySignals) ? parsed.copySignals.slice(0, 8) : [],
      marketingOpportunities: Array.isArray(parsed.marketingOpportunities)
        ? parsed.marketingOpportunities.slice(0, 6)
        : [],
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { service: 'reviewAnalysis', founderId },
    });
    return fallback;
  }
}
