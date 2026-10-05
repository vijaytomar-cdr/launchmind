/**
 * @file directionAdjustment.ts
 * @description Owner adjustment of an existing content campaign's DIRECTION.
 *
 *   An AI CMO that cannot be redirected is a generator with a nicer surface.
 *   This is the redirection path: the owner says what they want changed, sees
 *   how LaunchMind will change it, and only then applies it.
 *
 *   THE INVARIANT: owner direction is DIRECTION, never EVIDENCE.
 *
 *   Direction can change WHO we talk to, WHAT we emphasise, HOW it sounds, WHAT
 *   we want the reader to do, and WHICH channels we build for. It cannot make
 *   anything true. That is enforced structurally, not by prompt: the applied
 *   strategy is produced by deriveContentStrategy, which recomputes
 *   `proofAvailable` from the CONTEXT's current evidence and never reads any
 *   field on this object. There is no code path from an owner sentence to the
 *   evidence set, so "conversion is 80% higher" typed here reaches generation as
 *   an emphasis and is then governed by the claim engine like any other claim.
 *
 *   APPEND, NEVER REWRITE. Applying a direction writes a NEW strategy and a NEW
 *   brief set. Existing artifacts, versions and approvals are untouched — they
 *   remain the historical output of the direction that produced them, which is
 *   the only honest reading of them.
 *
 * @security Owner text is inspected for substantiation-shaped assertions so the
 *   preview can say plainly what LaunchMind will not treat as proof. That
 *   inspection is a DISCLOSURE, not a filter — it grants nothing either way.
 * @dependencies contentCampaignService · strategyComposition · briefComposition
 */

import type { ProductContentContext } from './productContentContext';
import type { CampaignMessageArchitecture } from '../opportunity/contentCampaignService';
import { deriveContentStrategy, persistContentStrategy } from './strategyComposition';
import { deriveBriefSet, persistContentBrief, B3_CHANNELS, type B3Channel } from './briefComposition';
import { recommendContentPackage } from '../opportunity/channelRecommendation';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';

/** What an owner may adjust. Deliberately small: these are marketing decisions. */
export interface OwnerDirection {
  audience?: string | null;
  messageEmphasis?: string | null;
  tone?: string | null;
  ctaIntent?: string | null;
  channels?: string[] | null;
  /** Free refinement, e.g. "focus more on trust than convenience". */
  note?: string | null;
}

export class DirectionError extends Error {
  constructor(message: string) { super(message); this.name = 'DirectionError'; }
}

/**
 * Substantiation-shaped assertions in owner text.
 *
 * Linear scans, not backtracking alternations — this runs on owner-supplied
 * text and a catastrophic pattern here would be a denial-of-service surface.
 */
