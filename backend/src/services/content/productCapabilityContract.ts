/**
 * @file productCapabilityContract.ts
 * @description What LaunchMind may say the product DOES — Phase 3.5B6.7 §2–§6.
 *
 *   THE DEFECT THIS CLOSES, measured on the real AllignX account. LaunchMind
 *   holds exactly ONE sentence describing what the product does:
 *
 *     "Connect with trusted, vetted home service professionals in your
 *      neighborhood — quickly, safely, and conveniently."
 *
 *   The generator received that sentence and the instruction "every capability
 *   you state must be one this product's own description supports", and then
 *   wrote "search, compare, and reach out in one place". That is not
 *   disobedience — it is what happens when a model is given one sentence and
 *   asked to write an advert about a product surface it cannot see. Comparison
 *   is a plausible feature of a marketplace. It is also one LaunchMind has no
 *   reason to believe AllignX has.
 *
 *   PROSE IS NOT A BOUNDARY. The fix is not a firmer instruction. It is an
 *   ENUMERATED contract: the generator is told which actions it may attribute
 *   to the product, told explicitly which adjacent ones it may not, and then
 *   CHECKED afterwards — because the prompt is guidance and the validator is
 *   the boundary.
 *
 *   CONSERVATIVE BY CONSTRUCTION. A verb enters the contract only if the
 *   product's own truth contains it. Nothing is inferred from category, from
 *   competitors, from what similar products do, or from what a marketplace
 *   "obviously" offers. The cost is real: LaunchMind will refuse "find local
 *   pros" for a product whose description says only "connect with" them, and
 *   that will occasionally feel pedantic. The alternative is a system that
 *   decides for itself which unbuilt features to advertise.
 *
 *   WHAT THIS IS NOT. It is not a claim gate — grounding still runs afterwards
 *   and can still refuse a permitted verb. It is not a narrative exemption: a
 *   statement about what the product does is a product claim however it is
 *   phrased, and §6 forbids downgrading an unsupported capability into framing.
 *
 * @security Deterministic and model-free. The allow-list is derived from
 *   server-held product truth only; nothing the generator says can extend it.
 *   All patterns are linear — they run over model output.
 * @dependencies productContentContext (types only)
 */

import type { ProductContentContext } from './productContentContext';
import { isExplicitlyDenied } from './assertionContext';
import { ownerConfirmedServiceTruth,productionServiceTruth } from './serviceCatalog';

/** Where a permitted capability came from. Never inferred, always attributed. */
export type CapabilityProvenance =
  | 'PRODUCT_DESCRIPTION' | 'OWNER_CONFIRMED_TAGLINE'
  /** Service-level truth the owner typed in answer to a readiness question. */
  | 'OWNER_CONFIRMED_SERVICE_KNOWLEDGE';

export interface ProductCapability {
  /** Canonical action, lower case. */
  verb: string;
  /** Surface forms the generator may use for it. Inflections only. */
  forms: string[];
  /** What the action is performed on, as the product's own truth phrases it. */
  object: string | null;
  provenance: CapabilityProvenance;
  /** The service this came from, when it is service-level rather than company-level. */
  sourceService?: string | null;
  /** The exact sentence that established it. Owner-safe. */
  sourceText: string;
}

export interface ProductCapabilityContract {
  productName: string;
  capabilities: ProductCapability[];
  /** Every permitted surface form, flattened. The allow-list. */
  permittedForms: string[];
  /** Adjectives the product's own truth applies to what it offers. */
  qualifiers: string[];
  /** Named, so the generator sees the boundary rather than guessing at it. */
  unsupportedOrUnknown: string[];
  /** Owner-safe provenance sentences. */
  provenance: string[];
  /** True when LaunchMind holds no usable description at all. */
  empty: boolean;
}

/**
 * The capability vocabulary LaunchMind understands.
 *
 * A CLOSED SET, and that is the point. A verb absent from this table can never
 * be permitted, because there is no entry to permit — so the failure mode of an
 * unrecognised action word is refusal, not silent acceptance.
 *
 * Inflections are listed rather than stemmed: stemming would collapse "book"
 * (reserve) and "booking" (a reservation) into forms that also match "booked
 * solid", and a stemmer's mistakes are invisible where an explicit list's are
 * not.
 */
