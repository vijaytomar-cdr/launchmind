import { CONCEPTS, type ConceptKey } from '../content/creativeConcepts';
import type { CompositionLayout } from './productComposition';

/** Art direction only: an illustrative situation, never customer or product evidence. */
export interface VisualThesis {
  type: 'STALLED_PROJECT' | 'COORDINATION_FRICTION' | 'WAITING_FOR_HELP';
  scenePattern?: 'UNFINISHED_WALL_PATCH' | 'PAUSED_WALL_PAINT' | 'WAITING_SEATED' | 'WAITING_STANDING';
  /** Job-local failed semantic/credibility assessments, never Marketing Memory. */
  directionFailures?: number;
  marketingProblem: string;
  immediateRecognition: string;
  scene: string;
  allowedSubjects: readonly string[];
  forbiddenSubjects: readonly string[];
  messageRelationship: string;
}

export function recognitionThesis(context: string, hook: string,
  type: VisualThesis['type'] = 'WAITING_FOR_HELP',
  scenePattern: NonNullable<VisualThesis['scenePattern']> = 'UNFINISHED_WALL_PATCH'): VisualThesis | null {
  // This bounded direction serves arranging residential help, not every industry.
  if (!/home.{0,35}(service|project|professional|repair)|residential.{0,20}(repair|maintenance)/i.test(context + ' ' + hook)
      || !/hold|wait|call|start|arrang|coordinat|delay|easier|simpler/i.test(hook)) return null;
  // Literal-project imagery is retired as the default after controlled owner proofs.
  // It remains representable so an in-flight literal direction can exhaust and pivot.
  if (type === 'WAITING_FOR_HELP') {
    const standing = scenePattern === 'WAITING_STANDING';
    return {
      type, scenePattern: standing ? 'WAITING_STANDING' : 'WAITING_SEATED',
      marketingProblem: 'Arranging home-service help involves waiting for responses and callbacks.',
      immediateRecognition: 'A homeowner ready for a home project is visibly stuck waiting for a response, with mild impatience rather than distress.',
      scene: 'Premium commercial lifestyle photography in a clean, modest residential living room, naturally lit through a window. ' +
        (standing
          ? 'An adult homeowner stands beside the sofa on the right, framed from the waist upward, pausing with a plain mobile phone loosely held at waist level. Their gaze turns away toward the window, lips gently pressed and shoulders slightly slumped: a restrained, believable moment of waiting for someone to respond. '
          : 'An adult homeowner sits forward on the edge of a neutral sofa on the right, framed from the knees upward. They hold a plain mobile phone loosely near their lap and look down toward it with a lightly furrowed brow and gently pressed lips. Their paused posture conveys mild impatience: ready to start, still waiting for a response. ') +
        'The person is the dominant photographic subject, filling the right half of the frame; face and body language must be large and readable at feed size. Show a natural three-quarter profile, not eye contact with the camera. The camera sees only the plain unmarked back of the phone; no illuminated display is visible. ' +
        'One small closed unbranded toolbox beside the sofa provides a secondary home-project cue. No loose tool collection. Keep the left half softly lit, pale, quiet and uncluttered for later headline, supporting copy and CTA placement. Preserve comfortable space around the head and natural anatomy. Restrained everyday clothing, relatable home, polished campaign photography. This is an illustrative situation, not a real customer experience.',
      allowedSubjects: ['Residential living room', 'Large adult homeowner visibly waiting with mild frustration', 'Plain phone back only', 'One closed unbranded toolbox as secondary home-project context'],
      forbiddenSubjects: ['Cooking or food preparation', 'Restaurant', 'Office work', 'Beauty or spa', 'Medical scene',
        'Construction site or exposed building damage', 'Tool clutter', 'Luxury mansion', 'Exaggerated frustration or dramatic despair',
        'Comedy expressions, pointing, thumbs-up or camera-facing posing', 'Active worker', 'Celebratory success or before/after outcome',
        'Customer testimonial or claimed product outcome'],
      messageRelationship: 'The waiting homeowner supplies the emotional recognition; the home and closed toolbox establish why help is needed. The governed callback headline completes the advertising idea. No exact repair needs to be visible and no product outcome is claimed.',
    };
  }
  const patch = scenePattern === 'UNFINISHED_WALL_PATCH';
  const unfinished = patch
    ? 'A large, rough, unpainted wall-repair patch interrupts an otherwise painted residential wall.'
    : 'A residential wall paint job stops halfway across the wall, with a broad irregular roller edge and exposed primer still visible.';
  const project = patch
    ? 'A waist-high, roughly one-metre-wide rectangular plasterboard repair is set into a muted blue-grey living-room wall. Broad irregular white joint-compound seams and rough feathered filler cover the perimeter; the centre remains visibly raw and unpainted, strongly contrasting with the surrounding finished wall. The whole large unfinished patch, from just above the baseboard to waist height, is the dominant subject. A small open unmarked toolbox and one putty knife rest unused on a plain drop cloth directly below it.'
    : 'One muted blue-grey living-room wall is only partly painted: the new coat stops halfway across at a broad ragged roller edge, leaving a large contrasting white primed section exposed. The interrupted paint boundary spans a large area from baseboard to waist height. Masking tape remains on the baseboard. One plain unlabelled paint pail and a roller rest idle on a drop cloth below the unfinished section. This is a paused coat of paint, not a finished two-tone decorative wall.';
  return {
    type, scenePattern,
    marketingProblem: 'Arranging home-service help delays completing a residential project.',
    immediateRecognition: type === 'STALLED_PROJECT' ? unfinished : `A homeowner is still arranging help beside the unfinished project. ${unfinished}`,
    scene: `A clean photographic view inside an ordinary residential living room. ${project} ` +
      'Show the entire unfinished area, the baseboard and a little wood flooring together. A normal doorway at the edge establishes the household setting. Keep the large unfinished condition in the central-right part of the photograph, with quiet surrounding wall above and to its left. It must remain obvious in a small feed thumbnail; tiny hardware and tools are not the recognition cue. ' +
      (type === 'STALLED_PROJECT' ? 'No people are present; nobody is completing the work.'
        : 'An illustrative adult homeowner stands to the side of the large unfinished area, holding a plain phone to their ear with only its unmarked back visible. The project remains dominant. Nobody is completing the work; this is a staged situation, not a customer testimonial.'),
    allowedSubjects: ['Residential living room', patch ? 'Large unpainted plasterboard repair with rough white filler seams' : 'Large interrupted coat of wall paint with exposed primer',
      'A few idle unmarked repair materials directly beneath the unfinished area', ...(type === 'COORDINATION_FRICTION' ? ['Illustrative adult homeowner arranging help; phone back only'] : [])],
    forbiddenSubjects: ['Cooking or food preparation', 'Kitchen utensils or food trays',
      'Restaurant', 'Beauty or spa', 'Medical scene', 'Office work', 'Generic technology imagery',
      'Decorative wall art or finished accent-wall design', 'Unrelated tool collections', 'Tiny mechanical defects as the main subject',
      'Active worker or completed repair', 'Telephone or keys as standalone metaphors', 'Finished room makeover or before/after result',
      'Customer testimonial or claimed product outcome'],
    messageRelationship: 'The large unfinished wall and idle materials make the project visibly on hold. The callback hook names the delay in arranging help; the scene does not claim the product has resolved it.',
  };
}

