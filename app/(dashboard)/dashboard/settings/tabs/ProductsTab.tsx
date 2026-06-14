'use client';
/**
 * @file tabs/ProductsTab.tsx
 * @description Settings → Products tab.
 *   Active products: name, category, markets, Archive button per row.
 *   Archived products: name, archived date, Restore + Delete permanently.
 *   Confirmation dialogs for both archive and permanent delete.
 * @security API token fetched fresh from Supabase session on mount.
 * @dependencies api.products.list, api.products.listArchived, api.products.archive,
 *               api.products.restore, api.products.deletePermanently
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { Product } from '@/lib/api';

export function ProductsTab() {
  const supabase = createClient();

  const [activeProducts, setActiveProducts] = useState<Product[]>([]);
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tokenCache, setTokenCache] = useState('');

  async function getToken(): Promise<string> {
    if (tokenCache) return tokenCache;
    const { data: { session } } = await supabase.auth.getSession();
    const t = session?.access_token ?? '';
    setTokenCache(t);
    return t;
  }

  async function refresh() {
    const tok = await getToken();
    if (!tok) return;
    const [active, archived] = await Promise.all([
      api.products.list(tok).catch(() => [] as Product[]),
      api.products.listArchived(tok).catch(() => [] as Product[]),
    ]);
    setActiveProducts(active);
    setArchivedProducts(archived);
  }

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setTokenCache(session.access_token);
      const [active, archived] = await Promise.all([
        api.products.list(session.access_token).catch(() => [] as Product[]),
        api.products.listArchived(session.access_token).catch(() => [] as Product[]),
      ]);
      setActiveProducts(active);
      setArchivedProducts(archived);
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleArchive(product: Product) {
    const tok = await getToken();
    setActionLoading(`archive-${product.id}`);
    try {
      await api.products.archive(product.id, tok);
      setArchiveTarget(null);
      await refresh();
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  }

  async function handleRestore(product: Product) {
    const tok = await getToken();
    setActionLoading(`restore-${product.id}`);
    try {
      await api.products.restore(product.id, tok);
      await refresh();
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  }

  async function handleDelete(product: Product) {
    if (deleteInput !== 'DELETE') return;
    const tok = await getToken();
    setActionLoading(`delete-${product.id}`);
    try {
      await api.products.deletePermanently(product.id, tok);
      setDeleteTarget(null);
      setDeleteInput('');
      await refresh();
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Products</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
          Manage your apps — archive to hide, restore any time, or permanently delete when done.
        </div>
      </div>

      {/* Active products */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink3)', marginBottom: 10 }}>
          Active products
        </div>

        {loading && <div style={{ fontSize: 12, color: 'var(--ink3)', padding: '4px 0' }}>Loading…</div>}

        {!loading && activeProducts.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--ink3)', padding: '4px 0' }}>
            No active products.{' '}
            <a href="/dashboard/products/new" style={{ color: 'var(--sage)' }}>
              Add your first product →
            </a>
          </div>
        )}

        {activeProducts.map((product, index) => (
          <div
            key={product.id}
            style={{
              display: 'flex', alignItems: 'center', padding: '10px 0',
              borderTop: index > 0 ? '0.5px solid var(--border)' : 'none',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{product.name}</div>
              <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>
                {[product.category, (product.markets ?? []).join(' + ').toUpperCase()].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 99,
                background: 'rgba(5,150,105,0.12)', color: '#059669',
                border: '0.5px solid rgba(5,150,105,0.28)',
              }}>
                Active
              </span>
              <button
                onClick={() => setArchiveTarget(product)}
                style={{
                  padding: '5px 12px', borderRadius: 5, fontSize: 11,
                  border: '0.5px solid rgba(0,0,0,0.12)', background: 'transparent',
                  color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Archived products */}
      {archivedProducts.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink3)', marginBottom: 10 }}>
            Archived products
          </div>

          {archivedProducts.map((product, index) => (
            <div
              key={product.id}
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 0', opacity: 0.8,
                borderTop: index > 0 ? '0.5px solid var(--border)' : 'none',
              }}
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="var(--ink3)" strokeWidth={1.5} style={{ marginRight: 10, flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)' }}>{product.name}</div>
                <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>
                  Archived {product.archived_at ? new Date(product.archived_at).toLocaleDateString() : ''} · All data preserved
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => handleRestore(product)}
                  disabled={actionLoading === `restore-${product.id}`}
                  style={{
                    padding: '5px 12px', borderRadius: 5, fontSize: 11,
                    background: 'rgba(5,150,105,0.10)', border: '0.5px solid rgba(5,150,105,0.28)',
                    color: '#059669', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
                  }}
                >
                  {actionLoading === `restore-${product.id}` ? 'Restoring...' : '↩ Restore'}
                </button>
                <button
                  onClick={() => setDeleteTarget(product)}
                  style={{
                    padding: '5px 12px', borderRadius: 5, fontSize: 11,
                    background: 'rgba(220,38,38,0.07)', border: '0.5px solid rgba(220,38,38,0.20)',
                    color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Delete permanently
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Archive confirmation dialog */}
      {archiveTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 20, maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="#d97706" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
              Archive {archiveTarget.name}?
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.65, marginBottom: 16 }}>
              This will hide {archiveTarget.name} from your dashboard and pause all active campaigns.
              <br /><br />
              <strong style={{ color: 'var(--ink)' }}>All your data is preserved</strong> — briefs,
              metrics, campaigns, and content assets stay intact. Restore any time from this page.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setArchiveTarget(null)} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button
                onClick={() => handleArchive(archiveTarget)}
                disabled={actionLoading === `archive-${archiveTarget.id}`}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, background: 'rgba(217,119,6,0.12)', border: '0.5px solid rgba(217,119,6,0.28)', color: '#d97706', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
              >
                {actionLoading === `archive-${archiveTarget.id}` ? 'Archiving...' : 'Archive product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent delete dialog */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 20, maxWidth: 380, width: '90%', border: '1.5px solid rgba(220,38,38,0.28)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="#dc2626" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
              Permanently delete {deleteTarget.name}?
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.65, marginBottom: 14 }}>
              <strong style={{ color: 'var(--ink)' }}>This cannot be undone.</strong> All campaigns,
              briefs, metrics, and content assets will be permanently deleted.
              <br /><br />
              Anonymised performance data is kept to help improve recommendations for all founders.
            </p>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 5 }}>
                Type <strong style={{ fontFamily: 'monospace', color: 'var(--ink)' }}>DELETE</strong> to confirm
              </div>
              <input
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                style={{
                  width: '100%', padding: '8px 10px', boxSizing: 'border-box',
                  background: deleteInput === 'DELETE' ? 'rgba(220,38,38,0.04)' : 'var(--raised)',
                  border: `1px solid ${deleteInput === 'DELETE' ? 'rgba(220,38,38,0.40)' : 'var(--border2)'}`,
                  borderRadius: 6, fontSize: 13, fontFamily: 'monospace', color: 'var(--ink)', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setDeleteTarget(null); setDeleteInput(''); }} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleteInput !== 'DELETE' || actionLoading === `delete-${deleteTarget.id}`}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, background: deleteInput === 'DELETE' ? '#dc2626' : 'var(--raised)', border: 'none', color: deleteInput === 'DELETE' ? '#fff' : 'var(--ink3)', cursor: deleteInput === 'DELETE' ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 500 }}
              >
                {actionLoading === `delete-${deleteTarget.id}` ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