const CAPABILITY_VOCABULARY: Array<{ verb: string; forms: string[] }> = [
  { verb: 'connect',  forms: ['connect', 'connects', 'connecting', 'connected', 'connection'] },
  { verb: 'find',     forms: ['find', 'finds', 'finding', 'search', 'searches', 'searching'] },
  { verb: 'browse',   forms: ['browse', 'browses', 'browsing', 'discover', 'discovers', 'discovering'] },
  { verb: 'compare',  forms: ['compare', 'compares', 'comparing', 'comparison'] },
  { verb: 'book',     forms: ['book', 'books', 'booking', 'reserve', 'reserves', 'reserving'] },
  { verb: 'schedule', forms: ['schedule', 'schedules', 'scheduling', 'appointment', 'appointments'] },
  { verb: 'message',  forms: ['message', 'messages', 'messaging', 'chat', 'chats'] },
  { verb: 'quote',    forms: ['quote', 'quotes', 'estimate', 'estimates', 'bid', 'bids'] },
  { verb: 'pay',      forms: ['pay', 'pays', 'paying', 'payment', 'payments', 'checkout'] },
  { verb: 'track',    forms: ['track', 'tracks', 'tracking', 'monitor', 'monitors'] },
  { verb: 'manage',   forms: ['manage', 'manages', 'managing', 'dashboard'] },
  { verb: 'match',    forms: ['match', 'matches', 'matching', 'matched'] },
  { verb: 'request',  forms: ['request', 'requests', 'requesting'] },
  { verb: 'review',   forms: ['review', 'reviews', 'rating', 'ratings', 'rate'] },
  { verb: 'hire',     forms: ['hire', 'hires', 'hiring'] },
  { verb: 'reach',    forms: ['reach out', 'reaching out', 'contact', 'contacts', 'contacting'] },
  // ADDED AFTER THE ADVERSARIAL SUITE FOUND THEM MISSING. "Choose the lowest
  // price" and "See real-time availability" are feature claims that named no
  // verb in the original table, so both passed. A closed vocabulary is only as
  // good as its coverage, and coverage is measured, not assumed.
  { verb: 'price',    forms: ['price', 'prices', 'pricing', 'cost', 'costs', 'rate', 'rates', 'fee', 'fees'] },
  { verb: 'availability', forms: ['availability', 'available', 'real-time', 'realtime', 'live availability', 'open slots'] },
  // ADDED AFTER THE ALLIGNX PLUMBING RUN. The product's truth supports the
  // PROPERTY "vetted professionals"; it says nothing about the platform
  // performing vetting. With no entry here, "gone through the platform's
  // vetting process" named no verb the table knew and passed §6 untouched,
  // while the near-synonym "a structured review process" was rejected — the
  // repair loop simply converged on the uncovered word. 'vetted' is
  // deliberately NOT a form: it stays a qualifier, so the supported property
  // is unaffected and only the ACTION is refused.
  { verb: 'vet',      forms: ['vet', 'vets', 'vetting'] },
];

/** Qualifiers a product may claim about what it offers, if its truth says so. */
const QUALIFIER_VOCABULARY = [
  'trusted', 'vetted', 'verified', 'licensed', 'insured', 'certified',
  'background-checked', 'local', 'neighborhood', 'nearby', 'nearest',
  'rated', 'reviewed', 'top-rated', 'professional', 'qualified', 'screened',
];

/**
 * Qualifiers that are a legal or safety assertion rather than a description.
 *
 * These are refused even when the product's own marketing copy uses them: a
 * scraped page saying "background-checked" is that page's claim, and repeating
 * it in an advert makes it LaunchMind's. Owner confirmation is the only route.
 */
const QUALIFIERS_REQUIRING_OWNER_CONFIRMATION = [
  'certified', 'licensed', 'insured', 'background-checked', 'verified', 'screened',
];

/** Escapes a literal for safe inclusion in a pattern. */
function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Does this text contain this surface form as a whole word/phrase? */
function mentions(text: string, form: string): boolean {
  return new RegExp(`\\b${esc(form)}\\b`, 'i').test(text);
}

