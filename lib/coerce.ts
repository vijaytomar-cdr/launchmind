/**
 * @file lib/coerce.ts
 * @description Defensive coercion for jsonb fields that SHOULD be string[]
 *   but may arrive as a JSON string, an object, or null.
 *   jsonb columns do not guarantee shape — the DB will happily store any
 *   valid JSON. Never trust the TypeScript annotation on a jsonb field.
 */

/** Coerce an unknown jsonb value into string[]. Never throws. */
export function toStringArray(value: unknown): string[] {
  if (value == null) return [];

  // Already an array → keep only string-ish members
  if (Array.isArray(value)) {
    return value
      .filter((v) => v != null)
      .map((v) => (typeof v === 'string' ? v : String(v)));
  }

  // Double-encoded: jsonb stored a JSON *string* e.g. '["a","b"]'
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return toStringArray(parsed);
      } catch {
        /* fall through — treat as a single chip */
      }
    }
    return s.length > 0 ? [s] : [];
  }

  // Object → surface its values as chips rather than crashing
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .filter((v) => v != null)
      .map((v) => String(v));
  }

  return [String(value)];
}

/** Coerce unknown jsonb into a plain record. Never throws. */
export function toRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const p = JSON.parse(value);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
    } catch { return {}; }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
