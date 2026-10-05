/**
 * @file elevenLabsCreativeAdapter.ts
 * @description The ElevenLabs voice adapter — B6B §10, §11, §18.
 *
 *   STOCK VOICES ONLY, AND NO CLONING. This repository already contains the
 *   machinery for cloning: `lib/elevenLabsClient.ts` exports `createVoiceClone`,
 *   and `products.voice_clone_id` / `founders.voice_clone_id` exist. What it
 *   does NOT contain anywhere is a consent record — no actor, no rights basis,
 *   no timestamp, no evidence that the person whose voice it is ever agreed.
 *
 *   Possessing an audio file is not permission. So this adapter has no clone
 *   method at all: the capability is absent rather than guarded, because a guard
 *   can be removed by someone who does not know why it was there. When a consent
 *   contract exists, cloning becomes a new capability with its own authorisation
 *   path — not a flag flipped here.
 *
 *   NOT a reuse of lib/elevenLabsClient.ts, which returns an EMPTY BUFFER when
 *   the key is missing. Downstream that is a zero-byte "audio track" attached to
 *   a video the owner is asked to approve — the same fabricated-success shape
 *   B6A found in the legacy Replicate client.
 *
 * @security Key read per call, sent only in the xi-api-key header, never logged,
 *   never in an Error, never returned. The script is sent verbatim; this adapter
 *   cannot alter wording, and nothing about authority, scope or approval is sent.
 * @dependencies creativeProviderTypes
 */

import {
  CreativeProviderError, type CreativeProviderAdapter, type CreativeCapability,
  type VoiceRenderInstruction, type MediaRenderOutput,
} from './creativeProviderTypes';

const BASE = 'https://api.elevenlabs.io';
const TIMEOUT_MS = 90_000;
const MAX_BYTES = 25 * 1024 * 1024;

/** Voice categories LaunchMind may use. A cloned voice is not among them. */
const PERMITTED_CATEGORIES = new Set(['premade', 'professional', 'generated']);

function categorise(status: number, detail?: string): CreativeProviderError {
  if (status === 401 || status === 403) {
    // Distinguished because the fixes differ: a missing key is configuration, a
    // permission failure is an account scope the owner has to widen.
    const scoped = detail === 'missing_permissions';
    return new CreativeProviderError('ADAPTER_UNAVAILABLE',
      scoped
        ? 'LaunchMind’s voice service is connected but not permitted to be used yet.'
        : 'LaunchMind could not reach its voice service.',
      `elevenlabs ${status}${scoped ? ' missing_permissions' : ''}`);
  }
  if (status === 429) {
    return new CreativeProviderError('RATE_LIMITED',
      'The voice service is busy. LaunchMind will try again shortly.', 'elevenlabs 429');
  }
  if (status === 400 || status === 422) {
    return new CreativeProviderError('PROVIDER_REFUSED',
      'The voice service would not read this script.', `elevenlabs ${status}`);
  }
  if (status >= 500) {
    return new CreativeProviderError('PROVIDER_UNAVAILABLE',
      'The voice service is unavailable right now.', `elevenlabs ${status}`);
  }
  return new CreativeProviderError('MALFORMED_RESPONSE',
    'LaunchMind could not create the voice track.', `elevenlabs ${status}`);
}

/** Reads ONLY a machine code from an error body. The body itself is discarded. */
async function detailCode(res: Response): Promise<string | undefined> {
  try {
    const b = await res.json() as { detail?: { status?: string } | string };
    return typeof b.detail === 'object' && b.detail ? b.detail.status : undefined;
  } catch { return undefined; }
}

/** Owner-safe voice inventory. Provider metadata only — never evidence. */
export interface ProviderVoice {
  providerVoiceId: string;
  displayName: string;
  language: string | null;
  previewUrl: string | null;
}

export class ElevenLabsCreativeAdapter implements CreativeProviderAdapter {
  readonly provider = 'ELEVENLABS' as const;
  readonly capabilities: readonly CreativeCapability[] = ['VOICE'];

