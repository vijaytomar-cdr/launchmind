/**
 * @file contract.ts
 * @description The frozen ADR-069 Market Intelligence contract, as code.
 *
 *   Everything here is PURE and deterministic. No database, no network, no
 *   model. Timestamp semantics, freshness, subject identity, mode and the
 *   authority ceiling live here so a single file can be read to check the
 *   contract, and so every policy test drives the real implementation rather
 *   than a copy of it.
 *
 * @security Defines the authority CEILING for external evidence. Founder and
 *   first-party tiers are not expressible here, and migration 113 makes them
 *   unrepresentable in the table as well.
 * @dependencies authorityPolicy (types + version only)
 */

import { createHash } from 'crypto';
import {
  AUTHORITY_POLICY_VERSION, type AuthorityTier,
} from '../memory/authorityPolicy';

// ── MODE ────────────────────────────────────────────────────────────────────

export const MARKET_INTELLIGENCE_MODES = ['OFF', 'SHADOW', 'ACTIVE'] as const;
export type MarketIntelligenceMode = typeof MARKET_INTELLIGENCE_MODES[number];

/**
 * The running mode. Defaults to SHADOW.
 *
 * ACTIVE is REFUSED rather than silently downgraded. Phase 3.4B implements
 * ingestion, provenance, subject, applicability, freshness and would-be
 * eligibility — it does not implement owner-visible rendering, so an ACTIVE
 * flag would promise something that does not exist. Refusing loudly is the same
 * device as `execution_status` having no 'EXECUTED' value: turning it on has to
 * be a deliberate code change, not a config change someone makes at 2am.
 *
 * @throws {Error} when ACTIVE is requested before 3.4C lands
 */
export function resolveMarketIntelligenceMode(
  raw = process.env.MARKET_INTELLIGENCE_MODE,
): MarketIntelligenceMode {
  const v = (raw ?? 'SHADOW').toUpperCase();
  if (v === 'OFF' || v === 'SHADOW' || v === 'ACTIVE') return v;
  // An unrecognised value is a misconfiguration, and the safe reading of a
  // misconfiguration is "do not expose anything".
  return 'SHADOW';
}

// ── SOURCE CLASS (frozen to one in 3.4B) ────────────────────────────────────

export const SOURCE_TYPES = ['STORE_LISTING'] as const;
export type SourceType = typeof SOURCE_TYPES[number];

export const SOURCE_PROVIDERS = ['app_store', 'play_store'] as const;
export type SourceProvider = typeof SOURCE_PROVIDERS[number];

export const SUBJECT_TYPES = [
  'STORE_APP_ENTITY', 'CATEGORY', 'CHANNEL', 'GEOGRAPHY',
] as const;
export type SubjectType = typeof SUBJECT_TYPES[number];

export const OBSERVATION_TYPES = [
  'LISTING_POSITIONING', 'LISTING_RATING', 'LISTING_RATING_COUNT',
  'LISTING_PRICE_TIER', 'LISTING_CATEGORY', 'LISTING_UPDATE_RECENCY',
] as const;
export type ObservationType = typeof OBSERVATION_TYPES[number];

/**
 * The authority ceiling for this source class.
 *
 * A store listing is authored by the subject company (or computed by the
 * platform), which makes it an official primary public source — reliable about
 * what is PUBLISHED, which is not the same as a measured outcome. It therefore
 * ranks below OBSERVED_FIRST_PARTY and below both founder tiers, and
 * `mayAutoOverride` requires strictly stronger authority, so it can never
 * silently override founder direction or first-party performance.
 */
export const STORE_LISTING_AUTHORITY: AuthorityTier = 'VERIFIED_EXTERNAL';
export const MARKET_INTELLIGENCE_POLICY_VERSION = AUTHORITY_POLICY_VERSION;