const PROOF_SHAPED: Array<{ test: RegExp; label: (m: string) => string }> = [
  // Linear, no nested quantifier. A backtracking pattern here would be a
  // denial-of-service surface, since this runs on text the owner supplies.
  { test: /\d[\d.]*\s?%/, label: m => `the figure "${m.trim()}"` },
  { test: /\d+,\d\d\d/, label: m => `the number "${m.trim()}"` },
  { test: /\b(?:\d+x|\d+\s?times)\b/i, label: m => `the multiplier "${m.trim()}"` },
  { test: /\b(?:fastest|cheapest|best|only|#1|number one|leading)\b/i, label: m => `the claim "${m.trim()}"` },
  { test: /\b(?:better|faster|cheaper|more effective)\s+than\b/i, label: m => `the comparison "${m.trim()}"` },
  { test: /\b(?:soc\s?2|hipaa|gdpr|iso\s?27001|pci)\b/i, label: m => `the certification "${m.trim()}"` },
  { test: /\bguarantee(?:d|s)?\b/i, label: m => `the guarantee "${m.trim()}"` },
];

/**
 * Owner-safe sentences describing what this direction cannot make true.
 *
 * @returns one line per distinct assertion shape found; empty when the owner is
 *   simply telling LaunchMind what to emphasise, which is the normal case
 */
export function directionCannotProve(direction: OwnerDirection): string[] {
  const text = [direction.messageEmphasis, direction.note, direction.audience, direction.ctaIntent]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' · ');
  if (!text) return [];

  const out: string[] = [];
  for (const rule of PROOF_SHAPED) {
    const m = rule.test.exec(text);
    if (m) out.push(rule.label(m[0]));
  }
  if (out.length === 0) return [];
  return [
    `You mentioned ${out.join(', ')}. LaunchMind will treat that as what you want emphasised, not as something it can prove.`,
    'If content ends up stating it, that statement will need evidence before it can be used.',
  ];
}

export interface DirectionChange { field: string; before: string; after: string; }

export interface DirectionPreview {
  changes: DirectionChange[];
  /** What applying this will rebuild. */
  willRebuild: string[];
  /** What applying this will NOT touch. Stated because owners assume the worst. */
  willNotChange: string[];
  cannotProve: string[];
}

const CHANNEL_LABEL: Record<string, string> = {
  GOOGLE_RSA: 'Google search ad', META_AD: 'Meta ad', LANDING_PAGE: 'Landing page',
  LINKEDIN_POST: 'LinkedIn post', SHORT_FORM_VIDEO_SCRIPT: 'Short video script',
};

/** Normalises requested channels to the supported set. Unknown entries are dropped. */
function normaliseChannels(raw: readonly string[] | null | undefined): B3Channel[] {
  if (!raw || raw.length === 0) return [];
  const allowed = new Set<string>(B3_CHANNELS);
  const seen = new Set<string>();
  const out: B3Channel[] = [];
  for (const c of raw) {
    const up = String(c).trim().toUpperCase();
    if (allowed.has(up) && !seen.has(up)) { seen.add(up); out.push(up as B3Channel); }
  }
  return out;
}

export interface CampaignDirectionState {
  id: string;
  name: string;
  audience: string;
  messageAngle: string;
  thesis: string;
  ctaIntent: string | null;
  channels: string[];
  tone: string | null;
}

/** Reads the campaign's CURRENT direction inside the caller's workspace. */
export async function readCampaignDirection(
  campaignId: string, workspaceId: string,
): Promise<CampaignDirectionState> {
  const { data, error } = await getSupabaseAdmin().from('content_campaigns')
    .select('id, name, audience, message_angle, thesis, cta_intent, recommended_channels, product_id')
    .eq('id', campaignId).eq('workspace_id', workspaceId).maybeSingle();
  if (error) throw new DirectionError(error.message);
  // 404-shaped: another workspace's campaign must read as absent, not forbidden.
  if (!data) throw new DirectionError('Not found.');
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id), name: String(r.name ?? ''),
    audience: String(r.audience ?? ''), messageAngle: String(r.message_angle ?? ''),
    thesis: String(r.thesis ?? ''),
    ctaIntent: (r.cta_intent as string | null) ?? null,
    channels: ((r.recommended_channels as string[] | null) ?? []),
    tone: null,
  };
}

/**
 * "Here's how I'll adjust it" — computed, never generated.
 *
 * @security Pure. Nothing is written, so an owner can explore a direction
 *   without committing to it and without consuming generation.
 */
export function previewDirection(
  current: CampaignDirectionState, direction: OwnerDirection, ctx: ProductContentContext,
): DirectionPreview {
  const changes: DirectionChange[] = [];
  const push = (field: string, before: string, after: string | null | undefined) => {
    const a = (after ?? '').trim();
    if (a && a !== before) changes.push({ field, before: before || 'not set', after: a });
  };

  push('Audience', current.audience, direction.audience);
  push('Message emphasis', current.messageAngle, direction.messageEmphasis);
  push('What you want people to do', current.ctaIntent ?? '', direction.ctaIntent);

  const tone = ctx.brand.fields.tone?.ownerConfirmed ? String(ctx.brand.fields.tone.value) : '';
  push('Tone', tone, direction.tone);

  const channels = normaliseChannels(direction.channels);
  if (channels.length > 0) {
    const before = current.channels.map(c => CHANNEL_LABEL[c] ?? c).join(', ');
    const after = channels.map(c => CHANNEL_LABEL[c] ?? c).join(', ');
    if (after !== before) changes.push({ field: 'What to create', before: before || 'not set', after });
  }
  if (direction.note && direction.note.trim()) {
    changes.push({ field: 'Your refinement', before: '—', after: direction.note.trim() });
  }

  const willRebuild = [
    'The campaign strategy will be rebuilt from this direction',
    'New briefs will be written for each channel',
    'Anything you create from here on will follow the new direction',
  ];
  const willNotChange = [
    'Content you already have stays exactly as it is',
    'Versions you already approved stay approved',
    'The evidence LaunchMind may use does not change — direction is not proof',
  ];

  return { changes, willRebuild, willNotChange, cannotProve: directionCannotProve(direction) };
}

