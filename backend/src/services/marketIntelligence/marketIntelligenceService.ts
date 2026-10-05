/**
 * @file marketIntelligenceService.ts
 * @description Ingestion, resolution and lifecycle for governed Market
 *   Intelligence — Phase 3.4B, SHADOW ONLY.
 *
 *   THE SHAPE:
 *     ingestStoreListing()      untrusted listing  -> GLOBAL source records
 *     resolveForProduct()       global records     -> PRODUCT resolutions
 *     marketEvidenceHandles()   resolutions        -> handles the model may cite
 *
 *   The third function returns an EMPTY array in SHADOW, always, and records
 *   what it WOULD have returned. That is the entire owner-facing consequence of
 *   this milestone: nothing.
 *
 * @security Writes as service_role because both tables are server-only
 *   (migration 113). Every resolution is bound to a workspace and a product, and
 *   the composite FK makes a product/workspace mismatch unrepresentable.
 * @dependencies contract, ingestionBoundary, applicabilityPolicy, supabaseAdmin
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import {
  resolveMarketIntelligenceMode, lifecyclePermitsUse, lifecycleDisclosure,
  countIndependent, type MarketIntelligenceMode, type LifecycleState,
} from './contract';
import {
  buildSourceCandidates, type IngestionOutcome, type SourceRecordCandidate,
} from './ingestionBoundary';
import {
  resolveApplicability, type ProductSide, type ResolutionVerdict,
} from './applicabilityPolicy';

export interface SourceRecord {
  id: string;
  sourceProvider: string;
  sourceRef: string;
  subjectKey: string;
  subjectLabel: string | null;
  observationType: string;
  claimText: string;
  structuredValue: number | null;
  unit: string | null;
  observedAt: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  categoryKey: string | null;
  geography: string | null;
  authorityTier: string;
  independenceKey: string;
  lifecycleState: LifecycleState;
  entityGroupKey: string | null;
}

const SELECT = `id, source_provider, source_ref, subject_key, subject_label,
  observation_type, claim_text, structured_value, unit, observed_at, published_at,
  retrieved_at, category_key, geography, authority_tier, independence_key,
  lifecycle_state, entity_group_key`;

type Row = Record<string, unknown>;
const toRecord = (r: Row): SourceRecord => ({
  id: String(r.id),
  sourceProvider: String(r.source_provider),
  sourceRef: String(r.source_ref),
  subjectKey: String(r.subject_key),
  subjectLabel: (r.subject_label as string) ?? null,
  observationType: String(r.observation_type),
  claimText: String(r.claim_text),
  structuredValue: r.structured_value == null ? null : Number(r.structured_value),
  unit: (r.unit as string) ?? null,
  observedAt: (r.observed_at as string) ?? null,
  publishedAt: (r.published_at as string) ?? null,
  retrievedAt: String(r.retrieved_at),
  categoryKey: (r.category_key as string) ?? null,
  geography: (r.geography as string) ?? null,
  authorityTier: String(r.authority_tier),
  independenceKey: String(r.independence_key),
  lifecycleState: r.lifecycle_state as LifecycleState,
  entityGroupKey: (r.entity_group_key as string) ?? null,
});

export interface IngestResult {
  mode: MarketIntelligenceMode;
  records: SourceRecord[];
  /** Candidates that resolved to an EXISTING row rather than a new one. */
  deduped: number;
  rejected: IngestionOutcome['rejected'];
}

/**
 * Ingests one untrusted store listing into the GLOBAL source table.
 *
 * @param raw - adapter output, treated as hostile
 * @param now - injected for deterministic freshness
 * @returns the persisted records plus every rejection and its reason
 * @throws never for a single bad record — a rejection is data, not an outage
 * @security Provenance is required by the table; a candidate without it cannot
 *   be written, so "missing provenance rejected" is enforced twice.
 */
