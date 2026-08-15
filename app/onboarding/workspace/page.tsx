/**
 * @file app/onboarding/workspace/page.tsx
 * @description Phase 1 Step 2: Workspace setup. Matches fv-step[2] from spec.
 * @security Session fetched fresh on every action to prevent stale JWT.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

const ROLES  = ['Founder / Owner', 'Marketing leader', 'Product leader', 'Agency'];
const STAGES = ['Live product', 'Pre-launch', 'Private beta', 'Idea stage'];

/**
 * G3 — the existing stage selector already asked this question; its answer was
 * only ever written to sessionStorage, so LaunchMind could never record whether
 * a product was pre-launch or mature. That WAS the gap: the UI asked and the
 * database forgot.
 *
 * Everything before a public launch collapses to `pre_launch` — the distinction
 * that changes marketing reasoning is whether outcome history EXISTS, and a
 * private beta has none. A live product then needs one extra question, because
 * "live" spans a first week and a third year.
 */
const STAGE_TO_MATURITY: Record<string, string | null> = {
  'Pre-launch':   'pre_launch',
  'Private beta': 'pre_launch',
  'Idea stage':   'pre_launch',
  'Live product': null,          // ask which kind
};
const LIVE_MATURITIES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'early',   label: 'Early',   hint: 'Launched recently, little marketing history' },
  { id: 'growing', label: 'Growing', hint: 'Running marketing, some results to learn from' },
  { id: 'mature',  label: 'Mature',  hint: 'Established channels and a track record' },
];

const field: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
};
const label: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--ink2)',
};
const input: React.CSSProperties = {
  height: 40, border: '1px solid var(--border2)', borderRadius: 9,
  padding: '0 11px', fontSize: 14, color: 'var(--ink)',
  background: 'white', outline: 'none', fontFamily: 'inherit',
};
const select: React.CSSProperties = {
  ...input, cursor: 'pointer',
};

export default function WorkspacePage() {
  const router = useRouter();
  const [name, setName]     = useState('');
  const [role, setRole]     = useState(ROLES[0]);
  const [stg, setStg]       = useState(STAGES[0]);
  const [sessionId, setId]  = useState('');
  const [liveMaturity, setLiveMaturity] = useState('early');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login?next=/onboarding/workspace'); return; }
      try {
        const res = await api.onboarding.getSession(session.access_token);
        const id = res?.session?.id ?? '';
        setId(id);
        if (id) sessionStorage.setItem('onboarding_session_id', id);
      } catch { /* session created on submit */ }
    })();
  }, [router]);

  async function submit(workspaceName: string, workspaceRole: string, workspaceStage: string) {
    if (saving) return;
    setSaving(true); setError('');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login?next=/onboarding/workspace'); return; }
    try {
      let sid = sessionId;
      if (!sid) {
        const r = await api.onboarding.getSession(session.access_token);
        sid = r?.session?.id ?? '';
        setId(sid);
        if (sid) sessionStorage.setItem('onboarding_session_id', sid);
      }
      const maturity = STAGE_TO_MATURITY[workspaceStage] ?? liveMaturity;
      await api.onboarding.saveWorkspace(sid, workspaceName, session.access_token, maturity);
      sessionStorage.setItem('onboarding_workspace_meta', JSON.stringify({ workspaceName, role: workspaceRole, stage: workspaceStage }));
      router.push('/onboarding/discovery');
    } catch (e) {
      setError((e as Error).message ?? 'Something went wrong — please try again.');
      setSaving(false);
    }
  }

  function handleContinue() {
    if (!name.trim()) return;
    void submit(name.trim(), role, stg);
  }

  function handleUseDefaults() {
    void submit('My Workspace', ROLES[0], STAGES[0]);
  }

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 850, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--sage)', marginBottom: 11 }}>
        Workspace created
      </div>
      <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 30, letterSpacing: '-1px', margin: '0 0 9px', color: 'var(--ink)' }}>
        Tell us what you are building.
      </h2>
      <p style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 26px' }}>
        This names your private workspace. LaunchMind will discover the product details in the next step.
      </p>

      {/* Form grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
        {/* Workspace name */}
        <div style={field}>
          <label style={label}>Workspace name</label>
          <input
            style={input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. ClientPulse Growth"
            maxLength={80}
            autoFocus
            onFocus={e => { e.target.style.borderColor = 'var(--sage)'; e.target.style.boxShadow = '0 0 0 3px var(--sage-d)'; }}
            onBlur={e => { e.target.style.borderColor = 'var(--border2)'; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        {/* Role */}
        <div style={field}>
          <label style={label}>Your role</label>
          <select style={select} value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>

        {/* Product stage — full width */}
        <div style={{ ...field, gridColumn: '1 / -1' }}>
          <label style={label}>Product stage</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
            {STAGES.map(s => (
              <button
                key={s}
                onClick={() => setStg(s)}
                style={{
                  padding: '10px 7px', borderRadius: 9, fontSize: 11,
                  cursor: 'pointer', fontFamily: 'inherit',
                  border: '1px solid ' + (stg === s ? 'var(--sage3)' : 'var(--border)'),
                  background: stg === s ? 'var(--sage2)' : 'white',
                  color: stg === s ? '#087253' : 'var(--ink)',
                  fontWeight: stg === s ? 750 : 400,
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* G3 — "Live product" spans a first week and a third year, and those
              need different marketing caution. One extra question only when it
              is actually ambiguous. */}
          {stg === 'Live product' && (
            <div style={{ marginTop: 10 }}>
              <label style={label}>How established is your marketing?</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                {LIVE_MATURITIES.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setLiveMaturity(m.id)}
                    title={m.hint}
                    style={{
                      padding: '10px 7px', borderRadius: 9, fontSize: 11,
                      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                      border: '1px solid ' + (liveMaturity === m.id ? 'var(--sage3)' : 'var(--border)'),
                      background: liveMaturity === m.id ? 'var(--sage2)' : 'white',
                      color: liveMaturity === m.id ? '#087253' : 'var(--ink)',
                      fontWeight: liveMaturity === m.id ? 750 : 400,
                    }}
                  >
                    <b style={{ display: 'block' }}>{m.label}</b>
                    <span style={{ color: 'var(--ink3)', fontSize: 10 }}>{m.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info notice */}
      <div style={{ display: 'flex', gap: 10, borderRadius: 11, padding: '12px 13px', marginTop: 16, background: 'var(--blue2)', border: '1px solid #cfe0fa' }}>
        <span style={{ width: 23, height: 23, borderRadius: 7, display: 'grid', placeItems: 'center', flexShrink: 0, fontWeight: 850, background: 'white', color: 'var(--blue)' }}>i</span>
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          <b>Your workspace is private by default.</b> Team invitations and shared access can be configured later.
        </p>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '10px 13px', borderRadius: 9, background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 }}>
        <button
          onClick={handleUseDefaults}
          disabled={saving}
          style={{ border: 0, background: 'none', color: 'var(--ink3)', fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontSize: 13, opacity: saving ? 0.5 : 1 }}
        >
          Use defaults
        </button>
        <button
          onClick={handleContinue}
          disabled={!name.trim() || saving}
          style={{
            height: 40, padding: '0 20px', borderRadius: 10, border: 'none',
            background: !name.trim() || saving ? 'var(--raised)' : 'var(--sage)',
            color: !name.trim() || saving ? 'var(--ink3)' : 'white',
            fontWeight: 600, fontSize: 14, cursor: !name.trim() || saving ? 'default' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : 'Continue →'}
        </button>
      </div>
    </>
  );
}
