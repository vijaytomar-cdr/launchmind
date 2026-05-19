/**
 * @file app/(dashboard)/dashboard/products/page.tsx
 * @description Products list — all products for the founder with ICP and strategy status.
 * @security Auth token from Supabase session. Read-only data fetch.
 * @dependencies lib/api, lib/supabase/client
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { Product } from '@/lib/api';

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

function PlatformBadge({ platform }: { platform: Product['platform'] }) {
  const app = platform === 'app_store';
  return (
    <span style={{ fontSize: 10, fontWeight: 500, borderRadius: 9999, padding: '2px 8px', background: app ? 'var(--indigo-d)' : 'var(--sage-d)', border: `1px solid ${app ? 'var(--indigo-b)' : 'var(--sage-b)'}`, color: app ? 'var(--indigo)' : 'var(--sage)' }}>
      {app ? 'App Store' : 'Play Store'}
    </span>
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

function ProductCard({ product }: { product: Product }) {
  return (
    <Link href={`/dashboard/products/${product.id}`} style={{ textDecoration: 'none' }}>
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, cursor: 'pointer', transition: 'border-color 0.15s' }}
        onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border2)')}
        onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)')}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="font-display font-semibold" style={{ fontSize: 15, color: 'var(--ink)' }}>{product.name}</span>
          <PlatformBadge platform={product.platform} />
        </div>

        {product.markets && product.markets.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {product.markets.map(m => <MarketBadge key={m} market={m} />)}
          </div>
        )}

        <div style={{ marginBottom: 6 }}>
          {product.confirmed_icp
            ? <span style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 500 }}>ICP confirmed ✓</span>
            : <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 500 }}>ICP pending</span>}
        </div>

        {(product.category || product.price_tier) && (
          <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12, marginTop: 2 }}>
            {[product.category, product.price_tier].filter(Boolean).join(' · ')}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>Last analysed: {formatDate(product.last_scraped_at)}</span>
          <Link href={`/dashboard/products/${product.id}/strategy`} onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: 'var(--sage)', fontWeight: 500, textDecoration: 'none' }}>
            View strategy →
          </Link>
        </div>
      </div>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Not authenticated. Please sign in again.');
        return;
      }
      const data = await api.products.list(session.access_token);
      setProducts(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load products.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return (
    <div className="p-8">
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
        <Link
          href="/dashboard/products/new"
          className="rounded-[6px] font-medium transition-opacity hover:opacity-90"
          style={{ background: 'var(--sage)', color: '#fff', fontSize: 13, padding: '8px 16px' }}
        >
          + Add product
        </Link>
      </div>

      {/* States */}
      {loading && <Spinner />}

      {!loading && error && (
        <p style={{ fontSize: 13, color: 'var(--red)' }}>{error}</p>
      )}

      {!loading && !error && products.length === 0 && <EmptyState />}

      {!loading && !error && products.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          {products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