/**
 * Does this text attribute the action TO THE PRODUCT?
 *
 * A CORRECTNESS FIX, NOT A RELAXATION, and the distinction matters because the
 * phase brief forbids weakening capability validation. The set of permitted
 * capabilities is unchanged — AllignX may still only "connect". What changes is
 * that the validator now measures what it claims to measure.
 *
 * MEASURED: the dominant blocking failure across five concept sets was
 * `UNSUPPORTED_CAPABILITY: find`, firing on "If YOUR SEARCH for help starts
 * with hold music". That sentence attributes searching to the READER. It is
 * narrative framing about someone's afternoon, not an assertion that the
 * product has a search feature — and refusing it protected nothing while
 * costing the concept.
 *
 * The rule is narrow: a possessive determiner immediately before the form means
 * the action belongs to whoever the possessive names. "AllignX searches",
 * "search for pros", "you can search" and "book instantly" are all still
 * violations, because none of them is preceded by a possessive.
 *
 * RESIDUAL RISK, stated: "your booking is confirmed instantly" would slip
 * through this exclusion. It would still be caught by claim grounding as an
 * unsupported outcome, so the failure mode is one layer thinner rather than
 * absent.
 */
function attributedToReaderNotProduct(text: string, form: string): boolean {
  const possessive = new RegExp(`\\b(?:your|their|our|my|his|her|its)\\s+${esc(form)}\\b`, 'i');
  if (possessive.test(text)) {
    // …UNLESS THE SENTENCE SAYS SOMETHING PERFORMS IT. "Your search" is the
    // reader's afternoon; "your booking is confirmed instantly" is a claim that
    // the PRODUCT confirms bookings, and the possessive is doing nothing but
    // disguising the subject.
    //
    // Six such holes were measured against the §3 adversarial list — booking
    // confirmed, payment processed, quote arrives, appointment scheduled, and
    // both rhetorical wrappers of the same. All six passed the first version of
    // this exclusion. The distinction that closes them is grammatical rather
    // than lexical: a possessive noun followed by a PASSIVE completion, or
    // qualified by an automation adverb, is an assertion about what the product
    // does regardless of whose noun it is.
    if (performedForTheReader(text, form)) return false;
    return true;
  }
  // A GERUND SUBJECT naming the reader's activity — "if FINDING HELP feels
  // harder than it should" — is the same situation described without a
  // possessive, and was refused by the first version for lack of one.
  // Restricted to experience verbs: "finding help feels hard" describes the
  // reader; "finding help is instant" would be a product claim and is excluded
  // by the same passive/automation test.
  const gerund = new RegExp(
    `\\b${esc(form)}\\w*\\s+\\w+\\s+(?:feels?|seems?|looks?|sounds?)\\b`, 'i');
  if (gerund.test(text) && !performedForTheReader(text, form)) return true;
  // A PARTICIPLE MODIFYING THE AUDIENCE — "for professionals and entrepreneurs
  // MANAGING properties, AllignX offers…" — names who the reader is, not what
  // the product does. Surfaced the moment array fields entered §6: that exact
  // line is the audience descriptor from the brief, and refusing it would cost
  // eligibility while protecting nothing. Narrow and linear: the form must
  // stand IMMEDIATELY after a person noun, and the same passive/automation
  // test still reclaims "professionals managing your account automatically".
  if (audienceParticiple(text, form) && !performedForTheReader(text, form)) return true;
  return false;
}

/** Person nouns a brief uses to name an audience. Closed, like every other list here. */
const AUDIENCE_NOUNS =
  'people|professionals|entrepreneurs|founders|owners|homeowners|landlords|' +
  'managers|teams|businesses|customers|clients|renters|families|residents|users';

/** Is every use of the form a participle attached to an audience noun? */
function audienceParticiple(text: string, form: string): boolean {
  return new RegExp(`\\b(?:${AUDIENCE_NOUNS})\\s+${esc(form)}\\b`, 'i').test(text);
}

/**
 * Are ALL occurrences of this form the reader's own activity?
 *
 * Strips the spans that are reader-attributed and asks whether the form
 * survives. Anything left is the product being credited with the action.
 */
function onlyReaderAttributed(text: string, form: string): boolean {
  if (!attributedToReaderNotProduct(text, form)) return false;
  const stripped = text
    .replace(new RegExp(`\\b(?:your|their|our|my|his|her|its)\\s+${esc(form)}\\w*`, 'gi'), ' ')
    .replace(new RegExp(`\\b${esc(form)}\\w*\\s+\\w+\\s+(?:feels?|seems?|looks?|sounds?)`, 'gi'), ' ')
    .replace(new RegExp(`\\b(?:${AUDIENCE_NOUNS})\\s+${esc(form)}`, 'gi'), ' ');
  return !new RegExp(`\\b${esc(form)}\\b`, 'i').test(stripped);
}

/**
 * Does the sentence assert that this action is CARRIED OUT for the reader?
 *
 * Passive completion ("is confirmed", "are processed", "arrives") or an
 * automation adverb ("instantly", "automatically") turns a possessive noun into
 * a statement about what the product does.
 */