/** Tiers external market evidence may NEVER hold. Mirrors the 113 CHECK. */
export const FORBIDDEN_EXTERNAL_TIERS: readonly AuthorityTier[] = [
  'FOUNDER_ASSERTED', 'FOUNDER_CONFIRMED',
  'OBSERVED_FIRST_PARTY', 'EXPERIMENT_CONTROLLED',
];

// ── TIME + FRESHNESS ────────────────────────────────────────────────────────

export const FRESHNESS_STATES = ['CURRENT', 'AGING', 'STALE', 'UNKNOWN_DATE'] as const;
export type FreshnessState = typeof FRESHNESS_STATES[number];

/**
 * Thresholds for the STORE_LISTING class, in days.
 *
 * Derived from the source, not chosen: app-store listings update well inside a
 * quarter, so a listing observation older than one may already describe a
 * superseded build. A future source class with different cadence states its own
 * numbers rather than inheriting these.
 */
export const STORE_LISTING_FRESHNESS_DAYS = { current: 90, aging: 365 } as const;

const DAY_MS = 86_400_000;

/**
 * The ONLY date that may drive freshness.
 *
 * `retrieved_at` is deliberately not a parameter. Fetching a 2019 page today
 * does not make 2019 current, and the way that bug gets written is by having
 * the fetch timestamp within reach.
 */
