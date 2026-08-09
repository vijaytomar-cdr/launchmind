/**
 * @file traceId.ts
 * @description Correlation-ID helper for the Improve Intelligence sync chain.
 *   One trace id is minted per owner-initiated action and carried through
 *   HTTP request → workspace_connections.last_trace_id → connection_sync_runs.trace_id
 *   → BullMQ job payload → intelligence_signals.trace_id → learning_events.payload.trace_id.
 * @security Trace ids are random and carry no founder, credential, or provider data.
 *   They are safe to log and to return to clients.
 * @dependencies node:crypto
 */

import crypto from 'crypto';
import type { FastifyRequest } from 'fastify';

/** Header clients/proxies may set to continue an existing trace. */
export const TRACE_HEADER = 'x-launchmind-trace-id';

/** Accepts `lm_` + 32 lowercase hex chars, or a bare 8–64 char id from an upstream proxy. */
const TRACE_PATTERN = /^(lm_[0-9a-f]{32}|[A-Za-z0-9_-]{8,64})$/;

/**
 * Mints a new trace id.
 * @returns Trace id of the form `lm_<32 hex chars>`
 */
export function newTraceId(): string {
  return `lm_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Returns a trace id for this request — reusing an inbound one when it is well-formed,
 * otherwise minting a fresh one. Malformed inbound values are discarded rather than
 * propagated, so a caller cannot inject arbitrary text into logs or DB columns.
 * @param request - Fastify request whose headers may carry an upstream trace id
 * @returns A validated trace id, never null
 * @security Inbound header is pattern-validated before use (log-injection guard).
 */
export function traceIdFromRequest(request: FastifyRequest): string {
  const raw = request.headers[TRACE_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate === 'string' && TRACE_PATTERN.test(candidate)) return candidate;
  return newTraceId();
}

/**
 * Validates an arbitrary string as a trace id, falling back to a fresh one.
 * Used when reading a trace id off a persisted row or a queue job payload.
 * @param value - Candidate trace id (may be null/undefined from an older row)
 * @returns A valid trace id
 */
export function coerceTraceId(value: string | null | undefined): string {
  if (typeof value === 'string' && TRACE_PATTERN.test(value)) return value;
  return newTraceId();
}
