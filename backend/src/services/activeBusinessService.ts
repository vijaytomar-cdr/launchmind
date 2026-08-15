/**
 * @file activeBusinessService.ts
 * @description Resolves WHICH BUSINESS the owner is currently operating.
 *
 *   "Business" is the owner-facing word for a workspace. Internally the model is
 *   unchanged: workspaces 1:N products, and the workspace is the tenancy
 *   boundary. Product selection happens strictly INSIDE the resolved workspace.
 *
 *   THE ACTIVE BUSINESS IS EXPLICIT. There is deliberately no
 *   `products.find(...)`, no "newest product", no "first product owned by this
 *   founder", and no "latest onboarding session". The dashboard previously did
 *   exactly that — `products.find(p => !p.archived_at)` over a founder-wide
 *   list — which is how one founder's two businesses could silently blend. With
 *   a second business those fallbacks stop being conveniences and become
 *   whichever business happened to be created most recently.
 *
 *   So this FAILS CLOSED. If `active_workspace_id` is missing, stale, or points
 *   somewhere the actor may not use, the answer is "choose a business", never a
 *   guess. A wrong business is worse than no business: the owner would act on
 *   another company's numbers believing they were this one's.
 *
 * @security Membership is re-verified on every resolve. A stored pointer is a
 *   hint, never authorization — a workspace lost since it was written must stop
 *   resolving immediately.
 * @dependencies workspaceAuthService, workspaces, products, founders
 */

import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { getWorkspaceRole } from './workspaceAuthService';

export interface BusinessSummary {
  workspaceId: string;
  name: string;
  productId:   string | null;
  productName: string | null;
  platform:    string | null;
  markets:     string[];
  maturity:    string | null;
  /** True for the business the owner is currently operating. */
  isActive:    boolean;
}

export interface ActiveBusiness {
  workspaceId: string;
  name: string;
  role: string;
  productId:   string | null;
  productName: string | null;
  platform:    string | null;
  markets:     string[];
  maturity:    string | null;
}

/**
 * Every business this founder may operate, newest-last.
 *
 * Owned workspaces plus accepted memberships. A pending invitation is not a
 * business the owner can switch into, so it does not appear.
 *
 * @param actorId - authenticated founder
 * @returns businesses with their primary product, `isActive` flagged
 */
export async function listBusinesses(actorId: string): Promise<BusinessSummary[]> {
  const db = getSupabaseAdmin();

  const [ownedRes, memberRes, founderRes] = await Promise.all([
    db.from('workspaces').select('id, name, created_at')
      .eq('founder_id', actorId).order('created_at', { ascending: true }),
    db.from('workspace_members').select('workspace_id')
      .eq('founder_id', actorId).not('accepted_at', 'is', null),
    db.from('founders').select('active_workspace_id, active_product_id')
      .eq('id', actorId).maybeSingle(),
  ]);

  const owned = (ownedRes.data ?? []) as Array<{ id: string; name: string }>;
  const memberIds = ((memberRes.data ?? []) as Array<{ workspace_id: string }>)
    .map(m => m.workspace_id)
    .filter(id => !owned.some(w => w.id === id));

  let extra: Array<{ id: string; name: string }> = [];
  if (memberIds.length) {
    const { data } = await db.from('workspaces').select('id, name').in('id', memberIds);
    extra = (data ?? []) as Array<{ id: string; name: string }>;
  }

  const all = [...owned, ...extra];
  if (all.length === 0) return [];

  // Products for these workspaces only — never a founder-wide product read.
  const { data: prodRows } = await db
    .from('products')
    .select('id, name, workspace_id, platform, markets, maturity, created_at')
    .in('workspace_id', all.map(w => w.id))
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  const products = (prodRows ?? []) as Array<Record<string, unknown>>;

  const activeWs = (founderRes.data as { active_workspace_id?: string | null } | null)?.active_workspace_id ?? null;
  const activeProd = (founderRes.data as { active_product_id?: string | null } | null)?.active_product_id ?? null;

  return all.map(w => {
    const inWs = products.filter(p => p.workspace_id === w.id);
    // The explicitly chosen product if it is in THIS workspace, else the
    // workspace's own first product. Scoped either way — this can never reach
    // across businesses because `inWs` is already filtered.
    const chosen = inWs.find(p => p.id === activeProd) ?? inWs[0] ?? null;
    return {
      workspaceId: w.id,
      name: w.name,
      productId:   (chosen?.id as string) ?? null,
      productName: (chosen?.name as string) ?? null,
      platform:    (chosen?.platform as string) ?? null,
      markets:     (chosen?.markets as string[]) ?? [],
      maturity:    (chosen?.maturity as string) ?? null,
      isActive:    w.id === activeWs,
    };
  });
}

/**
 * THE product id every business-scoped list must filter on.
 *
 * Returns null when no business is selected or it has no product. Callers must
 * then return an EMPTY result — never an unfiltered one. That single rule is
 * what stops "no active business" degrading into "show everything the founder
 * owns", which is how AllignX's opportunities, content and experiments reached
 * LaunchMind's screens.
 *
 * @security Delegates to getActiveBusiness, so membership is re-verified.
 */
export async function activeProductId(actorId: string): Promise<string | null> {
  return (await getActiveBusiness(actorId))?.productId ?? null;
}

/**
 * The business the owner is currently operating, or null.
 *
 * @returns null when no business is selected or the stored pointer is no longer
 *   usable. Callers must ask the owner to choose — never substitute a default.
 */
export async function getActiveBusiness(actorId: string): Promise<ActiveBusiness | null> {
  const db = getSupabaseAdmin();

  const { data: founder } = await db
    .from('founders')
    .select('active_workspace_id, active_product_id')
    .eq('id', actorId)
    .maybeSingle();

  const workspaceId = (founder as { active_workspace_id?: string | null } | null)?.active_workspace_id ?? null;
  if (!workspaceId) return null;

  // Re-verified every time: a membership removed since this pointer was written
  // must stop resolving immediately, not at the next login.
  const role = await getWorkspaceRole(actorId, workspaceId);
  if (!role) return null;

  const { data: ws } = await db
    .from('workspaces').select('id, name').eq('id', workspaceId).maybeSingle();
  if (!ws) return null;

  const activeProd = (founder as { active_product_id?: string | null } | null)?.active_product_id ?? null;

  // Products are read WITHIN the resolved workspace. The workspace is the
  // tenancy boundary; product choice happens inside it.
  const { data: prodRows } = await db
    .from('products')
    .select('id, name, platform, markets, maturity, created_at')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  const products = (prodRows ?? []) as Array<Record<string, unknown>>;
  const chosen = products.find(p => p.id === activeProd) ?? products[0] ?? null;

  return {
    workspaceId,
    name: (ws as { name: string }).name,
    role,
    productId:   (chosen?.id as string) ?? null,
    productName: (chosen?.name as string) ?? null,
    platform:    (chosen?.platform as string) ?? null,
    markets:     (chosen?.markets as string[]) ?? [],
    maturity:    (chosen?.maturity as string) ?? null,
  };
}
