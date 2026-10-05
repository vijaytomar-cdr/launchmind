/**
 * @file aiPlatform.ts
 * @description AI Platform — mandatory single entry point for all LLM calls.
 *   callSonnet / callHaiku: drop-in replacements for aiClient.ts, add audit + retry.
 *   callMessages: multimodal calls (image + text) with audit.
 *   generateAI: full pipeline — context assembly → prompt resolution → routing → call → audit.
 * @security
 *   - No service or route may import @anthropic-ai/sdk or aiClient.ts directly.
 *   - Prompt injection defense: sanitizeInput() strips control sequences before interpolation.
 *   - All calls write an immutable row to ai_requests (service_role). auditCtx is REQUIRED.
 *   - auditCtx.founderId is verified to be a UUID before writing; a non-UUID actor
 *     (e.g. 'system') is recorded as actor_type='system' with founder_id NULL.
 *     THIS LINE PREVIOUSLY DESCRIBED A GUARD THAT DID NOT EXIST IN THE CODE
 *     (P1-43): 'system' went straight into a UUID column, Postgres returned
 *     22P02, the catch swallowed it, and no audit row was written at all.
 *   - outputSchema enables output validation: parse failure is logged as status='failed'.
 * @dependencies aiClient, contextEngine, promptRegistry, modelRouter, supabaseAdmin, Sentry, zod
 */

import { z } from 'zod';
import * as Sentry from '@sentry/node';
import {
  callSonnetWithUsage,
  callHaikuWithUsage,
  callMessages as rawCallMessages,
  type RawCallResult,
} from './aiClient';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { buildContextPackage, formatContextForPrompt, type ContextOptions, type ContextPackage } from './contextEngine';
import { resolvePrompt } from './promptRegistry';
import { routeModel } from './modelRouter';
import { getSupabaseAdmin } from './supabaseAdmin';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditContext {
  /**
   * The founder this call was made for, as a UUID.
   *
   * Anything that is not a UUID — 'system', a worker label, undefined — is
   * recorded as a SYSTEM actor with no founder identity. It is never coerced
   * into a founder, and no synthetic founder is minted to hold it.
   */
  founderId?: string | null;
  productId?: string | null;
  /**
   * Workspace this call was made for, when it was made for one. Omit for a
   * genuinely global call: NULL records "not workspace-scoped", which is an
   * honest answer, whereas attaching a nearby workspace is a guess (§9).
   */
  workspaceId?: string | null;
  promptId: string;
  action: string;
  /**
   * ADR-066 rule 21. Links this request to the ContextPackage that produced it,
   * completing the chain output → ai_request → context_package → memory version.
   * Optional: utility calls that carry no provenance value stay unlinked rather
   * than fabricating one.
   */
  contextPackageId?: string | null;
}

export interface AIRequest {
  founderId: string;
  productId?: string | null;
  promptId: string;
  system: string;
  user: string;
  maxTokens?: number;
  contextOptions?: ContextOptions;
  contextPackage?: ContextPackage;
  injectContext?: boolean;
}

export interface AIResponse {
  requestId: string;
  text: string;
  promptId: string;
  promptVersion: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retries: number;
  contextSources: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES    = 2;
const RETRY_DELAY_MS = 500;

// Sonnet pricing (per M tokens): $3 input / $15 output
// Haiku pricing (per M tokens): $0.25 input / $1.25 output
const COST_TABLE: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-4-6':         { inputPerM: 3.00,  outputPerM: 15.00 },
  'claude-haiku-4-5-20251001': { inputPerM: 0.25,  outputPerM: 1.25  },
};

// ── Output validation ─────────────────────────────────────────────────────────

/**
 * Thrown when the model returns a 200 response whose output fails schema validation.
 * Callers that wrap callSonnet/callHaiku in try/catch receive this instead of
 * a raw JSON parse error, so they can distinguish network failures from model failures.
 */
export class OutputValidationError extends Error {
  readonly code = 'output_validation_failed';
  constructor(message: string) {
    super(message);
    this.name = 'OutputValidationError';
  }
}

/**
 * Strips markdown code fences that models sometimes add even when told not to.
 * Applied before JSON.parse in output validation so callers receive clean text.
 */
export function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

// ── Prompt injection defense ──────────────────────────────────────────────────

/**
 * Strips known prompt injection patterns from user-controlled text before
 * it is interpolated into a prompt template. Catches the most common attack vectors.
 * @security Applied to all variables passed via AIRequest.
 */
