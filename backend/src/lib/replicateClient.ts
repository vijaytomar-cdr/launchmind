/**
 * @file replicateClient.ts
 * @description Replicate API client for AI image generation using Flux.1 Schnell.
 *   Generates marketing background images from visual brief descriptions.
 *   Returns a placeholder URL when REPLICATE_API_KEY is not configured.
 * @security API key read at call time, never logged.
 * @dependencies ENV: REPLICATE_API_KEY
 */

const REPLICATE_BASE = 'https://api.replicate.com/v1';

export interface ImageGenerationInput {
  prompt: string;
  width?: number;
  height?: number;
  numOutputs?: number;
  outputQuality?: number;
}

/**
 * Generates an image using Replicate Flux.1 Schnell.
 * Returns a placeholder URL when REPLICATE_API_KEY is not configured.
 * @param input - Image generation parameters
 * @returns Public URL of the generated image
 */
export async function generateImage(input: ImageGenerationInput): Promise<string> {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    console.warn('[replicateClient] REPLICATE_API_KEY not set — returning mock image URL');
    return `https://placeholder.launchmind.com/image/mock-${Date.now()}.png`;
  }

  const response = await fetch(`${REPLICATE_BASE}/models/black-forest-labs/flux-schnell/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',
    },
    body: JSON.stringify({
      input: {
        prompt: input.prompt,
        aspect_ratio: '1:1',
        output_quality: input.outputQuality ?? 80,
        num_outputs: input.numOutputs ?? 1,
        output_format: 'png',
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Replicate API error: ${response.status} ${errorBody}`);
  }

  const prediction = await response.json() as {
    id: string;
    status: string;
    output?: string[];
    error?: string;
    urls?: { get: string };
  };

  // If 'Prefer: wait' was honored and prediction succeeded immediately
  if (prediction.status === 'succeeded' && prediction.output?.[0]) {
    return prediction.output[0];
  }

  // Otherwise poll until done (max ~2 min)
  return pollPrediction(prediction.id, apiKey);
}

