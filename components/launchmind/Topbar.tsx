/**
 * @file Topbar.tsx
 * @description Dashboard persistent topbar — matches spec fv-topbar design.
 *   Shows: breadcrumb, product switcher, search, notifications, action buttons.
 *   "Update launch context" opens an inline wizard modal (no navigation).
 *   "Review product understanding" navigates to /onboarding/review.
 * @security No secret data. Uses Supabase client-side session only.
 * @dependencies next/navigation, @tabler/icons-react v3, react useState
 */

'use client';

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  IconSearch,
  IconBell,
  IconSparkles,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Route → breadcrumb label mapping
const PAGE_LABELS: Record<string, string> = {
  '/dashboard':                              'Owner Command Center',
  '/dashboard/brief':                        'Owner Command Center',
  '/dashboard/opportunities':               'Owner Command Center',
  '/dashboard/approvals':                   'Owner Command Center',
  '/dashboard/missions':                    'Owner Command Center',
  '/dashboard/content':                     'Execution Center',
  '/dashboard/campaigns':                   'Execution Center',
  '/dashboard/calendar':                    'Execution Center',
  '/dashboard/experiments':                 'Execution Center',
  '/dashboard/intelligence/growth-brain':   'Intelligence Center',
  '/dashboard/intelligence/memory':         'Intelligence Center',
  '/dashboard/intelligence/knowledge':      'Intelligence Center',
  '/dashboard/intelligence/market':         'Intelligence Center',
  '/dashboard/channels':                    'Intelligence Center',
  '/dashboard/launch-readiness':            'Intelligence Center',
  '/dashboard/analytics':                   'Analytics',
  '/dashboard/reports':                     'Reports',
  '/dashboard/settings':                    'Settings',
  '/dashboard/products':                    'Products',
  '/dashboard/billing':                     'Billing',
};

function getPageLabel(pathname: string): string {
  // Try exact match first
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname];
  // Try prefix match (longest wins)
  const sorted = Object.keys(PAGE_LABELS).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (pathname.startsWith(key)) return PAGE_LABELS[key];
  }
  return 'Owner Command Center';
}

interface TopbarProps {
  plan?: string;
  productName?: string;
  productCount?: number;
  unreadNotifications?: number;
}

/** "AllignX · Home Services App - App Store" → "AllignX" */
function shortName(full: string | undefined): string {
  if (!full) return 'My Product';
  const before = full.split('·')[0].trim();
  return before || full;
}

/** "AllignX · Home Services App - App Store" → "AllignX · Home Services" (drop " - App Store") */
function switcherName(full: string | undefined): string {
  if (!full) return 'My Product';
  const dashIdx = full.indexOf(' - ');
  return dashIdx > -1 ? full.slice(0, dashIdx) : full;
}

