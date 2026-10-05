/**
 * @file heygenCreativeAdapter.ts
 * @description The HeyGen avatar adapter — B6B §9, §19.
 *
 *   HeyGen renders a chosen avatar speaking a GIVEN script. That framing is the
 *   whole reason this is the safe home for "a person speaks to camera": the
 *   presenter is a specific inventory entry the owner picked and the words are
 *   ours, whereas asking a generative video model for "a person" produces
 *   somebody nobody chose, delivering a performance nobody specified. B6A
 *   learned that the hard way with an image model.
 *
 *   THE ADAPTER NEVER PICKS AN AVATAR. `listAvatars` returns inventory for the
 *   owner to choose from; `generateVideo` refuses without a selection. There is
 *   no "sensible default", because a default presenter is LaunchMind choosing a
 *   face — and a demographic — on the owner's behalf.
 *
 *   THE ADAPTER NEVER EDITS THE SCRIPT. HeyGen is given the governed text
 *   verbatim. If it cannot render it, that is a failure, not an invitation to
 *   paraphrase: a paraphrase is new copy that never passed claim governance.
 *
 *   MIGRATED TO v3. /v2/video/generate and /v1/video_status.get are retired on
 *   2026-11-01 and every v2 response already carries a deprecation warning, so
 *   carrying them into a finished architecture would ship a known expiry date.
 *
 *   ONE ENDPOINT COULD NOT MIGRATE. `GET /v3/avatars` returns avatar GROUP ids
 *   (each carrying `looks_count`), and `POST /v3/videos` rejects them with
 *   `avatar_not_found`. The renderable LOOK ids come only from `GET /v2/avatars`
 *   — no v3 looks endpoint responded (`/v3/avatars/{id}/looks`, `/v3/looks` and
 *   `/v3/avatar-looks` all 404). So the presenter inventory stays on v2 as an
 *   explicitly labelled LEGACY_TEMPORARY path with the removal date recorded
 *   below, rather than a silent fallback nobody would notice.
 *
 *     LEGACY_TEMPORARY: GET /v2/avatars — MUST be replaced before 2026-10-31.
 *
 *   Two things had to be learned by calling it rather than assuming. First, the
 *   v3 body is a FLAT discriminated union (`type: "avatar"`, `avatar_id`,
 *   `script`, `voice_id`) — not v2's nested `video_inputs[].character`; sending
 *   the old shape returns "Unable to extract tag using discriminator 'type'".
 *   Second, `type: "avatar"` defaults to the Avatar IV engine, which the stock
 *   avatar inventory does not support ("This video avatar does not support
 *   Avatar IV video generation"). Stock presenters need `engine.type =
 *   avatar_iii`, which is set explicitly rather than left to a default that
 *   changes underneath us.
 *
 * @security Key read per call from the server environment, sent only in the
 *   X-Api-Key header, never logged, never placed in an Error, never returned.
 *   Provider error bodies are read for a machine code at most; they echo the
 *   request, which for this provider includes the full script.
 * @dependencies creativeProviderTypes
 */

import {
  CreativeProviderError, type CreativeProviderAdapter, type CreativeCapability,
  type VideoRenderInstruction, type MediaRenderOutput,
} from './creativeProviderTypes';

const DEFAULT_BASE = 'https://api.heygen.com';
const CREATE_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 60;                 // ~5 min ceiling; avatar renders are slow
const PAGE_SIZE = 50;                 // v3 hard cap; 60 returns 400
/**
 * The date HeyGen retires v1/v2. The presenter inventory still depends on
 * /v2/avatars; a test asserts this constant so the debt cannot be forgotten.
 */
export const HEYGEN_LEGACY_REMOVAL_DATE = '2026-10-31';
/** Endpoints still on the legacy API, and why. */
export const HEYGEN_LEGACY_ENDPOINTS = ['GET /v2/avatars'] as const;

/** Maps an HTTP status to something the owner can act on. Body never surfaced. */
function categorise(status: number): CreativeProviderError {
  if (status === 401 || status === 403) {
    return new CreativeProviderError('ADAPTER_UNAVAILABLE',
      'LaunchMind could not reach its presenter service.', `heygen auth ${status}`);
  }
  if (status === 429) {
    return new CreativeProviderError('RATE_LIMITED',
      'The presenter service is busy. LaunchMind will try again shortly.', 'heygen 429');
  }
  if (status === 400 || status === 422) {
    return new CreativeProviderError('PROVIDER_REFUSED',
      'The presenter service would not create this video. Try a different presenter or a shorter script.',
      `heygen ${status}`);
  }
  if (status >= 500) {
    return new CreativeProviderError('PROVIDER_UNAVAILABLE',
      'The presenter service is unavailable right now.', `heygen ${status}`);
  }
  return new CreativeProviderError('MALFORMED_RESPONSE',
    'LaunchMind could not create the video.', `heygen ${status}`);
}

