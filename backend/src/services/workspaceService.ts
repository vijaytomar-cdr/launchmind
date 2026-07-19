/**
 * @file workspaceService.ts
 * @description Workspace CRUD, member management, and active-state operations.
 *   Enforces plan-tier limits (ADR-011):
 *     Free/Solo: 1 personal workspace · Builder: 3 · Studio: unlimited
 *   ensurePersonalWorkspace() is called after every login/signup to guarantee
 *   every founder always has exactly one personal workspace before product intake begins.
 * @security All operations verify founder_id ownership before any mutation.
 *   Role enforcement: owner = full access · editor = content only · viewer = read-only.
 *   ensurePersonalWorkspace is idempotent — re-login never creates duplicates.
 * @dependencies supabaseAdmin, founders table, workspaces table, workspace_members table,
 *   audit_logs
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type WorkspaceType = 'personal' | 'team';

export interface Workspace {
  id:             string;
  founder_id:     string;
  name:           string;
  client_name:    string | null;
  workspace_type: WorkspaceType;
  settings:       Record<string, unknown> | null;
  created_at:     string;
}

export interface WorkspaceMember {
  id:            string;
  workspace_id:  string;
  founder_id:    string | null;
  role:          WorkspaceRole;
  invited_email: string | null;
  accepted_at:   string | null;
}

const WORKSPACE_LIMITS: Record<string, number> = {
  free:    1,
  solo:    1,
  builder: 3,
  studio:  Infinity,
};

// ── Personal workspace bootstrap ─────────────────────────────────────────────

export interface EnsureWorkspaceResult {
  workspace:   Workspace;
  created:     boolean;   // true = just created; false = already existed
}

/**
 * Guarantees every founder has exactly one personal workspace.
 * Safe to call on every login or session init — fully idempotent.
 *
 * Algorithm:
 *   1. SELECT the first workspace owned by this founder.
 *   2. If found → update founders.active_workspace_id if not already set, return it.
 *   3. If not found → INSERT workspace, INSERT owner member row, UPDATE founders.active_workspace_id.
 *   4. Audit log on creation only.
 *
 * @param founderId - UUID of the authenticated founder
 * @returns { workspace, created: boolean }
 * @throws Never for "already exists" — that is the happy path.
 * @security No plan-limit check here — personal workspace is always allowed regardless of plan.
 */
export async function ensurePersonalWorkspace(
  founderId: string,
): Promise<EnsureWorkspaceResult> {
  const db = getSupabaseAdmin();

  // 1. Check if workspace already exists
  const { data: existing, error: selectErr } = await db
    .from('workspaces')
    .select('id, founder_id, name, client_name, workspace_type, settings, created_at')
    .eq('founder_id', founderId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectErr) throw selectErr;

  if (existing) {
    // Ensure active_workspace_id is set (may not be set on older accounts)
    const { data: founder } = await db
      .from('founders')
      .select('active_workspace_id')
      .eq('id', founderId)
      .single();

    if (!founder?.active_workspace_id) {
      await db
        .from('founders')
        .update({ active_workspace_id: existing.id })
        .eq('id', founderId);
    }

    return { workspace: existing as Workspace, created: false };
  }

  // 2. Create personal workspace
  const { data: workspace, error: insertErr } = await db
    .from('workspaces')
    .insert({
      founder_id:     founderId,
      name:           'My Workspace',
      workspace_type: 'personal',
      client_name:    null,
    })
    .select('id, founder_id, name, client_name, workspace_type, settings, created_at')
    .single();

  if (insertErr || !workspace) throw insertErr ?? new Error('Workspace insert returned no data');

  // 3. Create owner member row (workspace_members)
  await db.from('workspace_members').insert({
    workspace_id:  workspace.id,
    founder_id:    founderId,
    role:          'owner',
    accepted_at:   new Date().toISOString(),
    invited_by:    founderId,
  });

  // 4. Set active_workspace_id on founders
  await db
    .from('founders')
    .update({ active_workspace_id: workspace.id })
    .eq('id', founderId);

  // 5. Audit log (creation only)
  await db.from('audit_logs').insert({
    founder_id:    founderId,
    action:        'workspace.personal_created',
    resource_type: 'workspace',
    resource_id:   workspace.id,
    metadata:      { workspace_type: 'personal', name: 'My Workspace' },
  });

  return { workspace: workspace as Workspace, created: true };
}

/**
 * Returns all workspaces for a founder.
 */
