/**
 * @file IntakeSteps.tsx
 * @description 7-step progress indicator for the product intake flow.
 *   Done: sage background + white check. Active: sidebar bg + sage ring.
 *   Future: raised background + gray number. Lines turn sage when step is done.
 *   Design tokens from CLAUDE.md §6.
 */

'use client';

import { INTAKE_STEP_ORDER, INTAKE_STEP_LABELS, type IntakeStep } from '@/lib/types/intake';

interface IntakeStepsProps {
  currentStep: IntakeStep;
  onStepClick?: (step: IntakeStep) => void;
}

export function IntakeSteps({ currentStep, onStepClick }: IntakeStepsProps) {
  const currentIndex = INTAKE_STEP_ORDER.indexOf(currentStep);

  return (
    <div className="flex items-center" style={{ marginBottom: 28 }}>
      {INTAKE_STEP_ORDER.map((step, i) => {
        const isDone   = i < currentIndex;
        const isActive = i === currentIndex;
        const isFuture = i > currentIndex;

        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center" style={{ minWidth: 36 }}>
              {/* Circle */}
              <button
                type="button"
                disabled={!isDone}
                onClick={() => isDone && onStepClick?.(step)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isDone ? 'var(--sage)' : isActive ? 'var(--sidebar)' : 'var(--raised)',
                  outline: isActive ? '2px solid var(--sage)' : 'none',
                  outlineOffset: 2,
                  border: 'none',
                  cursor: isDone ? 'pointer' : 'default',
                  flexShrink: 0,
                  transition: 'background 0.2s',
                }}
              >
                {isDone ? (
                  <svg width="11" height="11" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 12 12">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                  </svg>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isActive ? '#fff' : 'var(--ink3)',
                      lineHeight: 1,
                    }}
                  >
                    {i + 1}
                  </span>
                )}
              </button>
              {/* Label */}
              <span
                style={{
                  fontSize: 10,
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                  color: isDone ? 'var(--sage)' : isActive ? 'var(--ink)' : 'var(--ink3)',
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {INTAKE_STEP_LABELS[step]}
              </span>
            </div>

            {/* Connecting line — not after last step */}
            {i < INTAKE_STEP_ORDER.length - 1 && (
              <div
                style={{
                  height: 2,
                  width: 28,
                  marginBottom: 16,
                  background: isDone ? 'var(--sage)' : 'var(--border2)',
                  transition: 'background 0.3s',
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
