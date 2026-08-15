/**
 * @file contextPackageV2.ts
 * @description ContextPackage V2 — structured authoritative context + targeted
 *   memory retrieval + persisted provenance. Phase 3.1E.
 *
 *   WHAT CHANGED FROM V1, and why it is not simply "delete the old thing":
 *
 *     V1 read ten tables and returned the top-5 memories by CONFIDENCE,
 *     identically for every question. Measured in 3.1A: 18.8% Recall@5, 93.1%
 *     irrelevant. It also stripped identity — a memory reached the model as
 *     {type, title, confidence, content} with no id and no version, so no output
 *     could ever be traced back to what produced it.
 *
 *     V2 keeps NINE of those ten reads exactly as they were, because they are
 *     authoritative CURRENT STATE and deterministic retrieval is the right tool
 *     for them. Only `marketing_memories` — the one source that is history
 *     rather than state — moves to the hybrid RetrievalService.
 *
 *   THE PACKAGE IS STRUCTURED DATA, NOT A STRING. Formatting for a model happens
 *   afterwards in contextFormatter.ts, once, so domain services cannot each
 *   invent their own memory prompt dialect.
 *
 *   FOUNDER CONTEXT AND RETRIEVED MEMORY ARE SEPARATE FIELDS and are never
 *   merged. If the founder says the audience is X and an older inference says Y,
 *   the package carries both, labelled — blending them into one sentence would
 *   destroy the distinction the whole precedence rule depends on (§10).
 *
 * @security READ PATH ONLY. No memory mutation, no supersession, no confidence
 *   change, no learning events (§25). Enforced structurally by
 *   contextEngineNoWrite tests.
 * @dependencies retrievalService, contextIntents, context_packages
 */

import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../supabaseAdmin';
import { newTraceId } from '../traceId';
import { retrieveMemories } from '../../services/memory/retrievalService';
import type { RetrievedMemory, RetrievalMode } from '../../services/memory/retrievalTypes';
import { estimateTokens } from '../../services/memory/retrievalTypes';
import {
  INTENT_POLICIES, statusesFor, type ContextIntent,
} from './contextIntents';

// ── Contract ─────────────────────────────────────────────────────────────────

/** Current, authoritative state. Deterministic — never retrieved by similarity. */
export interface AuthoritativeContext {
  workspaceId: string;
  productId: string | null;
  productName: string | null;
  category: string | null;
  markets: string[];
  plan: string;
  tokenBalance: number | null;
}

/** What the OWNER has said. Outranks anything inferred (ADR-066 rule 28). */
export interface FounderConfirmedContext {
  audienceConfirmed: string | null;
  contextDelta: string | null;
  workingStyle: string | null;
  primaryGoal: string | null;
  nextInitiative: string | null;
  targetWindow: string | null;
  confirmedIcp: Record<string, unknown> | null;
  competitors: Array<{ name: string; relationship: string; differentiator: string | null }>;
  strategyDirection: Record<string, unknown> | null;
}

/** What is happening right now. Also deterministic. */
export interface OperationalContext {
  activeCampaigns: Array<{ id: string; channel: string; market: string; status: string }>;
  recentMetrics: Array<{ channel: string; installs: number; cpi: number | null; weekStart: string }>;
  knowledgeNodes: Array<{ type: string; label: string; confidence: number }>;
}

/** How retrieval went, persisted so a thin package can be explained later. */
export interface RetrievalMetadata {
  mode: RetrievalMode;
  degraded: boolean;
  degradedReasons: string[];
  /** Distinguishes the three ways a package can hold no memory (§16). */
  memoryOutcome: 'selected' | 'none_relevant' | 'retrieval_failed' | 'excluded_by_budget';
  memoriesConsidered: number;
  memoriesSelected: number;
  excludedForBudget: number;
  query: string;
}

export interface ContextPackageV2 {
  /** Null when the package was not persisted (diagnostic builds). */
  id: string | null;
  workspaceId: string;
  productId: string | null;
  founderId: string;
  contextType: ContextIntent;
  createdAt: string;
  traceId: string;