export async function listWorkspaces(founderId: string): Promise<Workspace[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('workspaces')
    .select('id, founder_id, name, client_name, workspace_type, settings, created_at')
    .eq('founder_id', founderId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Workspace[];
}

/**
 * Creates a new workspace, enforcing plan-tier limits.
 * @throws {Error} PLAN_LIMIT_REACHED if founder is at their workspace limit
 */
export async function createWorkspace(
  founderId: string,
  name: string,
  opts?: { clientName?: string; workspaceType?: WorkspaceType },
): Promise<Workspace> {
  // Enforce plan limit
  const { data: founder } = await getSupabaseAdmin()
    .from('founders')
    .select('plan')
    .eq('id', founderId)
    .single();

  const plan = founder?.plan ?? 'free';
  const limit = WORKSPACE_LIMITS[plan] ?? 1;

  const { count } = await getSupabaseAdmin()
    .from('workspaces')
    .select('id', { count: 'exact', head: true })
    .eq('founder_id', founderId);

  if ((count ?? 0) >= limit) {
    const err = new Error(`Workspace limit reached for ${plan} plan`);
    (err as Error & { code: string }).code = 'PLAN_LIMIT_REACHED';
    throw err;
  }

  const { data, error } = await getSupabaseAdmin()
    .from('workspaces')
    .insert({
      founder_id:     founderId,
      name,
      client_name:    opts?.clientName ?? null,
      workspace_type: opts?.workspaceType ?? 'personal',
    })
    .select('id, founder_id, name, client_name, workspace_type, settings, created_at')
    .single();

  if (error || !data) throw error ?? new Error('Insert returned no data');
  return data as Workspace;
}

/**
 * Returns a workspace by ID, verifying founder ownership.
 */
export async function getWorkspace(workspaceId: string, founderId: string): Promise<Workspace | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('workspaces')
    .select('id, founder_id, name, client_name, workspace_type, settings, created_at')
    .eq('id', workspaceId)
    .eq('founder_id', founderId)
    .single();

  if (error || !data) return null;
  return data as Workspace;
}

/**
 * Updates workspace name, client_name, or settings.
 */
export async function updateWorkspace(
  workspaceId: string,
  founderId: string,
  updates: { name?: string; clientName?: string | null; settings?: Record<string, unknown> },
): Promise<Workspace | null> {
  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined)       patch.name        = updates.name;
  if (updates.clientName !== undefined) patch.client_name = updates.clientName;
  if (updates.settings !== undefined)   patch.settings    = updates.settings;

  const { data, error } = await getSupabaseAdmin()
    .from('workspaces')
    .update(patch)
    .eq('id', workspaceId)
    .eq('founder_id', founderId)
    .select('id, founder_id, name, client_name, workspace_type, settings, created_at')
    .single();

  if (error || !data) return null;
  return data as Workspace;
}

/**
 * Sets the founder's active workspace and optionally active product.
 */
export async function setActiveWorkspace(
  founderId: string,
  workspaceId: string,
  activeProductId?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { active_workspace_id: workspaceId };
  if (activeProductId !== undefined) patch.active_product_id = activeProductId;

  const { error } = await getSupabaseAdmin()
    .from('founders')
    .update(patch)
    .eq('id', founderId);

  if (error) throw error;
}

/**
 * Sets the founder's active product (within any workspace).
 */
export async function setActiveProduct(founderId: string, productId: string): Promise<void> {
  // Verify product belongs to this founder
  const { data: product } = await getSupabaseAdmin()
    .from('products')
    .select('id, workspace_id')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .single();

  if (!product) throw new Error('Product not found or access denied');

  const { error } = await getSupabaseAdmin()
    .from('founders')
    .update({
      active_product_id:   productId,
      active_workspace_id: product.workspace_id ?? null,
    })
    .eq('id', founderId);

  if (error) throw error;
}

/**
 * Lists members of a workspace (owner can always see all members).
 */
export async function listWorkspaceMembers(
  workspaceId: string,
  founderId: string,
): Promise<WorkspaceMember[]> {
  // Verify workspace ownership
  const ws = await getWorkspace(workspaceId, founderId);
  if (!ws) throw new Error('Workspace not found');

  const { data, error } = await getSupabaseAdmin()
    .from('workspace_members')
    .select('id, workspace_id, founder_id, role, invited_email, accepted_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as WorkspaceMember[];
}

/**
 * Invites a member to a workspace (creates pending row with invited_email).
 */
export async function inviteWorkspaceMember(
  workspaceId: string,
  ownerId: string,
  invitedEmail: string,
  role: WorkspaceRole = 'viewer',
): Promise<WorkspaceMember> {
  const ws = await getWorkspace(workspaceId, ownerId);
  if (!ws) throw new Error('Workspace not found');

  const { data, error } = await getSupabaseAdmin()
    .from('workspace_members')
    .insert({
      workspace_id:  workspaceId,
      invited_email: invitedEmail,
      role,
      invited_by:    ownerId,
      // founder_id and accepted_at set when invite is accepted
    })
    .select('id, workspace_id, founder_id, role, invited_email, accepted_at')
    .single();

  if (error || !data) throw error ?? new Error('Insert failed');
  return data as WorkspaceMember;
}

/**
 * Removes a member from a workspace (owner cannot remove themselves).
 */
export async function removeWorkspaceMember(
  workspaceId: string,
  ownerId: string,
  memberId: string,
): Promise<void> {
  const ws = await getWorkspace(workspaceId, ownerId);
  if (!ws) throw new Error('Workspace not found');

  const { error } = await getSupabaseAdmin()
    .from('workspace_members')
    .delete()
    .eq('id', memberId)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
}