export function repairVisualThesis(thesis: VisualThesis, critique: CreativeCritique):
  { thesis: VisualThesis; regenerate: boolean; reason: string } {
  const text = critique.summary.toLowerCase();
  const humanLayoutFailure = thesis.type === 'WAITING_FOR_HELP'
    && /(?:text|copy|headline|support|cta).{0,65}(?:cross|cover|overlap|obscur|unreadable|legib|contrast)|(?:unreadable|illegible).{0,30}(?:support|copy)/.test(text);
  const photographicFailure = critique.checks.backgroundText === 'NEEDS_ATTENTION'
    || critique.checks.authenticity === 'NEEDS_ATTENTION'
    || critique.checks.noInventedClaims === 'NEEDS_ATTENTION'
    || /(?:missing|absent|no).{0,25}(?:toolbox|home.project cue)|(?:person|subject|figure).{0,45}(?:wrong region|left side|centered.left)|wrong.{0,20}(?:scene|industry)|(?:phone|screen).{0,30}(?:illuminated|generated ui)/.test(text);
  if (humanLayoutFailure && !photographicFailure) return { thesis, regenerate: false,
    reason: 'Reuse the same photograph; repair protected message geometry and localized contrast' };
  const wrongMeaning = /wrong.{0,35}(context|industry|object|scene|category)|cooking|kitchen|unrelated|misdirect|semantic|(?:image|scene|imagery|visual).{0,90}(?:unrecogniz|no.{0,15}(?:relation|tension|connection)|fails.{0,25}(?:hook|recognition)|does not.{0,25}(?:reinforce|represent)|weak.{0,25}(?:hook|relationship))|(?:weak|absent|missing).{0,30}(?:relationship|tension)|generic.{0,30}(?:prop|decoration|tools)|(?:visually|completely).{0,15}finished|(?:weak|ambiguous).{0,20}repair cues|invented scene meaning/.test(text);
  const directionFailed = wrongMeaning || critique.checks.semanticContext === 'NEEDS_ATTENTION'
    || critique.checks.authenticity === 'NEEDS_ATTENTION';
  if (directionFailed) {
    const failures = Math.min(2, (thesis.directionFailures ?? 0) + 1);
    if (thesis.type === 'WAITING_FOR_HELP') {
      return { thesis: { ...recognitionThesis('residential maintenance', 'Waiting for a callback', 'WAITING_FOR_HELP',
        failures >= 2 ? 'WAITING_STANDING' : thesis.scenePattern ?? 'WAITING_SEATED')!, directionFailures: failures },
      regenerate: true, reason: failures >= 2
        ? 'Regenerate an alternate human-centered execution; keep WAITING_FOR_HELP'
        : 'Regenerate the WAITING_FOR_HELP execution; preserve the human-frustration idea' };
    }
    if (failures >= 2) return {
      thesis: recognitionThesis('residential maintenance', 'Waiting for a callback', 'WAITING_FOR_HELP')!,
      regenerate: true, reason: 'Creative-direction pivot: literal-project metaphor exhausted after two semantic or credibility failures; choose WAITING_FOR_HELP',
    };
    return { thesis: { ...recognitionThesis('residential maintenance', 'Arranging help is on hold', 'STALLED_PROJECT',
      thesis.scenePattern === 'PAUSED_WALL_PAINT' ? 'UNFINISHED_WALL_PATCH' : 'PAUSED_WALL_PAINT')!, directionFailures: failures },
    regenerate: true, reason: 'Semantic mismatch: one alternate literal scene before direction exhaustion' };
  }
  const imageDefect = /pseudo.?text|lettering|watermark|(?:invented|fabricated|readable|generated|unwanted).{0,30}(?:text|label|word|letter)|(?:background|scene|imagery).{0,35}(?:clutter|ambiguous)|(?:reduce|remove).{0,20}background clutter/.test(text)
    || critique.checks.backgroundText === 'NEEDS_ATTENTION'
    || critique.checks.authenticity === 'NEEDS_ATTENTION' || critique.checks.noInventedClaims === 'NEEDS_ATTENTION';
  return { thesis, regenerate: imageDefect,
    reason: imageDefect ? 'Regenerate the same thesis with the strict wordless scene contract' : 'Reuse imagery; repair deterministic composition only' };
}

