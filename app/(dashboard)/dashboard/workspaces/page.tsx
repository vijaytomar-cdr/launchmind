/**
 * @file app/(dashboard)/dashboard/workspaces/page.tsx
 * @description Studio-only workspace management page. Lists all client workspaces
 *   and provides create / delete actions. Non-Studio plans see an upgrade prompt.
 * @security Auth token from Supabase session. All mutations go through Fastify API.
 *   Workspace deletion is confirmed before proceeding.
 * @dependencies lib/supabase/client, lib/api (api.workspaces, api.billing)
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { Workspace } from '@/lib/api';

export default function WorkspacesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [token, setToken] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [plan, setPlan] = useState('free');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/login'); return; }
      const t = data.session.access_token;
      setToken(t);
      Promise.all([
        api.workspaces.list(t).then(d => setWorkspaces(d.workspaces)).catch(() => {}),
        api.billing.subscription(t).then(sub => { if (sub?.plan) setPlan(sub.plan); }).catch(() => {}),
      ]).finally(() => setLoading(false));
    });
  }, [router, supabase.auth]);

  async function createWorkspace() {
    if (!newName.trim()) return;
    setCreating(true); setError('');
    try {
      const res = await api.workspaces.create(
        { name: newName.trim(), client_name: newClientName.trim() || undefined },
        token,
      );
      setWorkspaces(prev => [res.workspace, ...prev]);
      setShowDialog(false); setNewName(''); setNewClientName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace');
    } finally { setCreating(false); }
  }

  async function deleteWorkspace(id: string) {
    if (!confirm('Delete this workspace? Products will be unassigned.')) return;
    await api.workspaces.delete(id, token).catch(() => {});
    setWorkspaces(prev => prev.filter(w => w.id !== id));
  }

  const isStudio = plan === 'studio';

  const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 20,
  };
  const inputBase: React.CSSProperties = {
    background: 'var(--raised)',
    border: '1px solid var(--border2)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    color: 'var(--ink)',
    outline: 'none',
    width: '100%',
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Workspaces
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Manage client workspaces for white-label briefs and product isolation.
          </p>
        </div>
        {isStudio ? (
          <button
            onClick={() => setShowDialog(true)}
            style={{
              background: 'var(--sage)',
              color: '#fff',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            New workspace
          </button>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 12, color: 'var(--ink3)' }}>Studio plan required</p>
            <Link href="/pricing" style={{ fontSize: 12, color: 'var(--sage)' }}>Upgrade →</Link>
          </div>
        )}
      </div>

      {/* Non-Studio upgrade prompt */}
      {!isStudio && (
        <div
          style={{
            ...card,
            textAlign: 'center',
            padding: 48,
            border: '1.5px solid var(--indigo-b)',
            background: 'var(--indigo-d)',
          }}
        >
          <p style={{ fontSize: 22, marginBottom: 8 }}>🏢</p>
          <p className="font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>
            Workspaces are a Studio feature
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4, marginBottom: 16 }}>
            Create isolated client workspaces with white-label briefs and brand voice training.
          </p>
          <Link
            href="/pricing"
            style={{
              display: 'inline-block',
              background: 'var(--indigo)',
              color: '#fff',
              borderRadius: 6,
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            View Studio plan →
          </Link>
        </div>
      )}

      {/* Loading state */}
      {isStudio && loading && (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <div
            className="w-8 h-8 rounded-full border-2 animate-spin mx-auto mb-3"
            style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
          />
          <p style={{ fontSize: 13, color: 'var(--ink2)' }}>Loading workspaces…</p>
        </div>
      )}

      {/* Empty state */}
      {isStudio && !loading && workspaces.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <p style={{ fontSize: 22, marginBottom: 8 }}>🗂️</p>
          <p className="font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>
            No workspaces yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Create your first workspace to organise products by client.
          </p>
        </div>
      )}

      {/* Workspace grid */}
      {isStudio && !loading && workspaces.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {workspaces.map(w => (
            <div key={w.id} style={card}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-display font-semibold" style={{ fontSize: 15, color: 'var(--ink)' }}>
                    {w.name}
                  </p>
                  {w.client_name && (
                    <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                      Client: {w.client_name}
                    </p>
                  )}
                </div>
                <span style={{ fontSize: 10, color: 'var(--ink3)' }}>
                  {new Date(w.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/workspaces/${w.id}`}
                  style={{
                    flex: 1,
                    display: 'block',
                    textAlign: 'center',
                    background: 'var(--sage-d)',
                    border: '1px solid var(--sage-b)',
                    color: 'var(--sage)',
                    borderRadius: 6,
                    padding: '6px 0',
                    fontSize: 12,
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Open workspace →
                </Link>
                <button
                  onClick={() => deleteWorkspace(w.id)}
                  style={{
                    fontSize: 11,
                    color: 'var(--ink3)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create workspace dialog */}
      {showDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)' }}
        >
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 12,
              padding: 28,
              width: 420,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 className="font-display font-bold mb-5" style={{ fontSize: 16, color: 'var(--ink)' }}>
              New workspace
            </h2>
            <div className="space-y-4">
              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--ink3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  Workspace name *
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  style={inputBase}
                />
              </div>
              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--ink3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  Client name (for white-label briefs)
                </label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  placeholder="e.g. Acme"
                  style={inputBase}
                />
                <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                  Replaces &quot;LaunchMind&quot; in brief emails sent to this client.
                </p>
              </div>
            </div>
            {error && (
              <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 12 }}>{error}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowDialog(false);
                  setNewName('');
                  setNewClientName('');
                  setError('');
                }}
                style={{
                  flex: 1,
                  border: '1px solid var(--border2)',
                  background: 'var(--surface)',
                  color: 'var(--ink2)',
                  borderRadius: 6,
                  padding: '8px 0',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={createWorkspace}
                disabled={creating || !newName.trim()}
                style={{
                  flex: 1,
                  background: 'var(--sage)',
                  color: '#fff',
                  borderRadius: 6,
                  padding: '8px 0',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer',
                  opacity: !newName.trim() ? 0.5 : 1,
                }}
              >
                {creating ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
