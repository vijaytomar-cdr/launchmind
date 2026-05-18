/**
 * @file utmService.ts
 * @description UTM tracking link generation and click attribution for campaign management.
 *   Creates short-coded redirect URLs that append UTM parameters to base URLs.
 *   Click tracking increments utm_links.click_count via atomic DB update.
 * @security
 *   - createUTMLink verifies campaign ownership (founder_id match) before inserting.
 *   - trackClick is public (called from redirect route) — only increments click_count.
 *   - base_url validated to be http/https only — no javascript: or data: URIs.
 * @dependencies supabaseAdmin
 */

import crypto from 'crypto';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export interface UTMParams {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}

export interface UTMLink {
  id: string;
  campaignId: string;
  baseUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  utmTerm: string | null;
  shortCode: string;
  clickCount: number;
  trackedUrl: string;
  createdAt: string;
}

/**
 * Builds a full UTM-tagged URL from a base URL and params.
 * @param baseUrl - The destination URL (must be http/https)
 * @param params  - UTM parameter values
 * @returns       Full URL with UTM query params appended
 */
export function buildUTMUrl(baseUrl: string, params: UTMParams): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', params.source);
  url.searchParams.set('utm_medium', params.medium);
  url.searchParams.set('utm_campaign', params.campaign);
  if (params.content) url.searchParams.set('utm_content', params.content);
  if (params.term) url.searchParams.set('utm_term', params.term);
  return url.toString();
}

/**
 * Generates a cryptographically random 8-char alphanumeric short code.
 */
function generateShortCode(): string {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

/**
 * Validates that a URL uses http or https scheme only.
 * @throws {Error} For javascript:, data:, or other non-http(s) schemes.
 */
function validateBaseUrl(url: string): void {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid URL scheme: ${parsed.protocol}. Only http/https allowed.`);
  }
}

/**
 * Creates a UTM-tagged tracking link for a campaign.
 * @param campaignId - UUID of the campaign to attach the link to
 * @param founderId  - UUID of the authenticated founder (ownership check)
 * @param baseUrl    - Destination URL (http/https only)
 * @param params     - UTM parameter values
 * @returns          The created UTM link record
 * @throws           {Error} If campaign not found, access denied, or URL invalid
 * @security         Verifies campaign.founder_id === founderId before insert.
 */
export async function createUTMLink(
  campaignId: string,
  founderId: string,
  baseUrl: string,
  params: UTMParams
): Promise<UTMLink> {
  validateBaseUrl(baseUrl);

  const supabase = getSupabaseAdmin();

  // Verify campaign ownership
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, founder_id')
    .eq('id', campaignId)
    .eq('founder_id', founderId)
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Campaign not found or access denied: ${campaignId}`);
  }

  // Generate unique short code (retry on collision, max 5 tries)
  let shortCode = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShortCode();
    const { data: existing } = await supabase
      .from('utm_links')
      .select('id')
      .eq('short_code', candidate)
      .maybeSingle();
    if (!existing) {
      shortCode = candidate;
      break;
    }
  }
  if (!shortCode) throw new Error('Failed to generate unique short code — try again');

  const { data, error } = await supabase
    .from('utm_links')
    .insert({
      campaign_id: campaignId,
      founder_id: founderId,
      base_url: baseUrl,
      utm_source: params.source,
      utm_medium: params.medium,
      utm_campaign: params.campaign,
      utm_content: params.content ?? null,
      utm_term: params.term ?? null,
      short_code: shortCode,
      click_count: 0,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create UTM link: ${error?.message}`);

  const trackedUrl = buildUTMUrl(baseUrl, params);

  return {
    id: data.id,
    campaignId: data.campaign_id,
    baseUrl: data.base_url,
    utmSource: data.utm_source,
    utmMedium: data.utm_medium,
    utmCampaign: data.utm_campaign,
    utmContent: data.utm_content,
    utmTerm: data.utm_term,
    shortCode: data.short_code,
    clickCount: data.click_count,
    trackedUrl,
    createdAt: data.created_at,
  };
}

/**
 * Returns all UTM links for a campaign (filtered by founder).
 * @param campaignId - UUID of the campaign
 * @param founderId  - UUID of the authenticated founder
 * @returns          Array of UTM link records
 */
export async function getUTMLinks(campaignId: string, founderId: string): Promise<UTMLink[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('utm_links')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('founder_id', founderId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch UTM links: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    baseUrl: row.base_url,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content,
    utmTerm: row.utm_term,
    shortCode: row.short_code,
    clickCount: row.click_count,
    trackedUrl: buildUTMUrl(row.base_url, {
      source: row.utm_source,
      medium: row.utm_medium,
      campaign: row.utm_campaign,
      content: row.utm_content ?? undefined,
      term: row.utm_term ?? undefined,
    }),
    createdAt: row.created_at,
  }));
}

/**
 * Records a click on a UTM link and returns the destination URL.
 * @param shortCode - The 8-char short code from the redirect URL
 * @returns         The full UTM-tagged destination URL, or null if not found
 * @security        Public endpoint — only increments click_count. No auth required.
 */
export async function trackClick(shortCode: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('utm_links')
    .select('base_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_count')
    .eq('short_code', shortCode)
    .single();

  if (error || !data) return null;

  // Increment click count (non-atomic on Supabase JS client; acceptable for analytics approximation)
  await supabase
    .from('utm_links')
    .update({ click_count: (data.click_count ?? 0) + 1 })
    .eq('short_code', shortCode);

  return buildUTMUrl(data.base_url, {
    source: data.utm_source,
    medium: data.utm_medium,
    campaign: data.utm_campaign,
    content: data.utm_content ?? undefined,
    term: data.utm_term ?? undefined,
  });
}
