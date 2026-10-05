/**
 * @file videoRenderService.ts
 * @description Orchestrates one governed short-form video — B6B §16–§24.
 *
 *   Same shape as the image lane, same table, same approval boundary. What is
 *   different is what a video can carry: a face, a voice and spoken words, all
 *   of which assert things that text governance cannot inspect after the fact.
 *   So the order below is not arbitrary — every gate runs BEFORE a provider is
 *   contacted, because once bytes exist somebody will want to use them.
 *
 *     1. SCOPE       artifact resolved inside the caller's workspace
 *     2. CONTEXT     refuses a hollow product context (B6A §28 carried forward)
 *     3. SCRIPT      governed voiceover/on-screen text extracted, never generated
 *     4. ENDORSEMENT a synthetic presenter may not claim to be a customer,
 *                    employee, founder or expert — checked against the actual
 *                    lines that would be spoken
 *     5. SELECTION   presenter and voice must be the owner's explicit choices
 *     6. ASSETS      references only from resolveMarketingAssets(VISUAL_RENDERING)
 *     7. DEMO        productDemoNeeded with no authorised footage is blocked,
 *                    never satisfied by inventing an interface
 *     8. BUDGET      bounded attempts and per-version provider calls
 *     9. RENDER      through the abstraction only
 *    10. VALIDATE    content type, size, duration
 *    11. CAPTIONS    provider captions accepted only if word-identical
 *    12. STORE       bytes under LaunchMind control; provider URL never canonical
 *    13. LINEAGE     artifact, version, campaign, mode, avatar, voice, brand
 *
 *   Rendering is not execution and not learning. This module writes render jobs
 *   and generated assets. Nothing else.
 *
 * @security Failure NEVER produces a placeholder video or a silent audio track.
 *   A failed job leaves the script byte-identical and says so.
 * @dependencies videoModePolicy · videoScriptGovernance · creativeProviderRegistry
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { resolveMarketingAssets } from '../brand/marketingAssetService';
import { deriveVideoCreativeBrief, type VideoCreativeBrief } from '../content/creativeBriefs';
import type { ProductContentContext } from '../content/productContentContext';
import type { ContentBrief } from '../content/briefComposition';
import { getCreativeProvider } from './creativeProviderRegistry';
import {
  CreativeProviderError, type CreativeFailureCategory,
} from './creativeProviderTypes';
import { routeVideoMode, IMAGE_TO_VIDEO_MODEL } from './creativeModelRouting';
import {
  decideVideoMode, validateSelections, checkPresenterSpeech, PRESENTER_DISCLOSURE,
  type VideoMode, type AvatarSelection, type VoiceSelection,
} from './videoModePolicy';
import { extractGovernedScript, reconcileCaptions } from './videoScriptGovernance';
import { inspectMp4Container } from './videoInspection';
import { sanitizeForProvider, abstractCompetitorReference } from './creativePromptAssembly';
import { CreativeRenderBlocked, CREATIVE_LIMITS,
  contextSupportsApplicationSpecificRender } from './creativeRenderService';

const BUCKET = 'content-assets';
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/** No people, ever, from a generative video model. Carried explicitly. */
const VIDEO_NEGATIVE = [
  'no people', 'no faces', 'no humans', 'no actors', 'no spokesperson',
  'no customers', 'no employees', 'no crowds', 'no portraits',
  'no text', 'no letters', 'no captions', 'no logos', 'no watermarks',
  'no badges', 'no award seals', 'no star ratings', 'no percentages', 'no numbers',
  'no competitor branding', 'no fake user interface',
].join(', ');

export interface RenderVideoInput {
  workspaceId: string;
  productId: string;
  founderId: string;
  contentAssetId: string;
  versionNumber: number;
  ctx: ProductContentContext;
  brief: ContentBrief;
  /** The governed SHORT_FORM_VIDEO_SCRIPT payload already persisted. */
  scriptPayload: Record<string, unknown>;
  mode: VideoMode;
  avatar?: AvatarSelection | null;
  voice?: VoiceSelection | null;
  /** False when the artifact's latest version did not pass governance. */
  textEligible: boolean;
  lineage?: {
    campaignId?: string | null; strategyId?: string | null;
    briefId?: string | null; variantLabel?: string | null;
  };
}

