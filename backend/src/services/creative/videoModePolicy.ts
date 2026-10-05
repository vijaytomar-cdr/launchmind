/**
 * @file videoModePolicy.ts
 * @description The three video modes, and who may appear in them — B6B §5–§8, §10.
 *
 *   B6A ENDED WITH A DEBT THIS FILE PAYS. A diffusion image model was told
 *   "no stock photography implying real customers" and drew two people at a desk
 *   anyway. The lesson was not "write a firmer prompt" — prompt language is
 *   advisory and always will be. The lesson was that the mechanism must be
 *   structural: do not choose a provider or mode whose output requires a human
 *   nobody controls.
 *
 *   So PRODUCT_MOTION is NO_SYNTHETIC_PEOPLE by construction, and a concept that
 *   genuinely needs someone speaking is ROUTED to AVATAR_SPOKESPERSON — where the
 *   person is a specific avatar the owner picked from a real inventory — rather
 *   than asking a generative video model for an unspecified person.
 *
 *   THE SYNTHETIC PERSON CONTRACT. A HeyGen avatar is a SYNTHETIC_PRESENTER and
 *   nothing else. It is not a customer, employee, founder, doctor, expert,
 *   reviewer or user. This matters because a synthetic person delivering
 *   "I've used this for a year and it changed my business" is a fabricated
 *   testimonial — a claim with no claimant, which no amount of content
 *   governance downstream can repair, because the claim is in a face and a voice
 *   rather than in a text field.
 *
 *   VOICE. Only PROVIDER_STOCK. This repository has `products.voice_clone_id`
 *   and an ElevenLabs `createVoiceClone` helper, and no consent record anywhere:
 *   no actor, no rights basis, no record that the person whose voice it is ever
 *   agreed. Possessing an audio file is not permission, so cloning is not
 *   implemented — refusing is the only honest option until that contract exists.
 *
 * @security All checks here are deterministic and model-free. They decide what
 *   may be asked of a provider; they never ask a provider what is permitted.
 * @dependencies creativeBriefs (types only)
 */

import type { VideoCreativeBrief } from '../content/creativeBriefs';
import type { ProductContentContext } from '../content/productContentContext';

export const VIDEO_MODES = [
  'PRODUCT_MOTION', 'AVATAR_SPOKESPERSON', 'VOICEOVER_CREATIVE',
] as const;
export type VideoMode = typeof VIDEO_MODES[number];

/** The ONLY thing a HeyGen avatar may be recorded as. */
export const PRESENTER_KIND = 'SYNTHETIC_PRESENTER' as const;

/**
 * Roles a synthetic presenter may never be given.
 *
 * Listed and refused explicitly rather than filtered silently: a stripped role
 * is invisible, and the next person to read this cannot see that someone tried
 * to make an avatar into a customer.
 */
export const FORBIDDEN_PRESENTER_ROLES = [
  'customer', 'client', 'user', 'employee', 'staff', 'technician', 'engineer',
  'founder', 'ceo', 'owner', 'doctor', 'nurse', 'lawyer', 'expert', 'specialist',
  'reviewer', 'testimonial', 'advocate', 'ambassador', 'endorser', 'partner',
] as const;

export interface AvatarSelection {
  providerAvatarId: string;
  /** Owner-safe label. Never a demographic judgement made by LaunchMind. */
  displayName: string;
  presenterKind: typeof PRESENTER_KIND;
  previewUrl?: string | null;
}

export type VoiceKind = 'PROVIDER_STOCK';

export interface VoiceSelection {
  providerVoiceId: string;
  displayName: string;
  kind: VoiceKind;
  language?: string | null;
}

export class VideoModeError extends Error {
  readonly ownerMessage: string;
  constructor(ownerMessage: string, internal?: string) {
    super(internal ?? ownerMessage);
    this.name = 'VideoModeError';
    this.ownerMessage = ownerMessage;
  }
}

/**
 * Text that would make a synthetic presenter into a person with a role,
 * a relationship to the business, or a testimonial.
 *
 * Linear patterns — this runs on owner-supplied and model-supplied text, and a
 * backtracking one would be a denial-of-service surface.
 */