/** Executable relationships, not provider instructions or product truth. */
export interface CompositionIntent {
  grammar: 'HOOK_PRODUCT_FRAGMENT' | 'PROBLEM_VISUAL_MESSAGE';
  dominant: 'PRODUCT_AND_HEADLINE' | 'HEADLINE';
  assetRole: 'UI_FRAGMENT' | 'HERO' | 'EVIDENCE' | 'SUPPORT' | 'OMIT';
  crop: 'CONTAIN' | 'CROP_TO_FOCUS' | 'BLEED' | 'PARTIAL_OFF_CANVAS';
  anchor: 'RIGHT' | 'LOWER_RIGHT' | 'LEFT' | 'LOWER_LEFT';
  visualWeight: number;
  overlap: 'VISUAL_FIELD' | 'COPY_FIELD';
  typography: { hookScale: number; supportScale: number; ctaGap: number; compact: boolean };
  sourceRegion?: { x: number; y: number; width: number; height: number };
}

export function recognitionIntent(grammar: CompositionIntent['grammar']): CompositionIntent {
  return grammar === 'HOOK_PRODUCT_FRAGMENT'
    ? { grammar, dominant: 'PRODUCT_AND_HEADLINE', assetRole: 'UI_FRAGMENT',
        crop: 'PARTIAL_OFF_CANVAS', anchor: 'LOWER_RIGHT', visualWeight: 0.56,
        overlap: 'VISUAL_FIELD', typography: { hookScale: 0.096, supportScale: 0.043, ctaGap: 0.028, compact: false } }
    : { grammar, dominant: 'HEADLINE', assetRole: 'SUPPORT', crop: 'CONTAIN',
        anchor: 'LOWER_RIGHT', visualWeight: 0.52, overlap: 'COPY_FIELD',
        typography: { hookScale: 0.108, supportScale: 0.043, ctaGap: 0.025, compact: false } };
}

