/**
 * @file brandVoiceService.ts
 * @description Brand voice extraction and copy adjustment using Claude Haiku.
 *   extractBrandVoice()  — derives tone/adjectives/style from product reviews (10 tokens)
 *   applyBrandVoice()    — rewrites provided copy to match the brand voice (5 tokens)
 *   previewBrandVoice()  — orchestrates extract + apply for the preview endpoint
 * @security No PII in brand voice profiles. Token consumption enforced before every Claude call.
 * @dependencies @anthropic-ai/sdk, supabaseAdmin, consumeTokens
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { consumeTokens } from '../lib/tokens';

const anthropic = new Anthropic();

export interface BrandVoiceProfile {
  tone:        string;
  adjectives:  string[];
  avoidWords:  string[];
  exampleCopy: string;
  extractedAt: string;
}

export interface BrandVoicePreviewResult {
  original:    string;
  adjusted:    string;
  tone:        string;
  adjectives:  string[];
}

// ── Extract ───────────────────────────────────────────────────────────────────

/**
 * Derives a brand voice profile from app store reviews and metadata using Claude Haiku.
 * 10 tokens consumed. Result is cached to products.brand_voice_profile.
 * @param productId  - UUID of the product
 * @param founderId  - UUID of the founder (for token gate)
 * @returns BrandVoiceProfile persisted to the products row
 */
export async function extractBrandVoice(
  productId: string,
  founderId: string
): Promise<BrandVoiceProfile> {
  await consumeTokens(founderId, 'brand_voice_extract', 10);

  const db = getSupabaseAdmin();
  const { data: product, error } = await db
    .from('products')
    .select('name, category, scraped_meta, confirmed_icp')
    .eq('id', productId)
    .single();

  if (error || !product) throw new Error('Product not found');

  const meta = product.scraped_meta as Record<string, unknown> | null;
  const reviews = (meta?.reviews as { text: string }[] | undefined)?.slice(0, 10) ?? [];
  const reviewText = reviews.map((r) => `- "${r.text}"`).join('\n') || '(no reviews available)';
  const icp = product.confirmed_icp as Record<string, unknown> | null;

  const { content } = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Analyse the brand voice of "${product.name}" (${product.category}) from these user reviews:
${reviewText}

Target user: ${icp?.targetUser ?? 'unknown'}

Return ONLY valid JSON with this shape:
{
  "tone": "professional|casual|energetic|minimal|friendly|technical",
  "adjectives": ["word1", "word2", "word3"],
  "avoidWords": ["word1", "word2"],
  "exampleCopy": "One sentence that perfectly captures this app's voice"
}`,
    }],
  });

  const raw = content[0].type === 'text' ? content[0].text.trim() : '{}';
  const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as Omit<BrandVoiceProfile, 'extractedAt'>;

  const profile: BrandVoiceProfile = { ...parsed, extractedAt: new Date().toISOString() };

  // Cache to DB — non-fatal if update fails
  await db.from('products')
    .update({ brand_voice_profile: profile })
    .eq('id', productId);

  return profile;
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Rewrites copy to match the provided brand voice profile using Claude Haiku.
 * 5 tokens consumed.
 * @param copy    - Original copy text
 * @param profile - Brand voice profile to apply
 * @param founderId - UUID of founder (for token gate)
 */
async function applyBrandVoice(
  copy: string,
  profile: BrandVoiceProfile,
  founderId: string
): Promise<string> {
  await consumeTokens(founderId, 'brand_voice_apply', 5);

  const { content } = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Rewrite this copy to match the brand voice.

Brand voice:
- Tone: ${profile.tone}
- Key adjectives: ${profile.adjectives.join(', ')}
- Avoid words: ${profile.avoidWords.join(', ')}
- Example style: "${profile.exampleCopy}"

Original copy:
"${copy}"

Return ONLY the rewritten copy — no explanation, no quotes.`,
    }],
  });

  return content[0].type === 'text' ? content[0].text.trim() : copy;
}

// ── Preview (orchestrator) ────────────────────────────────────────────────────

/**
 * Generates a brand voice preview for the given copy and product.
 * Extracts brand voice if not cached. Applies it and returns both versions.
 * Must complete within 15 seconds — Haiku latency is typically 2-4 seconds.
 * @param productId - UUID of the product
 * @param founderId - UUID of the founder
 * @param copy      - Original copy to adjust
 */
export async function previewBrandVoice(
  productId: string,
  founderId: string,
  copy: string
): Promise<BrandVoicePreviewResult> {
  const db = getSupabaseAdmin();

  // Use cached profile or extract fresh
  const { data: product } = await db
    .from('products')
    .select('brand_voice_profile')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .single();

  if (!product) throw new Error('Product not found');

  const profile: BrandVoiceProfile =
    (product.brand_voice_profile as BrandVoiceProfile | null) ??
    await extractBrandVoice(productId, founderId);

  const adjusted = await applyBrandVoice(copy, profile, founderId);

  return {
    original:   copy,
    adjusted,
    tone:       profile.tone,
    adjectives: profile.adjectives,
  };
}