function performedForTheReader(text: string, form: string): boolean {
  const near = `[^.?!]{0,40}`;
  const passive = new RegExp(
    `\\b${esc(form)}\\w*\\b${near}\\b(?:is|are|was|were|gets?|will be|being)\\s+` +
    `\\w+(?:ed|en)\\b`, 'i');
  if (passive.test(text)) return true;
  // "your quote arrives instantly" — an intransitive completion plus automation.
  const automated = new RegExp(
    `\\b${esc(form)}\\w*\\b${near}\\b(?:instantly|automatically|immediately|` +
    `right away|in seconds|in minutes|same day)\\b`, 'i');
  return automated.test(text);
}

/**
 * Builds the contract from server-held product truth ONLY.
 *
 * @security Reads `ctx.application.description` and OWNER-CONFIRMED brand
 *   fields. It does NOT read category, competitors, market intelligence,
 *   creative patterns or anything the generator produced — every one of those
 *   would let a capability arrive from outside the product.
 */
export function buildProductCapabilityContract(
  ctx: ProductContentContext,
): ProductCapabilityContract {
  const description = String(ctx.application.description ?? '').trim();
  // A CONFIRMED tagline is the owner's own statement about their product and
  // is admissible here. An OBSERVED one is not: brand is not evidence, and an
  // unconfirmed scraped line is exactly the kind of claim this file exists to
  // stop LaunchMind from adopting.
  const tagline = ctx.brand.fields.tagline?.ownerConfirmed
    ? String(ctx.brand.fields.tagline.value ?? '').trim() : '';

  const sources: Array<{ text: string; provenance: CapabilityProvenance; service?: string | null }> = [];
  if (description) sources.push({ text: description, provenance: 'PRODUCT_DESCRIPTION', service: null });
  if (tagline && tagline !== description) {
    sources.push({ text: tagline, provenance: 'OWNER_CONFIRMED_TAGLINE', service: null });
  }
  // SERVICE-LEVEL TRUTH the owner confirmed. It is admissible for the same
  // reason the tagline is: the owner stated it about their own product. Without
  // it, LaunchMind asks the owner what the product does for plumbing, uses the
  // answer to decide the concept is executable, and then refuses to let the
  // writer say any of it — which is how a READY concept still produced generic
  // copy. Read from `ctx` rather than passed in, so every caller (generation,
  // repair, revalidation, the creative set, the production contract) derives an
  // IDENTICAL contract; a per-call argument would let revalidation build a
  // narrower one and reject a draft that generation was entitled to write.
  //
  // Admissible does NOT mean unbounded: only verbs in the closed vocabulary
  // below are extracted, so owner wording can never become a stronger claim
  // than the owner supplied. Provenance and service name are retained so
  // company-level and service-level truth stay distinguishable.
  for (const entry of ctx.signalFoundation?.catalog?.confirmed ?? []) {
    const truth = productionServiceTruth(ownerConfirmedServiceTruth(entry)).truth;
    if (!truth) continue;
    for (const statement of truth.statements) {
      sources.push({ text: statement.text, provenance: 'OWNER_CONFIRMED_SERVICE_KNOWLEDGE',
        service: truth.serviceName });
    }
  }

  const capabilities: ProductCapability[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    for (const entry of CAPABILITY_VOCABULARY) {
      if (seen.has(entry.verb)) continue;
      // ONLY the forms the source actually uses become permitted. A source
      // saying "connect" permits "connects" and "connecting" — inflections of
      // the same action — and permits nothing else in the table.
      const used = entry.forms.filter(f => mentions(src.text, f));
      if (used.length === 0) continue;
      seen.add(entry.verb);
      capabilities.push({
        verb: entry.verb, forms: entry.forms, object: extractObject(src.text, used[0]),
        provenance: src.provenance, sourceService: src.service ?? null, sourceText: src.text,
      });
    }
  }

  /**
   * Qualifiers that are the SAME claim in different words.
   *
   * Narrow and explicit, not a general synonym mechanism. "In your
   * neighborhood" and "local" assert the same geographic fact about the same
   * offering; refusing the second while permitting the first is pedantry that
   * costs eligibility and protects nothing. Measured: a run failed solely
   * because the model wrote "Local" where the description says "neighborhood".
   *
   * Nothing else is grouped. "vetted" does not imply "background-checked",
   * "trusted" does not imply "verified" — those are different assertions with
   * different burdens, and the phase brief names them separately.
   */
  const QUALIFIER_EQUIVALENTS: Record<string, string[]> = {
    neighborhood: ['local', 'nearby'],
  };

  const qualifiers: string[] = [];
  for (const src of sources) {
    for (const q of QUALIFIER_VOCABULARY) {
      if (qualifiers.includes(q)) continue;
      if (!mentions(src.text, q)) continue;
      // A safety/legal assertion needs the owner, whatever the page said. Owner
      // service knowledge satisfies that for the same reason a confirmed
      // tagline does — the owner typed it, and it is stored with confirmedBy
      // and confirmedAt. A scraped page still does not.
      if (QUALIFIERS_REQUIRING_OWNER_CONFIRMATION.includes(q)
          && src.provenance !== 'OWNER_CONFIRMED_TAGLINE'
          && src.provenance !== 'OWNER_CONFIRMED_SERVICE_KNOWLEDGE') continue;
      qualifiers.push(q);
      for (const eq of QUALIFIER_EQUIVALENTS[q] ?? []) {
        if (!qualifiers.includes(eq)) qualifiers.push(eq);
      }
    }
  }

  const permittedForms = capabilities.flatMap(c => c.forms);
  const unsupportedOrUnknown = CAPABILITY_VOCABULARY
    .filter(e => !seen.has(e.verb)).map(e => e.verb);

  return {
    productName: String(ctx.application.name ?? ''),
    capabilities, permittedForms, qualifiers, unsupportedOrUnknown,
    provenance: sources.map(s => s.provenance === 'PRODUCT_DESCRIPTION'
      ? 'From your product description'
      : 'From the tagline you confirmed'),
    empty: capabilities.length === 0,
  };
}

