/**
 * @file app/onboarding/beliefs/page.tsx
 * @description Phase 1 Step 7: Belief review.
 *   Matches fv-step[7] from LaunchMind_Production_UX_July18_2026(15).html.
 *   Shows belief-list with FACT (blue) and ASSUMPTION (amber) badges.
 *   Inline belief-editor opens below the edited row.
 * @security Requires auth — middleware enforces it.
 * @dependencies api.onboarding.getClaims, reviewClaim, completeBeliefReview
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type ProductClaim } from '@/lib/api';

/** Map claim_type to spec badge appearance */
function claimMeta(type: ProductClaim['claim_type']): { label: string; isAssumption: boolean } {
  if (type === 'FACT')             return { label: 'FACT',       isAssumption: false };
  if (type === 'INFERENCE')        return { label: 'ASSUMPTION', isAssumption: true };
  if (type === 'FOUNDER_PROVIDED') return { label: 'FACT',       isAssumption: false };
  return { label: 'ASSUMPTION', isAssumption: true };
}

/** Spec button style helpers */
const btnPrimary: React.CSSProperties = {
  height: 38, borderRadius: 10, border: '1px solid var(--sage)',
  background: 'var(--sage)', color: '#fff', padding: '0 13px',
  fontWeight: 650, cursor: 'pointer', fontSize: 14,
};
const btnSecondary: React.CSSProperties = {
  height: 38, borderRadius: 10, border: '1px solid var(--sage3)',
  background: 'var(--sage2)', color: '#096b50', padding: '0 13px',
  fontWeight: 650, cursor: 'pointer', fontSize: 14,
};
const btnSkip: React.CSSProperties = {
  border: 0, background: 'none', color: 'var(--ink3)',
  fontWeight: 700, cursor: 'pointer', fontSize: 14, padding: 0,
};

