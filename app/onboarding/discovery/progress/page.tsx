/**
 * @file app/onboarding/discovery/progress/page.tsx
 * @description Phase 1 Step 4: Discovery scanning screen. Matches fv-step[4] from spec.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

const SCAN_ITEMS = [
  'Product, category, pricing, and positioning',
  'Screenshots, reviews, and release signals',
  'Likely audience, use cases, and competitors',
  'Prioritizing the first growth opportunity',
];

export default function DiscoveryProgressPage() {
  const router  = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sessionId, setId] = useState('');
  const [progress, setProg] = useState(0);
  const [doneItems, setDone] = useState(0);
  const [statusText, setStatus] = useState('Reading your product\'s public signals…');
  const [error, setError]  = useState('');
  const [initial, setInitial] = useState('A');

  useEffect(() => {
    // mounted flag prevents the leaked-interval bug in React 18 Strict Mode:
    // Strict Mode runs cleanup before the async init() finishes, so timerRef.current
    // is still null when cleanup fires. Without this flag a second interval is created
    // on remount and is never cleaned up, causing an infinite navigation loop.
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !mounted) { if (!session) router.replace('/login'); return; }
      let sid = '';
      try {
        const stored = sessionStorage.getItem('onboarding_session_id');
        if (stored) { sid = stored; } else {
          const res = await api.onboarding.getSession(session.access_token);
          sid = res?.session?.id ?? '';
          if (sid) sessionStorage.setItem('onboarding_session_id', sid);
        }
        setId(sid);
        const meta = sessionStorage.getItem('onboarding_workspace_meta');
        if (meta) {
          try {
            const { workspaceName } = JSON.parse(meta) as { workspaceName?: string };
            if (workspaceName) setInitial(workspaceName[0].toUpperCase());
          } catch { /* keep default */ }
        }
      } catch { /* ignore */ }

      // Guard: if Strict Mode cleanup already ran, don't start polling
      if (!mounted) return;

      interval = setInterval(async () => {
        if (!mounted) { clearInterval(interval!); return; }
        try {
          const supabase2 = createClient();
          const { data: { session: freshSession } } = await supabase2.auth.getSession();
          if (!freshSession) return;
          const res = await api.onboarding.getDiscovery(sid, freshSession.access_token);
          if (!res?.job) return;
          const job = res.job as { status: string; progress: number; progress_stage: number; candidate_matches?: unknown[]; error_message?: string };
          const sessionState = res.sessionState;
          const pct = Math.min(job.progress ?? 0, 95);
          setProg(pct);
          setDone(Math.floor((pct / 100) * SCAN_ITEMS.length));

          if (pct < 30) setStatus('Reading your product\'s public signals…');
          else if (pct < 60) setStatus('Analysing screenshots and review language…');
          else if (pct < 85) setStatus('Inferring audience, use cases, and competitors…');
          else setStatus('Prioritizing the first growth opportunity…');

          if (job.status === 'completed' || sessionState === 'PRELIMINARY_REPORT') {
            mounted = false; clearInterval(interval!);
            router.push('/onboarding/report');
          } else if (job.status === 'failed') {
            mounted = false; clearInterval(interval!);
            router.push('/onboarding/discovery/recovery');
          } else if (Array.isArray(job.candidate_matches) && (job.candidate_matches as unknown[]).length > 1) {
            mounted = false; clearInterval(interval!);
            sessionStorage.setItem('onboarding_candidates', JSON.stringify(job.candidate_matches));
            router.push('/onboarding/discovery/recovery');
          }
        } catch { /* skip tick */ }
      }, 2500);
      timerRef.current = interval;
    }
    init();

    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [router]);

  return (
    <div style={{ textAlign: 'center', paddingTop: 24 }}>
      {/* Animated orbit */}
      <div style={{
        width: 142, height: 142, borderRadius: '50%', margin: '0 auto 25px',
        display: 'grid', placeItems: 'center', position: 'relative',
        border: '1px solid #cfe5dc',
        background: 'radial-gradient(circle,#f8fffc 0,#e7f5ef 68%,transparent 69%)',
      }}>
        {/* CSS spin rings via style tag */}
        <style>{`
          @keyframes ob-spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
          .ob-ring1 { position:absolute; inset:8px; border-radius:50%; border:2.5px solid transparent; border-top-color:var(--sage); border-right-color:var(--sage); animation:ob-spin 1.4s linear infinite; }
          .ob-ring2 { position:absolute; inset:22px; border-radius:50%; border:2px solid transparent; border-bottom-color:var(--sage); border-left-color:var(--sage); animation:ob-spin 1.9s linear infinite reverse; }
        `}</style>
        <div className="ob-ring1" />
        <div className="ob-ring2" />
        <div style={{
          width: 58, height: 58, borderRadius: 16,
          background: 'linear-gradient(135deg,#e8faf3,#c2ead7)',
          display: 'grid', placeItems: 'center',
          color: '#0b6e50', fontSize: 22, fontWeight: 800,
          fontFamily: 'Syne, sans-serif',
          boxShadow: '0 8px 24px rgba(11,143,105,.16)',
          letterSpacing: '-0.5px',
          zIndex: 1,
        }}>
          {initial}
        </div>
      </div>

      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>Building your first Growth Brain</div>
      <div style={{ color: 'var(--ink2)', margin: '0 0 22px', fontSize: 14 }}>{statusText}</div>

      {/* Scan list */}
      <div style={{ maxWidth: 480, margin: 'auto', textAlign: 'left', display: 'grid', gap: 9 }}>
        {SCAN_ITEMS.map((item, i) => {
          const done    = i < doneItems;
          const working = i === doneItems && progress < 95;
          return (
            <div key={item} style={{
              display: 'grid', gridTemplateColumns: '22px 1fr auto',
              alignItems: 'center', padding: '11px 13px',
              borderRadius: 10, background: 'var(--raised)', fontSize: 12,
            }}>
              <span style={{ color: done ? 'var(--sage)' : working ? 'var(--amber)' : 'var(--ink3)', fontWeight: 900 }}>
                {done ? '✓' : working ? '●' : '○'}
              </span>
              <span>{item}</span>
              <small style={{ color: 'var(--ink3)' }}>
                {done ? 'Done' : working ? 'Analysing' : ''}
              </small>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => router.push('/onboarding/discovery')}
        style={{ border: 0, background: 'none', color: 'var(--ink3)', fontWeight: 700, cursor: 'pointer', marginTop: 22, fontSize: 13 }}
      >
        Cancel and save progress
      </button>

      {error && (
        <div style={{ marginTop: 16, padding: '10px 13px', borderRadius: 9, background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}
    </div>
  );
}