export interface CreativeScenePlan {
  visualThesis?: VisualThesis;
  compositionIntent?: CompositionIntent;
  conceptRole: ConceptKey;
  visualObjective: string;
  openingFrame: string;
  primaryFocalPoint: 'MESSAGE' | 'PRODUCT' | 'OUTCOME';
  secondaryFocalPoint: 'MESSAGE' | 'PRODUCT' | 'CONTEXT';
  productRole: 'REVEAL' | 'DEMONSTRATION' | 'SUPPORT';
  productRevealOrder: 'AFTER_PROBLEM' | 'IMMEDIATE' | 'AFTER_OUTCOME';
  problemRepresentation: string | null;
  solutionRepresentation: string;
  composition: CompositionLayout;
  screenshotPlacement: string;
  logoPlacement: string;
  textSafeZones: readonly string[];
  textHierarchy: readonly string[];
  ctaPlacement: string;
  backgroundPurpose: string;
  emotionalTone: string;
  channelConstraints: readonly string[];
  assetRequirements: readonly string[];
  forbiddenVisualInventions: readonly string[];
  sourceVisualBrief: string | null;
}

export interface VisualExecution {
  visualThesis?: VisualThesis;
  compositionIntent?: CompositionIntent;
  id: string;
  visualIdea: string;
  openingHook: string;
  problemRepresentation: string | null;
  productReveal: string;
  hierarchy: readonly string[];
  screenshotRole: string;
  tensionRevealMechanism: string;
  overlayIntent: string;
  compositionStructure: string;
  composition: CompositionLayout;
}

/** Structural identity: byte/background changes never make a new execution. */
export function visualExecutionSignature(execution: VisualExecution): string {
  if (execution.compositionIntent) {
    // Identity follows executed geometry, not a name or a different background.
    const i = execution.compositionIntent;
    return `recognition-v2|${i.grammar}|${i.dominant}|${i.assetRole}|${i.crop}|${i.anchor}`.toLowerCase();
  }
  return [execution.compositionStructure, execution.openingHook,
    execution.problemRepresentation ?? 'none', execution.productReveal,
    execution.screenshotRole, execution.tensionRevealMechanism,
    execution.hierarchy.join('>')].join('|').toLowerCase();
}