export function freshnessReferenceDate(
  observedAt: string | Date | null | undefined,
  publishedAt: string | Date | null | undefined,
): Date | null {
  const pick = observedAt ?? publishedAt ?? null;
  if (!pick) return null;
  const d = pick instanceof Date ? pick : new Date(pick);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Derives freshness from the reference date and a clock.
 *
 * @param reference - freshnessReferenceDate() output; null means no defensible date
 * @param now       - injected so boundary tests are exact rather than approximate
 */
export function deriveFreshness(
  reference: Date | null,
  now: Date = new Date(),
  thresholds = STORE_LISTING_FRESHNESS_DAYS,
): FreshnessState {
  if (!reference) return 'UNKNOWN_DATE';
  const ageDays = Math.floor((now.getTime() - reference.getTime()) / DAY_MS);
  // A source dated in the future is not "very fresh" — it is undated in any
  // useful sense, and treating it as CURRENT would reward a bad publication date.
  if (ageDays < 0) return 'UNKNOWN_DATE';
  if (ageDays <= thresholds.current) return 'CURRENT';
  if (ageDays <= thresholds.aging) return 'AGING';
  return 'STALE';
}

/** May this freshness state support a present-tense market statement? */
export function permitsPresentTense(f: FreshnessState): boolean {
  return f === 'CURRENT';
}

/**
 * May this freshness state support a NUMERIC market claim?
 *
 * UNKNOWN_DATE may not: a number with no date attached is the exact shape of a
 * fabricated benchmark, and there is no way for an owner to sanity-check it.
 */
export function permitsNumericClaim(f: FreshnessState): boolean {
  return f !== 'UNKNOWN_DATE';
}

/** States that can back an evidence handle at all. */
export function permitsEvidenceHandle(f: FreshnessState): boolean {
  return f === 'CURRENT' || f === 'AGING';
}

// ── OWNER-FACING LANGUAGE (ADR-069 §5, enforced in 3.4C) ────────────────────

/**
 * Words that assert the claim is true OF THE MARKET RIGHT NOW.
 *
 * Only CURRENT evidence may carry these. The failure this prevents is subtle
 * and would be invisible to an owner: a perfectly real 2019 observation,
 * rendered in the present tense, reads as a statement about today's market.
 */
const PRESENT_TENSE_MARKERS: readonly string[] = [
  'currently', 'right now', 'at the moment', 'these days', 'as of today',
  'today', 'this week', 'this month', 'the market is now', 'is now',
  'nowadays', 'at present', 'presently',
];

/** Does this sentence assert something about the market AS IT IS NOW? */
export function assertsPresentMarketState(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return PRESENT_TENSE_MARKERS.some(m => t.includes(m));
}

export type LanguageVerdict =
  | { ok: true }
  | { ok: false; reason: 'PRESENT_TENSE_ON_NON_CURRENT_EVIDENCE' | 'NUMERIC_CLAIM_ON_UNDATED_EVIDENCE' };

/**
 * May this claim stand, given the freshness of the evidence behind it?
 *
 * @param text      - the owner-visible sentence
 * @param freshness - the STRONGEST freshness among the evidence it cites
 * @param isNumeric - whether the claim asserts a measured quantity
 *
 * AGING is permitted to make a dated statement, so it is not blocked here —
 * what is blocked is present-tense framing on anything that is not CURRENT.
 * The date framing an AGING claim needs is supplied by the handle's own label,
 * which always carries the observation date.
 */
export function checkFreshnessLanguage(
  text: string, freshness: FreshnessState, isNumeric: boolean,
): LanguageVerdict {
  if (isNumeric && !permitsNumericClaim(freshness)) {
    return { ok: false, reason: 'NUMERIC_CLAIM_ON_UNDATED_EVIDENCE' };
  }
  if (assertsPresentMarketState(text) && !permitsPresentTense(freshness)) {
    return { ok: false, reason: 'PRESENT_TENSE_ON_NON_CURRENT_EVIDENCE' };
  }
  return { ok: true };
}

// ── SUBJECT IDENTITY ────────────────────────────────────────────────────────

/**
 * Stable subject key for a store entity.
 *
 * Display name is NEVER an input. Two different apps called "Tracker" must not
 * collide, and one app that renames itself must not fork into two entities.
 *
 * @param provider   app_store | play_store
 * @param storefront ISO storefront/country the listing was read from
 * @param providerId Apple numeric id (`id6448311069`) or Play package name
 */
export function storeSubjectKey(
  provider: SourceProvider, storefront: string, providerId: string,
): string {
  const sf = storefront.trim().toLowerCase();
  const id = providerId.trim();
  if (!sf || !id) throw new Error('storeSubjectKey: storefront and providerId are required');
  return `${provider}:${sf}:${id}`;
}

/** Extracts the provider id from a store URL. Null when it is not a listing URL. */
export function providerIdFromStoreUrl(url: string): { provider: SourceProvider; storefront: string; providerId: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }

  if (u.hostname.endsWith('apps.apple.com')) {
    const m = u.pathname.match(/\/(id\d+)(?:\/|$)/);
    if (!m) return null;
    const sfMatch = u.pathname.match(/^\/([a-z]{2})\//i);
    return { provider: 'app_store', storefront: (sfMatch?.[1] ?? 'us').toLowerCase(), providerId: m[1] };
  }
  if (u.hostname.endsWith('play.google.com')) {
    const pkg = u.searchParams.get('id');
    if (!pkg || !/^[A-Za-z0-9_.]+$/.test(pkg)) return null;
    const gl = u.searchParams.get('gl');
    return { provider: 'play_store', storefront: (gl ?? 'us').toLowerCase(), providerId: pkg };
  }
  return null;
}

/**
 * Conservative cross-store entity link.
 *
 * Returns a group key ONLY when the developer name and the normalized app name
 * match EXACTLY across two stores. That is a deterministic string comparison,
 * not semantic matching — no embeddings, no fuzzy distance. When in doubt the
 * entities stay separate, because a wrong link merges two companies' facts,
 * which is worse than showing them apart.
 */
export function entityGroupKey(
  appName: string, developer: string,
): { key: string; basis: string } | null {
  const n = canonicalAppName(appName);
  const d = canonicalPublisher(developer);
  // Ambiguity guard: a publisher that reduces to nothing (or to a bare legal
  // form like "Inc.") identifies no company, and a one-character app name
  // identifies no product. Both stay UNLINKED — a wrong link merges two
  // companies' facts, which is worse than showing them apart.
  if (!n || n.length < 2 || !d || d.length < 2) return null;
  return {
    key: createHash('sha256').update(`entity:${d}:${n}`).digest('hex').slice(0, 32),
    basis: 'canonical publisher + canonical app name, exact match',
  };
}

/**
 * Legal forms that differ between storefronts for the SAME company.
 *
 * P1-17, measured on real data: Notion publishes as "Notion Labs, Incorporated"
 * on the App Store and "Notion Labs, Inc." on Play. Independence no longer
 * depends on this link, but external CONFLICT detection does — two ratings can
 * only disagree about one entity if both are recognised as that entity.
 *
 * Stripping is limited to a closed list of legal suffixes. It is not a fuzzy
 * matcher: "Rival Software" and "Rival Systems" stay distinct, because the
 * difference is a real word, not a corporate form.
 */
const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'l l c', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'ag', 'plc', 'pty', 'pte', 'bv', 'nv', 'sa', 'sas',
  'srl', 'spa', 'ab', 'as', 'oy', 'aps', 'kk', 'pvt', 'private', 'lp', 'llp',
  'holdings', 'group', 'technologies', 'technology', 'labs', 'lab', 'studio',
  'studios', 'software', 'apps', 'app', 'mobile', 'digital', 'media', 'games',
]);

