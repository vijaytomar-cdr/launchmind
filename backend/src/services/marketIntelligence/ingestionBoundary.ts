/**
 * @file ingestionBoundary.ts
 * @description The trust boundary between untrusted store output and a governed
 *   Market Intelligence source record.
 *
 *   WHAT THIS IS NOT: a prompt-injection solution. Nothing in a normalizer can
 *   guarantee that hostile text is harmless. The load-bearing controls are
 *   elsewhere and unchanged — evidence handles are SERVER-ISSUED per request so
 *   a model cannot mint one, authority is decided by the authenticated actor and
 *   is CHECK-constrained in migration 113, and every generated claim is
 *   re-validated against resolved evidence after generation.
 *
 *   What this layer does is narrow the blast radius: an allow-list of typed
 *   fields, hard length caps, and REJECTION of records whose text is shaped like
 *   an instruction. Rejecting the record — rather than stripping the offending
 *   words and keeping it — matters: a listing that tries to issue instructions
 *   is not a listing whose remaining fields deserve trust.
 *
 * @security Every exported function treats its input as hostile. No field
 *   reaches a source record unless it is named here.
 * @dependencies contract (pure), zod
 */

import { z } from 'zod';
import {
  STORE_LISTING_AUTHORITY, MARKET_INTELLIGENCE_POLICY_VERSION,
  deriveFreshness, freshnessReferenceDate, entityGroupKey,
  independenceKeyFor, publisherOfRecord, sourceContentHash, storeSubjectKey,
  statementIdentity, entityIdentityFor, publisherIdentity,
  type ObservationType, type SourceProvider, type FreshnessState,
} from './contract';

// ── The ONLY fields admitted from a store listing ───────────────────────────
// Reviews, review text, author names, developer contact details, support URLs
// and privacy-policy content are absent BY OMISSION. The strongest PII control
// available is not collecting the data.
export const RawStoreListingSchema = z.object({
  provider:    z.enum(['app_store', 'play_store']),
  storefront:  z.string().min(2).max(8),
  providerId:  z.string().min(1).max(200),
  sourceRef:   z.string().url().max(500),

  name:        z.string().min(1).max(200),
  developer:   z.string().min(1).max(200),
  /** Short positioning line. NOT the full description — see MAX_EXCERPT. */
  summary:     z.string().max(2000).nullable().optional(),
  category:    z.string().max(80).nullable().optional(),

  rating:      z.number().min(0).max(5).nullable().optional(),
  ratingCount: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  free:        z.boolean().nullable().optional(),

  /** When the listing was last updated at the store. The observation date. */
  updatedAt:   z.string().nullable().optional(),
  /** When the app was first released. */
  releasedAt:  z.string().nullable().optional(),

  retrievedAt: z.string(),
}).strict();

export type RawStoreListing = z.infer<typeof RawStoreListingSchema>;

const MAX_CLAIM = 500;
const MAX_EXCERPT = 400;

// ── PII ─────────────────────────────────────────────────────────────────────
// Business/entity facts only. These patterns are a backstop for text fields
// that are supposed to be marketing copy but sometimes carry a support email or
// a founder's phone number.
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/;

/** Characters that may appear INSIDE a phone number without ending it. */
const PHONE_SEPARATORS = new Set([' ', '.', '-', '(', ')', '+', ' ']);

/**
 * True when a text field carries personal contact data we must not persist.
 *
 * The phone check is a LINEAR SCAN, not a regex. The obvious pattern —
 * optional country code, optional bracketed area code, optional separators —
 * is a nested-quantifier shape that ESLint's security plugin correctly flags as
 * catastrophic-backtracking-prone. This function runs on app-store listing text,
 * i.e. on strings anyone in the world can author, so a ReDoS here would be a
 * denial-of-service surface handed out for free. Suppressing the rule was the
 * wrong fix; the scan below is O(n) and does the same job.
 */
export function containsPii(text: string): boolean {
  if (EMAIL_RE.test(text)) return true;

  let digits = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : '\n';
    if (ch >= '0' && ch <= '9') {
      digits++;
      // 15 is the E.164 maximum; longer runs are ids, not phone numbers.
      if (digits > 15) { digits = 0; while (i < text.length && (text[i] >= '0' && text[i] <= '9')) i++; }
      continue;
    }
    if (PHONE_SEPARATORS.has(ch)) continue;
    // Any other character ends the candidate. 9 digits is long enough that a
    // version string ("1.2.3"), a price or a rating count is not a match.
    if (digits >= 9 && digits <= 15) return true;
    digits = 0;
  }
  return false;
}