const ENDORSEMENT_PATTERNS: Array<{ test: RegExp; label: string }> = [
  { test: /\bI(?:'ve| have)? (?:been )?(?:used|using|use)\b/i, label: 'speaking as someone who uses the product' },
  { test: /\bas a (?:happy |satisfied |long[- ]time )?(?:customer|client|user)\b/i, label: 'claiming to be a customer' },
  { test: /\bI(?:'m| am) a (?:customer|client|user|founder|technician|doctor|nurse|expert)\b/i, label: 'claiming a role' },
  { test: /\bI work (?:for|at|with)\b/i, label: 'claiming to work for the business' },
  { test: /\bour (?:founder|ceo|team member|technician|engineer)\b/i, label: 'presenting as staff' },
  { test: /\bmy (?:business|company|team) (?:uses|switched|grew)\b/i, label: 'first-person customer story' },
  { test: /\breal (?:customer|user|homeowner|client)\b/i, label: 'asserting the presenter is real' },
  { test: /\btestimonial\b/i, label: 'a testimonial' },
  { test: /\bthousands of (?:users|customers) say\b/i, label: 'attributed social proof' },
  // THIRD PERSON. The first-person patterns above miss "have HIM say he works
  // for us" — the same assertion, phrased as a direction to the presenter.
  { test: /\b(?:he|she|they)\s+works?\s+(?:for|at|with)\b/i, label: 'presenting as staff' },
  { test: /\b(?:he|she|they)\s+(?:is|are)\s+(?:a |an |one of )/i, label: 'giving the presenter a role' },
  { test: /\bsay (?:he|she|they) (?:is|are|works|uses)\b/i, label: 'giving the presenter a role' },
  { test: /\b(?:is|are) one of (?:our|the)\b/i, label: 'presenting as staff' },
  { test: /\bact like (?:the |our |a |an )?\w+/i, label: 'asking the presenter to play a role' },
];

export interface EndorsementVerdict {
  permitted: boolean;
  /** Owner-safe reasons. Plain sentences, never a pattern or an enum. */
  reasons: string[];
}

/**
 * May a synthetic presenter say this?
 *
 * @security Fails toward refusal. A first-person claim of use, role or
 *   employment is refused whatever else the line contains, because the presenter
 *   cannot truthfully make it and the viewer cannot tell.
 */
export function checkPresenterSpeech(lines: readonly string[]): EndorsementVerdict {
  const reasons: string[] = [];
  for (const line of lines) {
    const text = String(line ?? '');
    for (const p of ENDORSEMENT_PATTERNS) {
      if (p.test.test(text)) {
        reasons.push(`"${text.trim().slice(0, 70)}" reads as ${p.label}.`);
        break;
      }
    }
  }
  return { permitted: reasons.length === 0, reasons };
}

/** An owner-supplied presenter role. Always refused; never quietly dropped. */
export function checkRequestedPresenterRole(text: string | null | undefined): EndorsementVerdict {
  const t = String(text ?? '').toLowerCase();
  if (!t.trim()) return { permitted: true, reasons: [] };
  // Plural-aware: "one of our technicians" must match the "technician" role.
  const hit = FORBIDDEN_PRESENTER_ROLES.find(r => new RegExp(`\\b${r}s?\\b`).test(t));
  if (!hit) return { permitted: true, reasons: [] };
  return {
    permitted: false,
    reasons: [
      `LaunchMind cannot present the speaker as a ${hit}. The presenter is generated, so saying that would not be true.`,
      'It can present them as a spokesperson delivering your message.',
    ],
  };
}

export interface ModeDecision {
  mode: VideoMode;
  /** Owner-safe explanation of why this mode fits. */
  why: string[];
  /** What the owner must choose before this mode can render. */
  needsFromOwner: string[];
  /** Structural guarantee carried into provider assembly. */
  syntheticPeoplePermitted: boolean;
}

/**
 * The default mode for a brief. PRODUCT_MOTION unless a person must speak.
 *
 * @security Never selects a mode involving a person on the owner's behalf.
 *   AVATAR_SPOKESPERSON and VOICEOVER_CREATIVE are only ever RECOMMENDED here;
 *   `needsFromOwner` is non-empty until the owner has chosen, and the render
 *   service refuses a mode whose selections are missing.
 */
export function decideVideoMode(opts: {
  brief: VideoCreativeBrief;
  ctx: ProductContentContext;
  ownerRequestedMode?: VideoMode | null;
  avatar?: AvatarSelection | null;
  voice?: VoiceSelection | null;
}): ModeDecision {
  const { brief, ctx } = opts;
  const hasAuthorisedFootage = ctx.authorizedAssets.length > 0;

  // The owner's explicit choice wins over the recommendation — but it still has
  // to satisfy its own selection requirements below.
  const mode: VideoMode = opts.ownerRequestedMode ?? 'PRODUCT_MOTION';

  const needsFromOwner: string[] = [];
  const why: string[] = [];

  if (mode === 'PRODUCT_MOTION') {
    why.push('The message can be told visually, so no presenter is needed.');
    why.push(hasAuthorisedFootage
      ? 'It can use the product imagery you approved.'
      : 'It uses brand-led motion rather than showing your interface, which is not available to it.');
  }

  if (mode === 'AVATAR_SPOKESPERSON') {
    why.push('Someone speaking to camera delivers this message.');
    why.push('The presenter is generated by LaunchMind, not a real person.');
    if (!opts.avatar) needsFromOwner.push('Choose a presenter');
  }

  if (mode === 'VOICEOVER_CREATIVE') {
    why.push('A spoken voice carries the message over the visuals.');
    if (!opts.voice) needsFromOwner.push('Choose a voice');
  }

  // §17 — a demo of the product needs the product. Drawing a plausible interface
  // and presenting it as the real thing is a picture of software that does not exist.
  if (brief.productDemoNeeded && !hasAuthorisedFootage) {
    needsFromOwner.push('Authorise product imagery LaunchMind may show');
  }

  return {
    mode, why, needsFromOwner,
    // PRODUCT_MOTION never permits a synthetic person; an avatar video contains
    // exactly one, chosen by the owner, and identified as generated.
    syntheticPeoplePermitted: mode === 'AVATAR_SPOKESPERSON',
  };
}

/**
 * Validates an owner selection before it can reach a provider or the database.
 *
 * @throws {VideoModeError} on a missing selection, a cloned voice, or an
 *   attempt to attach a role to a presenter
 */
export function validateSelections(opts: {
  mode: VideoMode; avatar?: AvatarSelection | null; voice?: VoiceSelection | null;
}): void {
  if (opts.mode === 'AVATAR_SPOKESPERSON') {
    if (!opts.avatar?.providerAvatarId) {
      throw new VideoModeError('Choose a presenter before creating this video.');
    }
    if (opts.avatar.presenterKind !== PRESENTER_KIND) {
      throw new VideoModeError(
        'LaunchMind can only use a generated presenter.', 'presenterKind is not SYNTHETIC_PRESENTER');
    }
    // A role would turn the presenter into someone with a relationship to the
    // business. Refused at the boundary, not filtered downstream.
    const extra = Object.keys(opts.avatar as unknown as Record<string, unknown>);
    if (extra.includes('role')) {
      throw new VideoModeError(
        'The presenter cannot be given a role. They are generated, not a real person.',
        'avatar selection carried a role');
    }
  }
  if (opts.voice) {
    if (opts.voice.kind !== 'PROVIDER_STOCK') {
      throw new VideoModeError(
        'LaunchMind can only use a stock voice right now. Using someone’s real voice needs their recorded permission, which LaunchMind cannot yet capture.',
        'non-stock voice kind');
    }
  }
  if (opts.mode === 'VOICEOVER_CREATIVE' && !opts.voice?.providerVoiceId) {
    throw new VideoModeError('Choose a voice before creating this video.');
  }
}

/** Owner-safe disclosure line. Used wherever a presenter appears. */
export const PRESENTER_DISCLOSURE =
  'This presenter is generated by LaunchMind. They are not a customer, an employee or a real person.';
