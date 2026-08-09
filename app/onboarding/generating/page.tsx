/**
 * @file app/onboarding/generating/page.tsx
 * @description Phase 1 Step 14: Direction generation loading screen.
 *   Polls the backend every 2.5s until strategy_directions.status transitions to 'ready'.
 *   Displays animated dots and sequential strategy chips while AI generates.
 * @dependencies api.onboarding.getDirection
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';

const STRATEGY_CHIPS = [
  '✓ Supply constraint identified',
  '✓ Goal-to-mission sequence mapped',
  '✓ Approval-safe actions selected',
];

export default function GeneratingPage() {
  const router = useRouter();
  const [visibleChips, setVisibleChips] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chipRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Reveal strategy chips sequentially while waiting
    chipRef.current = setInterval(() => {
      setVisibleChips(n => Math.min(n + 1, STRATEGY_CHIPS.length));
    }, 1800);

    async function poll() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
      if (!sid) return;

      try {
        const r = await api.onboarding.getDirection(sid, session.access_token);
        const direction = r?.direction;
        if (direction?.status === 'ready') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (chipRef.current)  clearInterval(chipRef.current);
          router.push('/onboarding/direction');
        }
      } catch { /* keep polling */ }
    }

    intervalRef.current = setInterval(poll, 2500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (chipRef.current)  clearInterval(chipRef.current);
    };
  }, [router]);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '48px 24px',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480, width: '100%' }}>

        {/* Animated dots loader */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
          <span className="dl-dot" />
          <span className="dl-dot" />
          <span className="dl-dot" />
        </div>

        {/* Scan label */}
        <div style={{
          fontSize: 20, fontWeight: 700, color: 'var(--ink)',
          marginBottom: 10, fontFamily: 'Syne, sans-serif',
        }}>
          Turning understanding into direction
        </div>

        {/* Scan sub */}
        <div style={{
          fontSize: 13, color: 'var(--ink3)', lineHeight: 1.65,
          marginBottom: 36,
        }}>
          Connecting your market evidence, future plans, measurable goal, and approval boundaries…
        </div>

        {/* Strategy build chips */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          {STRATEGY_CHIPS.map((chip, i) => (
            <div key={chip} style={{
              fontSize: 13, fontWeight: 600,
              color: i < visibleChips ? 'var(--sage)' : 'transparent',
              transition: 'color .45s ease',
              letterSpacing: '-.01em',
            }}>
              {chip}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes dl-pulse {
          0%,60%,100% { transform:scale(0.7); opacity:.4 }
          30%          { transform:scale(1);   opacity:1 }
        }
        .dl-dot {
          width:12px; height:12px; border-radius:50%;
          background:var(--sage);
          animation:dl-pulse 1.2s ease infinite;
          display:inline-block;
        }
        .dl-dot:nth-child(2) { animation-delay:.2s }
        .dl-dot:nth-child(3) { animation-delay:.4s }
      `}</style>
    </div>
  );
}
