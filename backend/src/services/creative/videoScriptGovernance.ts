/**
 * @file videoScriptGovernance.ts
 * @description The governed script is the source of truth — B6B §12, §13, §14.
 *
 *   A short video is the densest claim surface LaunchMind produces. One clip
 *   carries spoken words, on-screen captions, a headline, a CTA, a face and a
 *   voice, and every one of those can assert something. Text governance can read
 *   a string; it cannot read a waveform or a frame.
 *
 *   So the rule from B6A hardens rather than relaxes: LaunchMind owns every word
 *   a viewer reads or hears. Providers receive the EXACT governed wording needed
 *   for their task and are never asked to write, summarise, shorten, punch up or
 *   caption. If a provider returns captions, they are compared against what was
 *   sent; if fidelity cannot be established, the provider's captions are
 *   discarded and LaunchMind's deterministic track is used.
 *
 *   Timing, line wrapping and punctuation normalisation are allowed because they
 *   do not change what was said. Anything that changes meaning is a copy change,
 *   and a copy change belongs back in the content pipeline, not in a renderer.
 *
 * @security Comparison is deterministic and model-free. A model asked "did the
 *   meaning change?" would be one more thing that can be talked into agreeing.
 * @dependencies creativeBriefs (types only)
 */

import type { VideoCreativeBrief } from '../content/creativeBriefs';

/** Whitespace, punctuation and casing normalised away; WORDS are not. */
function normalise(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[.,!?;:\-—–()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ScriptFidelityVerdict {
  faithful: boolean;
  /** Owner-safe sentences. Never a diff, never a pattern. */
  reasons: string[];
}

/**
 * Did a provider return the words LaunchMind sent?
 *
 * @param sent the governed text handed to the provider
 * @param returned what the provider says it rendered
 * @security Any added word is a failure. A provider that adds "the #1 choice"
 *   to a caption has authored a claim, and it would reach a viewer having passed
 *   through none of the claim machinery.
 */
export function checkScriptFidelity(sent: string, returned: string): ScriptFidelityVerdict {
  const a = normalise(sent);
  const b = normalise(returned);
  if (a === b) return { faithful: true, reasons: [] };

  const sentWords = new Set(a.split(' ').filter(Boolean));
  const added = b.split(' ').filter(w => w && !sentWords.has(w));
  const returnedWords = new Set(b.split(' ').filter(Boolean));
  const dropped = a.split(' ').filter(w => w && !returnedWords.has(w));

  const reasons: string[] = [];
  if (added.length > 0) {
    reasons.push(`The video service added wording LaunchMind did not write: "${added.slice(0, 6).join(' ')}".`);
  }
  if (dropped.length > 0) {
    reasons.push(`The video service left out wording from your approved script: "${dropped.slice(0, 6).join(' ')}".`);
  }
  if (reasons.length === 0) {
    reasons.push('The wording the video service returned does not match your approved script.');
  }
  return { faithful: false, reasons };
}

export interface CaptionLine { startMs: number; endMs: number; text: string }

export interface CaptionTrack {
  lines: CaptionLine[];
  /** LAUNCHMIND when we generated it; PROVIDER only if fidelity was proven. */
  source: 'LAUNCHMIND' | 'PROVIDER';
  /** Owner-safe note when a provider track was rejected. */
  notes: string[];
}

const WORDS_PER_SECOND = 2.6;   // conversational short-form pace
const MAX_CHARS_PER_LINE = 38;

/**
 * Builds a caption track from GOVERNED wording, deterministically.
 *
 * @security The only inputs are the governed voiceover lines. Nothing is
 *   summarised, rephrased or added, so a caption cannot assert anything the
 *   claim engine has not already seen.
 */
export function buildDeterministicCaptions(
  voiceoverLines: readonly string[], notes: string[] = [],
): CaptionTrack {
  const lines: CaptionLine[] = [];
  let cursorMs = 0;

  for (const raw of voiceoverLines) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    // Wrap only. Words are never altered, merged or dropped.
    const words = text.split(/\s+/);
    let current = '';
    const chunks: string[] = [];
    for (const w of words) {
      if (!current) { current = w; continue; }
      if ((current + ' ' + w).length <= MAX_CHARS_PER_LINE) current += ' ' + w;
      else { chunks.push(current); current = w; }
    }
    if (current) chunks.push(current);

    for (const chunk of chunks) {
      const durationMs = Math.max(900, Math.round(
        (chunk.split(/\s+/).length / WORDS_PER_SECOND) * 1000));
      lines.push({ startMs: cursorMs, endMs: cursorMs + durationMs, text: chunk });
      cursorMs += durationMs;
    }
  }
  return { lines, source: 'LAUNCHMIND', notes };
}

/**
 * Accepts a provider caption track ONLY when it says exactly what we sent.
 *
 * @returns the provider track when faithful, otherwise LaunchMind's own track
 *   with the reason recorded — never a silent substitution either way
 */
export function reconcileCaptions(
  governedLines: readonly string[], providerCaptions: string | null | undefined,
): CaptionTrack {
  const governedText = governedLines.join(' ');
  if (!providerCaptions || !providerCaptions.trim()) {
    return buildDeterministicCaptions(governedLines);
  }
  const verdict = checkScriptFidelity(governedText, providerCaptions);
  if (verdict.faithful) {
    return { ...buildDeterministicCaptions(governedLines), source: 'PROVIDER' };
  }
  return buildDeterministicCaptions(governedLines, [
    'LaunchMind used its own captions because the video service changed the wording.',
    ...verdict.reasons,
  ]);
}

export interface GovernedVideoScript {
  /** Spoken lines, in order. Exactly as governed. */
  voiceover: string[];
  /** On-screen phrases, in order. Exactly as governed. */
  onScreenText: string[];
  /** One string for providers that voice the whole script at once. */
  spokenScript: string;
  captions: CaptionTrack;
  estimatedSeconds: number;
}

/**
 * Extracts the governed script from a video brief.
 *
 * @security Reads the scene plan only. Nothing is generated here, so there is no
 *   path by which a new sentence could enter a video at render time.
 */
export function extractGovernedScript(brief: VideoCreativeBrief): GovernedVideoScript {
  const voiceover = brief.scenePlan
    .map(s => String(s.voiceover ?? '').trim()).filter(Boolean);
  const onScreenText = brief.scenePlan
    .map(s => String(s.onScreenText ?? '').trim()).filter(Boolean);

  return {
    voiceover, onScreenText,
    spokenScript: voiceover.join(' '),
    captions: buildDeterministicCaptions(voiceover),
    estimatedSeconds: brief.estimatedSeconds || Math.max(6, Math.round(
      voiceover.join(' ').split(/\s+/).length / WORDS_PER_SECOND)),
  };
}
