/**
 * @file BusinessesTab.tsx
 * @description Settings → Companies. Management, not switching.
 *
 *   "Company" is owner language for a workspace; the tenancy model is unchanged.
 *
 *   Three controls, three distinct roles, deliberately not interchangeable:
 *     top bar   the company switcher — the one primary way to change company
 *     sidebar   passive current-company context
 *     here      seeing everything you own, and adding a new one
 *
 *   Switching is offered here too because it would be perverse to list the
 *   companies and make the owner go elsewhere to pick one — but the top bar
 *   remains the primary control, and both call the same verified endpoint.
 *
 *   ADDING A COMPANY GOES THROUGH GOVERNED ONBOARDING. Never the legacy
 *   /dashboard/products/new wizard: that flow has no concept of a workspace at
 *   all and creates untenanted products, which is what left the original
 *   AllignX rows invisible to every workspace-scoped surface.
 *
 * @security Sends only a company (workspace) id. The server re-verifies membership before
 *   moving the active pointer and answers 404 for anything else.
 * @dependencies GET /businesses, POST /businesses/:id/activate
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Business {
  workspaceId: string;
  name: string;
  productName: string | null;
  platform: string | null;
  markets: string[];
  maturity: string | null;
  isActive: boolean;
}

const MATURITY: Record<string, string> = {
  pre_launch: 'Pre-launch', early: 'Early', growing: 'Live', mature: 'Established',
};

export function BusinessesTab() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Session expired — sign in again.'); return; }
      const res = await fetch('/api/businesses', {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Could not load companies (${res.status})`);
      const body = await res.json() as { businesses: Business[] };
      setBusinesses(body.businesses ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function activate(b: Business) {
    if (b.isActive || switching) return;
    setSwitching(b.workspaceId); setError('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Session expired — sign in again.'); setSwitching(null); return; }
      const res = await fetch(`/api/businesses/${b.workspaceId}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        setError(res.status === 404
          ? 'That company is no longer available to you.'
          : 'Could not switch company.');
        setSwitching(null);
        return;
      }
      await load();
      router.refresh();   // re-scope every server-rendered surface
      setSwitching(null);
    } catch {
      setError('Could not switch company.');
      setSwitching(null);
    }
  }

  const card: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 14, padding: 15,
    background: 'var(--surface)', marginBottom: 10,
  };
  const btn: React.CSSProperties = {
    height: 34, padding: '0 13px', borderRadius: 10, fontSize: 12, fontWeight: 700,
    border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)',
    cursor: 'pointer', fontFamily: 'inherit',
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--ink3)' }} aria-busy="true">Loading companies…</div>;

  return (
    <div>
      {error && (
        <div role="alert" style={{
          ...card, background: 'var(--danger2)', borderColor: 'var(--danger-b)',
          color: 'var(--danger)', fontSize: 13,
        }}>
          {error}
          <button type="button" style={{ ...btn, marginLeft: 10 }} onClick={load}>Retry</button>
        </div>
      )}

      {businesses.length === 0 && !error && (
        <div style={{ ...card, color: 'var(--ink3)', fontSize: 13 }}>
          No companies yet. Add one to get started.
        </div>
      )}

      {businesses.map(b => {
        const meta = [
          b.maturity ? MATURITY[b.maturity] ?? b.maturity : null,
          b.markets?.length
            ? b.markets.map(m => m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(', ')
            : null,
        ].filter(Boolean).join(' · ');

        return (
          <div key={b.workspaceId} style={{
            ...card,
            borderColor: b.isActive ? 'var(--sage-b)' : 'var(--border)',
            display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap',
          }}>
            <div aria-hidden style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)',
              display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13,
            }}>{b.name.charAt(0).toUpperCase()}</div>

            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 750, color: 'var(--ink)' }}>{b.name}</div>
              {b.productName && (
                <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 1 }}>{b.productName}</div>
              )}
              {meta && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>{meta}</div>}
              {b.isActive && (
                /* A word, not just a border colour. */
                <div style={{ fontSize: 11, fontWeight: 750, color: 'var(--sage)', marginTop: 5 }}>
                  ✓ Current company
                </div>
              )}
            </div>

            {!b.isActive && (
              <button type="button" style={btn} disabled={Boolean(switching)}
                onClick={() => activate(b)}>
                {switching === b.workspaceId ? 'Switching…' : 'Switch to this company'}
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => router.push('/onboarding/workspace?add=business')}
        style={{
          height: 40, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 750,
          border: '1px solid var(--sage-b)', background: 'var(--sage-d)', color: 'var(--sage)',
          cursor: 'pointer', fontFamily: 'inherit', marginTop: 4,
        }}
      >
        + Add company
      </button>
      <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8, lineHeight: 1.6 }}>
        Adding a company runs the same guided setup as your first one, so its context,
        boundaries and goals stay separate from every other company you own.
      </p>
    </div>
  );
}