export async function ingestStoreListing(
  raw: unknown, now: Date = new Date(),
): Promise<IngestResult> {
  const mode = resolveMarketIntelligenceMode();
  const { candidates, rejected } = buildSourceCandidates(raw, now);
  if (mode === 'OFF' || candidates.length === 0) {
    return { mode, records: [], deduped: 0, rejected };
  }

  const db = getSupabaseAdmin();
  const records: SourceRecord[] = [];
  let deduped = 0;

  for (const c of candidates) {
    // Global dedup FIRST. Re-reading an unchanged listing must resolve to the
    // same row: minting a second one would manufacture corroboration out of a
    // repeated fetch, which is exactly what independence counting must not see.
    const { data: existing } = await db
      .from('market_intelligence_source_records')
      .select(SELECT).eq('content_hash', c.contentHash).maybeSingle();
    if (existing) { records.push(toRecord(existing as Row)); deduped++; continue; }

    const { data, error } = await db
      .from('market_intelligence_source_records')
      .insert(rowFor(c, mode)).select(SELECT).single();

    if (error) {
      // A CHECK violation here is the schema refusing something the boundary let
      // through. That is a finding, not a thing to swallow.
      rejected.push({
        observationType: c.observationType, reason: 'DB_REJECTED', detail: error.message,
      });
      Sentry.captureException(new Error(`market intelligence insert rejected: ${error.message}`),
        { tags: { service: 'marketIntelligence' } });
      continue;
    }
    records.push(toRecord(data as Row));
  }

  return { mode, records, deduped, rejected };
}

function rowFor(c: SourceRecordCandidate, mode: MarketIntelligenceMode) {
  return {
    source_type: c.sourceType,
    source_provider: c.sourceProvider,
    source_ref: c.sourceRef,
    subject_type: c.subjectType,
    subject_key: c.subjectKey,
    subject_label: c.subjectLabel,
    entity_group_key: c.entityGroupKey,
    entity_link_basis: c.entityLinkBasis,
    category_key: c.categoryKey,
    geography: c.geography,
    observation_type: c.observationType,
    claim_text: c.claimText,
    structured_value: c.structuredValue,
    unit: c.unit,
    excerpt: c.excerpt,
    observed_at: c.observedAt,
    published_at: c.publishedAt,
    retrieved_at: c.retrievedAt,
    freshness_state_at_ingestion: c.freshnessStateAtIngestion,
    authority_tier: c.authorityTier,
    authority_policy_version: c.authorityPolicyVersion,
    provenance: c.provenance,
    independence_key: c.independenceKey,
    content_hash: c.contentHash,
    ingestion_mode: mode === 'OFF' ? 'SHADOW' : mode,
  };
}

// ── RESOLUTION ──────────────────────────────────────────────────────────────

export interface ResolutionRequest {
  workspaceId: string;
  productId: string | null;
  contextPackageId?: string | null;
  product: ProductSide;
  /** Subject keys to consider. Derived from the owner's confirmed set. */
  subjectKeys: readonly string[];
}

export interface ResolvedItem {
  record: SourceRecord;
  verdict: ResolutionVerdict;
  resolutionId: string | null;
  lifecycleNote: string | null;
}

/**
 * Resolves every candidate source record against ONE product, and persists the
 * verdict so an operator can inspect what shadow decided.
 *
 * Global storage never implies global applicability: a record only becomes
 * usable HERE by earning an APPLICABLE verdict HERE.
 *
 * @security Reads are by subject_key, never by workspace — the global table has
 *   no workspace column. Isolation lives on the resolution row, which carries a
 *   composite FK to (product_id, workspace_id).
 */