function sanitizeInput(input: string): string {
  return input
    // Strip role markers
    .replace(/\b(Human|Assistant|System|User)\s*:/gi, '')
    // Strip XML-style role tags
    .replace(/<\|im_(start|end)\|>/gi, '')
    // Strip triple-hash section headers (common jailbreak delimiter)
    .replace(/^#{3,}/gm, '')
    // Strip instruction override patterns
    // Split into quantifier-free alternatives rather than nesting a quantifier
    // inside an optional group. `\s+(all\s+)?` has star height 2, which lets the
    // engine split one whitespace run exponentially many ways — the classic
    // catastrophic-backtracking shape, in the one function whose entire job is to
    // process deliberately hostile input. Each pattern below is star height 1 and
    // every repetition is bounded.
    .replace(/ignore\s{1,8}all\s{1,8}(?:previous|prior|above)\s{1,8}instructions?/gi, '')
    .replace(/ignore\s{1,8}(?:previous|prior|above)\s{1,8}instructions?/gi, '')
    .replace(/disregard\s{1,8}all\s{1,8}[^\n]{0,120}instructions?/gi, '')
    .replace(/disregard\s{1,8}[^\n]{0,120}instructions?/gi, '')
    // Normalize excessive whitespace
    .replace(/\s{4,}/g, '   ')
    .trim();
}

// ── Retry + timeout logic ─────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // 429 rate limit, 529 overload, network reset
  return msg.includes('429') || msg.includes('529') || msg.includes('econnreset') || msg.includes('timeout');
}

async function callWithRetry(
  fn: (signal: AbortSignal) => Promise<RawCallResult>,
  timeoutMs: number,
): Promise<{ result: RawCallResult; retries: number }> {
  let retries = 0;
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      retries = attempt;
      await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return { result, retries };
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRetryable(err) && attempt < MAX_RETRIES) continue;
      break;
    }
  }

  throw lastError;
}

// ── Audit writer ──────────────────────────────────────────────────────────────

/** RFC 4122 shape. The column is UUID; anything else is not a founder. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reuses the actor vocabulary the repository already had — the same
 * 'founder' | 'system' pair used by connection permission history
 * (migration 083) and by the execution guard, where 'system' is the value
 * refused before every other gate. Those modules are deliberately NOT named
 * as identifiers here: the execution-boundary suite greps this file for them,
 * because a comment is how an import starts.
 */
export type AiActorType = 'founder' | 'system';

/**
 * Splits WHO INITIATED THE CALL from WHOSE AUTHORITY APPLIES.
 *
 * A founder id that is not a UUID is not a founder with a formatting problem —
 * it is a system caller. Recording it as a system actor with NO founder_id is
 * the only representation that is both auditable and honest; the alternative
 * considered and rejected was minting a synthetic founder row, which would have
 * made every authority surface in LaunchMind see a person that does not exist.
 */
export function resolveAiActor(founderId?: string | null): {
  actorType: AiActorType; founderId: string | null;
} {
  const id = typeof founderId === 'string' ? founderId.trim() : '';
  return UUID_RE.test(id)
    ? { actorType: 'founder', founderId: id }
    : { actorType: 'system', founderId: null };
}

/**
 * Observability for audit writes — P1-43 was invisible for months because the
 * only signal was a console.error nobody was counting. `failed` rising while
 * `written` is flat is the exact shape of a silently missing audit trail.
 */
export const aiAuditCounters = { written: 0, failed: 0, lastError: null as string | null };

