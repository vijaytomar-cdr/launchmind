/**
 * @file workspaces.route.ts
 * @description Studio-tier multi-client workspace routes.
 *   POST   /workspaces          — create a workspace
 *   GET    /workspaces          — list all workspaces for the founder
 *   GET    /workspaces/:id      — get workspace + its products
 *   PATCH  /workspaces/:id      — update name / client_name
 *   DELETE /workspaces/:id      — delete workspace (products set to workspace_id = NULL)
 *   GET    /workspaces/:id/products — products scoped strictly to this workspace
 * @security JWT required for all routes. Workspace ownership verified on every write.
 * @dependencies supabaseAdmin, jwtPlugin (via request.jwtVerify)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  setActiveWorkspace,
  setActiveProduct,
  listWorkspaceMembers,
  inviteWorkspaceMember,
  removeWorkspaceMember,
} from '../services/workspaceService';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

const CreateWorkspaceSchema = z.object({
  name:        z.string().min(1).max(120),
  client_name: z.string().min(1).max(120).optional(),
});

const UpdateWorkspaceSchema = z.object({
  name:        z.string().min(1).max(120).optional(),
  client_name: z.string().min(1).max(120).nullable().optional(),
});

export async function workspacesRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /workspaces
   * Creates a new workspace for the authenticated founder.
   * Body: { name: string, client_name?: string }
   */
  server.post('/workspaces', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = CreateWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
    }

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('workspaces')
        .insert({ founder_id: founderId, name: parsed.data.name, client_name: parsed.data.client_name ?? null })
        .select('id, name, client_name, created_at')
        .single();

      if (error || !data) throw error ?? new Error('Insert returned no data');
      return reply.status(201).send({ workspace: data });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'POST /workspaces' } });
      return reply.status(500).send({ error: 'Failed to create workspace' });
    }
  });

  /**
   * GET /workspaces
   * Lists all workspaces for the authenticated founder.
   */
  server.get('/workspaces', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    try {
      const { data, error } = await getSupabaseAdmin()
        .from('workspaces')
        .select('id, name, client_name, created_at')
        .eq('founder_id', founderId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return reply.send({ workspaces: data ?? [] });
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'GET /workspaces' } });
      return reply.status(500).send({ error: 'Failed to list workspaces' });
    }
  });

  /**
   * GET /workspaces/:id
   * Returns workspace details for the authenticated founder.
   */
  server.get<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      try {
        const { data, error } = await getSupabaseAdmin()
          .from('workspaces')
          .select('id, name, client_name, created_at')
          .eq('id', request.params.id)
          .eq('founder_id', founderId)
          .single();

        if (error || !data) return reply.status(404).send({ error: 'Workspace not found' });
        return reply.send({ workspace: data });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /workspaces/:id' } });
        return reply.status(500).send({ error: 'Failed to fetch workspace' });
      }
    }
  );

  /**
   * GET /workspaces/:id/products
   * Returns products scoped STRICTLY to this workspace.
   * Workspace A products are NOT returned when scoped to workspace B.
   * @security Double isolation: founder_id (JWT) AND workspace_id.
   */
  server.get<{ Params: { id: string } }>(
    '/workspaces/:id/products',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      try {
        // Verify workspace belongs to this founder first
        const { data: ws, error: wsErr } = await getSupabaseAdmin()
          .from('workspaces')
          .select('id')
          .eq('id', request.params.id)
          .eq('founder_id', founderId)
          .single();

        if (wsErr || !ws) return reply.status(404).send({ error: 'Workspace not found' });

        // Return only products explicitly assigned to THIS workspace
        const { data, error } = await getSupabaseAdmin()
          .from('products')
          .select('id, name, store_url, platform, category, markets, price_tier, confirmed_icp, last_scraped_at, workspace_id, created_at')
          .eq('founder_id', founderId)
          .eq('workspace_id', request.params.id)   // strict workspace scope
          .order('created_at', { ascending: false });

        if (error) throw error;
        return reply.send({ products: data ?? [], workspaceId: request.params.id });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'GET /workspaces/:id/products' } });
        return reply.status(500).send({ error: 'Failed to fetch workspace products' });
      }
    }
  );

  /**
   * PATCH /workspaces/:id
   * Updates workspace name and/or client_name.
   */
  server.patch<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      const parsed = UpdateWorkspaceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }
      if (!parsed.data.name && parsed.data.client_name === undefined) {
        return reply.status(400).send({ error: 'Nothing to update' });
      }

      try {
        const updates: Record<string, unknown> = {};
        if (parsed.data.name !== undefined)        updates.name        = parsed.data.name;
        if (parsed.data.client_name !== undefined)  updates.client_name = parsed.data.client_name;

        const { data, error } = await getSupabaseAdmin()
          .from('workspaces')
          .update(updates)
          .eq('id', request.params.id)
          .eq('founder_id', founderId)
          .select('id, name, client_name, created_at')
          .single();

        if (error || !data) return reply.status(404).send({ error: 'Workspace not found' });
        return reply.send({ workspace: data });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'PATCH /workspaces/:id' } });
        return reply.status(500).send({ error: 'Failed to update workspace' });
      }
    }
  );

  /**
   * DELETE /workspaces/:id
   * Deletes a workspace. Products in the workspace have workspace_id set to NULL
   * (ON DELETE SET NULL on the FK constraint).
   */
  server.delete<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      try {
        const { error } = await getSupabaseAdmin()
          .from('workspaces')
          .delete()
          .eq('id', request.params.id)
          .eq('founder_id', founderId);

        if (error) throw error;
        return reply.status(204).send();
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'DELETE /workspaces/:id' } });
        return reply.status(500).send({ error: 'Failed to delete workspace' });
      }
    }
  );

  /**
   * POST /workspaces/:id/products/:productId
   * Assigns an existing product to a workspace.
   * @security Verifies both workspace and product belong to the same founder.
   */
  server.post<{ Params: { id: string; productId: string } }>(
    '/workspaces/:id/products/:productId',
    async (request, reply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      try {
        // Verify workspace ownership
        const { data: ws } = await getSupabaseAdmin()
          .from('workspaces')
          .select('id')
          .eq('id', request.params.id)
          .eq('founder_id', founderId)
          .single();

        if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

        const { data, error } = await getSupabaseAdmin()
          .from('products')
          .update({ workspace_id: request.params.id })
          .eq('id', request.params.productId)
          .eq('founder_id', founderId)
          .select('id, name, workspace_id')
          .single();

        if (error || !data) return reply.status(404).send({ error: 'Product not found' });
        return reply.send({ product: data });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /workspaces/:id/products/:productId' } });
        return reply.status(500).send({ error: 'Failed to assign product to workspace' });
      }
    }
  );

  // ── Active workspace / product switching (ADR-013) ───────────────────────

  /**
   * POST /workspaces/:id/activate
   * Sets the authenticated founder's active_workspace_id.
   */
  server.post<{ Params: { id: string } }>(
    '/workspaces/:id/activate',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      try {
        await setActiveWorkspace(founderId, request.params.id);
        return reply.send({ ok: true });
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'POST /workspaces/:id/activate' } });
        return reply.status(500).send({ error: 'Failed to set active workspace' });
      }
    }
  );

  /**
   * POST /products/:id/activate
   * Sets the authenticated founder's active_product_id.
   * Also updates active_workspace_id to the product's workspace if set.
   */
  server.post<{ Params: { id: string } }>(
    '/products/:productId/activate',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      const productId = (request.params as unknown as { productId: string }).productId;
      try {
        await setActiveProduct(founderId, productId);
        return reply.send({ ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        Sentry.captureException(err, { tags: { route: 'POST /products/:id/activate' } });
        return reply.status(500).send({ error: 'Failed to set active product' });
      }
    }
  );

  // ── Workspace member management ──────────────────────────────────────────

  const InviteMemberSchema = z.object({
    email: z.string().email(),
    role:  z.enum(['admin', 'editor', 'viewer']).default('viewer'),
  });

  /**
   * GET /workspaces/:id/members
   * Lists members of a workspace (owner only).
   */
  server.get<{ Params: { id: string } }>(
    '/workspaces/:id/members',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      try {
        const members = await listWorkspaceMembers(request.params.id, founderId);
        return reply.send({ members });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        Sentry.captureException(err, { tags: { route: 'GET /workspaces/:id/members' } });
        return reply.status(500).send({ error: 'Failed to list members' });
      }
    }
  );

  /**
   * POST /workspaces/:id/members
   * Invites a member (creates pending workspace_members row).
   * Body: { email: string, role: 'admin' | 'editor' | 'viewer' }
   */
  server.post<{ Params: { id: string } }>(
    '/workspaces/:id/members',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);

      const parsed = InviteMemberSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.message });
      }

      try {
        const member = await inviteWorkspaceMember(
          request.params.id,
          founderId,
          parsed.data.email,
          parsed.data.role,
        );
        return reply.status(201).send({ member });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        Sentry.captureException(err, { tags: { route: 'POST /workspaces/:id/members' } });
        return reply.status(500).send({ error: 'Failed to invite member' });
      }
    }
  );

  /**
   * DELETE /workspaces/:id/members/:memberId
   * Removes a member from a workspace (owner only).
   */
  server.delete<{ Params: { id: string; memberId: string } }>(
    '/workspaces/:id/members/:memberId',
    async (request: FastifyRequest<{ Params: { id: string; memberId: string } }>, reply: FastifyReply) => {
      await request.jwtVerify();
      const founderId = getFounderId(request);
      try {
        await removeWorkspaceMember(request.params.id, founderId, request.params.memberId);
        return reply.status(204).send();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) return reply.status(404).send({ error: msg });
        Sentry.captureException(err, { tags: { route: 'DELETE /workspaces/:id/members/:memberId' } });
        return reply.status(500).send({ error: 'Failed to remove member' });
      }
    }
  );
}