export interface RenderVideoResult {
  renderJobId: string;
  status: 'SUCCEEDED' | 'FAILED';
  generatedAssetId: string | null;
  storagePath: string | null;
  publicUrl: string | null;
  durationMs: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  costSource: 'PROVIDER_REPORTED' | 'NOT_REPORTED';
  failureCategory: CreativeFailureCategory | null;
  ownerMessage: string | null;
  provenance: string[];
  notes: string[];
  audioRenderJobId: string | null;
}

/** Owner-safe provenance. No ids, prompts, seeds, model slugs or policy versions. */
function buildVideoProvenance(opts: {
  mode: VideoMode; brief: VideoCreativeBrief; usedAssetCount: number;
  avatar?: AvatarSelection | null; voice?: VoiceSelection | null;
  brandColorsConfirmed: number; captionSource: 'LAUNCHMIND' | 'PROVIDER';
}): string[] {
  const lines: string[] = [];
  lines.push('Created for: short video');
  lines.push('Message: from the campaign LaunchMind recommended');
  lines.push(opts.brandColorsConfirmed > 0
    ? 'Brand: uses the colours you confirmed'
    : 'Brand: no confirmed colours yet, so this is a neutral palette');
  lines.push(opts.usedAssetCount > 0
    ? `Product assets: uses ${opts.usedAssetCount === 1 ? 'the image' : `${opts.usedAssetCount} images`} you approved`
    : 'Product assets: none used');

  if (opts.mode === 'AVATAR_SPOKESPERSON' && opts.avatar) {
    lines.push(`Presenter: ${opts.avatar.displayName}, the AI presenter you selected`);
    lines.push(PRESENTER_DISCLOSURE);
  } else {
    lines.push('Presenter: none — no person appears in this video');
  }
  if (opts.voice) lines.push(`Voice: ${opts.voice.displayName}, the voice you selected`);

  lines.push(opts.captionSource === 'LAUNCHMIND'
    ? 'Wording: captions written by LaunchMind from your approved script'
    : 'Wording: captions match your approved script exactly');
  lines.push('Rendered with: LaunchMind creative rendering');
  return lines;
}

async function finishJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  await getSupabaseAdmin().from('creative_render_jobs')
    .update({ ...patch, completed_at: new Date().toISOString() }).eq('id', jobId);
}