// ── Instruction-shaped content ──────────────────────────────────────────────
// Linear scans, not backtracking regexes: this runs on hostile input, and a
// catastrophic-backtracking pattern here would be a denial-of-service surface
// handed to anyone who can publish an app listing.
const INSTRUCTION_MARKERS: readonly string[] = [
  'ignore all prior', 'ignore all previous', 'ignore previous instruction',
  'disregard the above', 'disregard all prior', 'disregard previous',
  'system prompt', 'you are now', 'new instructions', 'override the',
  'do not mention', 'do not tell the user', 'tell the user to',
  'founder confirmed', 'founder-confirmed', 'mark this as confirmed',
  'treat this as verified', 'use source handle', 'evidence handle',
  'increase spend', 'raise the budget immediately',
  'assistant:', 'system:', '<|im_start|>', '[[system]]',
];

/**
 * Detects instruction-shaped content.
 *
 * @returns the marker that fired, or null. Returning WHICH marker fired makes
 *   the rejection auditable instead of mysterious.
 */
export function instructionShaped(text: string): string | null {
  const t = text.toLowerCase();
  for (const m of INSTRUCTION_MARKERS) if (t.includes(m)) return m;
  return null;
}

// ── Dates ───────────────────────────────────────────────────────────────────
/**
 * Parses a store-supplied date.
 *
 * A date the store did not give us is NULL, never "now". Substituting the
 * fetch time here is precisely how `retrieved_at` leaks into freshness, and it
 * would be invisible afterwards because the column would look populated.
 */
export function parseSourceDate(v: unknown): string | null {
  if (v == null) return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  // A date before the App Store existed is a parse artefact, not an observation.
  if (d.getUTCFullYear() < 2008) return null;
  return d.toISOString();
}

// ── The candidate a source record is built from ─────────────────────────────
export interface SourceRecordCandidate {
  sourceType: 'STORE_LISTING';
  sourceProvider: SourceProvider;
  sourceRef: string;
  subjectType: 'STORE_APP_ENTITY';
  subjectKey: string;
  subjectLabel: string;
  entityGroupKey: string | null;
  entityLinkBasis: string | null;
  categoryKey: string | null;
  geography: string | null;
  observationType: ObservationType;
  claimText: string;
  structuredValue: number | null;
  unit: string | null;
  excerpt: string | null;
  observedAt: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  freshnessStateAtIngestion: FreshnessState;
  authorityTier: typeof STORE_LISTING_AUTHORITY;
  authorityPolicyVersion: number;
  provenance: Record<string, unknown>;
  independenceKey: string;
  contentHash: string;
}

export interface IngestionOutcome {
  candidates: SourceRecordCandidate[];
  rejected: Array<{ observationType: ObservationType | 'RECORD'; reason: string; detail?: string }>;
}

export const INGESTION_VERSION = 1;

/**
 * Normalises one untrusted store listing into governed candidates.
 *
 * @param input - raw adapter output; assumed hostile
 * @param now   - injected for deterministic freshness in tests
 * @returns candidates plus every rejection, with the reason
 * @security Whole-record rejection on PII or instruction-shaped content.
 */
