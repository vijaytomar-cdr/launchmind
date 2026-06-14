'use client';
/**
 * @file ProductMenu.tsx
 * @description Three-dot overflow menu for product cards on the Products page.
 *   Clicking Archive opens a confirmation dialog before making the API call.
 *   Parent must have position: relative.
 *
 * Usage:
 *   <div style={{ position: 'relative' }}>
 *     ...card content...
 *     <ProductMenu productId={id} productName={name} token={tok} onArchived={refresh} />
 *   </div>
 *
 * @security token passed from parent (fresh Supabase session token).
 * @dependencies api.products.archive
 */

import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';

interface ProductMenuProps {
  productId: string;
  productName: string;
  token: string;
  onArchived: () => void;
}

export function ProductMenu({ productId, productName, token, onArchived }: ProductMenuProps) {
  const [open, setOpen] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleArchive() {
    setLoading(true);
    try {
      await api.products.archive(productId, token);
      setShowArchiveConfirm(false);
      onArchived();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={menuRef} style={{ position: 'absolute', top: 12, right: 12 }}>
      {/* Three-dot trigger */}
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        aria-label="Product options"
        style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '1px solid var(--border2)', background: 'var(--surface)',
          cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--ink2)', transition: 'all .15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--raised)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 32, zIndex: 50,
          background: 'var(--surface)',
          border: '0.5px solid var(--border2)',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          minWidth: 170, overflow: 'hidden',
        }}>
          {[
            {
              icon: <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" /></svg>,
              label: 'View strategy',
              color: 'var(--ink2)',
              onClick: () => { setOpen(false); window.location.href = `/dashboard/products/${productId}/strategy`; },
            },
            {
              icon: <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>,
              label: 'View briefs',
              color: 'var(--ink2)',
              onClick: () => { setOpen(false); window.location.href = '/dashboard/briefs'; },
            },
          ].map((item, i) => (
            <button
              key={i}
              onClick={item.onClick}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '9px 12px',
                background: 'transparent', border: 'none',
                cursor: 'pointer', fontSize: 12,
                color: item.color, fontFamily: 'inherit', textAlign: 'left',
                transition: 'all .1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--raised)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          {/* Separator */}
          <div style={{ height: '0.5px', background: 'var(--border)' }} />

          {/* Archive */}
          <button
            onClick={() => { setOpen(false); setShowArchiveConfirm(true); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '9px 12px',
              background: 'transparent', border: 'none',
              cursor: 'pointer', fontSize: 12,
              color: '#d97706', fontFamily: 'inherit', textAlign: 'left',
              transition: 'all .1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--raised)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            Archive product
          </button>
        </div>
      )}

      {/* Archive confirmation dialog */}
      {showArchiveConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 20, maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="#d97706" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
              Archive {productName}?
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.65, marginBottom: 16 }}>
              This will hide {productName} from your dashboard and pause all active campaigns.
              <br /><br />
              <strong style={{ color: 'var(--ink)' }}>All your data is preserved.</strong> Briefs,
              metrics, campaigns, and content assets stay intact. Restore any time from
              Settings → Products.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowArchiveConfirm(false)}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, border: '0.5px solid var(--border2)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={loading}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, background: 'rgba(217,119,6,0.12)', border: '0.5px solid rgba(217,119,6,0.28)', color: '#d97706', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
              >
                {loading ? 'Archiving...' : 'Archive product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