function conceptKey(label: string | null | undefined): ConceptKey | null {
  const value = String(label ?? '').toLowerCase();
  if (/problem|recognition|concept a/.test(value)) return 'PROBLEM_RECOGNITION';
  if (/product|demonstration|concept b/.test(value)) return 'PRODUCT_DEMONSTRATION';
  if (/relief|outcome|concept c/.test(value)) return 'RELIEF';
  return null;
}

const EXECUTIONS: Record<ConceptKey, readonly VisualExecution[]> = {
  PROBLEM_RECOGNITION: [
    { id: 'problem-product-split', visualIdea: 'Problem and product split', openingHook: 'A recognition-led problem field', problemRepresentation: 'Abstract repeated interruption marks', productReveal: 'Authentic UI resolves the opposite side', hierarchy: ['Problem hook', 'Product reveal', 'CTA'], screenshotRole: 'Resolution', tensionRevealMechanism: 'Tense-to-calm split', overlayIntent: 'Name the problem without inventing evidence', compositionStructure: 'Asymmetric split', composition: 'PROBLEM_FRAME' },
    { id: 'interruption-then-reveal', visualIdea: 'Interruption followed by product reveal', openingHook: 'Repeated-call tension pattern', problemRepresentation: 'Non-literal repetition and hold rhythm', productReveal: 'Authentic UI becomes the visual answer', hierarchy: ['Interruption pattern', 'Product', 'Message'], screenshotRole: 'Delayed reveal', tensionRevealMechanism: 'Repetition breaks when product appears', overlayIntent: 'Support recognition, not claim an outcome', compositionStructure: 'Pattern interruption', composition: 'RELIEF_FRAME' },
    { id: 'question-led-product', visualIdea: 'Question-led typographic interruption', openingHook: 'A large governed question interrupts the feed', problemRepresentation: 'Question only; no fabricated customer scene', productReveal: 'Authentic UI supplies the concrete product proof', hierarchy: ['Question', 'Product UI', 'CTA'], screenshotRole: 'Concrete answer', tensionRevealMechanism: 'Question-to-product reveal', overlayIntent: 'Use only governed copy', compositionStructure: 'Type-led product frame', composition: 'PRODUCT_HERO' },
  ],
  PRODUCT_DEMONSTRATION: [{ id: 'product-hero', visualIdea: 'Product demonstration', openingHook: 'Authentic UI first', problemRepresentation: null, productReveal: 'Immediate', hierarchy: ['Product', 'Headline', 'CTA'], screenshotRole: 'Hero', tensionRevealMechanism: 'Immediate clarity', overlayIntent: 'Explain without obscuring UI', compositionStructure: 'Central product hero', composition: 'PRODUCT_HERO' }],
  RELIEF: [{ id: 'relief-support', visualIdea: 'Relief with product support', openingHook: 'Calm outcome framing', problemRepresentation: 'Implied by contrast', productReveal: 'Supporting reveal', hierarchy: ['Outcome', 'Product', 'CTA'], screenshotRole: 'Supporting proof', tensionRevealMechanism: 'Tension-to-relief contrast', overlayIntent: 'Avoid promising an outcome', compositionStructure: 'Open relief field', composition: 'RELIEF_FRAME' }],
};

