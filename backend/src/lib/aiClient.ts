/**
 * @file aiClient.ts
 * @description Thin wrappers over the Anthropic SDK for common call patterns.
 *   callSonnet: system + user prompt → returns text (complex generation).
 *   callHaiku:  single user prompt → returns text (fast scoring / rewrites).
 * @security Never logs prompt content. Caller is responsible for consumeTokens().
 * @dependencies @anthropic-ai/sdk
 */

import Anthropic from '@anthropic-ai/sdk';

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
  maxTokens = 4096
): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude Sonnet returned non-text response');
  return content.text;
}

/**
 * Calls Claude Haiku with a single user prompt (no system message).
 * Used for scoring, quick rewrites, and char-limit enforcement.
 * @param prompt - The user prompt
 * @param maxTokens - Max tokens (default 600)
 * @returns The text content of the response
 * @throws {Error} If the model returns a non-text response
 */
export async function callHaiku(prompt: string, maxTokens = 600): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude Haiku returned non-text response');
  return content.text;
}