export default function BeliefsPage() {
  const router = useRouter();
  const [claims, setClaims]         = useState<ProductClaim[]>([]);
  const [loading, setLoading]       = useState(true);
  const [sessionId, setSessionId]   = useState('');
  const [editing, setEditing]       = useState<string | null>(null);
  const [editText, setEditText]     = useState('');
  const [saving, setSaving]         = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [regenerating, setRegen]    = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/beliefs'); return; }
      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) { router.replace('/onboarding'); return; }
      setSessionId(sid);
      try {
        const r = await api.onboarding.getClaims(sid, session.access_token);
        setClaims((r?.claims ?? []).sort((a, b) => a.display_order - b.display_order));
      } catch { /* show empty state */ }
      finally { setLoading(false); }
    }
    load();
    // router is an imperative API (navigation only), not reactive data — effect runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCorrection(claimId: string) {
    if (!editText.trim()) return;
    setSaving(claimId);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(null); return; }
    try {
      const r = await api.onboarding.reviewClaim(sessionId, claimId, { status: 'CORRECTED', correctedValue: editText.trim() }, session.access_token);
      const updated = r?.claim;
      if (updated) setClaims(prev => prev.map(c => c.id === claimId ? { ...c, ...updated } : c));
      setEditing(null);
    } finally { setSaving(null); }
  }

  async function regenerate() {
    if (regenerating || !sessionId) return;
    setRegen(true); setError('');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setRegen(false); return; }
    try {
      await api.onboarding.regenerateClaims(sessionId, session.access_token);
      const r = await api.onboarding.getClaims(sessionId, session.access_token);
      setClaims((r?.claims ?? []).sort((a, b) => a.display_order - b.display_order));
      if ((r?.claims ?? []).length === 0) setError('No beliefs could be extracted from your discovery data.');
    } catch (e) {
      setError((e as Error).message ?? 'Could not regenerate — try again.');
    } finally { setRegen(false); }
  }

  async function complete() {
    if (submitting) return;
    setSubmitting(true); setError('');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError('Your session expired — please refresh the page.');
      setSubmitting(false); return;
    }
    try {
      await api.onboarding.completeBeliefReview(sessionId, session.access_token);
      router.push('/onboarding/audience');
    } catch (e) {
      setError((e as Error).message ?? 'Could not save — please try again.');
      setSubmitting(false);
    }
  }

  /* ── Loading ─────────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--ink3)' }}>Loading beliefs…</div>
      </div>
    );
  }

  return (
    <div>
      {/* .fv-kicker */}
      <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)' }}>
        Review what LaunchMind believes
      </div>

      {/* h2 */}
      <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 30, letterSpacing: '-1px', margin: '11px 0 9px', color: 'var(--ink)' }}>
        Confirm the foundation before we build on it.
      </h2>

      {/* .lead */}
      <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
        Facts came from public evidence. Assumptions are highlighted and can be corrected now or later.
      </p>

      {/* Empty state */}
      {claims.length === 0 && (
        <div style={{ padding: '16px 18px', borderRadius: 11, background: 'var(--raised)', border: '1px solid var(--border)', marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 10 }}>
            No beliefs generated yet. This can happen when scraping finds limited data. You can regenerate from your discovery results or continue without beliefs.
          </div>
          <button
            onClick={regenerate}
            disabled={regenerating}
            style={{
              height: 34, borderRadius: 9, border: '1px solid var(--sage3)',
              background: 'var(--sage2)', color: '#096b50', padding: '0 13px',
              fontWeight: 650, cursor: regenerating ? 'not-allowed' : 'pointer', fontSize: 13,
              opacity: regenerating ? 0.6 : 1,
            }}
          >
            {regenerating ? 'Regenerating…' : '↻ Regenerate from discovery data'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 13px', borderRadius: 9, background: 'var(--danger2)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* .belief-list */}
      <div style={{ display: 'grid', gap: 9, marginBottom: 20 }}>
        {claims.map(claim => {
          const { label, isAssumption } = claimMeta(claim.claim_type);
          const isEditing = editing === claim.id;
          const isSaving  = saving === claim.id;
          const hasCorrected = claim.status === 'CORRECTED' && claim.corrected_value;

          return (
            <div key={claim.id}>
              {/* .belief-row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '88px 1fr auto',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                border: `1px solid ${hasCorrected ? 'var(--sage3)' : 'var(--border)'}`,
                borderRadius: 11,
                background: hasCorrected ? 'var(--sage2)' : 'white',
                opacity: isSaving ? 0.7 : 1,
                transition: 'opacity .15s',
              }}>
                {/* .belief-type badge */}
                <span style={{
                  fontSize: 9, fontWeight: 850, padding: '5px 7px',
                  borderRadius: 999, textAlign: 'center',
                  background: isAssumption ? 'var(--amber2)' : 'var(--blue2)',
                  color: isAssumption ? 'var(--amber)' : 'var(--blue)',
                  display: 'inline-block',
                }}>
                  {label}
                </span>

                {/* Claim content */}
                <div>
                  <b style={{ fontSize: 13, color: 'var(--ink)', display: 'block' }}>
                    {claim.title}
                  </b>
                  <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 11 }}>
                    {hasCorrected ? claim.corrected_value : claim.body}
                  </p>
                </div>

                {/* Edit / Correct button */}
                {!isEditing && (
                  <button
                    onClick={() => {
                      setEditing(claim.id);
                      setEditText(claim.corrected_value ?? claim.body);
                    }}
                    style={{
                      height: 30, borderRadius: 8, border: '1px solid var(--border)',
                      background: 'white', color: 'var(--ink2)', padding: '0 9px',
                      fontWeight: 650, cursor: 'pointer', fontSize: 11, flexShrink: 0,
                    }}
                  >
                    {isAssumption ? 'Correct' : 'Edit'}
                  </button>
                )}
                {isEditing && (
                  <span style={{ fontSize: 11, color: 'var(--ink3)' }}>Editing…</span>
                )}
              </div>

              {/* .belief-editor (inline below this row, open when isEditing) */}
              {isEditing && (
                <div style={{
                  display: 'grid', gap: 8,
                  padding: 12,
                  border: '1px solid var(--sage3)',
                  background: '#f8fffb',
                  borderRadius: 11,
                  marginTop: 6,
                }}>
                  <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink2)' }}>
                    Correction
                  </label>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    autoFocus
                    style={{
                      minHeight: 70, border: '1px solid var(--border2)',
                      borderRadius: 9, padding: 10, resize: 'vertical',
                      fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
                      outline: 'none', background: 'white', color: 'var(--ink)',
                      width: '100%', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                      onClick={() => setEditing(null)}
                      style={{ ...btnSecondary, height: 34, fontSize: 12 }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveCorrection(claim.id)}
                      disabled={!editText.trim() || isSaving}
                      style={{
                        ...btnPrimary,
                        height: 34, fontSize: 12,
                        cursor: !editText.trim() || isSaving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isSaving ? 'Saving…' : 'Save correction'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* .report-actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={complete} disabled={submitting} style={btnSkip}>
          Review later
        </button>
        <button
          onClick={complete}
          disabled={submitting}
          style={{ ...btnPrimary, cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? 'Saving…' : 'Everything else looks right →'}
        </button>
      </div>
    </div>
  );
}