export async function resolveForProduct(
  req: ResolutionRequest, now: Date = new Date(),
): Promise<{ mode: MarketIntelligenceMode; items: ResolvedItem[] }> {
  const mode = resolveMarketIntelligenceMode();
  if (mode === 'OFF' || req.subjectKeys.length === 0) return { mode, items: [] };

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('market_intelligence_source_records')
    .select(SELECT)
    .in('subject_key', [...req.subjectKeys]);

  if (error) throw new Error(`market intelligence read failed: ${error.message}`);

  const items: ResolvedItem[] = [];
  for (const row of (data ?? []) as Row[]) {
    const record = toRecord(row);
    const verdict = resolveApplicability({
      subjectKey: record.subjectKey,
      lifecycleState: record.lifecycleState,
      observedAt: record.observedAt,
      publishedAt: record.publishedAt,
      dims: { category: record.categoryKey, geography: record.geography },
    }, req.product, now);

    const { data: res, error: resErr } = await db
      .from('market_intelligence_resolutions')
      .insert({
        source_record_id: record.id,
        workspace_id: req.workspaceId,
        product_id: req.productId,
        context_package_id: req.contextPackageId ?? null,
        subject_relation: verdict.subjectRelation,
        applicability: verdict.applicability,
        reason: verdict.reason,
        dimensions: verdict.dimensions,
        freshness_at_resolution: verdict.freshnessAtResolution,
        evidence_handle_eligible: verdict.evidenceHandleEligible,
        ineligible_reason: verdict.ineligibleReason,
        mode,
      }).select('id').single();

    if (resErr) throw new Error(`market intelligence resolution failed: ${resErr.message}`);

    items.push({
      record, verdict,
      resolutionId: (res as { id: string }).id,
      lifecycleNote: lifecycleDisclosure(record.lifecycleState),
    });
  }
  return { mode, items };
}

// ── EVIDENCE HANDLES — the owner-facing boundary ────────────────────────────

export interface MarketEvidenceHandle {
  ref: string;
  kind: 'MARKET_INTELLIGENCE';
  label: string;
  text: string;
  authority: string;
  detail: string;
}

export interface HandleDecision {
  mode: MarketIntelligenceMode;
  /** What the model may cite. EMPTY in SHADOW, by contract. */
  handles: MarketEvidenceHandle[];
  /** What ACTIVE would have offered. Recorded, never returned to the model. */
  wouldBeHandles: MarketEvidenceHandle[];
  marketIntelligenceAvailable: boolean;
}

/**
 * The one place Market Intelligence could ever reach owner reasoning.
 *
 * In SHADOW it returns nothing and records what it would have returned. There
 * is deliberately no flag, override or env var that makes this function emit a
 * handle in SHADOW — `resolveMarketIntelligenceMode` refuses ACTIVE outright, so
 * turning it on requires editing code, not configuration.
 *
 * `marketIntelligenceAvailable` is computed HERE, per product per generation,
 * from what actually resolved — never from "the subsystem exists" or "the table
 * is non-empty".
 */
export function marketEvidenceHandles(items: readonly ResolvedItem[]): HandleDecision {
  const mode = resolveMarketIntelligenceMode();

  const wouldBe: MarketEvidenceHandle[] = items
    .filter(i => i.verdict.evidenceHandleEligible && lifecyclePermitsUse(i.record.lifecycleState))
    .map((i, n) => ({
      ref: `mi${n + 1}`,
      kind: 'MARKET_INTELLIGENCE' as const,
      label: `Public store listing — ${i.record.subjectLabel ?? i.record.subjectKey}`,
      text: i.record.claimText,
      authority: i.record.authorityTier,
      detail: `${i.record.sourceProvider} · observed ${i.record.observedAt ?? 'date unknown'}`,
    }));

  if (mode === 'ACTIVE') {
    // Unreachable: resolveMarketIntelligenceMode() throws on ACTIVE. Kept so the
    // shape of 3.4C is visible and so this branch has to be deliberately
    // enabled rather than accidentally reached.
    return { mode, handles: wouldBe, wouldBeHandles: wouldBe, marketIntelligenceAvailable: wouldBe.length > 0 };
  }
  return { mode, handles: [], wouldBeHandles: wouldBe, marketIntelligenceAvailable: false };
}

// ── INDEPENDENCE + CONFLICT ─────────────────────────────────────────────────