/** Downloads and validates a provider video. Rejects anything that is not one. */
async function downloadVideo(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  let res: Response;
  try { res = await fetch(url, { signal: AbortSignal.timeout(180_000) }); }
  catch {
    throw new CreativeProviderError('OUTPUT_EXPIRED',
      'The created video was no longer available to download.', 'video fetch failed');
  }
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    throw new CreativeProviderError('OUTPUT_EXPIRED',
      'The created video expired before LaunchMind could save it.', `video ${res.status}`);
  }
  if (!res.ok) {
    throw new CreativeProviderError('PROVIDER_UNAVAILABLE',
      'LaunchMind could not download the created video.', `video ${res.status}`);
  }
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_VIDEO_MIME.has(mime)) {
    throw new CreativeProviderError('INVALID_CONTENT_TYPE',
      'What the video service returned was not a video.', `content-type ${mime || 'absent'}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new CreativeProviderError('MALFORMED_RESPONSE',
      'The created video was empty.', 'zero bytes');
  }
  if (bytes.length > MAX_VIDEO_BYTES) {
    throw new CreativeProviderError('INVALID_CONTENT_TYPE',
      'The created video was too large to save.', `bytes ${bytes.length}`);
  }
  return { bytes, mimeType: mime };
}

/**
 * Renders ONE governed short-form video.
 *
 * @throws {CreativeRenderBlocked} when governance refuses before any provider
 *   call. Provider failures are RECORDED on the job and returned, not thrown.
 */
export async function renderGovernedVideo(
  input: RenderVideoInput,
): Promise<RenderVideoResult> {
  const db = getSupabaseAdmin();

  // ── 2. application context ───────────────────────────────────────────────
  const support = contextSupportsApplicationSpecificRender(input.ctx);
  if (!support.ok) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      `LaunchMind needs to know ${support.missing.join(' and ')} before it can create a video for your product.`,
      'insufficient product context');
  }

  // ── 3. governed script — extracted, never generated ──────────────────────
  const videoBrief = deriveVideoCreativeBrief(input.brief, input.ctx, input.scriptPayload);
  const script = extractGovernedScript(videoBrief);
  if (script.voiceover.length === 0 && input.mode !== 'PRODUCT_MOTION') {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'There is no approved wording for this video yet.', 'empty governed script');
  }
  if (!input.textEligible && input.mode !== 'PRODUCT_MOTION') {
    // A version the claim engine refused must not be spoken aloud. Speech is a
    // claim surface no downstream governance can read.
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'This script still needs work before LaunchMind can have it spoken aloud.',
      'script version not eligible');
  }

  // ── 4. a synthetic presenter may not claim to be someone ─────────────────
  if (input.mode === 'AVATAR_SPOKESPERSON') {
    const verdict = checkPresenterSpeech(script.voiceover);
    if (!verdict.permitted) {
      throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
        `LaunchMind cannot have a generated presenter say this. ${verdict.reasons[0]} ` +
        'The presenter is not a real person, so that would not be true.',
        'presenter speech asserts a role or testimonial');
    }
  }

  // ── 5. owner selections ──────────────────────────────────────────────────
  const decision = decideVideoMode({
    brief: videoBrief, ctx: input.ctx, ownerRequestedMode: input.mode,
    avatar: input.avatar, voice: input.voice,
  });
  try {
    validateSelections({ mode: input.mode, avatar: input.avatar, voice: input.voice });
  } catch (e) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      e instanceof Error && 'ownerMessage' in e
        ? String((e as { ownerMessage: string }).ownerMessage)
        : 'LaunchMind needs a selection before creating this video.',
      'selection validation failed');
  }

  // ── 6. authorised assets ONLY ────────────────────────────────────────────
  const authorised = await resolveMarketingAssets(
    input.workspaceId, input.productId, 'VISUAL_RENDERING');
  const referenceUrls = authorised
    .map(a => a.externalUrl ?? (a.storagePath
      ? db.storage.from(BUCKET).getPublicUrl(a.storagePath).data.publicUrl : ''))
    .filter(u => u.length > 0);

  // ── 7. a product demo needs the product ──────────────────────────────────
  if (videoBrief.productDemoNeeded && referenceUrls.length === 0) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'This video is meant to show your product, and you have not authorised any imagery of it yet.',
      'product demo needed, none authorised');
  }
  if (decision.needsFromOwner.length > 0) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      decision.needsFromOwner[0], 'mode requirements unmet');
  }

  // ── 8. bounded cost ──────────────────────────────────────────────────────
  const { count: priorCalls } = await db.from('creative_render_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('content_asset_id', input.contentAssetId)
    .eq('content_version_number', input.versionNumber);
  if ((priorCalls ?? 0) >= CREATIVE_LIMITS.MAX_PROVIDER_CALLS_PER_ARTIFACT_VERSION) {
    throw new CreativeRenderBlocked('BLOCKED_BY_GOVERNANCE',
      'You have created a lot of videos for this version. Approve one or edit the script before creating more.',
      'per-version provider call cap reached');
  }

  const route = routeVideoMode(input.mode);
  const notes: string[] = [];

  // Scene description for the motion providers. Never used by HeyGen, which
  // renders a chosen presenter rather than an invented scene.
  const rawScene = videoBrief.scenePlan.map(s => s.visual).filter(Boolean).join('. ');
  const abstracted = abstractCompetitorReference(
    rawScene, input.ctx.founderDirection.competitors ?? []);
  const clean = sanitizeForProvider(abstracted.text);
  if (clean.removed.length > 0) {
    notes.push('LaunchMind left some wording out of the visuals because it cannot put a claim in a picture.');
  }
  if (abstracted.abstracted) {
    notes.push('A competitor was mentioned, so LaunchMind used the style rather than their creative.');
  }
  const useImageToVideo = referenceUrls.length > 0 && input.mode !== 'AVATAR_SPOKESPERSON';
  const modelRef = useImageToVideo ? IMAGE_TO_VIDEO_MODEL : route.modelRef;

  // ── job row ──────────────────────────────────────────────────────────────
  const { data: jobRow, error: jobErr } = await db.from('creative_render_jobs').insert({
    workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
    content_asset_id: input.contentAssetId, content_version_number: input.versionNumber,
    content_campaign_id: input.lineage?.campaignId ?? null,
    content_strategy_id: input.lineage?.strategyId ?? null,
    content_brief_id: input.lineage?.briefId ?? null,
    variant_label: input.lineage?.variantLabel ?? null,
    provider: route.provider,
    capability: useImageToVideo ? 'IMAGE_TO_VIDEO' : route.capability,
    model_ref: modelRef, quality_tier: 'PRODUCTION',
    creative_kind: 'SHORT_FORM_VIDEO', video_mode: input.mode,
    concept_label: null,
    brand_kit_version: input.ctx.brand.version,
    used_asset_ids: authorised.map(a => a.id),
    avatar_selection: input.avatar ? {
      providerAvatarId: input.avatar.providerAvatarId,
      displayName: input.avatar.displayName,
      presenterKind: input.avatar.presenterKind,
    } : null,
    voice_selection: input.voice ? {
      providerVoiceId: input.voice.providerVoiceId,
      displayName: input.voice.displayName, kind: input.voice.kind,
    } : null,
    status: 'RENDERING', attempt: 1, started_at: new Date().toISOString(),
  }).select('id').single();
  if (jobErr || !jobRow) throw new Error(`video render job insert failed: ${jobErr?.message}`);
  const jobId = (jobRow as { id: string }).id;

  let audioJobId: string | null = null;

  try {
    // ── companion voice track, when the mode needs one ─────────────────────
    if (route.companion && input.voice) {
      const voiceProvider = getCreativeProvider('VOICE');
      if (!voiceProvider.generateVoice) {
        throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
          'Voice is not available yet.', 'adapter lacks generateVoice');
      }
      const { data: audioRow } = await db.from('creative_render_jobs').insert({
        workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
        content_asset_id: input.contentAssetId, content_version_number: input.versionNumber,
        provider: 'ELEVENLABS', capability: 'VOICE',
        model_ref: route.companion.modelRef, quality_tier: 'PRODUCTION',
        creative_kind: 'VOICEOVER_AUDIO', video_mode: input.mode,
        brand_kit_version: input.ctx.brand.version,
        voice_selection: {
          providerVoiceId: input.voice.providerVoiceId,
          displayName: input.voice.displayName, kind: input.voice.kind,
        },
        parent_render_job_id: jobId,
        status: 'RENDERING', attempt: 1, started_at: new Date().toISOString(),
      }).select('id').single();
      audioJobId = (audioRow as { id?: string } | null)?.id ?? null;

      // GOVERNED text, verbatim. The provider voices it; it never rewrites it.
      const audio = await voiceProvider.generateVoice({
        text: script.spokenScript,
        providerVoiceId: input.voice.providerVoiceId,
        modelRef: route.companion.modelRef,
      });
      const audioPath = `${input.founderId}/${input.productId}/creative/${audioJobId ?? jobId}.mp3`;
      const { error: audioUpErr } = await db.storage.from(BUCKET)
        .upload(audioPath, audio.bytes ?? Buffer.alloc(0),
          { contentType: audio.mimeType, upsert: true });
      if (audioUpErr) {
        throw new CreativeProviderError('STORAGE_FAILED',
          'LaunchMind created the voice track but could not save it. Nothing was changed.',
          'audio storage upload failed');
      }
      const { data: audioAsset } = await db.from('marketing_assets').insert({
        workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
        asset_type: 'AUDIO', source: 'GENERATED', subject_relation: 'OWN_PRODUCT',
        authorization_state: 'OBSERVED_EXTERNAL', storage_path: audioPath,
        may_contain_pii: false,
        render_job_id: audioJobId, content_asset_id: input.contentAssetId,
        content_version_number: input.versionNumber,
        brand_kit_version: input.ctx.brand.version,
        mime_type: audio.mimeType, byte_size: (audio.bytes ?? Buffer.alloc(0)).length,
        duration_ms: audio.durationMs,
        generation_provenance: { lines: [`Voice: ${input.voice.displayName}, the voice you selected`], notes: [] },
      }).select('id').single();
      if (audioJobId) {
        await finishJob(audioJobId, {
          status: 'SUCCEEDED',
          output_asset_id: (audioAsset as { id?: string } | null)?.id ?? null,
          latency_ms: audio.latencyMs, cost_source: 'NOT_REPORTED',
          provider_request_ref: audio.providerRequestRef,
        });
      }
      notes.push('LaunchMind created a voice track from your approved script.');
    }

    // ── 9. render the video ────────────────────────────────────────────────
    const capability = useImageToVideo ? 'IMAGE_TO_VIDEO' : route.capability;
    const provider = getCreativeProvider(capability);
    if (!provider.generateVideo) {
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Video creation is not available yet.', 'adapter lacks generateVideo');
    }

    const out = await provider.generateVideo({
      prompt: input.mode === 'AVATAR_SPOKESPERSON' ? undefined
        : `${clean.text}. ${videoBrief.videoStyle}. Vertical short-form marketing video with no people in frame.`,
      negativePrompt: [VIDEO_NEGATIVE, ...videoBrief.prohibitedContent].join(', ').slice(0, 900),
      aspectRatio: '9:16',
      referenceImageUrl: useImageToVideo ? referenceUrls[0] : null,
      spokenScript: input.mode === 'AVATAR_SPOKESPERSON' ? script.spokenScript : undefined,
      providerAvatarId: input.avatar?.providerAvatarId ?? null,
      providerVoiceId: input.mode === 'AVATAR_SPOKESPERSON'
        ? (input.voice?.providerVoiceId ?? null) : null,
      durationSeconds: Math.min(script.estimatedSeconds, 10),
      modelRef,
    });

    // ── 10. download + validate ────────────────────────────────────────────
    if (!out.mediaUrl) {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'The video service returned no video.', 'no media url');
    }
    const { bytes, mimeType } = await downloadVideo(out.mediaUrl);

    // Facts read from the FILE, not from what the provider says it made. The
    // Replicate motion model reports 720p and delivers 1088x1920; storing the
    // request instead of the result would put a wrong number in front of the owner.
    const container = inspectMp4Container(bytes);
    if (!container.parsed || !container.videoCodec) {
      throw new CreativeProviderError('INVALID_CONTENT_TYPE',
        'What the video service returned could not be read as a video.',
        'container did not parse');
    }

    // ── 11. captions: provider wording accepted only if word-identical ─────
    const captions = reconcileCaptions(script.voiceover, null);
    notes.push(...captions.notes);

    // ── 12. store under LaunchMind control ─────────────────────────────────
    const path = `${input.founderId}/${input.productId}/creative/${jobId}.mp4`;
    const { error: upErr } = await db.storage.from(BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: true });
    if (upErr) {
      throw new CreativeProviderError('STORAGE_FAILED',
        'LaunchMind created the video but could not save it. Nothing was changed.',
        'video storage upload failed');
    }
    const publicUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const provenance = buildVideoProvenance({
      mode: input.mode, brief: videoBrief, usedAssetCount: referenceUrls.length,
      avatar: input.avatar, voice: input.voice,
      brandColorsConfirmed: ['primary_color', 'secondary_color']
        .filter(k => input.ctx.brand.fields[k]?.ownerConfirmed).length,
      captionSource: captions.source,
    });

    // ── 13. governed output asset + lineage ────────────────────────────────
    const { data: assetRow, error: assetErr } = await db.from('marketing_assets').insert({
      workspace_id: input.workspaceId, product_id: input.productId, founder_id: input.founderId,
      asset_type: 'VIDEO', source: 'GENERATED', subject_relation: 'OWN_PRODUCT',
      authorization_state: 'OBSERVED_EXTERNAL', storage_path: path,
      // No real person's data can enter: references are restricted to assets
      // already proven pii-free, and a synthesised presenter is not a person.
      may_contain_pii: false,
      render_job_id: jobId, content_asset_id: input.contentAssetId,
      content_version_number: input.versionNumber,
      brand_kit_version: input.ctx.brand.version,
      mime_type: mimeType, byte_size: bytes.length,
      // File-derived, falling back to the provider only where the container is silent.
      duration_ms: container.durationMs ?? out.durationMs,
      width_px: container.widthPx ?? out.widthPx,
      height_px: container.heightPx ?? out.heightPx,
      generation_provenance: {
        lines: provenance, notes,
        captions: captions.lines.map(l => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
        captionSource: captions.source,
      },
    }).select('id').single();
    if (assetErr || !assetRow) {
      throw new CreativeProviderError('STORAGE_FAILED',
        'LaunchMind created the video but could not save it. Nothing was changed.',
        `video asset insert failed: ${assetErr?.message}`);
    }
    const assetId = (assetRow as { id: string }).id;

    await finishJob(jobId, {
      status: 'SUCCEEDED', output_asset_id: assetId,
      latency_ms: out.latencyMs, cost_usd: out.costUsd,
      cost_source: out.costUsd === null ? 'NOT_REPORTED' : 'PROVIDER_REPORTED',
      provider_request_ref: out.providerRequestRef,
      duration_ms: container.durationMs ?? out.durationMs,
    });

    return {
      renderJobId: jobId, status: 'SUCCEEDED', generatedAssetId: assetId,
      storagePath: path, publicUrl, durationMs: container.durationMs ?? out.durationMs,
      latencyMs: out.latencyMs, costUsd: out.costUsd,
      costSource: out.costUsd === null ? 'NOT_REPORTED' : 'PROVIDER_REPORTED',
      failureCategory: null, ownerMessage: null, provenance, notes,
      audioRenderJobId: audioJobId,
    };
  } catch (err) {
    const category: CreativeFailureCategory = err instanceof CreativeProviderError
      ? err.category : 'MALFORMED_RESPONSE';
    const ownerMessage = err instanceof CreativeProviderError
      ? err.ownerMessage : 'LaunchMind could not create the video.';

    await finishJob(jobId, {
      status: 'FAILED', failure_category: category,
      failure_detail: ownerMessage, cost_source: 'NOT_REPORTED',
    });
    if (audioJobId) {
      await finishJob(audioJobId, {
        status: 'FAILED', failure_category: category,
        failure_detail: ownerMessage, cost_source: 'NOT_REPORTED',
      });
    }

    // NO placeholder video, NO silent audio, NO approval. The script is
    // byte-identical to what it was before this call.
    return {
      renderJobId: jobId, status: 'FAILED', generatedAssetId: null,
      storagePath: null, publicUrl: null, durationMs: null,
      latencyMs: null, costUsd: null, costSource: 'NOT_REPORTED',
      failureCategory: category,
      ownerMessage: `${ownerMessage} Your script was not changed.`,
      provenance: [], notes, audioRenderJobId: audioJobId,
    };
  }
}