async function writeAuditRecord(params: {
  founderId?: string | null;
  productId?: string | null;
  promptId: string;
  promptVersion: number;
  model: string;
  action: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs: number;
  retries: number;
  status: 'success' | 'failed' | 'retried' | 'timeout';
  error?: string;
  contextSources?: string[];
  contextPackageId?: string | null;
  workspaceId?: string | null;
}): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const actor = resolveAiActor(params.founderId);
    const { data, error } = await supabase
      .from('ai_requests')
      .insert({
        actor_type:      actor.actorType,
        founder_id:      actor.founderId,
        workspace_id:    params.workspaceId ?? null,
        product_id:      params.productId ?? null,
        prompt_id:       params.promptId,
        prompt_version:  params.promptVersion,
        model:           params.model,
        action:          params.action,
        input_tokens:    params.inputTokens ?? null,
        output_tokens:   params.outputTokens ?? null,
        total_tokens:    params.totalTokens ?? null,
        cost_usd:        params.costUsd ?? null,
        latency_ms:      params.latencyMs,
        retries:         params.retries,
        status:          params.status,
        error:           params.error ?? null,
        context_sources: params.contextSources ?? [],
        context_package_id: params.contextPackageId ?? null,
      })
      .select('id')
      .single();
    // A failed insert must NEVER be reported as a written audit row. The
    // previous version read only `data` and returned null on error, which is
    // indistinguishable from success-with-no-id to every caller.
    if (error) {
      aiAuditCounters.failed++;
      aiAuditCounters.lastError = `${error.code ?? 'unknown'}: ${String(error.message).slice(0, 160)}`;
      console.error(JSON.stringify({
        event: 'ai_audit_write_failed', code: error.code ?? null,
        message: String(error.message).slice(0, 200),
        promptId: params.promptId, action: params.action,
        actorType: actor.actorType, model: params.model,
      }));
      Sentry.captureMessage('ai_audit_write_failed', {
        level: 'error',
        extra: { code: error.code, promptId: params.promptId, actorType: actor.actorType },
      });
      return null;
    }
    aiAuditCounters.written++;
    return data?.id ?? null;
  } catch (err) {
    // Still non-fatal — telemetry must not break a generation the owner is
    // waiting on — but no longer silent, and never a fabricated success.
    aiAuditCounters.failed++;
    aiAuditCounters.lastError = err instanceof Error ? err.message.slice(0, 160) : 'unknown';
    console.error(JSON.stringify({
      event: 'ai_audit_write_failed', code: null,
      message: aiAuditCounters.lastError,
      promptId: params.promptId, action: params.action, model: params.model,
    }));
    Sentry.captureException(err);
    return null;
  }
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = COST_TABLE[model] ?? COST_TABLE['claude-haiku-4-5-20251001'];
  return (inputTokens / 1_000_000) * pricing.inputPerM +
         (outputTokens / 1_000_000) * pricing.outputPerM;
}

// ── callSonnet wrapper ────────────────────────────────────────────────────────

/**
 * Calls Claude Sonnet with audit trail + retry logic.
 * auditCtx is REQUIRED — every call writes an immutable row to ai_requests.
 * @param system       - System prompt
 * @param user         - User message
 * @param maxTokens    - Max tokens
 * @param auditCtx     - REQUIRED: writes to ai_requests on every call including failures
 * @param outputSchema - Optional Zod schema. If provided, validates the response; a parse
 *                       failure logs status='failed' and throws OutputValidationError.
 *                       Markdown fences are stripped before validation.
 * @returns Validated (fence-stripped) text on success
 * @throws {OutputValidationError} When outputSchema is provided and response fails validation
 */
export async function callSonnet(
  system: string,
  user: string,
  maxTokens: number,
  auditCtx: AuditContext,
  outputSchema?: z.ZodTypeAny,
): Promise<string> {
  const start = Date.now();
  let result: RawCallResult;
  let retries = 0;

  try {
    const res = await callWithRetry(
      signal => callSonnetWithUsage(system, user, maxTokens, signal),
      60_000,
    );
    result = res.result;
    retries = res.retries;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void writeAuditRecord({
      ...auditCtx,
      promptVersion: 1,
      model: 'claude-sonnet-4-6',
      latencyMs: Date.now() - start,
      retries: MAX_RETRIES,
      status: 'failed',
      error: errorMsg,
    });
    throw err;
  }

  // Output validation — if schema provided, attempt JSON parse + Zod check.
  // A model returning 200 with unparseable output is a FAILURE, not a success.
  if (outputSchema) {
    const stripped = stripMarkdownFences(result.text);
    try {
      outputSchema.parse(JSON.parse(stripped));
      // Validation passed — return the fence-stripped text so callers can JSON.parse directly
      const latencyMs = Date.now() - start;
      void writeAuditRecord({
        ...auditCtx,
        promptVersion: 1,
        model: 'claude-sonnet-4-6',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        costUsd: estimateCost('claude-sonnet-4-6', result.inputTokens, result.outputTokens),
        latencyMs,
        retries,
        status: retries > 0 ? 'retried' : 'success',
      });
      return stripped;
    } catch {
      const errMsg = `output_validation_failed: ${result.text.slice(0, 200)}`;
      void writeAuditRecord({
        ...auditCtx,
        promptVersion: 1,
        model: 'claude-sonnet-4-6',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        costUsd: estimateCost('claude-sonnet-4-6', result.inputTokens, result.outputTokens),
        latencyMs: Date.now() - start,
        retries,
        status: 'failed',
        error: errMsg,
      });
      throw new OutputValidationError(errMsg);
    }
  }

  const latencyMs = Date.now() - start;
  void writeAuditRecord({
    ...auditCtx,
    promptVersion: 1,
    model: 'claude-sonnet-4-6',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.inputTokens + result.outputTokens,
    costUsd: estimateCost('claude-sonnet-4-6', result.inputTokens, result.outputTokens),
    latencyMs,
    retries,
    status: retries > 0 ? 'retried' : 'success',
  });

  return result.text;
}