/** Owner-safe avatar inventory. Provider metadata only — never evidence. */
export interface ProviderAvatar {
  providerAvatarId: string;
  displayName: string;
  previewUrl: string | null;
  /** The presenter's own default voice. A pairing, never an auto-selection. */
  defaultVoiceId: string | null;
}

/** Owner-safe voice inventory for a presenter. Provider metadata only. */
export interface ProviderVoiceOption {
  providerVoiceId: string;
  displayName: string;
  language: string | null;
  previewUrl: string | null;
}

interface HeyGenAvatarRow {
  avatar_id?: string; avatar_name?: string; preview_image_url?: string;
}

export class HeyGenCreativeAdapter implements CreativeProviderAdapter {
  readonly provider = 'HEYGEN' as const;
  readonly capabilities: readonly CreativeCapability[] = ['AVATAR_VIDEO'];

  private key(): string | null {
    const k = process.env.HEYGEN_API_KEY;
    return typeof k === 'string' && k.trim().length > 0 ? k.trim() : null;
  }
  private base(): string {
    const b = process.env.HEYGEN_API_BASE_URL;
    return (typeof b === 'string' && b.trim()) ? b.trim().replace(/\/$/, '') : DEFAULT_BASE;
  }
  isConfigured(): boolean { return this.key() !== null; }

  /**
   * Avatars the owner may choose from.
   *
   * @security Returns provider id, a display name and a preview only. No
   *   demographic field is carried forward: LaunchMind must never rank or
   *   recommend a presenter by gender, age or ethnicity, and the surest way to
   *   avoid that is not to have the data.
   */
  async listAvatars(limit = 60): Promise<ProviderAvatar[]> {
    const apiKey = this.key();
    if (!apiKey) {
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Presenter videos are not available yet.', 'HEYGEN_API_KEY absent');
    }
    // LEGACY_TEMPORARY — see the file header. v3's avatar list returns group
    // ids the render endpoint rejects; only v2 exposes renderable look ids.
    // MUST be replaced before HEYGEN_LEGACY_REMOVAL_DATE.
    let res: Response;
    try {
      res = await fetch(`${this.base()}/v2/avatars`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
    } catch {
      throw new CreativeProviderError('PROVIDER_UNAVAILABLE',
        'LaunchMind could not load the list of presenters.', 'heygen avatars fetch failed');
    }
    if (!res.ok) throw categorise(res.status);

    let body: { data?: { avatars?: HeyGenAvatarRow[] } };
    try { body = await res.json() as typeof body; }
    catch {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'LaunchMind could not read the list of presenters.', 'heygen avatars json');
    }
    // `gender` is present on every row and is deliberately NOT carried forward.
    return (body.data?.avatars ?? [])
      .filter(a => typeof a.avatar_id === 'string' && a.avatar_id.length > 0)
      .slice(0, limit)
      .map(a => ({
        providerAvatarId: a.avatar_id!,
        displayName: (a.avatar_name ?? 'Presenter').slice(0, 80),
        previewUrl: typeof a.preview_image_url === 'string' ? a.preview_image_url : null,
        // v2 carries no default voice, so the owner picks one from the v3 list.
        defaultVoiceId: null,
      }));
  }