/** The words following the verb, as the source itself phrases them. */
function extractObject(text: string, form: string): string | null {
  const m = new RegExp(`\\b${esc(form)}\\b\\s+(?:with\\s+|to\\s+)?([^.,;—-]{3,60})`, 'i').exec(text);
  return m ? m[1].trim() : null;
}

// ── §5 GENERATION CONSTRAINT ────────────────────────────────────────────────

/**
 * The prompt section. Generated from the contract, never hardcoded per product.
 */
export function capabilityDirective(c: ProductCapabilityContract): string {
  if (c.empty) {
    return '\nPRODUCT TRUTH YOU MAY STATE\n' +
      'LaunchMind does not hold a description of what this product does, so do ' +
      'NOT state any capability at all. Write about the situation and the brand ' +
      'only.\n';
  }
  const may = c.capabilities.map(cap =>
    `- the product ${cap.verb}s${cap.object ? ` ${cap.object}` : ''}`).join('\n');
  const quals = c.qualifiers.length
    ? `\nYou may describe what it offers as: ${c.qualifiers.join(', ')}.\n` : '\n';
  return '\nPRODUCT TRUTH YOU MAY STATE — this is the whole of it:\n' + may + quals +
    '\nPRODUCT DETAILS YOU MUST NOT INVENT. LaunchMind has no reason to believe ' +
    'this product does any of these, so do not imply it does:\n' +
    c.unsupportedOrUnknown.map(v => `- ${v}`).join(', ') + '\n' +
    'Do not say "in one place", "all in one", "everything you need" or anything ' +
    'else implying a feature set beyond the line above.\n';
}

// ── §6 SERVER VALIDATION ────────────────────────────────────────────────────

export interface CapabilityViolation {
  /** The unsupported action the text attributed to the product. */
  verb: string;
  /** The phrase that did it. */
  span: string;
  /** Owner-safe. */
  reason: string;
}

/**
 * Phrases that imply a feature set regardless of which verb is used.
 *
 * "Everything in one place" attributes no specific action and is still a claim
 * about breadth that one sentence of product truth cannot support.
 */
const BREADTH_CLAIMS: Array<{ test: RegExp; label: string }> = [
  // FLAT BRANCHES. `(?:in\s+)?` between two `\s+` runs gave the engine two ways
  // to partition the same whitespace, which is the shape the analyser objects
  // to. The second pattern below already covers "in one place", so the optional
  // group bought nothing. These run over model output.
  { test: /\b(?:all|everything)\s+one\s+place\b/i, label: 'a single place for everything' },
  { test: /\bin\s+one\s+place\b/i, label: 'a single place for everything' },
  { test: /\ball[- ]in[- ]one\b/i, label: 'an all-in-one product' },
  { test: /\beverything you need\b/i, label: 'a complete feature set' },
  { test: /\bone\s+(?:app|dashboard|hub)\s+for\b/i, label: 'a single hub for everything' },
  { test: /\bend[- ]to[- ]end\b/i, label: 'an end-to-end product' },
];