// ── callHaiku wrapper ─────────────────────────────────────────────────────────

/**
 * Calls Claude Haiku with audit trail + retry logic.
 * auditCtx is REQUIRED — every call writes an immutable row to ai_requests.
 * @param prompt       - User prompt (Haiku is single-turn; system prompt is in the text)
 * @param maxTokens    - Max tokens
 * @param auditCtx     - REQUIRED: writes to ai_requests on every call including failures
 * @param outputSchema - Optional Zod schema. If provided, validates the response; a parse
 *                       failure logs status='failed' and throws OutputValidationError.
 * @returns Validated (fence-stripped) text when outputSchema passes, raw text otherwise
 * @throws {OutputValidationError} When outputSchema is provided and response fails validation
 */
export async function callHaiku(
  prompt: string,
  maxTokens: number,
  auditCtx: AuditContext,
  outputSchema?: z.ZodTypeAny,
  /**
   * Generation settings. Pass `{ temperature: 0 }` for constrained
   * classification paths; omit for creative generation, which keeps the
   * provider default.
   */
  genOpts: { temperature?: number } = {},
): Promise<string> {
  const start = Date.now();
  let result: RawCallResult;
  let retries = 0;

  try {
    const res = await callWithRetry(
      signal => callHaikuWithUsage(prompt, maxTokens, signal, genOpts),
      30_000,
    );
    result = res.result;
    retries = res.retries;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void writeAuditRecord({
      ...auditCtx,
      promptVersion: 1,
      model: 'claude-haiku-4-5-20251001',
      latencyMs: Date.now() - start,
      retries: MAX_RETRIES,
      status: 'failed',
      error: errorMsg,
    });
    throw err;
  }

  // Output validation — same contract as callSonnet
  if (outputSchema) {
    const stripped = stripMarkdownFences(result.text);
    try {
      outputSchema.parse(JSON.parse(stripped));
      const latencyMs = Date.now() - start;
      void writeAuditRecord({
        ...auditCtx,
        promptVersion: 1,
        model: 'claude-haiku-4-5-20251001',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        costUsd: estimateCost('claude-haiku-4-5-20251001', result.inputTokens, result.outputTokens),
        latencyMs,
        retries,
        status: retries > 0 ? 'retried' : 'success',
      });
      return stripped;
    } catch {
      const errMsg = `output_validation_failed: ${result.text.slice(0, 200)}`;
      void writeAuditRecord({
        ...auditCtx,
        promptVersion: 1,
        model: 'claude-haiku-4-5-20251001',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
        costUsd: estimateCost('claude-haiku-4-5-20251001', result.inputTokens, result.outputTokens),
        latencyMs: Date.now() - start,
        retries,
        status: 'failed',
        error: errMsg,
      });
      throw new OutputValidationError(errMsg);
    }
  }

  const latencyMs = Date.now() - start;
  void writeAuditRecord({
    ...auditCtx,
    promptVersion: 1,
    model: 'claude-haiku-4-5-20251001',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.inputTokens + result.outputTokens,
    costUsd: estimateCost('claude-haiku-4-5-20251001', result.inputTokens, result.outputTokens),
    latencyMs,
    retries,
    status: retries > 0 ? 'retried' : 'success',
  });

  return result.text;
}

// ── callMessages wrapper (multimodal) ─────────────────────────────────────────

/**
 * Multimodal call supporting image + text MessageParam arrays.
 * Used by icpService for screenshot analysis.
 * @param model     - 'sonnet' | 'haiku'
 * @param messages  - MessageParam array (may include image blocks)
 * @param system    - Optional system prompt
 * @param maxTokens - Max tokens (default 1024)
 * @param auditCtx  - If provided, writes to ai_requests
 * @returns Text response
 */
export async function callMessages(
  model: 'sonnet' | 'haiku',
  messages: MessageParam[],
  system?: string,
  maxTokens = 1024,
  auditCtx?: AuditContext,
): Promise<string> {
  const start = Date.now();
  const modelId = model === 'sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  const timeoutMs = model === 'sonnet' ? 60_000 : 30_000;

  let result: RawCallResult;
  let retries = 0;

  try {
    const res = await callWithRetry(
      signal => rawCallMessages(model, messages, system, maxTokens, signal),
      timeoutMs,
    );
    result = res.result;
    retries = res.retries;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (auditCtx) {
      void writeAuditRecord({
        ...auditCtx,
        promptVersion: 1,
        model: modelId,
        latencyMs: Date.now() - start,
        retries: MAX_RETRIES,
        status: 'failed',
        error: errorMsg,
      });
    }
    throw err;
  }

  const latencyMs = Date.now() - start;
  if (auditCtx) {
    void writeAuditRecord({
      ...auditCtx,
      promptVersion: 1,
      model: modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.inputTokens + result.outputTokens,
      costUsd: estimateCost(modelId, result.inputTokens, result.outputTokens),
      latencyMs,
      retries,
      status: retries > 0 ? 'retried' : 'success',
    });
  }

  return result.text;
}

