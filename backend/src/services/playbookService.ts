/**
 * @file playbookService.ts
 * @description Retrieves anonymised playbook signals from the DB to enrich strategy prompts.
 *   Signals are PII-free aggregate performance data (see playbook_signals schema).
 *   getRelevantSignals: category + market filter (SQL).
 *   getSimilarSignals: pgvector cosine distance on signal_embedding.
 *   buildPlaybookContext: formats signals as natural language for Claude prompt injection.
 * @security No founder_id on playbook_signals — anonymised by design.
 *   Vectors compared via pgvector <=> operator; no raw vectors returned to caller.
 * @dependencies supabaseAdmin, types/strategy
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export interface PlaybookSignal {
  category: string;
  market: string;
  channel: string;
  hookType: string | null;
  priceTier: string | null;
  installDeltaPct: number | null;
  conversionRate: number | null;
  retentionD7: number | null;
  weekNumber: number | null;
}

/**
 * Fetches the top-K playbook signals matching a category + market combination.
 * @param category - App category string (e.g. 'Productivity')
 * @param market   - 'usa' | 'india'
 * @param topK     - Number of signals to return (default 10)
 * @returns        Array of matching PlaybookSignal rows
 * @security       No PII. playbook_signals RLS: authenticated SELECT only.
 */
export async function getRelevantSignals(
  category: string,
  market: 'usa' | 'india',
  topK = 10
): Promise<PlaybookSignal[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('playbook_signals')
    .select(
      'category, market, channel, hook_type, price_tier, install_delta_pct, conversion_rate, retention_d7, week_number'
    )
    .eq('market', market)
    .ilike('category', `%${category}%`)
    .order('install_delta_pct', { ascending: false })
    .limit(topK);

  if (error || !data) return [];

  return data.map((row) => ({
    category: row.category,
    market: row.market,
    channel: row.channel,
    hookType: row.hook_type,
    priceTier: row.price_tier,
    installDeltaPct: row.install_delta_pct,
    conversionRate: row.conversion_rate,
    retentionD7: row.retention_d7,
    weekNumber: row.week_number,
  }));
}

/**
 * Finds the top-K playbook signals most similar to the given ICP embedding.
 * Uses pgvector cosine distance (<=>). Falls back to empty array if no embedding.
 * @param icpEmbedding - 1536-dim float array from products.icp_embedding
 * @param topK         - Number of similar signals (default 5)
 * @returns            Array of similar PlaybookSignal rows
 * @security           No raw vectors returned. pgvector RPC call only.
 */
export async function getSimilarSignals(
  icpEmbedding: number[] | null,
  topK = 5
): Promise<PlaybookSignal[]> {
  if (!icpEmbedding || icpEmbedding.length === 0) return [];

  const { data, error } = await getSupabaseAdmin().rpc('match_playbook_signals', {
    query_embedding: icpEmbedding,
    match_count: topK,
  });

  if (error || !data) return [];

  return (data as PlaybookSignal[]);
}

/**
 * Formats playbook signals into a natural-language string for Claude prompt injection.
 * @param category     - App category
 * @param market       - 'usa' | 'india'
 * @param icpEmbedding - Optional ICP vector for similarity enrichment
 * @returns            Plain-text context block to insert into a strategy prompt
 */
export async function buildPlaybookContext(
  category: string,
  market: 'usa' | 'india',
  icpEmbedding: number[] | null
): Promise<string> {
  const [relevant, similar] = await Promise.all([
    getRelevantSignals(category, market),
    getSimilarSignals(icpEmbedding),
  ]);

  const all = [...relevant, ...similar].filter(
    (s, i, arr) => arr.findIndex((x) => x.channel === s.channel && x.hookType === s.hookType) === i
  );

  if (all.length === 0) {
    return `No historical playbook signals found for ${category} in ${market.toUpperCase()}.`;
  }

  const lines = all.map((s) => {
    const parts: string[] = [`Channel: ${s.channel}`];
    if (s.hookType) parts.push(`Hook: ${s.hookType}`);
    if (s.installDeltaPct != null)
      parts.push(`Install lift: +${s.installDeltaPct.toFixed(1)}%`);
    if (s.conversionRate != null)
      parts.push(`Conversion: ${(s.conversionRate * 100).toFixed(1)}%`);
    if (s.retentionD7 != null)
      parts.push(`D7 retention: ${(s.retentionD7 * 100).toFixed(1)}%`);
    return parts.join(' | ');
  });

  return `Historical performance signals for ${category} apps in ${market.toUpperCase()}:\n${lines.join('\n')}`;
}
