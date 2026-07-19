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
 * @param error - Human-readable message safe to show the client
 * @param code  - Machine-readable error code (e.g. 'PRODUCT_NOT_FOUND')
 */
export function fail(error: string, code: string): FailureResponse {
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
