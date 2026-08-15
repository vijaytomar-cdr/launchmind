/**
 * @file response.ts
 * @description Standard API response envelope for all Fastify routes.
 *   Every route MUST return { ok, data } on success or { ok, error, code } on failure.
 *   Replaces ad-hoc response shapes across routes.
 *
 *   Success:  { ok: true, data: T, meta?: ResponseMeta }
 *   Failure:  { ok: false, error: string, code: string }
 *
 * @security Never include internal error details (stack traces, DB messages)
 *   in the error field — only the code. Log internals via Sentry separately.
 */

export interface ResponseMeta {
  page?:    number;
  perPage?: number;
  total?:   number;
  cursor?:  string;
}

export interface SuccessResponse<T> {
  ok:    true;
  data:  T;
  meta?: ResponseMeta;
}

export interface FailureResponse {
  ok:    false;
  error: string;
  code:  string;
}

export type ApiResponse<T> = SuccessResponse<T> | FailureResponse;

/**
 * Wraps data in the standard success envelope.
 */
export function ok<T>(data: T, meta?: ResponseMeta): SuccessResponse<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}

/**
 * Returns the standard failure envelope.
 *
 * ARGUMENT ORDER CORRECTED. The parameters were named `(error, code)` while all
 * 71 call sites pass `(code, message)` — `fail(ErrorCodes.VALIDATION_ERROR,
 * 'Invalid prompt data')`. The names were wrong, not the call sites, so the
 * envelope carried the CODE in its `error` field and the frontend, which shows
 * `body.error`, rendered raw machine strings at owners. A founder describing
 * their pre-launch product was told, in full:
 *
 *     VALIDATION_ERROR
 *
 * Swapping the parameters here fixes every route at once rather than editing 71
 * call sites, and nothing reads either field positionally (checked).
 *
 * @param code  - Machine-readable error code (e.g. 'PRODUCT_NOT_FOUND')
 * @param error - Human-readable message safe to show the owner. Write it as
 *   something a person can act on; the code is what software matches against.
 */
export function fail(code: string, error: string): FailureResponse {
  return { ok: false, error, code };
}

// ─── Standard error codes ─────────────────────────────────────────────────────

export const ErrorCodes = {
  // Auth
  UNAUTHORIZED:        'UNAUTHORIZED',
  FORBIDDEN:           'FORBIDDEN',
  MFA_REQUIRED:        'MFA_REQUIRED',

  // Resources
  NOT_FOUND:           'NOT_FOUND',
  ALREADY_EXISTS:      'ALREADY_EXISTS',
  CONFLICT:            'CONFLICT',

  // Validation
  VALIDATION_ERROR:    'VALIDATION_ERROR',
  INVALID_INPUT:       'INVALID_INPUT',

  // Business rules (Decision Engine)
  BUDGET_EXCEEDED:     'BUDGET_EXCEEDED',
  NOT_APPROVED:        'NOT_APPROVED',
  PLAN_REQUIRED:       'PLAN_REQUIRED',
  INSUFFICIENT_TOKENS: 'INSUFFICIENT_TOKENS',
  EXPERIMENT_TOO_EARLY:'EXPERIMENT_TOO_EARLY',

  // Rate limits
  RATE_LIMITED:        'RATE_LIMITED',

  // External services
  AI_SERVICE_ERROR:    'AI_SERVICE_ERROR',
  SCRAPER_ERROR:       'SCRAPER_ERROR',
  PAYMENT_ERROR:       'PAYMENT_ERROR',

  // Internal
  INTERNAL_ERROR:      'INTERNAL_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
