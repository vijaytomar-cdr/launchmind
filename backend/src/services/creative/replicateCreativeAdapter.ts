/**
 * @file replicateCreativeAdapter.ts
 * @description The Replicate creative adapter — B6A §20.
 *
 *   Deliberately NOT a reuse of lib/replicateClient.ts. That client is the
 *   legacy Studio path and does one thing this lane must never do: when
 *   REPLICATE_API_KEY is absent it returns
 *
 *       https://placeholder.launchmind.com/image/mock-<timestamp>.png
 *
 *   A URL that looks like a result but is not one. Downstream that becomes a
 *   stored asset, a SUCCEEDED job and an image the owner is asked to approve —
 *   the precise "fabricated creative" failure §29 forbids. Here, an absent
 *   credential is ADAPTER_UNAVAILABLE and the owner is told the truth.
 *
 *   The legacy client also raises `Replicate API error: 422 <body>`. Provider
 *   error bodies echo the request — for an image provider that means the prompt,
 *   and occasionally the Authorization header when a proxy is in the path. Only
 *   the STATUS is read here; the body is parsed for a machine code at most and
 *   is never propagated.
 *
 * @security Credential read per call from the server environment, sent only in
 *   the Authorization header, never logged, never placed in an Error, never
 *   returned. Reference image URLs are passed through only after the caller has
 *   proven they are owner-authorised — the adapter cannot tell the difference
 *   and does not try.
 * @dependencies creativeProviderTypes · creativeModelRouting
 */

import {
  CreativeProviderError, type CreativeProviderAdapter, type CreativeCapability,
  type CreativeRenderInstruction, type CreativeRenderOutput,
  type VideoRenderInstruction, type MediaRenderOutput,
} from './creativeProviderTypes';

const BASE = 'https://api.replicate.com/v1';
const CREATE_TIMEOUT_MS = 90_000;
const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 2_500;
const MAX_POLLS = 40;                 // ~100s ceiling on an async prediction
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_MAX_POLLS = 72;           // ~6 min; generative video is slow
const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Maps an HTTP status to something the owner can act on. Body never read for this. */
function categoriseStatus(status: number): CreativeProviderError {
  if (status === 401 || status === 403) {
    return new CreativeProviderError('ADAPTER_UNAVAILABLE',
      'LaunchMind could not reach its image service.', `replicate auth ${status}`);
  }
  if (status === 429) {
    return new CreativeProviderError('RATE_LIMITED',
      'The image service is busy. LaunchMind will try again shortly.', 'replicate 429');
  }
  if (status === 422 || status === 400) {
    // The provider understood us and refused. Retrying identical input repeats it.
    return new CreativeProviderError('PROVIDER_REFUSED',
      'The image service would not create this concept. Try adjusting the visual direction.',
      `replicate ${status}`);
  }
  if (status >= 500) {
    return new CreativeProviderError('PROVIDER_UNAVAILABLE',
      'The image service is unavailable right now.', `replicate ${status}`);
  }
  return new CreativeProviderError('MALFORMED_RESPONSE',
    'LaunchMind could not create the visual.', `replicate ${status}`);
}

interface Prediction {
  id?: string;
  status?: string;
  output?: unknown;
  metrics?: { predict_time?: number; total_time?: number };
}

/** Replicate returns either a string or an array of strings depending on model. */
function firstOutputUrl(output: unknown): string | null {
  if (typeof output === 'string' && output.startsWith('http')) return output;
  if (Array.isArray(output)) {
    const first = output.find(o => typeof o === 'string' && o.startsWith('http'));
    return (first as string) ?? null;
  }
  return null;
}

async function readJson(res: Response): Promise<Prediction> {
  try { return await res.json() as Prediction; }
  catch {
    throw new CreativeProviderError('MALFORMED_RESPONSE',
      'LaunchMind could not read the image service response.', 'json parse failed');
  }
}

export class ReplicateCreativeAdapter implements CreativeProviderAdapter {
  readonly provider = 'REPLICATE' as const;
  readonly capabilities: readonly CreativeCapability[] = ['IMAGE_GENERATION', 'TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'];

