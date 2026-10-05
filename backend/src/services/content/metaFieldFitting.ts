import type { ChannelContentResult } from './b3ContentGeneration';

/** Mirrors the pinned validators; they remain authoritative after every change. */
export const META_FIELD_LIMITS = { primaryText: 2200, headline: 40, description: 30, cta: 24 } as const;
type Field = keyof typeof META_FIELD_LIMITS;
const claimField = (field: Field) => field === 'primaryText' ? 'primary_text' : field;
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
/** Removes only dispensable terminal punctuation when that single character
 * resolves the actual channel limit. Never truncates words or expressive ?/!. */
export function fitTerminalPunctuation(text: string, maximum: number): string | null {
  const normalized = normalize(text);
  if (normalized.length <= maximum || normalized.length - 1 > maximum) return null;
  if (!/[.,;:]$/.test(normalized)) return null;
  return normalized.slice(0, -1);
}
const safe = (r: ChannelContentResult) => r.quality.factualSafety === 'CERTIFIED_SUPPORTED'
  && !r.degraded && !r.terminologyViolations.length
  && !r.claims.some(c => c.verdict === 'NEEDS_OWNER_CONFIRMATION');

/** No enum exists in the channel contract. These are proposals, never pre-approved claims.
 * Neutral discovery labels do not invent a destination, transaction, trial or booking.
 */
export function navigationCtaCandidates(productName: string): string[] {
  return [`See ${normalize(productName)}`, 'Learn more', 'Explore options']
    .filter(value => value.length <= META_FIELD_LIMITS.cta);
}

export async function fitMetaFields(opts: {
  result: ChannelContentResult;
  parsed: Record<string, unknown>;
  productName: string;
  context: string;
  evaluate: (candidate: Record<string, unknown>) => Promise<ChannelContentResult>;
  generate: (system: string, user: string) => Promise<string>;
}) {
  let result = opts.result;
  let parsed = opts.parsed;
  const evidence: Array<Record<string, unknown>> = [];
  const errors = () => result.structuralIssues.filter(i => i.severity === 'ERROR');
  // Semantic failures keep the existing bounded semantic repair path.
  if (!safe(result) || !errors().length) return { result, evidence };
  const failing = [...new Set(errors().map(i => i.field))]
    .filter((f): f is Field => Object.hasOwn(META_FIELD_LIMITS, f));

  async function consider(field: Field, text: string, method: string, declarations: unknown[] = []) {
    const limit = META_FIELD_LIMITS[field];
    const entry: Record<string, unknown> = { field, text, measuredLength: text.length, maximum: limit, method };
    evidence.push(entry);
    if (!text.trim() || text.length > limit) { entry.selected = false; return false; }
    // Remove only superseded field declarations; independent discovery runs again
    // on the WHOLE candidate, with all unaffected generator declarations intact.
    const old = Array.isArray(parsed.declaredClaims) ? parsed.declaredClaims : [];
    const candidate = { ...parsed, content: { ...result.payload, [field]: text },
      declaredClaims: [...old.filter(d => d?.fieldId !== claimField(field)), ...declarations] };
    const checked = await opts.evaluate(candidate);
    entry.claims = checked.claims;
    entry.structuralIssues = checked.structuralIssues;
    entry.disposition = checked.disposition;
    const selected = safe(checked) && !checked.structuralIssues.some(i => i.severity === 'ERROR' && i.field === field);
    entry.selected = selected;
    if (selected) { result = checked; parsed = candidate; }
    return selected;
  }

  for (const field of failing) {
    const original = result.payload[field];
    if (typeof original === 'string' && normalize(original) !== original) {
      const declarations = (Array.isArray(parsed.declaredClaims) ? parsed.declaredClaims : [])
        .filter(d => d?.fieldId === claimField(field))
        .map(d => ({ ...d, textSpan: typeof d.textSpan === 'string' ? normalize(d.textSpan) : d.textSpan }));
      if (await consider(field, normalize(original), 'whitespace', declarations)) continue;
    }
    if (typeof original === 'string') {
      const fitted = fitTerminalPunctuation(original, META_FIELD_LIMITS[field]);
      if (fitted) {
        const declarations = (Array.isArray(parsed.declaredClaims) ? parsed.declaredClaims : [])
          .filter(d => d?.fieldId === claimField(field))
          .map(d => ({ ...d, textSpan: typeof d.textSpan === 'string'
            ? d.textSpan.replace(/[.,;:]\s*$/, '') : d.textSpan }));
        if (await consider(field, fitted, 'terminal_punctuation', declarations)) continue;
      }
    }
    if (field === 'cta') {
      for (const cta of navigationCtaCandidates(opts.productName)) {
        if (await consider(field, cta, 'navigation_set')) break;
      }
    }
  }
  const remaining = failing.filter(f => errors().some(i => i.field === f));
  if (!remaining.length) return { result, evidence };
  const request = remaining.map(field => ({ field, original: result.payload[field] ?? null,
    measuredLength: typeof result.payload[field] === 'string' ? result.payload[field].length : null,
    maximum: META_FIELD_LIMITS[field],
    meaningToPreserve: result.payload[field] || 'Recover the required meaning only from the governed surrounding copy and supplied product context.' }));
  const system = `${opts.context}\nTARGETED FIELD FITTING: Return JSON only, {"alternatives":{"field":[{"text":"...","declaredClaims":[]}]}}. ` +
    'Return five concise alternatives for EACH requested field only. Do not return the copy bundle or character counts. ' +
    'Preserve the original meaning, complete grammar and supported action/object; prefer comfortably shorter wording. ' +
    'Do not introduce promises, metrics, new capabilities, offers, destinations or customer experiences. ' +
    'Declare factual claims using the original field ID and existing declaration schema. The application measures every string and rechecks governance.';
  const user = JSON.stringify({ fields: request, governedContext: result.payload });
  let alternatives: Record<string, unknown> = {};
  try {
    const raw = await opts.generate(system, user);
    const decoded = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
    alternatives = decoded.alternatives ?? {};
    evidence.push({ method: 'targeted_request', system, user, raw });
  } catch { evidence.push({ method: 'targeted_request', system, user, failed: true }); }
  for (const field of remaining) {
    const values = alternatives[field];
    if (!Array.isArray(values)) continue;
    // Measured locally; alleged counts/limits supplied by the model are ignored.
    const bounded = values.slice(0, 5);
    evidence.push({ field, alternatives: bounded.map(v => ({ text: typeof v === 'string' ? v : v?.text,
      measuredLength: typeof (typeof v === 'string' ? v : v?.text) === 'string' ? (typeof v === 'string' ? v : v.text).length : null })) });
    for (const value of bounded) {
      const text = typeof value === 'string' ? value : value?.text;
      if (typeof text !== 'string') continue;
      const declarations = Array.isArray(value?.declaredClaims)
        ? value.declaredClaims.filter((d: { fieldId?: string }) => d?.fieldId === claimField(field)) : [];
      if (await consider(field, text, 'targeted_alternative', declarations)) break;
    }
  }
  return { result, evidence };
}
