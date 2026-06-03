/**
 * @file creatomateClient.ts
 * @description Creatomate video assembly API client.
 *   Assembles image frames + MP3 audio + text overlays into final MP4.
 *   Returns a mock URL when CREATOMATE_API_KEY is not configured.
 * @security API key in env, never logged.
 * @dependencies ENV: CREATOMATE_API_KEY
 */

const CREATOMATE_BASE = 'https://api.creatomate.com/v1';

export interface VideoScene {
  duration: number;
  backgroundImage?: string;
  backgroundColor?: string;
  textOverlay?: string;
  textColor?: string;
  audioUrl?: string;
}

export interface VideoRenderInput {
  scenes: VideoScene[];
  outputFormat: 'mp4' | 'mp3';
  width: number;
  height: number;
  frameRate?: number;
  captionsEnabled?: boolean;
}

/**
 * Renders a video from scenes using Creatomate.
 * Returns a placeholder ID when CREATOMATE_API_KEY is not configured.
 * @param input - Video render specification
 * @returns Render ID to poll for completion
 */
export async function renderVideo(input: VideoRenderInput): Promise<string> {
  const apiKey = process.env.CREATOMATE_API_KEY;
  if (!apiKey) {
    console.warn('[creatomateClient] CREATOMATE_API_KEY not set — returning mock render ID');
    return `mock-render-${Date.now()}`;
  }

  const elements = input.scenes.flatMap((scene, i) => {
    const start = input.scenes.slice(0, i).reduce((s, sc) => s + sc.duration, 0);
    const els = [];

    if (scene.backgroundImage) {
      els.push({ type: 'image', source: scene.backgroundImage, time: start, duration: scene.duration, fit: 'cover' });
    } else {
      els.push({ type: 'rectangle', fill_color: scene.backgroundColor ?? '#1a1a2e', time: start, duration: scene.duration, width: '100%', height: '100%' });
    }

    if (scene.textOverlay) {
      els.push({ type: 'text', text: scene.textOverlay, color: scene.textColor ?? '#ffffff', font_size: '7 vmin', font_weight: '600', x_alignment: '50%', y_alignment: '85%', width: '85%', time: start, duration: scene.duration });
    }

    return els;
  });

  const response = await fetch(`${CREATOMATE_BASE}/renders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ output_format: input.outputFormat, width: input.width, height: input.height, frame_rate: input.frameRate ?? 30, elements }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Creatomate error: ${response.status} ${await response.text()}`);
  }

  const [render] = await response.json() as Array<{ id: string }>;
  return render.id;
}

/**
 * Polls Creatomate for render completion (max 5 min, every 5s).
 * Returns a placeholder URL when the render ID is a mock.
 * @param renderId - ID returned by renderVideo()
 * @returns Final video URL
 */
export async function pollRender(renderId: string): Promise<string> {
  if (renderId.startsWith('mock-render-')) {
    return `https://placeholder.launchmind.com/video/${renderId}.mp4`;
  }

  const apiKey = process.env.CREATOMATE_API_KEY!;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${CREATOMATE_BASE}/renders/${renderId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const render = await res.json() as { status: string; url?: string; error_message?: string };
    if (render.status === 'succeeded') return render.url!;
    if (render.status === 'failed') throw new Error(`Creatomate render failed: ${render.error_message}`);
  }

  throw new Error('Creatomate render timed out after 5 minutes');
}