  private key(): string | null {
    const k = process.env.REPLICATE_API_KEY;
    return typeof k === 'string' && k.trim().length > 0 ? k.trim() : null;
  }

  isConfigured(): boolean { return this.key() !== null; }

  /**
   * Generative video for PRODUCT_MOTION — B6B §20.
   *
   * NO PEOPLE. The negative prompt is not the mechanism; the MODE is. B6A
   * established that a diffusion model told "no stock photography implying real
   * customers" draws people anyway, so a concept that needs someone speaking is
   * routed to the avatar provider instead of being asked of this one. The
   * prohibitions below are a second layer, not the first.
   *
   * @security Reference imagery, when present, has already been proven
   *   owner-authorised for VISUAL_RENDERING by the caller. This adapter cannot
   *   tell an authorised screenshot from a scraped one and does not try.
   */
  async generateVideo(instruction: VideoRenderInstruction): Promise<MediaRenderOutput> {
    const apiKey = this.key();
    if (!apiKey) {
      // NOT a placeholder video.
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Video creation is not available yet.', 'REPLICATE_API_KEY absent');
    }
    const prompt = (instruction.prompt ?? '').trim();
    if (!prompt) {
      throw new CreativeProviderError('BLOCKED_BY_GOVERNANCE',
        'There is nothing to base this video on yet.', 'empty video prompt');
    }

    const started = Date.now();
    // Video models do NOT share one input shape, and guessing produced a run of
    // opaque failures. The shape is chosen per model family, from each model's
    // published input schema rather than from assumption.
    const duration = Math.min(Math.max(instruction.durationSeconds ?? 5, 3), 10);
    const input: Record<string, unknown> = { prompt, duration };
    if (instruction.modelRef.startsWith('wan-video/')) {
      input.size = instruction.aspectRatio === '9:16' ? '720*1280' : '1280*720';
      // Carried explicitly. A renderer told nothing will fill the gap itself.
      input.negative_prompt = instruction.negativePrompt ?? '';
    } else {
      input.aspect_ratio = instruction.aspectRatio;
      input.resolution = '720p';
    }
    if (instruction.referenceImageUrl) input.image = instruction.referenceImageUrl;

    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${instruction.modelRef}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({ input }),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
      throw new CreativeProviderError(
        timedOut ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        timedOut ? 'Creating the video took too long.' : 'LaunchMind could not reach its video service.',
        'replicate video create failed');
    }
    if (!res.ok) throw categoriseStatus(res.status);
    let pred = await readJson(res);