export function selectVisualExecution(input: { conceptLabel?: string | null; recentIds?: readonly string[];
  recentSignatures?: readonly string[]; grammar?: CompositionIntent['grammar'] }): VisualExecution | null {
  const key = conceptKey(input.conceptLabel);
  if (!key) return null;
  const options = EXECUTIONS[key].map(option => {
    if (key !== 'PROBLEM_RECOGNITION') return option;
    const intent = recognitionIntent(option.id === 'problem-product-split'
      ? 'HOOK_PRODUCT_FRAGMENT' : 'PROBLEM_VISUAL_MESSAGE');
    return { ...option, composition: 'PROBLEM_FRAME' as const, compositionIntent: intent,
      visualIdea: intent.grammar === 'HOOK_PRODUCT_FRAGMENT' ? 'Dominant hook with authentic product fragment' : 'Recognizable problem visual with governed message',
      openingHook: 'A dominant governed recognition hook',
      tensionRevealMechanism: intent.grammar === 'HOOK_PRODUCT_FRAGMENT' ? 'Recognition meets a concrete product fragment' : 'An unfinished task connects to the governed product message',
      hierarchy: ['Recognition hook', 'Supporting message', 'CTA',
        intent.grammar === 'HOOK_PRODUCT_FRAGMENT' ? 'Authentic UI fragment' : 'Problem visual'],
      screenshotRole: intent.assetRole, compositionStructure: intent.grammar,
      productReveal: intent.grammar === 'HOOK_PRODUCT_FRAGMENT'
        ? 'Large authentic UI fragment anchored to the recognition hook'
        : 'Confirmed brand supports the message; unsuitable promotional artwork is omitted',
      problemRepresentation: intent.grammar === 'HOOK_PRODUCT_FRAGMENT'
        ? 'Governed recognition hook against authentic product content'
        : 'A recognizable unfinished task, no fabricated customer or outcome' };
  }).filter(option => !input.grammar || option.compositionIntent?.grammar === input.grammar);
  const recentSignatures = new Set(input.recentSignatures ?? []);
  const unused = options.find(option => !(input.recentIds ?? []).includes(option.id)
    && !recentSignatures.has(visualExecutionSignature(option)));
  if (unused) return unused;
  // Do not market a recycled structure as a new visual. Once every bounded
  // family is present, a new concept/direction is required.
  return null;
}

/**
 * Converts governed concept intent into renderer instructions. This is art
 * direction, never evidence: none of these fields may add a product claim.
 */
export function buildScenePlan(input: {
  conceptLabel?: string | null;
  visualBrief?: string | null;
  channel: string;
  recognitionContext?: string;
  governedHeadline?: string;
}): CreativeScenePlan | null {
  const key = conceptKey(input.conceptLabel);
  if (!key) return null;
  const shape = CONCEPTS[key];
  const common = {
    conceptRole: key,
    composition: shape.layout,
    channelConstraints: ['Readable at feed size', 'Respect channel-safe margins'],
    assetRequirements: ['Owner-authorized product screenshot', 'Confirmed logo when available'],
    forbiddenVisualInventions: [
      'Do not redraw or reinterpret product UI',
      'Do not invent product capabilities',
      'Do not generate logos, badges, ratings, or interface text',
    ],
    sourceVisualBrief: input.visualBrief?.trim() || null,
  } as const;

  if (key === 'PRODUCT_DEMONSTRATION') return {
    ...common, visualObjective: 'Make the verified product understandable immediately.',
    openingFrame: 'The authentic product interface is the first impression.',
    primaryFocalPoint: 'PRODUCT', secondaryFocalPoint: 'MESSAGE',
    productRole: 'DEMONSTRATION', productRevealOrder: 'IMMEDIATE',
    problemRepresentation: null,
    solutionRepresentation: 'Large, unobscured authentic product screenshot.',
    screenshotPlacement: 'Large and central', logoPlacement: 'Quiet corner mark',
    textSafeZones: ['Top headline band', 'Bottom CTA band'],
    textHierarchy: ['Product', 'Headline', 'CTA'], ctaPlacement: 'Bottom edge',
    backgroundPurpose: 'Stay quiet so the product dominates.', emotionalTone: 'Clear and direct',
  };
  if (key === 'RELIEF') return {
    ...common, visualObjective: 'Contrast the desired calmer state with the means to reach it.',
    openingFrame: 'Open space and relief establish the desired state.',
    primaryFocalPoint: 'OUTCOME', secondaryFocalPoint: 'PRODUCT',
    productRole: 'SUPPORT', productRevealOrder: 'AFTER_OUTCOME',
    problemRepresentation: 'Implied through contrast, never fabricated as evidence.',
    solutionRepresentation: 'Product appears as the supporting means, not a promised result.',
    screenshotPlacement: 'Lower-right supporting position', logoPlacement: 'Quiet top corner',
    textSafeZones: ['Open upper-left field', 'Bottom CTA band'],
    textHierarchy: ['Outcome statement', 'Product', 'CTA'], ctaPlacement: 'Bottom-left',
    backgroundPurpose: 'Create open, calm space around the message.', emotionalTone: 'Relieved and unhurried',
  };
  return {
    ...common, visualObjective: 'Earn recognition before revealing the product.',
    compositionIntent: recognitionIntent('HOOK_PRODUCT_FRAGMENT'),
    visualThesis: recognitionThesis(input.recognitionContext ?? '', input.governedHeadline ?? '') ?? undefined,
    assetRequirements: ['Confirmed logo when available'],
    openingFrame: 'The audience-recognizable tension is the first impression.',
    primaryFocalPoint: 'MESSAGE', secondaryFocalPoint: 'PRODUCT',
    productRole: 'REVEAL', productRevealOrder: 'AFTER_PROBLEM',
    problemRepresentation: 'Use the selected visual thesis to illustrate the governed recognition problem, without claiming a customer outcome.',
    solutionRepresentation: 'The confirmed brand and governed product message follow the recognition hook. Product artwork is optional supporting context.',
    screenshotPlacement: 'Optional secondary reveal on the calm side; omit unsuitable promotional artwork', logoPlacement: 'Near product, subordinate',
    textSafeZones: ['Measured hook and supporting-message bounds; no obscured words'],
    textHierarchy: ['Recognition hook', 'Supporting message', 'CTA', 'Visual anchor'], ctaPlacement: 'Connected to supporting copy',
    backgroundPurpose: 'Move from visual tension toward calm.', emotionalTone: 'Recognizable tension to clarity',
  };
}

