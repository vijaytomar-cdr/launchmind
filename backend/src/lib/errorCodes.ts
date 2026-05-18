/**
 * @file errorCodes.ts
 * @description Structured error codes for the LaunchMind API.
 *   Every error response includes a `code` field so clients can handle errors
 *   programmatically without string-matching on `error` messages.
 * @security Error codes must never leak internal state (stack traces, DB column names, etc.).
 */

export const ErrorCodes = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_JWT: 'INVALID_JWT',

  // Validation
  INVALID_BODY: 'INVALID_BODY',
  INVALID_UUID: 'INVALID_UUID',
  INVALID_URL: 'INVALID_URL',
  INVALID_PLATFORM: 'INVALID_PLATFORM',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // Plan gates
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  PLAN_FEATURE_RESTRICTED: 'PLAN_FEATURE_RESTRICTED',

  // Business rules
  CAMPAIGN_NOT_APPROVED: 'CAMPAIGN_NOT_APPROVED',
  SPEND_CAP_EXCEEDED: 'SPEND_CAP_EXCEEDED',
  TOKEN_INSUFFICIENT: 'TOKEN_INSUFFICIENT',

  // Admin
  ADMIN_SECRET_MISSING: 'ADMIN_SECRET_MISSING',
  ADMIN_SECRET_INVALID: 'ADMIN_SECRET_INVALID',

  // External
  QUEUE_ERROR: 'QUEUE_ERROR',
  AI_ERROR: 'AI_ERROR',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  EMAIL_ERROR: 'EMAIL_ERROR',

  // Server
  INTERNAL: 'INTERNAL',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',

  // UTM
  SHORT_CODE_NOT_FOUND: 'SHORT_CODE_NOT_FOUND',
  INVALID_SHORT_CODE: 'INVALID_SHORT_CODE',

  // Waitlist
  ALREADY_ON_WAITLIST: 'ALREADY_ON_WAITLIST',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Builds a standardised error response body.
 * @param code    - Machine-readable error code from ErrorCodes
 * @param message - Human-readable message
 * @param detail  - Optional extra detail (validation message, etc.)
 */
export function errorBody(code: ErrorCode, message: string, detail?: string) {
  return { error: message, code, ...(detail ? { detail } : {}) };
}
