/**
 * @file brandKitService.ts
 * @description Brand Kit resolution, build and owner confirmation — ADR-071 §6.
 *
 *   Builds the kit from sources LaunchMind ALREADY ingests — App Store / Play
 *   Store listings, website metadata, existing scraped context and existing
 *   content preferences. No new external source class is fetched in this pass.
 *
 *   Today the same information lives in four places with no provenance on any of
 *   them: `products.brand_voice_profile`, `products.website_meta.logoUrl`,
 *   `products.scraped_meta`, and `content_preferences.visual.logoUrl`. This
 *   module does not delete those; it reads them, labels each value with where it
 *   came from, and becomes the single thing content generation asks.
 *
 * @security An inferred or scraped value is never written as OWNER_CONFIRMED.
 *   Confirmation requires an actor and is recorded in append-only history.
 * @dependencies supabaseAdmin, brandFieldPolicy
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import {
  resolveBrandField, brandProvenanceLabel,
  type BrandFieldCandidate, type ResolvedBrandField, type BrandProvenance,
} from './brandFieldPolicy';

export interface BrandKit {
  productId: string;
  workspaceId: string;
  version: number;
  fields: Record<string, ResolvedBrandField>;
  /** Field keys with no value at all. Named so callers can degrade honestly. */
  missing: string[];
}

/** Owner-safe descriptors. Never a raw URL and never an internal id. */
const SOURCE_LABELS = {
  website: 'your website',
  appStore: 'your App Store listing',
  playStore: 'your Play Store listing',
  preferences: 'your content settings',
} as const;

/**
 * Derives brand candidates from what the product already carries.
 *
 * Everything here is SCRAPED or INFERRED by definition — these are observations,
 * however confident they look. Only confirmBrandField can produce
 * OWNER_CONFIRMED.
 */
export function deriveBrandCandidates(product: {
  brand_voice_profile?: unknown;
  website_meta?: unknown;
  scraped_meta?: unknown;
  content_preferences?: unknown;
}): BrandFieldCandidate[] {
  const out: BrandFieldCandidate[] = [];
  const rec = (v: unknown) => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
  const wm = rec(product.website_meta);
  const sm = rec(product.scraped_meta);
  const prefs = rec(product.content_preferences);
  const visual = rec(prefs.visual);
  const voice = rec(product.brand_voice_profile);

  const push = (fieldKey: string, value: unknown, provenance: BrandProvenance, sourceLabel: string) => {
    if (value === null || value === undefined || value === '') return;
    out.push({ fieldKey, value, provenance, sourceLabel });
  };

  // A logo the owner supplied on the confirm screen and left enabled is the one
  // brand field with an existing owner-authored path. It is still recorded as
  // SCRAPED unless a confirmation row exists — a field the owner never saw a
  // confirmation prompt for has not been confirmed, whatever the source.
  push('logo', visual.logoUrl, 'SCRAPED', SOURCE_LABELS.preferences);
  push('logo', wm.logoUrl, 'SCRAPED', SOURCE_LABELS.website);
  push('app_icon', sm.iconUrl, 'SCRAPED', SOURCE_LABELS.appStore);
  push('tagline', wm.description ?? sm.subtitle, 'SCRAPED', SOURCE_LABELS.website);
  push('brand_voice', voice.voice ?? voice.tone, 'INFERRED', SOURCE_LABELS.website);
  push('tone', voice.tone, 'INFERRED', SOURCE_LABELS.website);
  push('visual_style', visual.imageStyle, 'SCRAPED', SOURCE_LABELS.preferences);
  return out;
}

/**
 * Resolves the current Brand Kit for one product.
 *
 * @param workspaceId VERIFIED workspace context, never a client hint
 * @security Both predicates are on the query. A product id from another
 *   workspace returns nothing rather than another business's brand.
 */