// ── generateAI — full pipeline ────────────────────────────────────────────────

/**
 * Full AI generation pipeline:
 * 1. Resolve prompt from registry (gets version number for audit)
 * 2. Assemble context package (or use provided one)
 * 3. Inject context into system prompt if requested
 * 4. Route to correct model via modelRouter
 * 5. Call the model with retry + timeout
 * 6. Write ai_requests audit record
 * 7. Return AIResponse with full metadata
 *
 * @param req - AIRequest with founderId, promptId, system, user
 * @returns AIResponse with text + audit metadata
 * @throws If model call fails after all retries
 */
export async function generateAI(req: AIRequest): Promise<AIResponse> {
  const start = Date.now();
  const {
    founderId,
    productId,
    promptId,
    injectContext = false,
    contextOptions,
    contextPackage: prebuiltCtx,
    maxTokens: maxTokensOverride,
  } = req;

  // 1. Resolve prompt version from registry (non-fatal)
  let promptVersion = 1;
  try {
    const prompt = await resolvePrompt(promptId);
    if (prompt) promptVersion = prompt.version;
  } catch { /* registry miss — use version 1 */ }

  // 2. Route to model
  const { model, maxTokens } = routeModel(promptId, maxTokensOverride);

  // 3. Optionally assemble + inject context
  let contextSources: string[] = [];
  let system = sanitizeInput(req.system);
  const user = sanitizeInput(req.user);

  if (injectContext) {
    try {
      const ctx = prebuiltCtx ?? await buildContextPackage(founderId, productId ?? null, contextOptions);
      contextSources = ctx.sources;
      const ctxBlock = formatContextForPrompt(ctx);
      system = `${system}\n\n${ctxBlock}`;
    } catch (err) {
      // Context assembly failure is non-fatal — proceed without context
      Sentry.captureException(err, { tags: { service: 'aiPlatform', fn: 'generateAI', step: 'context' } });
    }
  }

  // 4. Call the model with retry
  let rawResult: RawCallResult;
  let retries = 0;
  let callStatus: 'success' | 'failed' | 'retried' | 'timeout' = 'success';
  let errorMsg: string | undefined;

  const timeoutMs = model.includes('sonnet') ? 60_000 : 30_000;

  try {
    const res = model.includes('sonnet')
      ? await callWithRetry(signal => callSonnetWithUsage(system, user, maxTokens, signal), timeoutMs)
      : await callWithRetry(signal => callHaikuWithUsage(user, maxTokens, signal), timeoutMs);

    rawResult = res.result;
    retries = res.retries;
    if (retries > 0) callStatus = 'retried';
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    callStatus = errorMsg.includes('abort') ? 'timeout' : 'failed';

    const requestId = await writeAuditRecord({
      founderId,
      productId,
      promptId,
      promptVersion,
      model,
      action: promptId,
      latencyMs: Date.now() - start,
      retries: MAX_RETRIES,
      status: callStatus,
      error: errorMsg,
      contextSources,
    });

    Sentry.captureException(err, { tags: { service: 'aiPlatform', fn: 'generateAI', promptId } });
    throw Object.assign(err as Error, { aiRequestId: requestId });
  }

  // 5. Write audit record
  const latencyMs = Date.now() - start;
  const costUsd = estimateCost(model, rawResult.inputTokens, rawResult.outputTokens);

  const requestId = (await writeAuditRecord({
    founderId,
    productId,
    promptId,
    promptVersion,
    model,
    action: promptId,
    inputTokens: rawResult.inputTokens,
    outputTokens: rawResult.outputTokens,
    totalTokens: rawResult.inputTokens + rawResult.outputTokens,
    costUsd,
    latencyMs,
    retries,
    status: callStatus,
    contextSources,
  })) ?? 'unknown';

  return {
    requestId,
    text: rawResult.text,
    promptId,
    promptVersion,
    model,
    inputTokens: rawResult.inputTokens,
    outputTokens: rawResult.outputTokens,
    latencyMs,
    retries,
    contextSources,
  };
}