  authoritative: AuthoritativeContext;
  founderContext: FounderConfirmedContext;
  /** Full provenance retained — id, version, hash, arms, ranks (§3). */
  retrievedMemories: RetrievedMemory[];
  operational: OperationalContext;

  retrieval: RetrievalMetadata;
  budget: { total: number; used: number; memoryBudget: number; memoryUsed: number };
  buildMs: number;
}

export interface BuildOptions {
  workspaceId: string;
  founderId: string;
  productId?: string | null;
  intent: ContextIntent;
  /** Retrieval query. Owner text or a task-derived phrase — never a system prompt. */
  query: string;
  traceId?: string;
  /** Diagnostic builds skip persistence. */
  persist?: boolean;
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * Builds a ContextPackage V2.
 *
 * Every section is fetched concurrently and every one is non-fatal: a failure in
 * an optional source degrades the package rather than failing the caller's
 * Morning Brief (§15).
 *
 * @returns A structured package. Never throws for a data-source failure.
 */
export async function buildContextPackageV2(opts: BuildOptions): Promise<ContextPackageV2> {
  const started = Date.now();
  const db = getSupabaseAdmin();
  const traceId = opts.traceId ?? newTraceId();
  const policy = INTENT_POLICIES[opts.intent];
  const productId = opts.productId ?? null;

  const [
    founderRes, productRes, founderCtxRes, goalRes, competitorsRes,
    directionRes, campaignsRes, nodesRes, retrieval,
  ] = await Promise.all([
    db.from('founders').select('plan, token_balance').eq('id', opts.founderId).maybeSingle(),
    productId
      ? db.from('products').select('id, name, category, markets, confirmed_icp').eq('id', productId).maybeSingle()
      : Promise.resolve({ data: null }),
    // Merged across rows WITHIN ONE BUSINESS: the delta editor writes a
    // session-less row while onboarding writes a session row, and taking only
    // the newest loses one of them — the bug found in Step 7. Scoping by
    // workspace keeps that merge while stopping it at the business boundary;
    // merging founder-wide would blend AllignX's positioning with LaunchMind's
    // into context belonging to neither.
    db.from('founder_context')
      .select('audience_confirmed, context_delta, working_style, primary_goal, next_initiative, target_window, updated_at')
      .eq('workspace_id', opts.workspaceId).order('updated_at', { ascending: false }),
    // business_goals and competitor_relationships carry product_id, so the
    // product IS the scope. With no product in scope they return nothing: a
    // goal from the founder's other business is worse than no goal.
    productId
      ? db.from('business_goals').select('goal_type, target_value, unit, time_horizon_days')
          .eq('product_id', productId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    productId
      ? db.from('competitor_relationships').select('name, relationship, key_differentiator')
          .eq('product_id', productId).limit(10)
      : Promise.resolve({ data: [] }),
    productId ? db.from('strategy_directions').select('*')
      .eq('founder_id', opts.founderId).eq('product_id', productId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    productId
      ? db.from('campaigns').select('id, channel, market, status')
          .eq('product_id', productId).in('status', ['launched', 'approved', 'scheduled']).limit(10)
      : Promise.resolve({ data: [] }),
    productId
      ? db.from('knowledge_nodes').select('node_type, label, confidence')
          .eq('workspace_id', opts.workspaceId).order('confidence', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),

    // The ONE source that moved: marketing history, retrieved by relevance.
    retrieveMemories({
      workspaceId: opts.workspaceId,
      productId: productId ?? undefined,
      query: opts.query,
      memoryTypes: policy.memoryTypes.length ? policy.memoryTypes : undefined,
      statuses: statusesFor(opts.intent),
      limit: policy.finalLimit,
      tokenBudget: policy.memoryTokenBudget,
      contextType: opts.intent,
    }).catch((): null => null),
  ]);

  // campaign_metrics carries only campaign_id and founder_id — no product and no
  // workspace — so the campaigns above ARE its scope. Fetched second rather than
  // in the batch on purpose: filtering founder-wide metrics down afterwards
  // would let another business's rows consume the limit and return an empty
  // result for the business actually being asked about.
  const scopedCampaignIds = ((campaignsRes as { data?: Array<{ id?: string }> }).data ?? [])
    .map(c => c.id).filter((id): id is string => typeof id === 'string');
  const metricsRes = scopedCampaignIds.length
    ? await db.from('campaign_metrics').select('installs, cpi, week_start, campaign_id')
        .in('campaign_id', scopedCampaignIds)
        .order('collected_at', { ascending: false }).limit(10)
    : { data: [] };

  const founderRow = (founderRes as { data?: { plan?: string; token_balance?: number | null } }).data;
  const productRow = (productRes as { data?: Record<string, unknown> | null }).data ?? null;

  const authoritative: AuthoritativeContext = {
    workspaceId: opts.workspaceId,
    productId,
    productName: (productRow?.name as string) ?? null,
    category: (productRow?.category as string) ?? null,
    markets: (productRow?.markets as string[]) ?? [],
    plan: founderRow?.plan ?? 'free',
    tokenBalance: founderRow?.token_balance ?? null,
  };

  // Merge founder_context rows, newest non-null wins per field.
  const ctxRows = ((founderCtxRes as { data?: Array<Record<string, unknown>> }).data ?? []);
  const pick = (field: string): string | null => {
    for (const row of ctxRows) {
      const v = row[field];
      if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
    }
    return null;
  };
  const goal = (goalRes as { data?: Record<string, unknown> | null }).data ?? null;

  const founderContext: FounderConfirmedContext = {
    audienceConfirmed: pick('audience_confirmed'),
    contextDelta:      pick('context_delta'),
    workingStyle:      pick('working_style'),
    primaryGoal:       pick('primary_goal') ?? (goal ? `${goal.goal_type}: ${goal.target_value} ${goal.unit}` : null),
    nextInitiative:    pick('next_initiative'),
    targetWindow:      pick('target_window'),
    confirmedIcp:      (productRow?.confirmed_icp as Record<string, unknown>) ?? null,
    competitors: ((competitorsRes as { data?: Array<Record<string, unknown>> }).data ?? [])
      .map(c => ({ name: String(c.name), relationship: String(c.relationship),
                   differentiator: (c.key_differentiator as string) ?? null })),
    strategyDirection: (directionRes as { data?: Record<string, unknown> | null }).data ?? null,
  };

  const operational: OperationalContext = {
    activeCampaigns: ((campaignsRes as { data?: Array<Record<string, unknown>> }).data ?? [])
      .map(c => ({ id: String(c.id), channel: String(c.channel), market: String(c.market), status: String(c.status) })),
    recentMetrics: ((metricsRes as { data?: Array<Record<string, unknown>> }).data ?? [])
      .map(m => ({ channel: 'n/a', installs: Number(m.installs ?? 0),
                   cpi: m.cpi === null ? null : Number(m.cpi), weekStart: String(m.week_start) })),
    knowledgeNodes: ((nodesRes as { data?: Array<Record<string, unknown>> }).data ?? [])
      .map(n => ({ type: String(n.node_type), label: String(n.label), confidence: Number(n.confidence) })),
  };

  // Retrieval outcome. The three empty cases are distinguished, not conflated.
  const memories = retrieval?.results ?? [];
  let memoryOutcome: RetrievalMetadata['memoryOutcome'];
  if (!retrieval)                              memoryOutcome = 'retrieval_failed';
  else if (memories.length > 0)                memoryOutcome = 'selected';
  else if (retrieval.mode === 'FAILED')        memoryOutcome = 'retrieval_failed';
  else if (retrieval.excludedForBudget > 0)    memoryOutcome = 'excluded_by_budget';
  else                                         memoryOutcome = 'none_relevant';

  const memoryUsed = memories.reduce((a, m) => a + estimateTokens(`${m.title} ${m.claim ?? ''}`), 0);

  const pkg: ContextPackageV2 = {
    id: null,
    workspaceId: opts.workspaceId,
    productId,
    founderId: opts.founderId,
    contextType: opts.intent,
    createdAt: new Date().toISOString(),
    traceId,
    authoritative,
    founderContext,
    retrievedMemories: memories,
    operational,
    retrieval: {
      mode: retrieval?.mode ?? 'FAILED',
      degraded: retrieval?.degraded ?? true,
      degradedReasons: retrieval?.degradedReasons ?? ['retrieval threw'],
      memoryOutcome,
      memoriesConsidered: retrieval?.diagnostics.fusedCandidates ?? 0,
      memoriesSelected: memories.length,
      excludedForBudget: retrieval?.excludedForBudget ?? 0,
      query: opts.query,
    },
    budget: {
      total: policy.totalTokenBudget, used: 0,
      memoryBudget: policy.memoryTokenBudget, memoryUsed,
    },
    buildMs: Date.now() - started,
  };

  if (opts.persist !== false) {
    pkg.id = await persistPackage(pkg).catch((e) => {
      // Provenance is important, but losing it must not fail an owner's brief.
      Sentry.captureException(e, { tags: { service: 'contextPackageV2', fn: 'persist' } });
      return null;
    });
  }

  return pkg;
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Writes the package and its items.
 *
 * Stores REFERENCES ONLY — id, version, content_hash, evidence ids. No memory
 * prose is duplicated (ADR-066 rule 22).
 *
 * @returns The persisted package id.
 */
async function persistPackage(pkg: ContextPackageV2): Promise<string> {
  const db = getSupabaseAdmin();
  const policy = INTENT_POLICIES[pkg.contextType];

  const { data: ttlRow } = await db.from('context_retention_classes')
    .select('ttl_days').eq('name', policy.retention).maybeSingle();
  const ttlDays = (ttlRow as { ttl_days: number | null } | null)?.ttl_days ?? null;

  const { data, error } = await db.from('context_packages').insert({
    workspace_id: pkg.workspaceId,
    product_id:   pkg.productId,
    founder_id:   pkg.founderId,
    context_type: pkg.contextType,
    retention_class: policy.retention,
    retrieval_mode:  pkg.retrieval.mode,
    degraded:        pkg.retrieval.degraded,
    degraded_reasons: pkg.retrieval.degradedReasons,
    memory_outcome:  pkg.retrieval.memoryOutcome,
    memories_considered: pkg.retrieval.memoriesConsidered,
    memories_selected:   pkg.retrieval.memoriesSelected,
    excluded_for_budget: pkg.retrieval.excludedForBudget,
    token_budget: pkg.budget.total,
    tokens_used:  pkg.budget.memoryUsed,
    build_ms:     pkg.buildMs,
    trace_id:     pkg.traceId,
    expires_at:   ttlDays === null ? null : new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
  }).select('id').single();

  if (error || !data) throw error ?? new Error('context package insert returned no id');
  const packageId = (data as { id: string }).id;

  const items = pkg.retrievedMemories.map((m, i) => ({
    context_package_id: packageId,
    workspace_id: pkg.workspaceId,
    item_type: 'marketing_memory',
    source_id: m.id,
    source_version: m.version,
    content_hash: m.contentHash,
    evidence_ids: m.evidenceIds,
    inclusion_reason: 'retrieved',
    retrieval_arms: m.arms,
    lexical_rank: m.lexicalRank,
    semantic_rank: m.semanticRank,
    fused_rank: m.fusedRank,
    final_rank: m.finalRank,
    position: i + 1,
    estimated_tokens: estimateTokens(`${m.title} ${m.claim ?? ''}`),
  }));

  // The authoritative and founder sections are recorded as items too, so a
  // reconstruction can show that founder context WAS present — not merely that
  // some memories were.
  let position = items.length;
  if (pkg.productId) {
    items.push({
      context_package_id: packageId, workspace_id: pkg.workspaceId,
      item_type: 'product', source_id: pkg.productId, source_version: null,
      content_hash: null, evidence_ids: [], inclusion_reason: 'authoritative',
      retrieval_arms: [], lexical_rank: null, semantic_rank: null,
      fused_rank: null, final_rank: null, position: ++position, estimated_tokens: 0,
    } as never);
  }
  if (pkg.founderContext.audienceConfirmed || pkg.founderContext.contextDelta || pkg.founderContext.primaryGoal) {
    items.push({
      context_package_id: packageId, workspace_id: pkg.workspaceId,
      item_type: 'founder_context', source_id: null, source_version: null,
      content_hash: null, evidence_ids: [], inclusion_reason: 'founder_confirmed',
      retrieval_arms: [], lexical_rank: null, semantic_rank: null,
      fused_rank: null, final_rank: null, position: ++position, estimated_tokens: 0,
    } as never);
  }

  if (items.length > 0) {
    const { error: itemErr } = await db.from('context_package_items').insert(items);
    if (itemErr) throw itemErr;
  }

  return packageId;
}

// ── Reconstruction (§21) ─────────────────────────────────────────────────────

export interface ReconstructedItem {
  itemType: string;
  sourceId: string | null;
  recordedVersion: number | null;
  recordedHash: string | null;
  position: number;
  /**
   * available   — the exact version used is recoverable (current row OR the
   *               historical snapshot in marketing_memory_versions)
   * changed     — the source exists and has moved on, and no historical snapshot
   *               was recorded, so what the model saw cannot be reproduced
   * deleted     — the source no longer exists at all
   * purged      — removed under a legal erasure; audit metadata only
   */
  availability: 'available' | 'changed' | 'deleted' | 'purged';
  currentTitle: string | null;
  currentVersion: number | null;
  /** The record AS IT WAS when the package was built. Null when unrecoverable. */
  historical: {
    title: string;
    content: Record<string, unknown>;
    confidence: number;
    status: string;
    memoryType: string | null;
    evidenceIds: string[];
    contentHash: string | null;
  } | null;
  /** Where `historical` came from — 'current' when the row never changed. */
  historicalSource: 'current' | 'version_snapshot' | null;
}

export interface ReconstructedPackage {
  id: string;
  contextType: string;
  createdAt: string;
  retrievalMode: string;
  memoryOutcome: string;
  degraded: boolean;
  items: ReconstructedItem[];
  /** True when every referenced source is still available AND unchanged. */
  fullyReconstructible: boolean;
}

/**
 * Answers "what context did LaunchMind use when it produced this?"
 *
 * Reports each source as available / changed / deleted rather than substituting
 * today's version. Silently returning current memory would make the audit trail
 * actively misleading — it would show a decision as based on evidence that did
 * not exist when the decision was made.
 *
 * @param packageId  The package to reconstruct.
 * @param workspaceId Verified by the caller; re-applied as a hard filter.
 */
export async function reconstructContextPackage(
  packageId: string,
  workspaceId: string,
): Promise<ReconstructedPackage | null> {
  const db = getSupabaseAdmin();

  const { data: pkgRow } = await db.from('context_packages')
    .select('*').eq('id', packageId).eq('workspace_id', workspaceId).maybeSingle();
  if (!pkgRow) return null;
  const p = pkgRow as Record<string, unknown>;

  const { data: itemRows } = await db.from('context_package_items')
    .select('*').eq('context_package_id', packageId).eq('workspace_id', workspaceId)
    .order('position', { ascending: true });

  const items = (itemRows ?? []) as Array<Record<string, unknown>>;
  const memoryIds = items.filter(i => i.item_type === 'marketing_memory' && i.source_id)
                         .map(i => String(i.source_id));

  type CurrentRow = {
    id: string; title: string; version: number; content: Record<string, unknown>;
    confidence: number; status: string; memory_type: string; evidence_ids: string[] | null;
  };
  type VersionRow = {
    memory_id: string; version: number; title: string | null;
    content: Record<string, unknown>; confidence: number; status: string | null;
    memory_type: string | null; evidence_ids: string[] | null; content_hash: string | null;
  };

  const currentById = new Map<string, CurrentRow>();
  const hashById = new Map<string, string | null>();
  /** Historical snapshots, keyed `${memoryId}:${version}`. */
  const versionByKey = new Map<string, VersionRow>();

  if (memoryIds.length > 0) {
    const [{ data: mems }, { data: embs }, { data: vers }] = await Promise.all([
      db.from('marketing_memories')
        .select('id, title, version, content, confidence, status, memory_type, evidence_ids')
        .in('id', memoryIds).eq('workspace_id', workspaceId),
      db.from('memory_embeddings')
        .select('source_id, content_hash').in('source_id', memoryIds).eq('workspace_id', workspaceId),
      // Gate 0.5 (3.1F): the historical snapshots. Without these, an updated
      // memory could only ever be reported as `changed`, and LaunchMind could
      // not show what a model was actually given.
      db.from('marketing_memory_versions')
        .select('memory_id, version, title, content, confidence, status, memory_type, evidence_ids, content_hash')
        .in('memory_id', memoryIds).eq('workspace_id', workspaceId),
    ]);

    for (const m of (mems ?? []) as CurrentRow[]) currentById.set(m.id, m);
    for (const e of (embs ?? []) as Array<{ source_id: string; content_hash: string }>) {
      hashById.set(e.source_id, e.content_hash);
    }
    for (const v of (vers ?? []) as VersionRow[]) versionByKey.set(`${v.memory_id}:${v.version}`, v);
  }

  const reconstructed: ReconstructedItem[] = items.map(i => {
    const sid = i.source_id ? String(i.source_id) : null;
    const cur = sid ? currentById.get(sid) : undefined;
    const recordedHash = (i.content_hash as string) ?? null;
    const recordedVersion = (i.source_version as number) ?? null;

    // Non-memory items carry no version chain; their presence is the record.
    if (i.item_type !== 'marketing_memory') {
      return {
        itemType: String(i.item_type), sourceId: sid, recordedVersion, recordedHash,
        position: Number(i.position), availability: 'available' as const,
        currentTitle: null, currentVersion: null, historical: null, historicalSource: null,
      };
    }

    if (!sid || !cur) {
      // Gone entirely. Reported, never invented (§23).
      return {
        itemType: 'marketing_memory', sourceId: sid, recordedVersion, recordedHash,
        position: Number(i.position), availability: 'deleted' as const,
        currentTitle: null, currentVersion: null, historical: null, historicalSource: null,
      };
    }

    // Unchanged: the current row IS what the model saw.
    const hashMatches = !recordedHash || !hashById.get(sid) || hashById.get(sid) === recordedHash;
    if (cur.version === recordedVersion && hashMatches) {
      return {
        itemType: 'marketing_memory', sourceId: sid, recordedVersion, recordedHash,
        position: Number(i.position), availability: 'available' as const,
        currentTitle: cur.title, currentVersion: cur.version,
        historical: {
          title: cur.title, content: cur.content, confidence: Number(cur.confidence),
          status: cur.status, memoryType: cur.memory_type,
          evidenceIds: cur.evidence_ids ?? [], contentHash: recordedHash,
        },
        historicalSource: 'current' as const,
      };
    }

    // Moved on. Recover the exact version from the append-only snapshot chain.
    const snap = recordedVersion !== null ? versionByKey.get(`${sid}:${recordedVersion}`) : undefined;
    if (snap) {
      return {
        itemType: 'marketing_memory', sourceId: sid, recordedVersion, recordedHash,
        position: Number(i.position), availability: 'available' as const,
        currentTitle: cur.title, currentVersion: cur.version,
        historical: {
          title: snap.title ?? cur.title,
          content: snap.content ?? {},
          confidence: Number(snap.confidence),
          status: snap.status ?? 'unknown',
          memoryType: snap.memory_type,
          evidenceIds: snap.evidence_ids ?? [],
          contentHash: snap.content_hash ?? recordedHash,
        },
        historicalSource: 'version_snapshot' as const,
      };
    }

    // Changed, and no snapshot exists — the honest answer is that it cannot be
    // reproduced. Substituting the current row here is precisely what would
    // make the audit trail misleading.
    return {
      itemType: 'marketing_memory', sourceId: sid, recordedVersion, recordedHash,
      position: Number(i.position), availability: 'changed' as const,
      currentTitle: cur.title, currentVersion: cur.version,
      historical: null, historicalSource: null,
    };
  });

  return {
    id: packageId,
    contextType: String(p.context_type),
    createdAt: String(p.created_at),
    retrievalMode: String(p.retrieval_mode),
    memoryOutcome: String(p.memory_outcome),
    degraded: Boolean(p.degraded),
    items: reconstructed,
    // "Available" now means the exact version is recoverable — from the current
    // row when nothing changed, or from the version snapshot when it did.
    fullyReconstructible: reconstructed.every(i => i.availability === 'available'),
  };
}