export async function resolveBrandKit(
  workspaceId: string, productId: string,
): Promise<BrandKit> {
  const db = getSupabaseAdmin();

  const [{ data: kitRow }, { data: fieldRows }, { data: productRow }] = await Promise.all([
    db.from('brand_kits').select('id, version')
      .eq('workspace_id', workspaceId).eq('product_id', productId).maybeSingle(),
    db.from('brand_kit_fields').select('field_key, value, provenance, source_label, updated_at')
      .eq('workspace_id', workspaceId).eq('product_id', productId),
    db.from('products').select('brand_voice_profile, website_meta, scraped_meta, content_preferences')
      .eq('workspace_id', workspaceId).eq('id', productId).maybeSingle(),
  ]);

  const persisted: BrandFieldCandidate[] = ((fieldRows ?? []) as Array<Record<string, unknown>>)
    .map(r => ({
      fieldKey: String(r.field_key), value: r.value,
      provenance: String(r.provenance) as BrandProvenance,
      sourceLabel: (r.source_label as string | null) ?? null,
      observedAt: (r.updated_at as string | null) ?? null,
    }));

  const derived = productRow ? deriveBrandCandidates(productRow as Record<string, unknown>) : [];

  const byField = new Map<string, BrandFieldCandidate[]>();
  for (const c of [...persisted, ...derived]) {
    byField.set(c.fieldKey, [...(byField.get(c.fieldKey) ?? []), c]);
  }

  const fields: Record<string, ResolvedBrandField> = {};
  for (const [key, candidates] of byField) {
    const resolved = resolveBrandField(candidates);
    if (resolved) fields[key] = resolved;
  }

  const { BRAND_FIELD_KEYS } = await import('./brandFieldPolicy');
  return {
    productId, workspaceId,
    version: (kitRow as { version?: number } | null)?.version ?? 1,
    fields,
    missing: BRAND_FIELD_KEYS.filter(k => !fields[k]),
  };
}

/** Prohibited terms as a plain list, for the deterministic validator. */
export function prohibitedTermsOf(kit: BrandKit): string[] {
  const v = kit.fields.prohibited_terminology?.value;
  return Array.isArray(v) ? v.map(String) : [];
}

/** Owner-safe provenance lines, e.g. "Logo — you confirmed this". */
export function brandProvenanceLines(kit: BrandKit): string[] {
  return Object.values(kit.fields).map(f =>
    `${f.fieldKey.replace(/_/g, ' ')} — ${brandProvenanceLabel(f)}`);
}

export class BrandConfirmationError extends Error {
  constructor(message: string) { super(message); this.name = 'BrandConfirmationError'; }
}

/**
 * Records an owner confirming or correcting one brand field.
 *
 * @security The ONLY producer of OWNER_CONFIRMED. Writes append-only history
 *   before the update, so the prior value and its provenance survive a rebrand —
 *   §21's requirement that history not be silently rewritten.
 */
export async function confirmBrandField(opts: {
  workspaceId: string; productId: string; founderId: string; actorId: string;
  fieldKey: string; value: unknown;
}): Promise<{ kitVersion: number }> {
  if (!opts.fieldKey) throw new BrandConfirmationError('A field is required.');
  if (opts.value === null || opts.value === undefined || opts.value === '') {
    throw new BrandConfirmationError('A value is required — confirming nothing confirms nothing.');
  }
  const db = getSupabaseAdmin();

  const { data: existingKit } = await db.from('brand_kits').select('id, version')
    .eq('workspace_id', opts.workspaceId).eq('product_id', opts.productId).maybeSingle();

  let kitId = (existingKit as { id?: string } | null)?.id ?? null;
  let version = ((existingKit as { version?: number } | null)?.version ?? 0) + 1;

  if (!kitId) {
    const { data, error } = await db.from('brand_kits').insert({
      workspace_id: opts.workspaceId, product_id: opts.productId,
      founder_id: opts.founderId, version: 1,
    }).select('id').single();
    if (error) throw new BrandConfirmationError(error.message);
    kitId = (data as { id: string }).id;
    version = 1;
  } else {
    await db.from('brand_kits')
      .update({ version, updated_at: new Date().toISOString() }).eq('id', kitId);
  }

  const { data: prior } = await db.from('brand_kit_fields')
    .select('value, provenance').eq('brand_kit_id', kitId)
    .eq('field_key', opts.fieldKey).maybeSingle();

  await db.from('brand_kit_field_history').insert({
    brand_kit_id: kitId, workspace_id: opts.workspaceId, product_id: opts.productId,
    field_key: opts.fieldKey,
    prior_value: (prior as { value?: unknown } | null)?.value ?? null,
    prior_provenance: (prior as { provenance?: string } | null)?.provenance ?? null,
    new_value: opts.value, new_provenance: 'OWNER_CONFIRMED',
    kit_version: version, changed_by: opts.actorId,
  });

  const { error } = await db.from('brand_kit_fields').upsert({
    brand_kit_id: kitId, workspace_id: opts.workspaceId, product_id: opts.productId,
    field_key: opts.fieldKey, value: opts.value,
    provenance: 'OWNER_CONFIRMED', source_label: null,
    confirmed_by: opts.actorId, confirmed_at: new Date().toISOString(),
    kit_version: version, updated_at: new Date().toISOString(),
  }, { onConflict: 'brand_kit_id,field_key' });
  if (error) throw new BrandConfirmationError(error.message);

  return { kitVersion: version };
}