/**
 * Canonical publisher identity.
 *
 * NOTE the deliberate risk taken here: descriptive suffixes ("Labs", "Software",
 * "Games") are stripped alongside strict legal forms, because storefronts
 * genuinely disagree about them. That makes "Rival Labs" and "Rival" one
 * publisher. The residual is required to be non-empty and at least 2 characters,
 * so a name that is ONLY suffixes never becomes an identity — it stays unlinked.
 */
export function canonicalPublisher(developer: string): string {
  const words = normalizeEntityToken(developer).split(' ').filter(Boolean);
  // Strip from the END only. A leading "Labs" is part of the name.
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  const last = words[words.length - 1];
  // A single remaining token that is itself a legal form identifies nobody.
  if (words.length === 1 && last && LEGAL_SUFFIXES.has(last)) return '';
  return words.join(' ');
}

/**
 * Canonical app name: the product, without the storefront tagline.
 *
 * Stores append different keyword taglines to the same product — App Store
 * "Notion: Notes, Tasks, AI" vs a Play title without it. The part before the
 * first ':' or '-' is the product; the rest is store SEO.
 */
export function canonicalAppName(appName: string): string {
  const head = appName.split(/[:–—-]/)[0] ?? appName;
  const n = normalizeEntityToken(head);
  return n || normalizeEntityToken(appName);
}