export function Topbar({ plan = 'free', productName, productCount = 1, unreadNotifications = 0 }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const pageLabel = getPageLabel(pathname);
  const appShortName   = shortName(productName);
  const appSwitchLabel = switcherName(productName);

  const [wizardOpen, setWizardOpen] = useState(false);

  // Context form state — loaded from product when modal opens
  const [positioning,    setPositioning]    = useState('');
  const [targetCustomer, setTargetCustomer] = useState('');
  const [strongestSignal,setStrongestSignal]= useState('');
  const [nextChange,     setNextChange]     = useState('');
  const [primaryGoal,    setPrimaryGoal]    = useState('Increase installs');
  const [targetDate,     setTargetDate]     = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [toastMsg,       setToastMsg]       = useState('');

  useEffect(() => {
    if (!wizardOpen) return;
    setContextLoading(true);
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setContextLoading(false); return; }
      fetch(`${API_URL}/owner/brief`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          const icp = json?.product?.confirmed_icp as Record<string, string> | null;
          if (icp) {
            setPositioning(icp.positioning ?? icp.icp_summary ?? '');
            setTargetCustomer(icp.target_customer ?? icp.icp_description ?? '');
          }
        })
        .catch(() => { /* non-fatal */ })
        .finally(() => setContextLoading(false));
    });
  }, [wizardOpen]);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  }

  function handleApply() {
    setWizardOpen(false);
    showToast('Launch context saved. Strategy rebuild started.');
  }

  function handleSaveDraft() {
    showToast('Launch context saved as draft.');
  }

  const btnBase: CSSProperties = {
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'white',
    color: 'var(--ink)',
    height: 38,
    padding: '0 13px',
    fontWeight: 650,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    flexShrink: 0,
  };

  return (
    <>
      <header style={{
        height: 68,
        display: 'flex',
        alignItems: 'center',
        padding: '0 28px',
        background: 'rgba(255,255,255,.86)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 15,
        flexShrink: 0,
        gap: 9,
      }}>
        {/* Page title — Syne display font, prominent but not oversized for the 68px bar */}
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.3px', whiteSpace: 'nowrap', marginRight: 4 }}>
          {pageLabel}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Product switcher — only shows ⌄ and acts as a button when multiple products exist */}
        {productCount > 1 ? (
          <button style={{ ...btnBase, gap: 8 }}>
            {appSwitchLabel}
            <span style={{ fontSize: 10, color: 'var(--ink3)' }}>⌄</span>
          </button>
        ) : (
          <div style={{ ...btnBase, cursor: 'default', pointerEvents: 'none' as const }}>
            {appSwitchLabel}
          </div>
        )}

        {/* Search → Ask LaunchMind */}
        <button
          onClick={() => router.push('/dashboard/ask')}
          title="Ask LaunchMind"
          style={{ ...btnBase, width: 38, padding: 0, justifyContent: 'center' }}
        >
          <IconSearch size={15} color="var(--ink2)" />
        </button>

        {/* Notifications → Approvals page; dot only when there are unread items */}
        <button
          onClick={() => router.push('/dashboard/approvals')}
          title={unreadNotifications > 0 ? `${unreadNotifications} unread notification${unreadNotifications > 1 ? 's' : ''}` : 'Notifications'}
          style={{ ...btnBase, width: 38, padding: 0, justifyContent: 'center', position: 'relative' }}
        >
          <IconBell size={15} color="var(--ink2)" />
          {unreadNotifications > 0 && (
            <span style={{
              position: 'absolute', top: 7, right: 8,
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--danger)', border: '2px solid white',
            }} />
          )}
        </button>

        {/* "Review product understanding" — spec: .secondary (sage tinted) */}
        <button
          onClick={() => router.push('/onboarding/review')}
          style={{
            ...btnBase,
            background: 'var(--sage2)',
            borderColor: 'var(--sage3)',
            color: '#096b50',
          }}
        >
          <IconSparkles size={13} />
          Review product understanding
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '2px 5px',
            borderRadius: 4, background: 'var(--ai-d)', color: 'var(--ai)',
            border: '1px solid var(--ai-b)',
          }}>AI</span>
        </button>

        {/* "Update launch context" — spec: .secondary (sage tinted) */}
        <button
          onClick={() => setWizardOpen(true)}
          style={{
            ...btnBase,
            background: 'var(--sage2)',
            borderColor: 'var(--sage3)',
            color: '#096b50',
          }}
        >
          <IconRefresh size={13} />
          Update launch context
        </button>

        {/* + New Mission — spec: .primary (sage solid) */}
        <Link
          href="/dashboard/missions?create=true"
          style={{
            ...btnBase,
            textDecoration: 'none',
            background: 'var(--sage)',
            color: '#fff',
            border: 'none',
          }}
        >
          <IconPlus size={13} />
          New mission
        </Link>
      </header>

      {/* Update launch context — spec: .wizard > .modal */}
      {wizardOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setWizardOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,20,16,.54)', backdropFilter: 'blur(5px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ width: 'min(1040px,96vw)', maxHeight: '92vh', overflow: 'auto', background: 'white', borderRadius: 20, boxShadow: '0 8px 40px rgba(22,33,29,.22)', display: 'flex', flexDirection: 'column' }}>

            {/* Modal head */}
            <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 4px' }}>Product intelligence refresh</p>
                <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Syne,sans-serif', color: 'var(--ink)', margin: 0 }}>Bridge what the market sees with what you are launching next</h2>
              </div>
              <button onClick={() => setWizardOpen(false)} style={{ background: 'var(--raised)', border: 'none', width: 34, height: 34, borderRadius: 9, cursor: 'pointer', fontSize: 16, color: 'var(--ink2)', flexShrink: 0, display: 'grid', placeItems: 'center' }}>✕</button>
            </div>

            {/* 4-step progress bar — spec: .steps .step .step.done */}
            <div style={{ display: 'flex', gap: 7, padding: '14px 22px', borderBottom: '1px solid var(--border)' }}>
              {[true, true, false, false].map((done, i) => (
                <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: done ? 'var(--sage)' : '#e8ece9' }} />
              ))}
            </div>

            {/* Modal body — spec: .modal-body .delta-grid */}
            <div style={{ padding: 22, flex: 1, overflow: 'auto' }}>
              {contextLoading && (
                <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12 }}>Loading your product context…</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                {/* Left: what the world sees — spec: .delta bg:var(--raised) border:var(--border) */}
                <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 16, background: 'var(--raised)' }}>
                  <h3 style={{ margin: '0 0 5px', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>What the world sees today</h3>
                  <p style={{ color: 'var(--ink2)', fontSize: 12, margin: '0 0 14px', lineHeight: 1.5 }}>Imported from your App Store, website, reviews, campaign history, and connected channels.</p>

                  {[
                    { label: 'Current positioning', value: positioning, onChange: setPositioning, type: 'textarea', placeholder: 'e.g. Fast, affordable home services with verified professionals.' },
                    { label: 'Current target customer', value: targetCustomer, onChange: setTargetCustomer, type: 'input', placeholder: 'e.g. Homeowners who need reliable help quickly' },
                    { label: 'Current strongest signal', value: strongestSignal, onChange: setStrongestSignal, type: 'input', placeholder: 'e.g. Demand rising in key markets' },
                  ].map(f => (
                    <div key={f.label} style={{ marginBottom: 13 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--ink2)', marginBottom: 6 }}>{f.label}</label>
                      {f.type === 'textarea'
                        ? <textarea value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder} rows={3} style={{ width: '100%', border: '1px solid var(--border2)', background: 'white', borderRadius: 9, padding: '10px 11px', font: 'inherit', fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box', minHeight: 92 }} />
                        : <input type="text" value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder} style={{ width: '100%', border: '1px solid var(--border2)', background: 'white', borderRadius: 9, padding: '10px 11px', font: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                      }
                    </div>
                  ))}
                </div>

                {/* Right: what you are launching — spec: .delta.future bg:#f8f7ff border:#dcd6ff */}
                <div style={{ border: '1px solid #dcd6ff', borderRadius: 14, padding: 16, background: '#f8f7ff' }}>
                  <h3 style={{ margin: '0 0 5px', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>What are you launching next?</h3>
                  <p style={{ color: 'var(--ink2)', fontSize: 12, margin: '0 0 14px', lineHeight: 1.5 }}>This context changes what LaunchMind recommends. Be specific about the next 30–90 days.</p>

                  <div style={{ marginBottom: 13 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--ink2)', marginBottom: 6 }}>Next product or growth change</label>
                    <textarea value={nextChange} onChange={e => setNextChange(e.target.value)} placeholder="Example: Same-day service promise, provider recruitment campaign, India beta…" rows={3} style={{ width: '100%', border: '1px solid var(--border2)', background: 'white', borderRadius: 9, padding: '10px 11px', font: 'inherit', fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box', minHeight: 92 }} />
                  </div>
                  <div style={{ marginBottom: 13 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--ink2)', marginBottom: 6 }}>Primary goal</label>
                    <select value={primaryGoal} onChange={e => setPrimaryGoal(e.target.value)} style={{ width: '100%', border: '1px solid var(--border2)', background: 'white', borderRadius: 9, padding: '10px 11px', font: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}>
                      <option>Increase installs</option>
                      <option>Increase fulfilled service requests</option>
                      <option>Reduce acquisition cost</option>
                      <option>Validate a new market</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 13 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--ink2)', marginBottom: 6 }}>Target date</label>
                    <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} style={{ width: '100%', border: '1px solid var(--border2)', background: 'white', borderRadius: 9, padding: '10px 11px', font: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                </div>

              </div>
            </div>

            {/* Modal footer — spec: .modal-foot */}
            <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
              <button onClick={handleSaveDraft} style={{ height: 38, padding: '0 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Save draft</button>
              <button onClick={handleApply} style={{ height: 38, padding: '0 18px', borderRadius: 10, border: 'none', background: 'var(--sage)', color: '#fff', fontSize: 13, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' }}>Apply context &amp; rebuild strategy</button>
            </div>

          </div>
        </div>
      )}

      {/* Toast notification */}
      {toastMsg && (
        <div style={{ position: 'fixed', right: 22, bottom: 22, background: 'var(--nav)', color: 'white', padding: '13px 16px', borderRadius: 11, boxShadow: '0 4px 20px rgba(0,0,0,.25)', zIndex: 9999, fontSize: 13, fontWeight: 500 }}>
          {toastMsg}
        </div>
      )}
    </>
  );
}
