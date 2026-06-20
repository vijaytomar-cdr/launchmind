/**
 * @file app/(dashboard)/dashboard/products/page.tsx
 * @description Products list — all active products for the founder with ICP and strategy status.
 *   Three-dot menu per card: view strategy, view briefs, archive.
 *   Archived products section below active list (collapsed by default).
 * @security Auth token from Supabase session. Fresh token passed to ProductMenu.
 * @dependencies lib/api, lib/supabase/client, ProductMenu
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Product } from '@/lib/api';
import { ProductMenu } from '@/components/launchmind/ProductMenu';
import { INTAKE_STORAGE } from '@/lib/types/intake';

type InProgressProduct = {
  id: string;
  name: string;
  store_url: string;
  play_store_url: string | null;
  app_store_url: string | null;
  intake_step: number | null;
  created_at: string;
};

// Maps completed intake_step to the next URL the user should land on when resuming
const RESUME_URLS: Record<number, string> = {
  1: '/dashboard/products/new/context',
  2: '/dashboard/products/new/analysis',
  3: '/dashboard/products/new/icp',
  4: '/dashboard/products/new/competitors',
  5: '/dashboard/products/new/markets',
  6: '/dashboard/products/new/confirm',
};

const STEP_LABELS: Record<number, string> = {
  1: 'URL entry',
  2: 'Context',
  3: 'Analysis',
  4: 'ICP brief',
  5: 'Competitors',
  6: 'Markets',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

const spinStyle: React.CSSProperties = { width: 20, height: 20, border: '2px solid var(--sage)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.75s linear infinite' };

function Spinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 96 }}>
      <div style={spinStyle} />
      <span style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading products…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 96, textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="var(--ink3)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      </div>
      <h3 className="font-semibold" style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 8 }}>No products yet</h3>
      <p style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 340, marginBottom: 24 }}>
        Paste your App Store or Play Store URL to scrape your app&apos;s data and generate an ICP brief automatically.
      </p>
      <Link href="/dashboard/products/new" className="rounded-[6px] font-medium transition-opacity hover:opacity-90" style={{ background: 'var(--sage)', color: '#fff', fontSize: 13, padding: '10px 24px' }}>
        Add your first product
      </Link>
    </div>
  );
}

const ICON_COLORS = ['#4f46e5', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626'];

function AppIcon({ name }: { name: string }) {
  const color = ICON_COLORS[name.charCodeAt(0) % ICON_COLORS.length];
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 12, flexShrink: 0,
      background: color + '15', border: `1px solid ${color}28`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span className="font-display font-bold" style={{ fontSize: 20, color }}>
        {name.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function MarketBadge({ market }: { market: string }) {
  const india = market === 'india';
  return (
    <span style={{ fontSize: 10, fontWeight: 500, borderRadius: 9999, padding: '2px 8px', background: india ? 'var(--amber-d)' : 'var(--sage-d)', border: `1px solid ${india ? 'var(--amber-b)' : 'var(--sage-b)'}`, color: india ? 'var(--amber)' : 'var(--sage)' }}>
      {market.toUpperCase()}
    </span>
  );
}

function ProductCard({ product, token, onArchived }: { product: Product; token: string; onArchived: () => void }) {
  const meta = [product.category, product.price_tier, `Last analysed ${formatDate(product.last_scraped_at)}`].filter(Boolean).join(' · ');

  return (
    <div
      style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, transition: 'border-color 0.15s' }}
      onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border2)')}
      onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)')}
    >
      <Link href={`/dashboard/products/${product.id}`} style={{ textDecoration: 'none', display: 'block', padding: '14px 16px' }}>
        {/* Header: icon + name/meta */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingRight: 40 }}>
          <AppIcon name={product.name} />
          <div style={{ flex: 1 }}>
            <div className="font-display font-semibold" style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 3 }}>
              {product.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{meta}</div>
          </div>
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
          {(product.markets ?? []).map(m => <MarketBadge key={m} market={m} />)}
          {product.confirmed_icp
            ? <span style={{ fontSize: 10, fontWeight: 500, borderRadius: 9999, padding: '2px 8px', background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)' }}>ICP confirmed ✓</span>
            : <span style={{ fontSize: 10, fontWeight: 500, borderRadius: 9999, padding: '2px 8px', background: 'var(--amber-d)', border: '1px solid var(--amber-b)', color: 'var(--amber)' }}>ICP pending</span>
          }
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--sage)', fontWeight: 500 }}>View strategy →</span>
        </div>
      </Link>

      <ProductMenu
        productId={product.id}
        productName={product.name}
        token={token}
        onArchived={onArchived}
      />
    </div>
  );
}