export interface CreativeCritique {
  outcome: 'READY_FOR_OWNER_REVIEW' | 'NEEDS_CREATIVE_REVISION' |
    'ASSET_PROBLEM' | 'CONCEPT_DID_NOT_SURVIVE_RENDER';
  summary: string;
  checks: Record<string, 'PASS' | 'NEEDS_ATTENTION'>;
}

/** Repairs the controls that own a defect. No copy or evidence is changed. */
export function repairCompositionIntent(current: CompositionIntent, critique: CreativeCritique,
  options: { attempt: number; canUseHero: boolean; triedGrammars: readonly CompositionIntent['grammar'][] }):
  { intent: CompositionIntent; regenerateBackground: boolean; reason: string } {
  const text = critique.summary.toLowerCase();
  const intent: CompositionIntent = { ...current, typography: { ...current.typography } };
  const changes: string[] = [];
  if (/small|tiny|prominen|product.*weak|weak.*product/.test(text)) {
    intent.visualWeight = Math.min(0.70, current.visualWeight + 0.08);
    if (current.grammar === 'HOOK_PRODUCT_FRAGMENT') intent.assetRole = 'HERO';
    changes.push('increase visual anchor weight');
  }
  if (/hierarchy|headline|hook|legib|subhead|support|type/.test(text)
      || critique.checks.visualHierarchy === 'NEEDS_ATTENTION' || critique.checks.legibility === 'NEEDS_ATTENTION') {
    intent.typography.hookScale = Math.min(0.125, current.typography.hookScale + 0.008);
    intent.typography.supportScale = Math.min(0.052, current.typography.supportScale + 0.005);
    changes.push('increase measured hook and support weight');
  }
  if (/whitespace|white space|empty|dead|isolat|cta|balance/.test(text)) {
    intent.typography.compact = true;
    intent.typography.ctaGap = Math.max(0.012, current.typography.ctaGap - 0.01);
    intent.visualWeight = Math.min(0.70, intent.visualWeight + 0.05);
    changes.push('compress message spacing and enlarge visual field');
  }
  if (/crop|clipp/.test(text) && current.grammar === 'HOOK_PRODUCT_FRAGMENT') {
    intent.crop = 'CROP_TO_FOCUS';
    intent.anchor = 'RIGHT';
    changes.push('bring focal product region inside canvas');
  }
  const structural = critique.checks.composition === 'NEEDS_ATTENTION'
    || critique.checks.conceptClarity === 'NEEDS_ATTENTION';
  const alternate = current.grammar === 'HOOK_PRODUCT_FRAGMENT'
    ? 'PROBLEM_VISUAL_MESSAGE' : 'HOOK_PRODUCT_FRAGMENT';
  if (structural && options.attempt >= 3 && !options.triedGrammars.includes(alternate)
      && (alternate !== 'HOOK_PRODUCT_FRAGMENT' || options.canUseHero)) {
    return { intent: recognitionIntent(alternate), regenerateBackground: true,
      reason: 'switch to untried composition grammar' };
  }
  // Failure to express the intended scene is an imagery defect. Geometry-only
  // comments must never spend another image-generation call.
  const imageryDefect = /nostalgi|dated|metaphor|unrecogniz|ribbon|swirl|wrong.*(?:object|scene)|(?:background|imagery|prop|scene).{0,60}(?:generic|clutter|distract|ambiguous|wrong|weak)|(?:generic|cluttered|ambiguous).{0,30}(?:background|imagery|prop)|palette|invented/.test(text)
    || critique.checks.authenticity === 'NEEDS_ATTENTION' || critique.checks.noInventedClaims === 'NEEDS_ATTENTION';
  if (!changes.length) {
    intent.anchor = current.anchor.includes('RIGHT') ? 'LOWER_LEFT' : 'LOWER_RIGHT';
    intent.typography.compact = !current.typography.compact;
    changes.push('rebalance visual anchor and message spacing');
  }
  return { intent, regenerateBackground: imageryDefect, reason: changes.join('; ') };
}

