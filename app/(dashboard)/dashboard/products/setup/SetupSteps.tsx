'use client';

/**
 * @file SetupSteps.tsx
 * @description Step progress indicator shared across all 5 Intake V3 wizard steps.
 */

const STEPS = [
  { n: 1, label: 'Basics' },
  { n: 2, label: 'Business' },
  { n: 3, label: 'Audience' },
  { n: 4, label: 'Brand' },
  { n: 5, label: 'Connect' },
];

interface Props {
  current: number;
}

export function SetupSteps({ current }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {STEPS.map((s, i) => {
        const done    = s.n < current;
        const active  = s.n === current;
        const pending = s.n > current;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: done   ? 'var(--sage)'  : active ? 'var(--sage-d)' : 'var(--raised)',
                  border: done       ? '2px solid var(--sage)' :
                          active     ? '2px solid var(--sage)'  :
                          '1.5px solid var(--border2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: done ? '#fff' : active ? 'var(--sage)' : 'var(--ink3)',
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : s.n}
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--ink)' : pending ? 'var(--ink3)' : 'var(--ink2)',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  width: 24, height: 1,
                  background: done ? 'var(--sage)' : 'var(--border2)',
                  margin: '0 8px',
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