    let polls = 0;
    while (pred.status !== 'succeeded' && polls < VIDEO_MAX_POLLS) {
      if (pred.status === 'failed' || pred.status === 'canceled') {
        throw new CreativeProviderError('PROVIDER_REFUSED',
          'The video service could not complete this video.', `prediction ${pred.status}`);
      }
      if (!pred.id) {
        throw new CreativeProviderError('MALFORMED_RESPONSE',
          'LaunchMind could not create the video.', 'prediction has no id');
      }
      await new Promise(r => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
      polls++;
      try {
        const p = await fetch(`${BASE}/predictions/${pred.id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
        if (!p.ok) throw categoriseStatus(p.status);
        pred = await readJson(p);
      } catch (e) {
        if (e instanceof CreativeProviderError) throw e;
        throw new CreativeProviderError('TIMEOUT',
          'Creating the video took too long.', 'video poll failed');
      }
    }
    if (pred.status !== 'succeeded') {
      throw new CreativeProviderError('TIMEOUT',
        'Creating the video took too long.', `video polls exhausted at ${pred.status}`);
    }

    const url = firstOutputUrl(pred.output);
    if (!url) {
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'The video service returned no video.', 'succeeded without output url');
    }
    return {
      mediaUrl: url,
      mimeType: 'video/mp4',
      durationMs: instruction.durationSeconds ? instruction.durationSeconds * 1000 : null,
      widthPx: null, heightPx: null,
      providerRequestRef: pred.id ?? null,
      latencyMs: Date.now() - started,
      costUsd: null,
    };
  }

  async generateImage(instruction: CreativeRenderInstruction): Promise<CreativeRenderOutput> {
    const apiKey = this.key();
    if (!apiKey) {
      // NOT a placeholder image. See file header.
      throw new CreativeProviderError('ADAPTER_UNAVAILABLE',
        'Image creation is not available yet.', 'REPLICATE_API_KEY absent');
    }

    const started = Date.now();
    const input: Record<string, unknown> = {
      prompt: instruction.prompt,
      aspect_ratio: instruction.aspectRatio,
      output_format: 'png',
      num_outputs: 1,
    };
    // Flux Schnell rejects unknown keys; only send what the route supports.
    if (instruction.negativePrompt) input.negative_prompt = instruction.negativePrompt;
    if (instruction.referenceImageUrls.length > 0) {
      input.image_prompt = instruction.referenceImageUrls[0];
    }

    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${instruction.modelRef}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({ input }),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
      throw new CreativeProviderError(
        timedOut ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        timedOut ? 'Creating the visual took too long.' : 'LaunchMind could not reach its image service.',
        'replicate create failed');
    }

    if (!res.ok) throw categoriseStatus(res.status);
    let pred = await readJson(res);

    // `Prefer: wait` usually resolves inline; poll only when it did not.
    let polls = 0;
    while (pred.status !== 'succeeded' && polls < MAX_POLLS) {
      if (pred.status === 'failed' || pred.status === 'canceled') {
        throw new CreativeProviderError('PROVIDER_REFUSED',
          'The image service could not complete this visual.', `prediction ${pred.status}`);
      }
      if (!pred.id) {
        throw new CreativeProviderError('MALFORMED_RESPONSE',
          'LaunchMind could not create the visual.', 'prediction has no id');
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      polls++;
      try {
        const p = await fetch(`${BASE}/predictions/${pred.id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
        if (!p.ok) throw categoriseStatus(p.status);
        pred = await readJson(p);
      } catch (e) {
        if (e instanceof CreativeProviderError) throw e;
        throw new CreativeProviderError('TIMEOUT',
          'Creating the visual took too long.', 'poll failed');
      }
    }

    if (pred.status !== 'succeeded') {
      throw new CreativeProviderError('TIMEOUT',
        'Creating the visual took too long.', `polls exhausted at ${pred.status}`);
    }

    const url = firstOutputUrl(pred.output);
    if (!url) {
      // Succeeded with nothing usable. Reported honestly rather than retried.
      throw new CreativeProviderError('MALFORMED_RESPONSE',
        'The image service returned no image.', 'succeeded without output url');
    }

    // Replicate reports predict_time in seconds. Cost is NOT reported on the
    // prediction body, so it stays null rather than being derived from a price
    // list nobody verified.
    return {
      imageUrl: url,
      mimeType: 'image/png',
      widthPx: null, heightPx: null,
      providerRequestRef: pred.id ?? null,
      latencyMs: Date.now() - started,
      costUsd: null,
    };
  }
}

/**
 * Downloads a provider output and validates it before it can become an asset.
 *
 * @security The provider URL is fetched WITHOUT the credential — it is a signed
 *   CDN link and forwarding a bearer token to it would leak the key to a host
 *   that does not need it. Content type and size are validated because a
 *   provider returning an HTML error page with 200 is a real failure mode, and
 *   storing it would give the owner a "picture" that is a stack trace.
 */
export async function downloadRenderedImage(
  url: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new CreativeProviderError('OUTPUT_EXPIRED',
      'The created visual was no longer available to download.', 'output fetch failed');
  }
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    throw new CreativeProviderError('OUTPUT_EXPIRED',
      'The created visual expired before LaunchMind could save it.', `output ${res.status}`);
  }
  if (!res.ok) throw categoriseStatus(res.status);

  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new CreativeProviderError('INVALID_CONTENT_TYPE',
      'What the image service returned was not an image.', `content-type ${mime || 'absent'}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new CreativeProviderError('MALFORMED_RESPONSE',
      'The created visual was empty.', 'zero bytes');
  }
  if (buf.length > MAX_BYTES) {
    throw new CreativeProviderError('INVALID_CONTENT_TYPE',
      'The created visual was too large to save.', `bytes ${buf.length}`);
  }
  return { bytes: buf, mimeType: mime };
}