/** Post-composition critique. Separate from claim governance and approval. */
export function critiqueComposition(input: {
  plan: CreativeScenePlan;
  widthPx: number;
  heightPx: number;
  screenshotComposited: boolean;
  overlayLineCount: number;
  actualLayout: CompositionLayout;
}): CreativeCritique {
  if (input.actualLayout !== input.plan.composition) return {
    outcome: 'CONCEPT_DID_NOT_SURVIVE_RENDER',
    summary: 'The rendered composition did not preserve the intended creative direction.',
    checks: { conceptClarity: 'NEEDS_ATTENTION', composition: 'NEEDS_ATTENTION' },
  };
  if (input.plan.assetRequirements.some(requirement => /screenshot/i.test(requirement)) && !input.screenshotComposited) return {
    outcome: 'ASSET_PROBLEM',
    summary: 'The intended product-led composition could not include an authorized product image.',
    checks: { productDemonstration: 'NEEDS_ATTENTION', assetIntegrity: 'NEEDS_ATTENTION' },
  };
  if (input.plan.primaryFocalPoint === 'MESSAGE' && input.overlayLineCount === 0) return {
    outcome: 'CONCEPT_DID_NOT_SURVIVE_RENDER',
    summary: 'The visual lost the concept\'s message, so it needs a stronger rebuild before review.',
    checks: { conceptClarity: 'NEEDS_ATTENTION', visualHierarchy: 'NEEDS_ATTENTION',
      composition: 'PASS', assetIntegrity: 'PASS' },
  };
  const usableSize = input.widthPx >= 600 && input.heightPx >= 600;
  const dense = input.overlayLineCount > 3;
  return {
    outcome: usableSize && !dense ? 'READY_FOR_OWNER_REVIEW' : 'NEEDS_CREATIVE_REVISION',
    summary: !usableSize ? 'The rendered image is too small for reliable owner review.'
      : dense ? 'The composition contains too much text for a clear first impression.'
        : 'The intended concept, authentic product image, and visual hierarchy survived composition.',
    checks: {
      visualHierarchy: dense ? 'NEEDS_ATTENTION' : 'PASS',
      legibility: usableSize ? 'PASS' : 'NEEDS_ATTENTION',
      conceptClarity: 'PASS', composition: 'PASS', productDemonstration: 'PASS',
      channelFit: usableSize && !dense ? 'PASS' : 'NEEDS_ATTENTION',
      assetIntegrity: 'PASS',
    },
  };
}