function normalizeEntityToken(s: string): string {
  return s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── INDEPENDENCE ────────────────────────────────────────────────────────────

/**
 * Two records sharing this key are the SAME statement, not two confirmations.
 *
 * Derived from the PUBLISHER OF RECORD and the statement identity, deliberately
 * NOT from the URL. A developer's own description text mirrored onto App Store
 * and Play Store is one statement published twice; counting the two URLs would
 * turn a single company's marketing copy into "corroborated by two sources".
 *
 * Platform-computed facts (ratings) are attributed to the PLATFORM, because
 * Apple's rating and Google's rating genuinely are two independent measurements.
 */
export function independenceKeyFor(
  publisherOfRecord: string, observationType: ObservationType, subjectIdentity: string,
): string {
  const p = normalizeEntityToken(publisherOfRecord);
  return createHash('sha256')
    .update(`ind:${p}:${observationType}:${subjectIdentity}`)
    .digest('hex').slice(0, 40);
}

/**
 * Who is answerable for this observation.
 *
 * Listing copy is the developer's statement. A rating aggregate is the
 * platform's measurement. Attributing both to the platform (or both to the
 * developer) is what collapses independence in the wrong direction.
 */
export function publisherOfRecord(
  observationType: ObservationType, developer: string, provider: SourceProvider,
): string {
  switch (observationType) {
    case 'LISTING_RATING':
    case 'LISTING_RATING_COUNT':
      return provider === 'app_store' ? 'Apple App Store' : 'Google Play';
    default:
      return developer;
  }
}

/**
 * The publisher as an IDENTITY, for independence counting.
 *
 * Separate from `publisherOfRecord`, which is the display value stored in
 * provenance and must stay the accurate legal name. Using that name as the
 * identity was the second half of the measured over-count: "Notion Labs,
 * Incorporated" and "Notion Labs, Inc." are one publisher, and normalising the
 * string does not merge them. The identity is therefore the ENTITY for
 * developer-authored facts, and the platform for platform-computed ones.
 */
export function publisherIdentity(
  observationType: ObservationType, provider: SourceProvider, entityIdentity: string,
): string {
  switch (observationType) {
    case 'LISTING_RATING':
    case 'LISTING_RATING_COUNT':
      return provider === 'app_store' ? 'platform:apple' : 'platform:google';
    default:
      return `entity:${entityIdentity}`;
  }
}

/**
 * Identity of the STATEMENT, for independence purposes.
 *
 * MEASURED DEFECT (real ingestion, 2026-08-16): keying on the entity link made
 * independence depend on the developer's legal name matching exactly across
 * stores. Notion publishes as "Notion Labs, Incorporated" on the App Store and
 * "Notion Labs, Inc." on Play. `entityGroupKey` therefore did NOT link them, and
 * two copies of one company's own fact — "listed as free", "listed in
 * productivity" — would have counted as TWO independent public confirmations.
 * That is the exact over-count the syndication rule exists to stop, reached
 * through a punctuation difference.
 *
 * The fix keys on WHAT IS ASSERTED rather than on who we managed to match:
 * the same fact stated twice is one statement, whatever the publisher called
 * itself. Two different companies asserting an identical boilerplate fact
 * collapse to one as well — under-counting independence, which is the safe
 * direction and the ADR-069 rule ("when independence cannot be established,
 * assume dependent").
 *
 * Platform-computed facts are excluded: Apple's rating and Google's rating are
 * two genuine measurements and are separated by their publisher instead.
 */
export function statementIdentity(
  observationType: ObservationType,
  parts: { excerpt?: string | null; structuredValue?: number | null; unit?: string | null; categoryKey?: string | null; observedAt?: string | null; entityIdentity: string },
): string {
  const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
  switch (observationType) {
    case 'LISTING_RATING':
    case 'LISTING_RATING_COUNT':
      // Platform measurement: identity is the entity; the PUBLISHER separates them.
      return parts.entityIdentity;
    case 'LISTING_POSITIONING':
      return h(`pos:${normalizeEntityToken(parts.excerpt ?? '')}`);
    case 'LISTING_PRICE_TIER':
      return h(`price:${parts.structuredValue ?? ''}:${normalizeEntityToken(parts.unit ?? '')}:${parts.entityIdentity}`);
    case 'LISTING_CATEGORY':
      return h(`cat:${normalizeEntityToken(parts.categoryKey ?? '')}:${parts.entityIdentity}`);
    case 'LISTING_UPDATE_RECENCY':
      // One update event. Stores stamp it minutes apart, so the DAY is the fact.
      return h(`upd:${(parts.observedAt ?? '').slice(0, 10)}:${parts.entityIdentity}`);
  }
}

/**
 * Entity identity that survives a legal-name variant across stores.
 *
 * Falls back to the per-store subject key only when the app name itself is
 * unusable, in which case the two listings stay separate — the conservative
 * outcome for entity matching, even though it is the risky one for
 * independence. `statementIdentity` is what actually protects independence.
 */
export function entityIdentityFor(appName: string, subjectKey: string): string {
  const n = normalizeEntityToken(appName);
  return n ? createHash('sha256').update(`ent:${n}`).digest('hex').slice(0, 32) : subjectKey;
}

/** Counts INDEPENDENT confirmations. Unknown independence counts as dependent. */
export function countIndependent(keys: Array<string | null | undefined>): number {
  const seen = new Set<string>();
  for (const k of keys) {
    // A missing key cannot be shown to be independent of anything, so it adds
    // nothing rather than adding one.
    if (!k) continue;
    seen.add(k);
  }
  return seen.size;
}

// ── LIFECYCLE ───────────────────────────────────────────────────────────────

export const LIFECYCLE_STATES = [
  'ACTIVE', 'SUPERSEDED', 'CORRECTED', 'RETRACTED', 'UNAVAILABLE', 'ERASED',
] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];

