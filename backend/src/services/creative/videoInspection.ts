/**
 * @file videoInspection.ts
 * @description Bounded inspection of a rendered video — B6B §8.
 *
 *   Provider metadata is not evidence about the file. A provider that reports
 *   "720x1280, 6 seconds" is describing what it was asked for; the bytes we
 *   stored are what an owner will actually watch. So container facts are read
 *   from the FILE.
 *
 *   TWO CAPABILITIES, DELIBERATELY SEPARATED, because one is always available
 *   and the other is not:
 *
 *     CONTAINER  duration, dimensions, codec, track layout. Parsed here from the
 *                MP4 atom tree with no dependency at all. Always available.
 *
 *     FRAMES     representative stills. Genuinely needs a decoder. Reported as
 *                UNAVAILABLE when ffmpeg is absent rather than approximated —
 *                a fabricated frame would be worse than no frame, because it
 *                would be reviewed as though it showed something.
 *
 *   This is NOT a computer-vision system and must not grow into one. It answers
 *   "is this a real video of the shape we expected", nothing more.
 *
 * @security Parsing is bounded: atom sizes are validated against the buffer, a
 *   maximum depth is enforced, and a zero or negative size ends the walk. A
 *   malformed file from a provider must not become an infinite loop.
 * @dependencies node:child_process (only to detect and invoke ffmpeg if present)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export interface VideoContainerFacts {
  /** Duration in milliseconds, from the movie header. */
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  /** e.g. 'avc1', 'hvc1'. The sample-entry format code. */
  videoCodec: string | null;
  audioCodec: string | null;
  /** Major brand from ftyp, e.g. 'isom', 'mp42'. */
  brand: string | null;
  byteSize: number;
  /** False when the bytes are not a parseable MP4 at all. */
  parsed: boolean;
}

const MAX_DEPTH = 8;
const VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v']);
const AUDIO_CODECS = new Set(['mp4a', 'ac-3', 'ec-3', 'Opus', 'alac']);

/**
 * Reads container facts from MP4 bytes.
 *
 * @security Every atom size is checked against the remaining buffer before the
 *   walk advances, so a truncated or hostile file terminates rather than looping.
 */
export function inspectMp4Container(bytes: Buffer): VideoContainerFacts {
  const facts: VideoContainerFacts = {
    durationMs: null, widthPx: null, heightPx: null,
    videoCodec: null, audioCodec: null, brand: null,
    byteSize: bytes.length, parsed: false,
  };

  function walk(start: number, end: number, depth: number): void {
    if (depth > MAX_DEPTH) return;
    let off = start;
    while (off + 8 <= end) {
      const size = bytes.readUInt32BE(off);
      const type = bytes.toString('latin1', off + 4, off + 8);
      // A zero or absurd size means the tree is not walkable from here.
      if (size < 8 || off + size > end) return;

      if (type === 'ftyp' && off + 12 <= end) {
        facts.brand = bytes.toString('latin1', off + 8, off + 12);
        facts.parsed = true;
      } else if (type === 'mvhd' && off + 32 <= end) {
        const version = bytes[off + 8];
        if (version === 0 && off + 28 <= end) {
          const timescale = bytes.readUInt32BE(off + 20);
          const duration = bytes.readUInt32BE(off + 24);
          if (timescale > 0) facts.durationMs = Math.round((duration / timescale) * 1000);
        } else if (version === 1 && off + 40 <= end) {
          const timescale = bytes.readUInt32BE(off + 28);
          // 64-bit duration; Number is exact well past any real video length.
          const duration = Number(bytes.readBigUInt64BE(off + 32));
          if (timescale > 0) facts.durationMs = Math.round((duration / timescale) * 1000);
        }
        facts.parsed = true;
      } else if (type === 'tkhd' && off + 92 <= end) {
        const version = bytes[off + 8];
        const base = version === 1 ? off + 8 + 88 : off + 8 + 76;
        if (base + 8 <= end) {
          // Fixed-point 16.16 width/height on the track header.
          const w = bytes.readUInt32BE(base) / 65536;
          const h = bytes.readUInt32BE(base + 4) / 65536;
          // Audio tracks carry 0x0; only a visual track sets these.
          if (w > 0 && h > 0) { facts.widthPx = Math.round(w); facts.heightPx = Math.round(h); }
        }
      } else if (VIDEO_CODECS.has(type)) {
        facts.videoCodec ??= type;
      } else if (AUDIO_CODECS.has(type)) {
        facts.audioCodec ??= type;
      }

      // Containers whose children are atoms. stsd has an 8-byte prelude.
      if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta'].includes(type)) {
        walk(off + 8, off + size, depth + 1);
      } else if (type === 'stsd' && off + 16 <= end) {
        walk(off + 16, off + size, depth + 1);
      }
      off += size;
    }
  }

  try { walk(0, bytes.length, 0); } catch { /* malformed: facts stay partial */ }
  return facts;
}

export type FrameCapability = 'AVAILABLE' | 'UNAVAILABLE_NO_DECODER';

/** Is a decoder present on this machine? Detected, never assumed. */
export async function frameCapability(): Promise<FrameCapability> {
  try {
    await exec('ffmpeg', ['-version'], { timeout: 5_000 });
    return 'AVAILABLE';
  } catch { return 'UNAVAILABLE_NO_DECODER'; }
}

export interface FrameExtraction {
  capability: FrameCapability;
  /** Paths to extracted stills. Empty when no decoder is present. */
  framePaths: string[];
  /** Owner-safe explanation when frames could not be produced. */
  note: string | null;
}

/**
 * Extracts up to five representative stills — first, 25%, 50%, 75%, last.
 *
 * @security Returns UNAVAILABLE_NO_DECODER with an empty list when ffmpeg is
 *   absent. It never substitutes a placeholder, a poster or a provider preview:
 *   a frame that did not come from this file would be reviewed as though it did.
 */
export async function extractRepresentativeFrames(
  videoPath: string, outDir: string, durationMs: number | null,
): Promise<FrameExtraction> {
  const capability = await frameCapability();
  if (capability !== 'AVAILABLE') {
    return {
      capability, framePaths: [],
      note: 'Frame-level review is unavailable on this machine because no video decoder is installed.',
    };
  }
  if (!durationMs || durationMs <= 0) {
    return { capability, framePaths: [], note: 'The video reported no duration to sample from.' };
  }

  const seconds = durationMs / 1000;
  const marks = [0, 0.25, 0.5, 0.75, 0.98].map(f => Math.max(0, seconds * f));
  const paths: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const out = `${outDir}/frame-${i}.png`;
    try {
      await exec('ffmpeg', ['-y', '-ss', marks[i].toFixed(2), '-i', videoPath,
        '-frames:v', '1', '-q:v', '2', out], { timeout: 30_000 });
      paths.push(out);
    } catch { /* one unreadable timestamp must not lose the others */ }
  }
  return {
    capability, framePaths: paths,
    note: paths.length === 0 ? 'No frames could be read from this video.' : null,
  };
}
