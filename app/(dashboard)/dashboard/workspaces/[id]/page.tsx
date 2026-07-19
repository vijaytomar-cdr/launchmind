/**
 * @file app/(dashboard)/dashboard/workspaces/[id]/page.tsx
 * @description Workspace detail page — shows products assigned to the workspace,
 *   allows assigning additional products, and provides a brand voice preview panel.
 * @security Auth token from Supabase session. All data fetched from Fastify API.
 *   Brand voice preview is product-scoped; never exposes raw encrypted tokens.
 * @dependencies lib/supabase/client, lib/api (api.workspaces, api.products, api.brandVoice)
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { Product } from '@/lib/api';

interface Props {
  params: { id: string };
}

export default function WorkspaceDetailPage({ params }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [token, setToken] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [clientName, setClientName] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [copy, setCopy] = useState('');
  const [brandVoiceResult, setBrandVoiceResult] = useState<{
    original: string;
    adjusted: string;
    tone: string;
    adjectives: string[];
  } | null>(null);
  const [brandVoiceLoading, setBrandVoiceLoading] = useState(false);
  const [brandVoiceError, setBrandVoiceError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/login'); return; }
      const t = data.session.access_token;
      setToken(t);
      Promise.all([
        api.workspaces.get(params.id, t).then(d => {
          setWorkspaceName(d.workspace.name);
          setClientName(d.workspace.client_name ?? '');
        }),
        api.workspaces.products(params.id, t).then(d => setProducts(d.products)),
        api.products.list(t).then(prods => {
          setAllProducts(Array.isArray(prods) ? prods : []);
        }),
      ]).finally(() => setLoading(false));
    });
  }, [params.id, router, supabase.auth]);

  async function assignProduct(productId: string) {
    if (!productId) return;
    await api.workspaces.assignProduct(params.id, productId, token).catch(() => {});
    const prod = allProducts.find(p => p.id === productId);
    if (prod && !products.find(p => p.id === productId)) {
      setProducts(prev => [...prev, prod]);
    }
    setSelectedProduct('');
  }

  async function previewBrandVoice() {
    if (!copy.trim() || products.length === 0) return;
    setBrandVoiceLoading(true); setBrandVoiceError(''); setBrandVoiceResult(null);
    try {
      const result = await api.brandVoice.preview(products[0].id, copy, token);
      setBrandVoiceResult(result);
    } catch (e) {
      setBrandVoiceError(e instanceof Error ? e.message : 'Brand voice preview failed');
    } finally { setBrandVoiceLoading(false); }
  }

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

  const unassignedProducts = allProducts.filter(p => !products.find(wp => wp.id === p.id));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Breadcrumb */}
      <div
        className="flex items-center gap-2 mb-6"
        style={{ fontSize: 13, color: 'var(--ink3)' }}
      >
        <Link href="/dashboard/workspaces" style={{ color: 'var(--ink2)' }}>
          Workspaces
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--ink)' }}>{workspaceName || '…'}</span>
      </div>

      {/* Page heading */}
      <div className="mb-6">
        <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>
          {workspaceName || 'Workspace'}
        </h1>
        {clientName && (
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Client: <strong>{clientName}</strong> · White-label briefs enabled
          </p>
        )}
      </div>

      {/* Loading state */}
      {loading ? (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <div
            className="w-8 h-8 rounded-full border-2 animate-spin mx-auto"
            style={{ borderColor: 'var(--sage)', borderTopColor: 'transparent' }}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Products panel */}
          <div style={card}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>
                Products in this workspace
              </h2>
              <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
                {products.length} product{products.length !== 1 ? 's' : ''}
              </span>
            </div>

            {products.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink3)' }}>No products assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {products.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between"
                    style={{ background: 'var(--raised)', borderRadius: 6, padding: '8px 12px' }}
                  >
                    <div>
                      <p style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{p.name}</p>
                      <p style={{ fontSize: 11, color: 'var(--ink3)' }}>
                        {p.platform === 'app_store' ? 'App Store' : 'Play Store'}{' '}
                        · {p.category ?? 'Unknown'}
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/products/${p.id}`}
                      style={{ fontSize: 11, color: 'var(--sage)', textDecoration: 'none' }}
                    >
                      View →
                    </Link>
                  </div>
                ))}
              </div>
            )}

            {/* Assign product */}
            {unassignedProducts.length > 0 && (
              <div className="flex gap-2 mt-4">
                <select
                  value={selectedProduct}
                  onChange={e => setSelectedProduct(e.target.value)}
                  style={{ ...inputBase, flex: 1 }}
                >
                  <option value="">Add a product…</option>
                  {unassignedProducts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => assignProduct(selectedProduct)}
                  disabled={!selectedProduct}
                  style={{
                    background: 'var(--sage)',
                    color: '#fff',
                    borderRadius: 6,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 500,
                    border: 'none',
                    cursor: !selectedProduct ? 'not-allowed' : 'pointer',
                    opacity: !selectedProduct ? 0.5 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Assign
                </button>
              </div>
            )}
          </div>

          {/* Brand voice panel */}
          <div style={card}>
            <h2 className="font-display font-semibold mb-2" style={{ fontSize: 14, color: 'var(--ink)' }}>
              Brand voice preview
            </h2>
            <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12 }}>
              Paste sample copy to see how it reads in this client&apos;s brand voice.
              {products.length === 0 && ' Assign a product first.'}
            </p>

            <textarea
              value={copy}
              onChange={e => setCopy(e.target.value)}
              placeholder="Paste copy here to preview brand voice…"
              disabled={products.length === 0}
              rows={3}
              style={{
                ...inputBase,
                resize: 'vertical',
                fontFamily: 'inherit',
                opacity: products.length === 0 ? 0.5 : 1,
              }}
            />

            {brandVoiceError && (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{brandVoiceError}</p>
            )}

            <button
              onClick={previewBrandVoice}
              disabled={!copy.trim() || products.length === 0 || brandVoiceLoading}
              style={{
                marginTop: 10,
                background: 'var(--sage)',
                color: '#fff',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 500,
                border: 'none',
                cursor:
                  !copy.trim() || products.length === 0 || brandVoiceLoading
                    ? 'not-allowed'
                    : 'pointer',
                opacity: !copy.trim() || products.length === 0 ? 0.5 : 1,
              }}
            >
              {brandVoiceLoading ? 'Analysing…' : 'Preview brand voice'}
            </button>

            {/* Brand voice result */}
            {brandVoiceResult && (
              <div className="mt-4 space-y-3">
                <div style={{ background: 'var(--raised)', borderRadius: 6, padding: '10px 14px' }}>
                  <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Original</p>
                  <p style={{ fontSize: 13, color: 'var(--ink2)' }}>{brandVoiceResult.original}</p>
                </div>
                <div
                  style={{
                    background: 'var(--sage-d)',
                    border: '1px solid var(--sage-b)',
                    borderRadius: 6,
                    padding: '10px 14px',
                  }}
                >
                  <p style={{ fontSize: 11, color: 'var(--sage)', marginBottom: 4 }}>
                    Adjusted — {brandVoiceResult.tone} tone
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--ink)' }}>{brandVoiceResult.adjusted}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {brandVoiceResult.adjectives.map(adj => (
                      <span
                        key={adj}
                        style={{
                          fontSize: 10,
                          background: 'var(--surface)',
                          border: '1px solid var(--sage-b)',
                          color: 'var(--sage)',
                          borderRadius: 4,
                          padding: '1px 6px',
                        }}
                      >
                        {adj}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
