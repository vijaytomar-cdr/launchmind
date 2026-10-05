/**
 * @file app/(dashboard)/dashboard/intelligence/content/create/page.tsx
 * @description "Create something else" — the owner-directed content path (B5).
 *
 *   The obvious version of this screen is a prompt box wired to a generator.
 *   That is what it deliberately is not. The owner speaks in marketing terms —
 *   what they want people to understand — and LaunchMind answers with its
 *   INTERPRETATION first: objective, audience, message, the product's role, why
 *   it fits this application, what it would create, and what it still needs.
 *   Only after the owner accepts that does anything get written.
 *
 *   THE TRUTH BOUNDARY, stated on screen rather than enforced silently:
 *   an owner may ask for a claim LaunchMind cannot substantiate. LaunchMind will
 *   understand the request and say plainly that it cannot treat it as proof.
 *   Typing a number does not make it evidence, and the interpretation says so
 *   before the owner spends any time on content built around it.
 *
 *   No model, provider, temperature, prompt, JSON or format field appears here.
 *
 * @security Interpretation writes nothing. The candidate returned by the server
 *   is echoed back on accept and REVALIDATED there against the evidence refs
 *   actually issued for this product, so the browser cannot widen what a
 *   campaign claims to be supported by.
 * @dependencies lib/api (contentIntelligence.ownerDirected), PageShell, Button
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type OwnerDirectedInterpretation } from '@/lib/api';
import { PageShell } from '@/components/launchmind/PageShell';
import { Button } from '@/components/launchmind/Button';
import { PageLoading } from '@/components/launchmind/LoadingState';
import { ErrorState } from '@/components/launchmind/ErrorState';

const SUGGESTIONS = [
  'Promote a new feature',
  'Explain an important product benefit',
  'Create messaging for an announcement',
  'Build a campaign around a launch',
  'Help people understand why this product is different',
];

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 14, padding: 20,
};
const eyebrow: React.CSSProperties = {
  fontSize: 10, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase',
  color: 'var(--ink3)', marginBottom: 6,
};

function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={eyebrow}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

export default function OwnerDirectedPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [interp, setInterp] = useState<OwnerDirectedInterpretation | null>(null);
  const [busy, setBusy] = useState<null | 'interpret' | 'apply'>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login?next=/dashboard/intelligence/content/create'); return; }
      setToken(session.access_token);
      // Product comes from the same owner-safe read model the decision surface
      // uses, so both screens agree on which application is in scope.
      const v = await api.contentIntelligence.get(session.access_token);
      if (!v.product) { setLoadError('Add an application before creating content.'); return; }
      setProductId(v.product.id);
      setProductName(v.product.name);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this.');
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function interpret(request: string) {
    if (!token || !productId) return;
    setBusy('interpret'); setError(null);
    try {
      const res = await api.contentIntelligence.ownerDirected(
        { productId, mode: 'interpret', request }, token);
      if (!res.interpretation) { setError('I could not work that out.'); return; }
      setInterp(res.interpretation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'I could not work that out.');
    } finally { setBusy(null); }
  }

  async function accept() {
    if (!token || !productId || !interp) return;
    setBusy('apply'); setError(null);
    try {
      const res = await api.contentIntelligence.ownerDirected(
        { productId, mode: 'apply', request: interp.request, candidate: interp.candidate }, token);
      if (res.campaignId) { router.push('/dashboard/intelligence/content'); return; }
      setError('I could not save that.');
      setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'I could not save that.');
      setBusy(null);
    }
  }

  if (loading) return <PageShell title="Create something else"><PageLoading /></PageShell>;
  if (loadError) {
    return (
      <PageShell title="Create something else">
        <ErrorState message={loadError} onRetry={() => void load()} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Create something else"
      description={productName ? `For ${productName}` : undefined}>
      <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>

        {/* ── The ask ──────────────────────────────────────────────────── */}
        <section style={card} aria-labelledby="od-ask">
          <h2 id="od-ask" style={{ fontFamily: 'var(--font-syne)', fontSize: 20, fontWeight: 700,
            color: 'var(--ink)', margin: '0 0 4px' }}>
            What would you like LaunchMind to help market?
          </h2>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 14px' }}>
            Say it the way you would say it to a colleague.
          </p>

          <label htmlFor="od-input" style={{ ...eyebrow, display: 'block' }}>Your request</label>
          <textarea id="od-input" rows={3} value={text}
            onChange={e => { setInterp(null); setText(e.target.value); }}
            style={{
              width: '100%', background: 'var(--raised)', border: '1px solid var(--border2)',
              borderRadius: 9, padding: '10px 12px', fontSize: 14, color: 'var(--ink)',
              fontFamily: 'inherit', resize: 'vertical',
            }}
            placeholder="We just shipped scheduled reports and nobody knows about it." />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} type="button"
                onClick={() => { setInterp(null); setText(s); }}
                style={{
                  padding: '7px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--ink2)', fontFamily: 'inherit',
                }}>
                {s}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '14px 0 0' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <Button onClick={() => void interpret(text)}
              disabled={busy !== null || text.trim().length < 4}>
              {busy === 'interpret' ? 'Working it out…' : 'Continue'}
            </Button>
            <Button variant="ghost" disabled={busy !== null}
              onClick={() => router.push('/dashboard/intelligence/content')}>
              Cancel
            </Button>
          </div>
        </section>

        {/* ── The interpretation, before anything is created ────────────── */}
        {interp && (
          <section style={card} aria-labelledby="od-understood">
            <div style={{ ...eyebrow, color: 'var(--sage)' }}>Here&rsquo;s what I understood</div>
            <h2 id="od-understood" style={{ fontFamily: 'var(--font-syne)', fontSize: 18,
              fontWeight: 700, color: 'var(--ink)', margin: '8px 0 14px' }}>
              {interp.message}
            </h2>

            <div style={{ display: 'grid', gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
              <Fact title="Objective">{interp.objective}</Fact>
              <Fact title="Audience">{interp.audience}</Fact>
              <Fact title="Your product&rsquo;s role">{interp.productRole}</Fact>
            </div>

            {interp.whyThisFits.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={eyebrow}>Why this fits your application</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
                  {interp.whyThisFits.map(w => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}

            {interp.recommends.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={eyebrow}>What I recommend creating</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
                  {interp.recommends.map(r => (
                    <li key={r.channel}>{r.label} — {r.why}</li>
                  ))}
                </ul>
              </div>
            )}

            {interp.stillNeeds.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={eyebrow}>What I still need from you</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
                  {interp.stillNeeds.map(n => <li key={n}>{n}</li>)}
                </ul>
              </div>
            )}

            {/* The owner asked for something LaunchMind cannot substantiate.
                Said here, before any work is built on top of it. */}
            {interp.cannotProve.length > 0 && (
              <div style={{
                marginTop: 16, padding: 13, borderRadius: 10,
                background: 'var(--amber2)', border: '1px solid #f2d29f', color: '#7d4306',
              }}>
                {interp.cannotProve.map(c => (
                  <p key={c} style={{ fontSize: 13, margin: '0 0 4px' }}>{c}</p>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              <Button onClick={() => void accept()} disabled={busy !== null}>
                {busy === 'apply' ? 'Setting it up…' : 'Continue'}
              </Button>
              <Button variant="ghost" onClick={() => setInterp(null)} disabled={busy !== null}>
                Adjust
              </Button>
              <Button variant="ghost" disabled={busy !== null}
                onClick={() => router.push('/dashboard/intelligence/content')}>
                Cancel
              </Button>
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}