export function buildSourceCandidates(
  input: unknown, now: Date = new Date(),
): IngestionOutcome {
  const rejected: IngestionOutcome['rejected'] = [];

  const parsed = RawStoreListingSchema.safeParse(input);
  if (!parsed.success) {
    return { candidates: [], rejected: [{
      observationType: 'RECORD', reason: 'SCHEMA_REJECTED',
      detail: parsed.error.issues[0]?.message ?? 'invalid shape',
    }] };
  }
  const l = parsed.data;

  // Whole-record gates, applied to every free-text field that could carry them.
  for (const [field, value] of [['name', l.name], ['developer', l.developer],
    ['summary', l.summary ?? ''], ['category', l.category ?? '']] as const) {
    const marker = instructionShaped(value);
    if (marker) {
      return { candidates: [], rejected: [{
        observationType: 'RECORD', reason: 'INSTRUCTION_SHAPED_CONTENT',
        detail: `${field}: ${marker}`,
      }] };
    }
    if (containsPii(value)) {
      return { candidates: [], rejected: [{
        observationType: 'RECORD', reason: 'PII_PRESENT', detail: field,
      }] };
    }
  }

  const subjectKey = storeSubjectKey(l.provider, l.storefront, l.providerId);
  const group = entityGroupKey(l.name, l.developer);
  const observedAt = parseSourceDate(l.updatedAt);
  const publishedAt = parseSourceDate(l.releasedAt);
  const retrievedAt = parseSourceDate(l.retrievedAt) ?? new Date(now).toISOString();
  const freshness = deriveFreshness(freshnessReferenceDate(observedAt, publishedAt), now);
  const categoryKey = l.category ? l.category.trim().toLowerCase().slice(0, 80) : null;

  const push = (
    out: SourceRecordCandidate[], observationType: ObservationType,
    claimText: string, structuredValue: number | null, unit: string | null,
    excerpt: string | null,
  ) => {
    const claim = claimText.slice(0, MAX_CLAIM);
    const publisher = publisherOfRecord(observationType, l.developer, l.provider);
    out.push({
      sourceType: 'STORE_LISTING',
      sourceProvider: l.provider,
      sourceRef: l.sourceRef,
      subjectType: 'STORE_APP_ENTITY',
      subjectKey,
      subjectLabel: l.name.slice(0, 200),
      entityGroupKey: group?.key ?? null,
      entityLinkBasis: group?.basis ?? null,
      categoryKey,
      geography: l.storefront.toLowerCase(),
      observationType,
      claimText: claim,
      structuredValue,
      unit,
      excerpt: excerpt ? excerpt.slice(0, MAX_EXCERPT) : null,
      observedAt,
      publishedAt,
      retrievedAt,
      freshnessStateAtIngestion: freshness,
      authorityTier: STORE_LISTING_AUTHORITY,
      authorityPolicyVersion: MARKET_INTELLIGENCE_POLICY_VERSION,
      provenance: {
        provider: l.provider,
        fetch_method: 'store_public_listing',
        publisher_of_record: publisher,
        storefront: l.storefront,
        retrieved_at: retrievedAt,
        ingestion_version: INGESTION_VERSION,
      },
      // Identity for INDEPENDENCE is the STATEMENT, not the URL and not the
      // entity match. A developer's own fact published on both stores is ONE
      // statement; keying on subjectKey — or on an entity link that a legal-name
      // variant can break — would make it look like two sources agreeing.
      independenceKey: (() => {
        const entity = entityIdentityFor(l.name, subjectKey);
        return independenceKeyFor(
          publisherIdentity(observationType, l.provider, entity),
          observationType,
          statementIdentity(observationType, {
            excerpt, structuredValue, unit, categoryKey, observedAt,
            entityIdentity: entity,
          }));
      })(),
      contentHash: sourceContentHash({
        subjectKey, observationType, claimText: claim,
        structuredValue, unit, observedAt, publishedAt, sourceRef: l.sourceRef,
      }),
    });
  };

  const out: SourceRecordCandidate[] = [];

  if (l.summary && l.summary.trim()) {
    // The wording IS the fact for positioning, so a minimal attributed excerpt
    // is justified here and nowhere else. Never the full description.
    const excerpt = l.summary.trim().slice(0, MAX_EXCERPT);
    push(out, 'LISTING_POSITIONING',
      `${l.name} positions itself on its ${l.provider === 'app_store' ? 'App Store' : 'Play Store'} listing as: ${excerpt.slice(0, 300)}`,
      null, null, excerpt);
  }

  if (typeof l.rating === 'number') {
    push(out, 'LISTING_RATING',
      `${l.name} holds a ${l.rating.toFixed(2)} star public store rating.`,
      l.rating, 'stars', null);
  }

  if (typeof l.ratingCount === 'number') {
    push(out, 'LISTING_RATING_COUNT',
      `${l.name} has ${l.ratingCount} public store ratings.`,
      l.ratingCount, 'ratings', null);
  }

  if (typeof l.free === 'boolean') {
    push(out, 'LISTING_PRICE_TIER',
      `${l.name} is listed as ${l.free ? 'free to download' : 'paid'}.`,
      null, null, null);
  }

  if (categoryKey) {
    push(out, 'LISTING_CATEGORY',
      `${l.name} is listed in the ${categoryKey} category.`, null, null, null);
  }

  if (observedAt) {
    const days = Math.floor((now.getTime() - new Date(observedAt).getTime()) / 86_400_000);
    if (days >= 0) {
      push(out, 'LISTING_UPDATE_RECENCY',
        `${l.name} last updated its store listing ${days} day(s) before observation.`,
        days, 'days', null);
    }
  }

  if (out.length === 0) {
    rejected.push({ observationType: 'RECORD', reason: 'NO_ADMISSIBLE_OBSERVATION' });
  }
  return { candidates: out, rejected };
}