export interface ConflictReport {
  observationType: string;
  subjectKey: string;
  conflicting: Array<{ recordId: string; value: number; unit: string | null; observedAt: string | null; publisherKey: string }>;
  independentSources: number;
  resolution: 'PRESERVE_BOTH_DISAGREEMENT';
  ownerStatement: string;
}

/** Relative gap above which two numbers are a real disagreement, not noise. */
const MATERIAL_GAP = 0.05;

/**
 * Detects disagreement between INDEPENDENT external observations.
 *
 * Never averages, never prefers the newer, never prefers the one that suits a
 * recommendation. Two credible sources disagreeing is information about
 * uncertainty, and flattening it to one number destroys exactly that.
 *
 * Records sharing an independence key are the SAME statement and are compared
 * as one — mirrored publisher copy cannot conflict with itself.
 */
export function detectExternalConflicts(items: readonly ResolvedItem[]): ConflictReport[] {
  const groups = new Map<string, ResolvedItem[]>();
  for (const i of items) {
    if (i.verdict.applicability !== 'APPLICABLE') continue;
    if (!lifecyclePermitsUse(i.record.lifecycleState)) continue;
    if (i.record.structuredValue == null) continue;
    const k = `${i.record.subjectKey}::${i.record.observationType}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }

  const out: ConflictReport[] = [];
  for (const [key, group] of groups) {
    // One statement per independence key. The first is representative; a second
    // copy of the same publisher's claim adds no independent measurement.
    const byIndependence = new Map<string, ResolvedItem>();
    for (const i of group) if (!byIndependence.has(i.record.independenceKey)) byIndependence.set(i.record.independenceKey, i);
    const distinct = [...byIndependence.values()];
    if (distinct.length < 2) continue;

    const values = distinct.map(i => i.record.structuredValue as number);
    const min = Math.min(...values), max = Math.max(...values);
    const base = Math.max(Math.abs(min), 1e-9);
    if ((max - min) / base <= MATERIAL_GAP) continue;

    const [subjectKey, observationType] = key.split('::');
    out.push({
      observationType, subjectKey,
      conflicting: distinct.map(i => ({
        recordId: i.record.id, value: i.record.structuredValue as number,
        unit: i.record.unit, observedAt: i.record.observedAt,
        publisherKey: i.record.independenceKey,
      })),
      independentSources: countIndependent(distinct.map(i => i.record.independenceKey)),
      resolution: 'PRESERVE_BOTH_DISAGREEMENT',
      ownerStatement:
        `Independent public sources disagree on ${observationType.toLowerCase().replace(/_/g, ' ')}: ` +
        distinct.map(i => `${i.record.structuredValue}${i.record.unit ? ' ' + i.record.unit : ''} (${i.record.sourceProvider}, observed ${i.record.observedAt ?? 'date unknown'})`).join(' vs ') +
        '. LaunchMind is not choosing between them.',
    });
  }
  return out;
}

// ── LIFECYCLE ───────────────────────────────────────────────────────────────

/**
 * Moves a source record's lifecycle state.
 *
 * The observation itself is immutable (migration 113 trigger), and no
 * recommendation snapshot is touched. A retraction changes what LaunchMind may
 * use GOING FORWARD and what provenance discloses — it never rewrites what was
 * recommended, or why, at the time.
 */
export async function setSourceLifecycle(
  sourceRecordId: string, state: LifecycleState,
  opts: { reason?: string; supersededBy?: string } = {},
): Promise<SourceRecord> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('market_intelligence_source_records')
    .update({
      lifecycle_state: state,
      lifecycle_reason: opts.reason ?? null,
      superseded_by: opts.supersededBy ?? null,
      // ERASED removes the content but keeps the reference and the audit trail.
      ...(state === 'ERASED' ? { claim_text: '[erased]', excerpt: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceRecordId).select(SELECT).single();

  if (error) throw new Error(`lifecycle transition failed: ${error.message}`);
  return toRecord(data as Row);
}
