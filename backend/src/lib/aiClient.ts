/**
 * @file aiClient.ts
 * @description Anthropic SDK adapter — the ONLY file in the codebase that imports @anthropic-ai/sdk.
 *   All service and route files must go through aiPlatform.ts, which calls this file.
 *   callSonnet / callHaiku: backward-compat text-only wrappers.
 *   callSonnetWithUsage / callHaikuWithUsage: return text + token usage for audit.
 *   callMessages: multimodal (image + text) via MessageParam array.
 * @security Never logs prompt content. Callers responsible for consumeTokens().
 * @dependencies @anthropic-ai/sdk
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages';

export type { MessageParam, ImageBlockParam };

// ── Shared result type ────────────────────────────────────────────────────────

export interface RawCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Internal shared client ────────────────────────────────────────────────────

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Text-only wrappers (backward-compat) ────────────────────────────────────

/**
 * Calls Claude Sonnet with a system + user message pair.
 * @param system - System prompt
 * @param user   - User message
 * @param maxTokens - Max tokens for the response (default 4096)
 * @returns The text content of the response
 * @throws {Error} If the model returns a non-text response
 */
export async function callSonnet(
  system: string,
  user: string,
  maxTokens = 4096,
): Promise<string> {
  const { text } = await callSonnetWithUsage(system, user, maxTokens);
  return text;
}

/**
 * Calls Claude Haiku with a single user prompt (no system message).
 * @param prompt - The user prompt
 * @param maxTokens - Max tokens (default 600)
 * @returns The text content of the response
 * @throws {Error} If the model returns a non-text response
 */
export async function callHaiku(prompt: string, maxTokens = 600): Promise<string> {
  const { text } = await callHaikuWithUsage(prompt, maxTokens);
  return text;
}

// ── Usage-returning wrappers (used by aiPlatform for audit) ──────────────────

/**
 * Calls Claude Sonnet and returns text + token usage.
 * Used by aiPlatform.ts to populate ai_requests audit records.
 */
export async function callSonnetWithUsage(
  system: string,
  user: string,
  maxTokens = 4096,
  signal?: AbortSignal,
): Promise<RawCallResult> {
  const client = getClient();
  const message = await client.messages.create(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    },
    { signal },
  );

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude Sonnet returned non-text response');
  return {
    text: content.text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

/**
 * Calls Claude Haiku and returns text + token usage.
 * Used by aiPlatform.ts to populate ai_requests audit records.
 */
export async function callHaikuWithUsage(
  prompt: string,
  maxTokens = 600,
  signal?: AbortSignal,
): Promise<RawCallResult> {
  const client = getClient();
  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    },
    { signal },
  );

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude Haiku returned non-text response');
  return {
    text: content.text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

/**
 * General-purpose multimodal call supporting image + text MessageParam arrays.
 * Used by icpService for screenshot analysis (Haiku multimodal).
 * @param model    - 'sonnet' | 'haiku'
 * @param messages - Array of MessageParam (may include image blocks)
 * @param system   - Optional system prompt
 * @param maxTokens - Max tokens (default 1024)
 * @param signal   - Optional AbortSignal for timeout
 */
export async function callMessages(
  model: 'sonnet' | 'haiku',
  messages: MessageParam[],
  system?: string,
  maxTokens = 1024,
  signal?: AbortSignal,
): Promise<RawCallResult> {
  const client = getClient();

  const modelId =
    model === 'sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  const req: Parameters<typeof client.messages.create>[0] = {
    model: modelId,
    max_tokens: maxTokens,
    messages,
  };
  if (system) req.system = system;

  const message = await client.messages.create(req, { signal });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error(`${modelId} returned non-text response`);
  return {
    text: content.text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