/**
 * Does this text attribute an action to the product that its truth does not?
 *
 * @security THE boundary. The prompt is advice; this decides. Runs on every
 *   generated field including headline, body, description and any overlay line,
 *   so a capability cannot enter through a field nobody validated.
 */
export function findCapabilityViolations(
  text: string, contract: ProductCapabilityContract,
): CapabilityViolation[] {
  const out: CapabilityViolation[] = [];
  const t = String(text ?? '');
  const permitted = new Set(contract.permittedForms.map(f => f.toLowerCase()));

  for (const entry of CAPABILITY_VOCABULARY) {
    for (const form of entry.forms) {
      if (permitted.has(form.toLowerCase())) continue;
      if (!mentions(t, form)) continue;
      // EVERY occurrence must belong to the reader, and the check is now made
      // by REMOVING the reader-attributed spans and asking whether the form
      // still appears. The previous form — "is reader-attributed AND no bare
      // occurrence exists" — worked for possessives and defeated itself for
      // gerunds, because the gerund IS the bare occurrence. "If finding help
      // feels harder than it should" was refused for that reason alone.
      //
      // A mixed sentence is still caught: "Your search starts here. Search for
      // pros." leaves a bare "Search" behind after the possessive span is
      // removed, so the violation stands.
      if (onlyReaderAttributed(t, form)) continue;
      // A capability can also be EXPLICITLY DENIED rather than claimed — "This
      // does not mean a provider will be instantly available" refuses the same
      // capability this check exists to catch. Shared with the qualifier check
      // below and with copyClaimClassifier's lexicon matcher: one negation
      // primitive, not a per-verb reimplementation.
      if (isExplicitlyDenied(t, form)) continue;
      out.push({
        verb: entry.verb, span: form,
        reason: `LaunchMind has no record that this product can ${entry.verb}, ` +
          `so it cannot say so.`,
      });
      break;   // one violation per verb is enough to reject
    }
  }
  for (const b of BREADTH_CLAIMS) {
    if (b.test.test(t)) {
      out.push({ verb: 'breadth', span: b.label,
        reason: `LaunchMind cannot describe this product as ${b.label} — it only ` +
          `knows what its own description says.` });
      break;
    }
  }
  // A qualifier the product's truth does not use is also an invention —
  // UNLESS the sentence explicitly DENIES it. "LaunchMind has not verified
  // this" refuses the same claim this check exists to catch; rejecting it
  // as if it asserted "verified" punishes the correct behaviour.
  for (const q of QUALIFIER_VOCABULARY) {
    if (contract.qualifiers.includes(q)) continue;
    if (!mentions(t, q)) continue;
    if (isExplicitlyDenied(t, q)) continue;
    out.push({ verb: `qualifier:${q}`, span: q,
      reason: `LaunchMind has no record that this product's professionals are ${q}.` });
    break;
  }
  return out;
}

/** Every reader-visible field of one generated payload — strings and the string
 * members of array fields — checked together. */
export function validatePayloadCapabilities(
  payload: Record<string, unknown>, contract: ProductCapabilityContract,
): CapabilityViolation[] {
  const out: CapabilityViolation[] = [];
  for (const [field, value] of Object.entries(payload)) {
    // visualBrief is an INSTRUCTION to a renderer, not owner-visible copy, and
    // it legitimately describes interfaces. Every field a reader could see is
    // checked; this one is checked at the overlay boundary instead.
    if (field === 'visualBrief') continue;
    // Owner-visible copy also arrives as ARRAYS. A landing page's `benefits`
    // is four reader-visible lines and `ctas` is one; skipping every
    // non-string meant §6 never ran on any of them. MEASURED on the AllignX
    // Plumbing run: "reviewed for trustworthiness" (an unpermitted qualifier)
    // and "a structured review process" (an unpermitted verb) both sat in
    // `benefits`, both are violations when passed here directly, and both
    // reached the owner path with capabilityViolations empty — caught only by
    // the model-dependent grounding arm, not by this deterministic boundary.
    const texts = typeof value === 'string' ? [value]
      : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string')
      : [];
    for (const text of texts) {
      for (const v of findCapabilityViolations(text, contract)) {
        if (!out.some(x => x.verb === v.verb)) out.push(v);
      }
    }
  }
  return out;
}