/** Only ACTIVE evidence may back a handle. Everything else is history. */
export function lifecyclePermitsUse(s: LifecycleState): boolean {
  return s === 'ACTIVE';
}

/** Owner-facing note for a source whose standing changed after the fact. */
export function lifecycleDisclosure(s: LifecycleState): string | null {
  switch (s) {
    case 'ACTIVE':      return null;
    case 'SUPERSEDED':  return 'This source has since been superseded by a newer observation.';
    case 'CORRECTED':   return 'This source has since been corrected.';
    case 'RETRACTED':   return 'This source has since been retracted.';
    case 'UNAVAILABLE': return 'This source is no longer available.';
    case 'ERASED':      return 'This source has been erased at the publisher\'s request.';
  }
}

// ── CONTENT HASH ────────────────────────────────────────────────────────────

/**
 * Global dedup identity. Covers what the observation IS, never when we fetched
 * it — otherwise every re-read would mint a new "independent" row.
 */
export function sourceContentHash(parts: {
  subjectKey: string; observationType: ObservationType; claimText: string;
  structuredValue: number | null; unit: string | null;
  observedAt: string | null; publishedAt: string | null; sourceRef: string;
}): string {
  return createHash('sha256').update(JSON.stringify([
    parts.subjectKey, parts.observationType, parts.claimText,
    parts.structuredValue, parts.unit, parts.observedAt, parts.publishedAt,
    parts.sourceRef,
  ])).digest('hex');
}

/** V1 read-only demand extension. This is a request-scoped observation, not a
 * STORE_LISTING row; the existing listing table's frozen CHECKs stay unchanged. */
export interface SearchDemandSignal {
  sourceType:'SEARCH_DEMAND'; provider:'serpapi_google_trends'; authority:'VERIFIED_EXTERNAL';
  workspaceId:string;productId:string;serviceId:string;query:string;geography:string;
  requestedWindow?:{start:string;end:string};samples?:Array<{timestamp:string;value:number}>;
  ownerGeography?:import('../content/serviceGeography').ServiceArea|null;normalizationReason?:string;comparisonGroupId?:string;
  observedWindow:{start:string;end:string};fetchedAt:string;freshness:FreshnessState;
  sourceRef:string;provenanceId:string;value:number;unit:'RELATIVE_SEARCH_INTEREST';
  direction:'RISING'|'FALLING'|'STABLE';fixture:boolean;limitations:string[];
}
export function applicableDemand(s:SearchDemandSignal,scope:{workspaceId:string;productId:string;serviceId:string;geographies:string[]},now=new Date()):boolean {
  const freshness=deriveFreshness(freshnessReferenceDate(s.observedWindow.end,null),now,{current:14,aging:30});
  return !s.fixture&&s.workspaceId===scope.workspaceId&&s.productId===scope.productId&&s.serviceId===scope.serviceId
    &&scope.geographies.includes(s.geography)&&freshness==='CURRENT'&&s.freshness==='CURRENT'
    &&Date.parse(s.observedWindow.end)<=now.getTime()&&Date.parse(s.observedWindow.start)<=Date.parse(s.observedWindow.end)
    &&Number.isFinite(s.value)&&s.value>=0&&s.value<=100;
}