export interface DirectionApplyResult {
  strategyId: string;
  briefIds: Record<string, string>;
  channels: B3Channel[];
  applied: DirectionChange[];
  /** Lineage the owner can inspect: what produced the content that already exists. */
  supersededStrategyId: string | null;
}

/**
 * Applies a direction: appends a new strategy and brief set.
 *
 * @security Nothing existing is deleted or rewritten. The campaign row's
 *   narrative fields move to the new direction because they ARE the campaign's
 *   current direction; every prior strategy, brief and artifact row remains and
 *   still points at the direction that produced it.
 */
export async function applyDirection(opts: {
  ctx: ProductContentContext; founderId: string; campaignId: string;
  current: CampaignDirectionState; direction: OwnerDirection;
}): Promise<DirectionApplyResult> {
  const { ctx, founderId, campaignId, current, direction } = opts;
  const db = getSupabaseAdmin();

  const preview = previewDirection(current, direction, ctx);
  if (preview.changes.length === 0) throw new DirectionError('Nothing to change.');

  const { data: campRow } = await db.from('content_campaigns')
    .select('core_problem, product_role, primary_benefit, objections, ' +
            'proof_available, proof_unavailable, content_package')
    .eq('id', campaignId).eq('workspace_id', ctx.workspaceId).maybeSingle();
  const camp = (campRow ?? {}) as Record<string, unknown>;

  const audience = (direction.audience ?? '').trim() || current.audience;
  const message = (direction.messageEmphasis ?? '').trim() || current.messageAngle;
  const ctaIntent = (direction.ctaIntent ?? '').trim() || current.ctaIntent;
  const requested = normaliseChannels(direction.channels);
  const channels: B3Channel[] = requested.length > 0
    ? requested
    : normaliseChannels(current.channels);
  if (channels.length === 0) throw new DirectionError('Choose at least one thing to create.');

  // The refinement steers HOW the thesis is expressed. It is appended to the
  // thesis rather than replacing it so the campaign keeps its identity.
  const note = (direction.note ?? '').trim();
  const thesis = note ? `${message} — ${note}` : message;

  const pkg = recommendContentPackage(channels.map(c => ({
    channel: c as never, rationale: 'you chose this', priority: 1, requiresAuthorizedVisual: false,
  })) as never);

  const architecture: CampaignMessageArchitecture = {
    name: current.name,
    thesis,
    // An adjustment changes direction, not what the campaign is for.
    campaignObjective: null,
    audience,
    coreProblem: (camp.core_problem as string | null) ?? null,
    messageAngle: message,
    productRole: (camp.product_role as string | null) ?? null,
    primaryBenefit: (camp.primary_benefit as string | null) ?? null,
    objections: (camp.objections as string[] | null) ?? [],
    ctaIntent,
    // Recomputed downstream from ctx.evidence. Passed empty so a stale campaign
    // copy of proof cannot ride into the new strategy.
    proofAvailable: [],
    proofUnavailable: (camp.proof_unavailable as string[] | null) ?? [],
    recommendedChannels: channels,
    contentPackage: pkg.items,
    packageNotes: pkg.notes,
    brandDirectives: [],
    prohibitedTerms: [...ctx.prohibitedTerms],
  };

  const { data: prior } = await db.from('content_strategies')
    .select('id').eq('content_campaign_id', campaignId).eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const supersededStrategyId = (prior as { id?: string } | null)?.id ?? null;

  const strategy = deriveContentStrategy({ ctx, architecture });
  const strategyId = await persistContentStrategy(strategy, { founderId, campaignId });
  if (!strategyId) throw new DirectionError('Could not save the new direction.');

  const briefs = deriveBriefSet(channels, strategy, ctx);
  const briefIds: Record<string, string> = {};
  for (const b of briefs) {
    const id = await persistContentBrief(b, { founderId, strategyId, campaignId });
    if (id) briefIds[b.channel] = id;
  }

  // The campaign's own fields ARE its current direction. Prior strategies,
  // briefs and artifacts are untouched and still describe the old one.
  await db.from('content_campaigns').update({
    thesis, audience, message_angle: message, cta_intent: ctaIntent,
    recommended_channels: channels, content_package: pkg.items,
  }).eq('id', campaignId).eq('workspace_id', ctx.workspaceId);

  return { strategyId, briefIds, channels, applied: preview.changes, supersededStrategyId };
}