  private key(): string | null {
    const k = process.env.ELEVENLABS_API_KEY;
    return typeof k === 'string' && k.trim().length > 0 ? k.trim() : null;
  }
  isConfigured(): boolean { return this.key() !== null; }

  /**
   * Voices the owner may choose from.
   *
   * @security Filtered to provider stock categories. A cloned voice on the
   *   account is EXCLUDED rather than offered, because LaunchMind holds no
   *   record of whose voice it is or whether they agreed.
   */
  async listVoices(): Promise<ProviderVoice[]> {
    const apiKey = this.key();
    if (!apiKey) {
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Voice is not available yet.', 'ELEVENLABS_API_KEY absent');
    }
    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/voices`, {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new CreativeProviderError('PROVIDER_UNAVAILABLE',
        'LaunchMind could not load the list of voices.', 'elevenlabs voices fetch failed');
    }
    if (!res.ok) throw categorise(res.status, await detailCode(res));

    let body: { voices?: Array<{ voice_id?: string; name?: string; category?: string;
      labels?: Record<string, string>; preview_url?: string }> };
    try { body = await res.json() as typeof body; }
    catch {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'LaunchMind could not read the list of voices.', 'elevenlabs voices json');
    }
    return (body.voices ?? [])
      .filter(v => typeof v.voice_id === 'string'
        && PERMITTED_CATEGORIES.has(String(v.category ?? '').toLowerCase()))
      .map(v => ({
        providerVoiceId: v.voice_id!,
        displayName: (v.name ?? 'Voice').slice(0, 80),
        language: v.labels?.language ?? v.labels?.accent ?? null,
        previewUrl: typeof v.preview_url === 'string' ? v.preview_url : null,
      }));
  }

  /**
   * Reads GOVERNED text aloud. Verbatim — this adapter cannot alter wording.
   *
   * @security Returns bytes, not a provider URL, so there is no expiring link to
   *   mistake for the asset. An empty response is a failure, never silent success.
   */
  async generateVoice(instruction: VoiceRenderInstruction): Promise<MediaRenderOutput> {
    const apiKey = this.key();
    if (!apiKey) {
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Voice is not available yet.', 'ELEVENLABS_API_KEY absent');
    }
    if (!instruction.providerVoiceId) {
      throw new CreativeProviderError('BLOCKED_BY_GOVERNANCE',
        'Choose a voice before creating this audio.', 'no voice selected');
    }
    const text = (instruction.text ?? '').trim();
    if (!text) {
      throw new CreativeProviderError('BLOCKED_BY_GOVERNANCE',
        'There is no approved wording to read aloud.', 'empty governed text');
    }

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(
        `${BASE}/v1/text-to-speech/${encodeURIComponent(instruction.providerVoiceId)}`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: instruction.modelRef }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (e) {
      const timedOut = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
      throw new CreativeProviderError(
        timedOut ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        timedOut ? 'Creating the voice track took too long.' : 'LaunchMind could not reach its voice service.',
        'elevenlabs tts failed');
    }
    if (!res.ok) throw categorise(res.status, await detailCode(res));

    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('audio/')) {
      throw new CreativeProviderError('INVALID_CONTENT_TYPE',
        'What the voice service returned was not audio.', `content-type ${mime || 'absent'}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    // An empty buffer is exactly the fabricated-success shape the legacy client
    // produced. Reported as a failure instead.
    if (bytes.length === 0) {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'The voice track came back empty.', 'zero bytes');
    }
    if (bytes.length > MAX_BYTES) {
      throw new CreativeProviderError('INVALID_CONTENT_TYPE',
        'The voice track was too large to save.', `bytes ${bytes.length}`);
    }

    return {
      bytes, mimeType: mime, durationMs: null, widthPx: null, heightPx: null,
      providerRequestRef: res.headers.get('request-id'),
      latencyMs: Date.now() - started,
      costUsd: null,
    };
  }

  // NO createVoiceClone. See the file header: the capability is absent, not
  // guarded, because a guard can be removed by someone who does not know why.
}