async function pollPrediction(predictionId: string, apiKey: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));

    const res = await fetch(`${REPLICATE_BASE}/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    const pred = await res.json() as {
      status: string;
      output?: string[];
      error?: string;
    };

    if (pred.status === 'succeeded' && pred.output?.[0]) {
      return pred.output[0];
    }
    if (pred.status === 'failed' || pred.status === 'canceled') {
      throw new Error(`Replicate prediction ${pred.status}: ${pred.error ?? 'unknown error'}`);
    }
  }

  throw new Error('Replicate image generation timed out after 2 minutes');
}

export type ImageStyle = 'photorealistic' | 'graphic' | 'mockup';

// Anti-split negative prompts applied to every Flux.1 call
const ANTI_SPLIT = 'no split screen, no diptych, no panels, no before-and-after, no side-by-side, single unified composition';
const ANTI_TEXT  = 'no text, no letters, no watermarks, no logos, no UI overlays';
const ANTI_DARK  = 'no dark moody shadows, no silhouettes, no dramatic shadows obscuring faces';

/**
 * Builds a Flux.1 image generation prompt from meta_image_brief structured fields.
 * Defensively strips split-panel language before building the prompt.
 * Style variants: photorealistic (default), graphic (flat design), mockup (phone frame).
 * @param brief  - Parsed brief fields from text_content JSON
 * @param style  - Visual style: photorealistic | graphic | mockup
 * @returns Concise prompt optimised for Flux.1 Schnell marketing images
 */
export function buildMarketingImagePrompt(brief: {
  mainVisual: string;
  emotionToConvey?: string;
  backgroundColor?: string;
  doNotInclude?: string;
  canvaTemplate?: string;
}, style: ImageStyle = 'photorealistic'): string {
  // Always extract the positive/resolution scene — strips "left shows X, right shows Y" → keeps Y
  const scene = _extractPositiveScene(brief.mainVisual);

  if (style === 'graphic') return _buildGraphicPrompt({ ...brief, mainVisual: scene });
  if (style === 'mockup')  return _buildMockupPrompt({ ...brief, mainVisual: scene });

  // Emotion → warm, positive lighting (never dark/cinematic)
  const emotionToLighting: Record<string, string> = {
    relief:       'warm golden hour light, bright airy space, soft shadows',
    trust:        'soft natural daylight, clean bright interior, welcoming',
    speed:        'bright clean studio, crisp sharp lighting',
    excitement:   'vivid bright colours, high energy, sunlit',
    professional: 'bright neutral studio lighting, clean, formal',
    confidence:   'warm studio lighting, welcoming, sharp',
    warmth:       'golden warm light, cosy bright interior',
  };
  const emotion  = brief.emotionToConvey?.toLowerCase() ?? 'trust';
  const lighting = emotionToLighting[emotion] ?? 'bright professional studio lighting, warm and clean';

  const userAvoid = brief.doNotInclude ? `, avoid ${brief.doNotInclude}` : '';

  return `${scene}, ${lighting}, single unified scene, commercial photography style, 4K sharp focus, warm inviting tones, marketing ad quality, ${ANTI_SPLIT}, ${ANTI_TEXT}, ${ANTI_DARK}${userAvoid}`;
}

/**
 * Extracts the positive/resolution half when mainVisual describes a split or before/after scene.
 * "left shows X, right shows Y" → returns Y
 * "before: X, after: Y" → returns Y
 * Returns the original string when no split pattern is found.
 */
function _extractPositiveScene(mainVisual: string): string {
  // "right shows/panel/side: X"
  const rightMatch = mainVisual.match(/right\s+(?:shows?|panel|side|half)[,:\s]+(.+?)(?:,\s*$|\s*$)/i);
  if (rightMatch?.[1]) return rightMatch[1].trim();

  // "after: X" / "after showing X"
  const afterMatch = mainVisual.match(/after[,:\s]+(.+?)(?:,\s*$|\s*$)/i);
  if (afterMatch?.[1]) return afterMatch[1].trim();

  // "X vs Y" — take the Y (resolution) half
  const vsMatch = mainVisual.match(/\bvs\.?\s+(.+?)(?:,\s*$|\s*$)/i);
  if (vsMatch?.[1]) return vsMatch[1].trim();

  // Contains "left" and "right" as compositional keywords — split on comma and take last meaningful chunk
  if (/\bleft\b/i.test(mainVisual) && /\bright\b/i.test(mainVisual)) {
    const parts = mainVisual.split(/[,;]+/);
    const positivePart = parts.find(p => /\bright\b/i.test(p)) ?? parts[parts.length - 1];
    return positivePart.replace(/\bright\s+(?:shows?|panel|side)[,:\s]*/i, '').trim();
  }

  return mainVisual;
}

function _buildGraphicPrompt(brief: {
  mainVisual: string;
  backgroundColor?: string;
  doNotInclude?: string;
}): string {
  const bg = brief.backgroundColor ?? 'deep indigo #4f46e5';
  const userAvoid = brief.doNotInclude ? `, avoid ${brief.doNotInclude}` : '';
  return `flat design vector illustration, ${brief.mainVisual}, bold geometric icons, ${bg} background, clean minimal, vibrant professional marketing visual, app category icons, Dribbble quality, ${ANTI_SPLIT}, ${ANTI_TEXT}, no photographs, no realistic faces${userAvoid}`;
}

function _buildMockupPrompt(brief: {
  mainVisual: string;
  backgroundColor?: string;
  doNotInclude?: string;
}): string {
  const bg = brief.backgroundColor ?? 'soft gradient indigo to purple';
  const userAvoid = brief.doNotInclude ? `, avoid ${brief.doNotInclude}` : '';
  return `iPhone 15 Pro product mockup floating on ${bg} background, app booking UI visible on screen, ${brief.mainVisual}, studio product photography, drop shadow, clean minimal, Behance quality, ${ANTI_SPLIT}, ${ANTI_TEXT}${userAvoid}`;
}