  /**
   * Voices this presenter may speak with.
   *
   * @security Provider stock inventory only, and a `gender` field the provider
   *   supplies is deliberately NOT carried forward: LaunchMind must never rank
   *   or recommend a voice by it, and the surest way is not to hold the data.
   */
  async listVoices(limit = 60): Promise<ProviderVoiceOption[]> {
    const apiKey = this.key();
    if (!apiKey) {
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Presenter videos are not available yet.', 'HEYGEN_API_KEY absent');
    }
    let res: Response;
    try {
      res = await fetch(`${this.base()}/v3/voices?limit=${PAGE_SIZE}`, {
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
    } catch {
      throw new CreativeProviderError('PROVIDER_UNAVAILABLE',
        'LaunchMind could not load the list of voices.', 'heygen voices fetch failed');
    }
    if (!res.ok) throw categorise(res.status);
    let body: { data?: Array<{ voice_id?: string; name?: string; language?: string;
      preview_audio_url?: string; type?: string }> };
    try { body = await res.json() as typeof body; }
    catch {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'LaunchMind could not read the list of voices.', 'heygen voices json');
    }
    // `public` only: a voice cloned onto this account has no consent record in
    // LaunchMind, and possession is not permission. `gender` is dropped.
    return (body.data ?? [])
      .filter(v => typeof v.voice_id === 'string' && v.voice_id.length > 0)
      .filter(v => (v.type ?? 'public').toLowerCase() === 'public')
      .filter(v => (v.language ?? '').toLowerCase().includes('english'))
      .slice(0, limit)
      .map(v => ({
        providerVoiceId: v.voice_id!,
        displayName: (v.name ?? 'Voice').trim().slice(0, 80) || 'Voice',
        language: v.language ?? null,
        previewUrl: typeof v.preview_audio_url === 'string' ? v.preview_audio_url : null,
      }));
  }

  /**
   * Renders one avatar video from a GOVERNED script.
   *
   * @throws {CreativeProviderError} BLOCKED_BY_GOVERNANCE when no presenter was
   *   selected — the adapter will not choose one.
   */
  async generateVideo(instruction: VideoRenderInstruction): Promise<MediaRenderOutput> {
    const apiKey = this.key();
    if (!apiKey) {
      // NOT a placeholder video. An absent key is an absent capability.
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Presenter videos are not available yet.', 'HEYGEN_API_KEY absent');
    }
    if (!instruction.providerAvatarId) {
      throw new CreativeProviderError('BLOCKED_BY_GOVERNANCE',
        'Choose a presenter before creating this video.', 'no avatar selected');
    }
    const script = (instruction.spokenScript ?? '').trim();
    if (!script) {
      throw new CreativeProviderError('BLOCKED_BY_GOVERNANCE',
        'There is no approved wording for the presenter to say.', 'empty governed script');
    }

    const started = Date.now();
    // HeyGen REQUIRES a voice id. It does not fall back to a per-avatar default —
    // omitting it returns invalid_parameter "voice.voice_id is invalid: Field
    // required". So a presenter video needs BOTH selections from the owner, and
    // the adapter refuses rather than choosing a voice on their behalf.
    if (!instruction.providerVoiceId) {
      throw new CreativeProviderError('BLOCKED_BY_GOVERNANCE',
        'Choose a voice for your presenter before creating this video.',
        'heygen requires voice_id');
    }
    const voice = {
      type: 'text', input_text: script, voice_id: instruction.providerVoiceId,
    };

    const payload = {
      type: 'avatar',
      avatar_id: instruction.providerAvatarId,
      script: voice.input_text,
      voice_id: voice.voice_id,
      title: 'LaunchMind creative',
      resolution: '720p',
      aspect_ratio: instruction.aspectRatio === '9:16' ? '9:16' : '16:9',
      // EXPLICIT. Omitting this defaults to Avatar IV, which the stock presenter
      // inventory does not support — a default that would silently break every
      // render the day HeyGen changes it.
      engine: { type: 'avatar_iii' },
    };

    let res: Response;
    try {
      res = await fetch(`${this.base()}/v3/videos`, {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
      throw new CreativeProviderError(
        timedOut ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        timedOut ? 'Creating the video took too long.' : 'LaunchMind could not reach its presenter service.',
        'heygen create failed');
    }
    if (!res.ok) throw categorise(res.status);

    let created: { data?: { video_id?: string }; error?: unknown };
    try { created = await res.json() as typeof created; }
    catch {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'LaunchMind could not read the presenter service response.', 'heygen create json');
    }
    // HeyGen returns 200 with a populated `error` for some refusals.
    if (created.error) {
      throw new CreativeProviderError('PROVIDER_REFUSED',
        'The presenter service would not create this video.', 'heygen create returned error');
    }
    const videoId = created.data?.video_id;
    if (!videoId) {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'LaunchMind could not create the video.', 'heygen create returned no video id');
    }

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      let st: Response;
      try {
        st = await fetch(`${this.base()}/v3/videos/${encodeURIComponent(videoId)}`, {
          headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
      } catch { continue; }             // a dropped poll is not a failed render
      if (!st.ok) throw categorise(st.status);

      let body: { data?: { status?: string; video_url?: string; url?: string;
        duration?: number } };
      try { body = await st.json() as typeof body; } catch { continue; }
      const status = body.data?.status;
      const url = body.data?.video_url ?? body.data?.url;

      if ((status === 'completed' || status === 'succeeded') && url) {
        return {
          mediaUrl: url,
          mimeType: 'video/mp4',
          durationMs: typeof body.data?.duration === 'number'
            ? Math.round(body.data.duration * 1000) : null,
          widthPx: instruction.aspectRatio === '9:16' ? 720 : 1280,
          heightPx: instruction.aspectRatio === '9:16' ? 1280 : 720,
          providerRequestRef: videoId,
          latencyMs: Date.now() - started,
          // HeyGen reports no per-render cost on this endpoint. Never estimated.
          costUsd: null,
        };
      }
      if (status === 'failed' || status === 'error') {
        throw new CreativeProviderError('PROVIDER_REFUSED',
          'The presenter service could not finish this video.', 'heygen status failed');
      }
    }
    throw new CreativeProviderError('TIMEOUT',
      'Creating the video took too long.', 'heygen polls exhausted');
  }
}
