/**
 * @file workspaceResolver.ts
 * @description Resolves the owning workspace for a memory-domain write.
 *
 *   Phase 3.1B. Migration 088 makes `workspace_id` NOT NULL on the memory tables,
 *   so every write must supply one. This module is the single place that decides
 *   which, using the SAME precedence the backfill used — so a row written today
 *   lands in the workspace the migration would have chosen for it yesterday. Two
 *   different answers to "which workspace owns this memory" would be worse than
 *   either answer alone.
 *
 *   PRECEDENCE
 *     1. the product's workspace          (exact — the product IS the tenant anchor)
 *     2. the actor's default workspace    (active_workspace_id, then sole owned,
 *                                          then oldest accepted membership)
 *
 *   This resolves TENANCY only. It is NOT an authorization check: callers that
 *   accept a client-supplied workspace must still go through
 *   workspaceAuthService.resolveWorkspaceContext, because a client-supplied
 *   workspace id is context, never authorization (Step 2, ADR-066 rule 43).
 *
 * @security Never accepts a workspace id from a request. Derives it server-side
 *   from the product or the authenticated actor.
 * @dependencies products, workspaceAuthService, supabaseAdmin
 */

import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { getDefaultWorkspaceId } from '../workspaceAuthService';

/**
 * Raised when no workspace can be determined.
 *
 * Deliberately fatal rather than defaulting: silently inventing a tenant is the
 * failure mode migration 088 refused to commit in the backfill, and it would be
 * no more acceptable at write time.
 */
export class WorkspaceUnresolvedError extends Error {
  readonly statusCode = 409;
  readonly code = 'WORKSPACE_UNRESOLVED';
  constructor(detail: string) {
    super(`Cannot determine the owning workspace: ${detail}`);
    this.name = 'WorkspaceUnresolvedError';
  }
}

/**
 * @param founderId Authenticated actor
 * @param productId Product the record belongs to, when there is one
 * @returns         The owning workspace id
 * @throws {WorkspaceUnresolvedError} When neither the product nor the actor yields one
 */
export async function resolveMemoryWorkspace(
  founderId: string,
  productId: string | null,
): Promise<string> {
  const db = getSupabaseAdmin();

  if (productId) {
    const { data } = await db
      .from('products')
      .select('workspace_id')
      .eq('id', productId)
      .maybeSingle();
    const ws = (data as { workspace_id?: string | null } | null)?.workspace_id;
    if (ws) return ws;
  }

  const fallback = await getDefaultWorkspaceId(founderId);
  if (fallback) return fallback;

  throw new WorkspaceUnresolvedError(
    `founder ${founderId} owns or belongs to no workspace` +
    (productId ? `, and product ${productId} has none either` : ''),
  );
}