// ── Archived section ──────────────────────────────────────────────────────────

function ArchivedSection({ products, token, onRefresh }: { products: Product[]; token: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleRestore(product: Product) {
    setRestoring(product.id);
    try {
      await api.products.restore(product.id, token);
      onRefresh();
    } finally {
      setRestoring(null);
    }
  }

  async function handleDelete() {
    if (deleteInput !== 'DELETE' || !deleteTarget) return;
    setDeleting(true);
    try {
      await api.products.deletePermanently(deleteTarget.id, token);
      setDeleteTarget(null);
      setDeleteInput('');
      onRefresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, cursor: 'pointer', fontSize: 12,
          color: 'var(--ink2)', fontFamily: 'inherit',
          padding: '9px 14px', fontWeight: 500,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          {open
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          }
        </svg>
        {products.length} archived product{products.length !== 1 ? 's' : ''}
      </button>

      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {products.map(p => (
            <div
              key={p.id}
              style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.75 }}
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="var(--ink3)" strokeWidth={1.5} style={{ flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)' }}>{p.name}</div>
                <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>
                  Archived {p.archived_at ? new Date(p.archived_at).toLocaleDateString() : ''} · All data preserved
                </div>
              </div>
              <button
                onClick={() => handleRestore(p)}
                disabled={restoring === p.id}
                style={{ padding: '5px 12px', borderRadius: 5, fontSize: 11, background: 'rgba(5,150,105,0.10)', border: '0.5px solid rgba(5,150,105,0.28)', color: '#059669', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
              >
                {restoring === p.id ? 'Restoring...' : '↩ Restore'}
              </button>
              <button
                onClick={() => setDeleteTarget(p)}
                style={{ padding: '5px 12px', borderRadius: 5, fontSize: 11, background: 'rgba(220,38,38,0.07)', border: '0.5px solid rgba(220,38,38,0.20)', color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Delete permanently
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Permanent delete modal */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 20, maxWidth: 380, width: '90%', border: '1.5px solid rgba(220,38,38,0.28)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="#dc2626" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
              Permanently delete {deleteTarget.name}?
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.65, marginBottom: 14 }}>
              <strong style={{ color: 'var(--ink)' }}>This cannot be undone.</strong> All campaigns,
              briefs, metrics, and content assets will be permanently deleted.
            </p>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 5 }}>
                Type <strong style={{ fontFamily: 'monospace', color: 'var(--ink)' }}>DELETE</strong> to confirm
              </div>
              <input
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                style={{ width: '100%', padding: '8px 10px', boxSizing: 'border-box', background: deleteInput === 'DELETE' ? 'rgba(220,38,38,0.04)' : 'var(--raised)', border: `1px solid ${deleteInput === 'DELETE' ? 'rgba(220,38,38,0.40)' : 'var(--border2)'}`, borderRadius: 6, fontSize: 13, fontFamily: 'monospace', color: 'var(--ink)', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setDeleteTarget(null); setDeleteInput(''); }} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteInput !== 'DELETE' || deleting}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, background: deleteInput === 'DELETE' ? '#dc2626' : 'var(--raised)', border: 'none', color: deleteInput === 'DELETE' ? '#fff' : 'var(--ink3)', cursor: deleteInput === 'DELETE' ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 500 }}
              >
                {deleting ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Resume modal ──────────────────────────────────────────────────────────────

function ResumeModal({
  product,
  onResume,
  onStartFresh,
  onCancel,
  abandonLoading,
}: {
  product: InProgressProduct;
  onResume: () => void;
  onStartFresh: () => void;
  onCancel: () => void;
  abandonLoading: boolean;
}) {
  const step = product.intake_step ?? 1;
  const displayUrl = product.play_store_url ?? product.app_store_url ?? product.store_url;
  const shortUrl = displayUrl.replace(/^https?:\/\//, '').replace(/\?.+$/, '').substring(0, 52);
  const stepLabel = STEP_LABELS[step] ?? 'URL entry';
  const startedAt = new Date(product.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 420, width: '90%', border: '1px solid var(--border2)', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--amber-d)', border: '1px solid var(--amber-b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="var(--amber)" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
          </div>
          <div>
            <div className="font-display font-semibold" style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 2 }}>Unfinished setup found</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Started {startedAt}</div>
          </div>
        </div>

        {/* Product info */}
        <div style={{ background: 'var(--raised)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>In progress</div>
          <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, wordBreak: 'break-all' }}>{shortUrl}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            {/* Step progress dots */}
            {[1,2,3,4,5,6].map(n => (
              <div key={n} style={{ width: n <= step ? 20 : 8, height: 6, borderRadius: 3, background: n <= step ? 'var(--sage)' : 'var(--border2)', transition: 'width 0.2s' }} />
            ))}
            <span style={{ fontSize: 11, color: 'var(--ink2)', marginLeft: 4 }}>Step {step}/6 — {stepLabel}</span>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>
          You left off at <strong style={{ color: 'var(--ink)' }}>{stepLabel}</strong>. Pick up where you left off or discard this and start fresh.
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onResume}
            style={{ flex: 1, padding: '9px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, background: 'var(--sage)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Resume setup →
          </button>
          <button
            onClick={onStartFresh}
            disabled={abandonLoading}
            style={{ padding: '9px 16px', borderRadius: 6, fontSize: 13, background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink2)', cursor: abandonLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: abandonLoading ? 0.6 : 1 }}
          >
            {abandonLoading ? 'Discarding…' : 'Start fresh'}
          </button>
          <button
            onClick={onCancel}
            style={{ padding: '9px 12px', borderRadius: 6, fontSize: 13, background: 'transparent', border: '1px solid var(--border)', color: 'var(--ink3)', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const mountedRef = useRef(true);
  const [checkingInProgress, setCheckingInProgress] = useState(false);
  const [inProgressProduct, setInProgressProduct] = useState<InProgressProduct | null>(null);
  const [abandonLoading, setAbandonLoading] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mountedRef.current) return;
      if (!session?.access_token) {
        router.replace('/login');
        return;
      }
      setToken(session.access_token);
      const [active, archived] = await Promise.all([
        api.products.list(session.access_token),
        api.products.listArchived(session.access_token).catch(() => [] as Product[]),
      ]);
      if (!mountedRef.current) return;
      setProducts(active);
      setArchivedProducts(archived);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof ApiError ? err.message : 'Failed to load products.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  async function handleAddProduct() {
    if (!token) { router.push('/dashboard/products/new'); return; }
    setCheckingInProgress(true);
    try {
      const result = await api.products.inProgress(token);
      if (result.product) {
        setInProgressProduct(result.product);
      } else {
        router.push('/dashboard/products/new');
      }
    } catch {
      router.push('/dashboard/products/new');
    } finally {
      setCheckingInProgress(false);
    }
  }

  function handleResume() {
    if (!inProgressProduct) return;
    sessionStorage.setItem(INTAKE_STORAGE.productId, inProgressProduct.id);
    sessionStorage.setItem(INTAKE_STORAGE.jobId, `scrape-${inProgressProduct.id}`);
    const step = inProgressProduct.intake_step ?? 1;
    // Products returned by /in-progress always have confirmed_icp=null (analysis not complete).
    // step=1 means context not yet submitted → go to context page.
    // step>=2 means context was submitted but analysis is still running → go to analysis page.
    const url = step <= 1
      ? '/dashboard/products/new/context'
      : '/dashboard/products/new/analysis';
    router.push(url);
  }

  async function handleStartFresh() {
    if (!inProgressProduct || !token) return;
    setAbandonLoading(true);
    try {
      await api.products.abandon(inProgressProduct.id, token);
    } catch { /* ignore — product may not exist */ }
    setInProgressProduct(null);
    setAbandonLoading(false);
    router.push('/dashboard/products/new');
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {inProgressProduct && (
        <ResumeModal
          product={inProgressProduct}
          onResume={handleResume}
          onStartFresh={handleStartFresh}
          onCancel={() => setInProgressProduct(null)}
          abandonLoading={abandonLoading}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Products
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>
            Your apps and their ICP briefs
          </p>
        </div>
        <button
          onClick={handleAddProduct}
          disabled={checkingInProgress}
          className="rounded-[6px] font-medium transition-opacity hover:opacity-90"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13, padding: '8px 16px', border: 'none', cursor: checkingInProgress ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: checkingInProgress ? 0.7 : 1 }}
        >
          {checkingInProgress ? 'Checking…' : '+ Add product'}
        </button>
      </div>

      {/* States */}
      {loading && <Spinner />}

      {!loading && error && (
        <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>
      )}

      {!loading && !error && products.length === 0 && archivedProducts.length === 0 && <EmptyState />}

      {!loading && !error && (products.length > 0 || archivedProducts.length > 0) && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            {products.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                token={token}
                onArchived={fetchProducts}
              />
            ))}
          </div>

          {archivedProducts.length > 0 && (
            <ArchivedSection
              products={archivedProducts}
              token={token}
              onRefresh={fetchProducts}
            />
          )}
        </>
      )}
    </div>
  );
}
