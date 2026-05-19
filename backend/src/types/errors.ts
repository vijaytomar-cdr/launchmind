/**
 * @file errors.ts
 * @description Domain-specific error types for LaunchMind API.
 *   InsufficientTokensError maps to HTTP 402 in the Fastify error handler.
 * @security InsufficientTokensError causes 402 response — never 500.
 *   balance and required are safe to return to the frontend (non-sensitive).
 */

export class InsufficientTokensError extends Error {
  readonly balance: number;
  readonly required: number;

  constructor(balance: number, required: number, action: string) {
    super(`Insufficient tokens for ${action}. Balance: ${balance}, Required: ${required}`);
    this.name = 'InsufficientTokensError';
    this.balance = balance;
    this.required = required;
  }
}
