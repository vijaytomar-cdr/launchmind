/**
 * @file embeddingErrors.ts
 * @description Typed embedding failures and the retry classification.
 *
 *   Phase 3.1C, ADR-066 rule 26. The classification lives here rather than in the
 *   worker so that "is this worth retrying?" has exactly one answer, and adding a
 *   provider cannot quietly introduce a second opinion.
 *
 *   THE DISTINCTION THAT MATTERS: a retryable failure is one where the SAME input
 *   might succeed later. Everything else must fail fast. Retrying a malformed
 *   input, a bad credential, or a dimension mismatch burns quota, delays real
 *   work behind it, and — worst — turns a loud configuration error into a slow
 *   silent backlog that looks like the provider being slow.
 *
 * @security No error carries provider payloads, request bodies, credentials or
 *   source text. Provider error bodies routinely echo the input, and the input
 *   here is founder memory.
 * @dependencies none
 */

export const EMBEDDING_ERROR_KINDS = [
  'UNCONFIGURED',        // no credential / no active contract
  'AUTH_FAILED',         // credential rejected
  'RATE_LIMITED',        // provider throttled us
  'TIMEOUT',             // no response in budget
  'PROVIDER_UNAVAILABLE',// 5xx / network
  'INVALID_INPUT',       // provider refused the text (too long, empty, unsupported)
  'MALFORMED_OUTPUT',    // response was not a usable vector
  'DIMENSION_MISMATCH',  // vector width ≠ the contract
  'SOURCE_INELIGIBLE',   // canonical record must never be embedded (rule 45)
  'SOURCE_MISSING',      // canonical record gone before the job ran
  'GENERATION_DISABLED', // contract exists but generation is switched off
] as const;

export type EmbeddingErrorKind = typeof EMBEDDING_ERROR_KINDS[number];

/**
 * Kinds where the same input may succeed on a later attempt.
 *
 * UNCONFIGURED and GENERATION_DISABLED are deliberately NOT retryable: they are
 * operator states, not transient faults. Retrying them would spin the queue
 * until attempts were exhausted and then report "failed" — which reads as a
 * provider problem rather than "nobody has provisioned a key yet".
 */
const RETRYABLE = new Set<EmbeddingErrorKind>([
  'RATE_LIMITED', 'TIMEOUT', 'PROVIDER_UNAVAILABLE',
]);

export function isRetryable(kind: EmbeddingErrorKind): boolean {
  return RETRYABLE.has(kind);
}

export class EmbeddingError extends Error {
  readonly kind: EmbeddingErrorKind;
  /** Seconds the provider asked us to wait, when it said so. */
  readonly retryAfterSeconds?: number;

  constructor(kind: EmbeddingErrorKind, detail: string, retryAfterSeconds?: number) {
    // `detail` is written by LaunchMind, never copied from a provider body.
    super(`${kind}: ${detail}`);
    this.name = 'EmbeddingError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  get retryable(): boolean { return isRetryable(this.kind); }
}

/**
 * Maps an HTTP status to a failure kind.
 *
 * 400 is NOT retryable: a rejected request is our bug, and telling the operator
 * to wait would point them at nothing. 408/429/5xx are.
 */
export function kindFromStatus(status: number): EmbeddingErrorKind {
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408) return 'TIMEOUT';
  if (status >= 500)  return 'PROVIDER_UNAVAILABLE';
  if (status === 400 || status === 422) return 'INVALID_INPUT';
  return 'PROVIDER_UNAVAILABLE';
}

/**
 * Back-off for a retryable failure.
 *
 * Honours a provider's own Retry-After when present — guessing shorter than the
 * provider asked is how a rate limit becomes a longer rate limit.
 *
 * @param attempt 1-based attempt number
 */
export function backoffSeconds(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.min(retryAfterSeconds, 3600);
  return Math.min(2 ** Math.max(0, attempt - 1) * 15, 3600);   // 15s, 30s, 60s … capped 1h
}
