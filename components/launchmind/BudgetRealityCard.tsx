/**
 * @file BudgetRealityCard.tsx
 * @description Budget Reality Check card on the strategy page.
 *   Shows a 3-tier budget comparison (Seed / Growth / Scale) with honest assessments.
 *   Manages its own modal state: card view → decision modal → side-by-side preview.
 *   "Apply this strategy" calls onApplyBudget() which regenerates the strategy at the
 *   new budget tier. Path B (unlock channels) navigates to /dashboard/billing.
 * @security No auth calls. All data is derived from the already-fetched strategy object.
 * @dependencies Next.js router, design system CSS tokens
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BudgetTierCard {
  rangeLabel: string;
  name: string;
  channels: string[];
  lockedChannels?: string[];
  planRequiredForLocked?: string;
  projectedInstalls: string;
  projectedInstallsWithPlan?: string;
}

interface BudgetReality {
  currentTier: 'seed' | 'growth' | 'scale';
  currentMonthlyUSD: number;
  assessment: string;
  seed: BudgetTierCard;
  growth: BudgetTierCard;
  scale: BudgetTierCard;
}

interface BudgetRealityCardProps {
  budgetReality: BudgetReality;
  plan: string;
  onApplyBudget: (budgetOverride: string) => Promise<void>;
  applying: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type TargetTier = 'growth' | 'scale';

const TIER_ORDER: Array<'seed' | 'growth' | 'scale'> = ['seed', 'growth', 'scale'];

const TIER_BUDGET_STRINGS: Record<TargetTier, string> = {
  growth: '$500–$1,000/mo',
  scale:  '$2,000+/mo',
};

const PLAN_FOR_TIER: Record<TargetTier, { name: string; price: string; billing: string }> = {
  growth: { name: 'Builder', price: '$49', billing: '/mo' },
  scale:  { name: 'Studio',  price: '$99', billing: '/mo' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function YouAreHereBadge() {
  return (
    <span style={{
      display: 'inline-block', fontSize: 9, fontWeight: 700,
      background: 'var(--sage)', color: '#fff',
      borderRadius: 4, padding: '1px 6px', marginBottom: 6,
    }}>
      ← You are here
    </span>
  );
}

function YouAreHereBadgeAmber() {
  return (
    <span style={{
      display: 'inline-block', fontSize: 9, fontWeight: 700,
      background: 'var(--amber)', color: '#fff',
      borderRadius: 4, padding: '1px 6px', marginBottom: 6,
    }}>
      ← You are here
    </span>
  );
}

function CompletedBadge() {
  return (
    <span style={{
      display: 'inline-block', fontSize: 9, fontWeight: 600,
      color: 'var(--ink3)', marginBottom: 4,
    }}>
      completed ✓
    </span>
  );
}

function LockBadge({ plan }: { plan: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)',
      color: 'var(--indigo)', borderRadius: 4, padding: '1px 6px', flexShrink: 0,
    }}>
      🔒 {plan}
    </span>
  );
}

// ── Decision modal ────────────────────────────────────────────────────────────

function DecisionModal({
  targetTier,
  onClose,
  onSelectPath,
}: {
  targetTier: TargetTier;
  onClose: () => void;
  onSelectPath: (path: 'A' | 'B') => void;
}) {
  const [selected, setSelected] = useState<'A' | 'B' | null>(null);
  const plan = PLAN_FOR_TIER[targetTier];
  const budgetLabel = targetTier === 'growth' ? '$500–1k/mo' : '$2k+/mo';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 520,
          overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="font-display font-bold" style={{ fontSize: 15, color: 'var(--ink)' }}>
            Growing to {budgetLabel} — what&apos;s your goal?
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 3 }}>
            Choose your path. You can change this any time.
          </div>
        </div>

        {/* Options */}
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Path A */}
          <button
            onClick={() => setSelected('A')}
            style={{
              border: `1.5px solid ${selected === 'A' ? 'var(--sage-b)' : 'var(--border2)'}`,
              borderRadius: 8, padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
              background: selected === 'A' ? 'var(--sage-d)' : 'transparent', width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${selected === 'A' ? 'var(--sage)' : 'var(--border2)'}`,
                background: selected === 'A' ? 'var(--sage)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {selected === 'A' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Spend more on my current channels
              </span>
              <span style={{
                marginLeft: 'auto', fontSize: 10, fontWeight: 500,
                background: 'var(--sage-d)', border: '1px solid var(--sage-b)',
                color: 'var(--sage)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap',
              }}>
                No plan change
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', paddingLeft: 26, lineHeight: 1.55 }}>
              Keep your existing channels but put more budget behind them. I&apos;ll show you a
              side-by-side preview of what your strategy looks like at {budgetLabel} before you commit.
            </div>
          </button>

          {/* Path B */}
          <button
            onClick={() => setSelected('B')}
            style={{
              border: `1.5px solid ${selected === 'B' ? 'var(--indigo-b)' : 'var(--border2)'}`,
              borderRadius: 8, padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
              background: selected === 'B' ? 'var(--indigo-d)' : 'transparent', width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${selected === 'B' ? 'var(--indigo)' : 'var(--border2)'}`,
                background: selected === 'B' ? 'var(--indigo)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {selected === 'B' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Unlock {plan.name} channels too
              </span>
              <span style={{
                marginLeft: 'auto', fontSize: 10, fontWeight: 500,
                background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)',
                color: 'var(--indigo)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap',
              }}>
                {plan.name} plan — {plan.price}{plan.billing}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', paddingLeft: 26, lineHeight: 1.55 }}>
              Add new channels on top of your existing ones.
              Requires upgrading to the {plan.name} plan.
            </div>
          </button>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px 20px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', borderTop: '1px solid var(--border)',
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border2)', borderRadius: 6,
              padding: '8px 16px', fontSize: 13, color: 'var(--ink2)', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            disabled={!selected}
            onClick={() => selected && onSelectPath(selected)}
            style={{
              background: selected ? 'var(--sage)' : 'var(--raised)',
              border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13,
              fontWeight: 500, color: selected ? '#fff' : 'var(--ink3)',
              cursor: selected ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            Continue
            <span style={{ fontSize: 12 }}>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Side-by-side preview ──────────────────────────────────────────────────────

function BudgetPreview({
  currentTier,
  targetTier,
  budgetReality,
  applying,
  onApply,
  onBack,
  applyLabel,
  applyNote,
}: {
  currentTier: 'seed' | 'growth' | 'scale';
  targetTier: TargetTier;
  budgetReality: BudgetReality;
  applying: boolean;
  onApply: () => void;
  onBack: () => void;
  applyLabel: string;
  applyNote: string;
}) {
  const current = budgetReality[currentTier];
  const target = budgetReality[targetTier];
  const hasLocked = (target.lockedChannels?.length ?? 0) > 0;

  const colHeaderStyle = (isNew: boolean): React.CSSProperties => ({
    padding: '14px 18px', borderBottom: '1px solid var(--border)',
    background: isNew ? 'var(--sage-d)' : 'var(--raised)',
    borderLeft: isNew ? '1px solid var(--border)' : undefined,
  });

  const sectionStyle = (isNew: boolean): React.CSSProperties => ({
    padding: '14px 18px', borderBottom: '1px solid var(--border)',
    background: isNew ? 'rgba(5,150,105,0.03)' : undefined,
    borderLeft: isNew ? '1px solid var(--border)' : undefined,
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="font-display font-bold" style={{ fontSize: 18, color: 'var(--ink)' }}>
            Strategy preview — {target.name} tier ({target.rangeLabel})
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 3 }}>
            Compare your current strategy with what&apos;s possible at higher budget. Nothing changes until you apply.
          </div>
        </div>
        <button
          onClick={onBack}
          style={{
            flexShrink: 0, background: 'transparent', border: '1px solid var(--border2)',
            borderRadius: 6, padding: '8px 16px', fontSize: 13, color: 'var(--ink2)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          ← Back
        </button>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={colHeaderStyle(false)}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink3)', marginBottom: 3 }}>Current</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--ink2)' }}>
              {current.rangeLabel} · {current.name} tier
            </div>
          </div>
          <div style={colHeaderStyle(true)}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sage)', marginBottom: 3 }}>With {target.name} budget</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--sage)' }}>
              {target.rangeLabel} · {target.name} tier ✦
            </div>
          </div>
        </div>

        {/* Active channels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={sectionStyle(false)}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink3)', marginBottom: 8 }}>Active channels</div>
            {current.channels.map((ch, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < current.channels.length - 1 ? '1px solid var(--border)' : undefined, fontSize: 12, color: 'var(--ink)' }}>
                {ch}
              </div>
            ))}
          </div>
          <div style={sectionStyle(true)}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sage)', marginBottom: 8 }}>Active channels</div>
            {target.channels.map((ch, i) => {
              const isNew = !current.channels.some(c => c.toLowerCase() === ch.toLowerCase());
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < target.channels.length + (target.lockedChannels?.length ?? 0) - 1 ? '1px solid var(--border)' : undefined, fontSize: 12 }}>
                  <span style={{ color: 'var(--ink)' }}>{ch}</span>
                  {isNew && (
                    <span style={{ fontSize: 10, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', borderRadius: 4, padding: '1px 6px' }}>↑ scaled</span>
                  )}
                </div>
              );
            })}
            {(target.lockedChannels ?? []).map((ch, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12, opacity: 0.6 }}>
                <span style={{ color: 'var(--ink2)' }}>{ch}</span>
                <LockBadge plan={target.planRequiredForLocked ?? 'Builder plan'} />
              </div>
            ))}
          </div>
        </div>

        {/* Projected outcome */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink3)', marginBottom: 6 }}>Projected outcome (30 days)</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 500, color: 'var(--ink2)' }}>{current.projectedInstalls}</div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>installs / mo</div>
          </div>
          <div style={{ padding: '14px 18px', background: 'rgba(5,150,105,0.03)', borderLeft: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sage)', marginBottom: 6 }}>Projected outcome (30 days)</div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 20, fontWeight: 500, color: 'var(--sage)' }}>{target.projectedInstalls}</div>
            <div style={{ fontSize: 11, color: 'var(--sage)', marginTop: 2 }}>
              installs / mo{' '}
              <span style={{ color: 'var(--ink3)' }}>(on current plan)</span>
            </div>
            {hasLocked && target.projectedInstallsWithPlan && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink3)', background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)', borderRadius: 6, padding: '7px 10px', lineHeight: 1.5 }}>
                🔒 Upgrade to <strong style={{ color: 'var(--indigo)' }}>{target.planRequiredForLocked}</strong> to reach{' '}
                <strong style={{ color: 'var(--indigo)' }}>{target.projectedInstallsWithPlan}</strong>
              </div>
            )}
          </div>
        </div>

        {/* Apply bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'var(--sage-d)', borderTop: '1.5px solid var(--sage-b)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#065f46' }}>
            <span>ℹ</span>
            {applyNote}
          </div>
          <button
            onClick={onApply}
            disabled={applying}
            style={{
              flexShrink: 0, background: applying ? 'var(--raised)' : 'var(--sage)',
              border: 'none', borderRadius: 6, padding: '9px 22px', fontSize: 13,
              fontWeight: 500, color: applying ? 'var(--ink3)' : '#fff',
              cursor: applying ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {applying ? 'Regenerating…' : applyLabel}
            {!applying && <span>→</span>}
          </button>
        </div>
      </div>

      {/* Upsell strip — only shown when locked channels exist */}
      {hasLocked && (
        <div style={{
          background: 'var(--indigo-d)', border: '1.5px solid var(--indigo-b)', borderRadius: 10,
          padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--indigo)', marginBottom: 3 }}>
              🔒 Want the full {target.projectedInstallsWithPlan ?? 'picture'}?
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5 }}>
              Upgrade to {target.planRequiredForLocked} to unlock {(target.lockedChannels ?? []).join(', ')} — and regenerate with all channels.
            </div>
          </div>
          <a
            href="/dashboard/billing"
            style={{
              flexShrink: 0, background: 'var(--indigo)', borderRadius: 6, padding: '9px 18px',
              fontSize: 12, fontWeight: 500, color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            Upgrade to {PLAN_FOR_TIER[targetTier].name} →
          </a>
        </div>
      )}
    </div>
  );
}

// ── Tier card ─────────────────────────────────────────────────────────────────

function TierCard({
  card,
  tier,
  currentTier,
  onGrow,
}: {
  card: BudgetTierCard;
  tier: 'seed' | 'growth' | 'scale';
  currentTier: 'seed' | 'growth' | 'scale';
  onGrow: () => void;
}) {
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  const thisIndex = TIER_ORDER.indexOf(tier);
  const isCurrent = tier === currentTier;
  const isCompleted = thisIndex < currentIndex;
  const isGrowable = thisIndex > currentIndex;

  if (isCompleted) {
    return (
      <div style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: 14, opacity: 0.5 }}>
        <CompletedBadge />
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 500, color: 'var(--ink3)' }}>
          {card.rangeLabel}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink3)', marginTop: 2 }}>
          {card.name} tier
        </div>
        <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />
        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
          {card.channels.slice(0, 3).join(' · ')}
        </div>
      </div>
    );
  }

  if (isCurrent) {
    // Style changes based on which tier is current
    const isSeed = tier === 'seed';
    const isGrowth = tier === 'growth';
    const borderColor = isSeed ? 'var(--sage-b)' : 'var(--amber-b)';
    const bg = isSeed ? 'var(--sage-d)' : 'var(--amber-d)';
    const textColor = isSeed ? 'var(--sage)' : 'var(--amber)';
    const subtleText = isSeed ? '#065f46' : '#92400e';
    const outcomeBg = isSeed ? 'rgba(5,150,105,0.18)' : 'rgba(217,119,6,0.12)';
    const BadgeComponent = isSeed ? YouAreHereBadge : YouAreHereBadgeAmber;

    return (
      <div style={{ border: `1.5px solid ${borderColor}`, background: bg, borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <BadgeComponent />
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 500, color: textColor }}>
            {card.rangeLabel}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: textColor, marginTop: 2 }}>
            {card.name} tier
          </div>
        </div>
        <div style={{ height: 1, background: borderColor }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: subtleText }}>
            {isGrowth && (card.lockedChannels?.length ?? 0) > 0 ? 'Active channels' : 'Channels'}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: subtleText }}>
            {card.channels.map((ch, i) => <div key={i}>✓ {ch}</div>)}
            {(card.lockedChannels ?? []).map((ch, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                🔒 {ch}
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderRadius: 6, padding: '8px 10px', background: outcomeBg, marginTop: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: subtleText, marginBottom: 2 }}>
            {isGrowth && (card.lockedChannels?.length ?? 0) > 0 ? 'Current projection' : 'Realistic outcome'}
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: subtleText }}>
            {card.projectedInstalls} installs/mo
          </div>
          {card.projectedInstallsWithPlan && (
            <div style={{ fontSize: 11, color: subtleText, opacity: 0.8, marginTop: 1 }}>
              {card.projectedInstallsWithPlan} with {card.planRequiredForLocked}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Growable (higher than current) — show "Grow to this tier →" button
  if (isGrowable) {
    return (
      <div style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 500, color: tier === 'scale' ? 'var(--ink3)' : 'var(--amber)' }}>
            {card.rangeLabel}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: tier === 'scale' ? 'var(--ink3)' : 'var(--amber)', marginTop: 2 }}>
            {card.name} tier
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--border)' }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--ink2)' }}>Channels unlocked</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink2)' }}>
            {card.channels.map((ch, i) => <div key={i}>✓ {ch}</div>)}
          </div>
        </div>
        <div style={{ borderRadius: 6, padding: '8px 10px', background: 'var(--raised)', marginTop: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink3)', marginBottom: 2 }}>
            Realistic outcome
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
            {card.projectedInstalls} installs/mo
          </div>
          {card.projectedInstallsWithPlan && (
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>
              {card.projectedInstallsWithPlan} with {card.planRequiredForLocked}
            </div>
          )}
        </div>
        <button
          onClick={onGrow}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 12px',
            fontSize: 12, fontWeight: 500, color: 'var(--ink2)', background: 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', marginTop: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--raised)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Grow to this tier
          <span style={{ fontSize: 11 }}>→</span>
        </button>
      </div>
    );
  }

  // Scale tier when already on Scale — no button, "maximising" label
  return (
    <div style={{ border: `1.5px solid var(--sage-b)`, background: 'var(--sage-d)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <YouAreHereBadge />
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 500, color: 'var(--sage)' }}>
          {card.rangeLabel}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--sage)', marginTop: 2 }}>
          {card.name} tier
        </div>
      </div>
      <div style={{ height: 1, background: 'var(--sage-b)' }} />
      <div style={{ fontSize: 12, lineHeight: 1.6, color: '#065f46' }}>
        {card.channels.map((ch, i) => <div key={i}>✓ {ch}</div>)}
      </div>
      <div style={{ borderRadius: 6, padding: '8px 10px', background: 'rgba(5,150,105,0.18)', marginTop: 'auto' }}>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#065f46', marginBottom: 2 }}>
          You&apos;re maximising your budget ✓
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#065f46' }}>
          {card.projectedInstalls} installs/mo
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BudgetRealityCard({
  budgetReality,
  plan: _plan,
  onApplyBudget,
  applying,
}: BudgetRealityCardProps) {
  const router = useRouter();
  const [modalState, setModalState] = useState<'closed' | 'decision' | 'preview'>('closed');
  const [targetTier, setTargetTier] = useState<TargetTier | null>(null);
  const [previewMode, setPreviewMode] = useState<'apply' | 'upgrade'>('apply');

  function handleGrow(tier: TargetTier) {
    setTargetTier(tier);
    setModalState('decision');
  }

  function handleSelectPath(path: 'A' | 'B') {
    // Both paths show the preview — Path B just changes the CTA to "Upgrade" instead of "Apply"
    setPreviewMode(path === 'A' ? 'apply' : 'upgrade');
    setModalState('preview');
  }

  async function handleApply() {
    if (!targetTier) return;
    if (previewMode === 'upgrade') {
      // Path B: user has seen the preview, now send them to billing
      const planParam = targetTier === 'growth' ? 'builder' : 'studio';
      router.push(`/dashboard/billing?highlight=${planParam}`);
      setModalState('closed');
      setTargetTier(null);
      return;
    }
    await onApplyBudget(TIER_BUDGET_STRINGS[targetTier]);
    setModalState('closed');
    setTargetTier(null);
  }

  const { currentTier, assessment } = budgetReality;

  // Label for the current tier badge
  const tierBadgeLabel = `${budgetReality[currentTier].rangeLabel} · ${budgetReality[currentTier].name} tier`;

  return (
    <>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6, background: 'var(--amber-d)',
              border: '1px solid var(--amber-b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>
              💰
            </div>
            <div>
              <div className="font-display font-semibold" style={{ fontSize: 13, color: 'var(--ink)' }}>Budget reality check</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>
                What your budget can realistically achieve — and what unlocks at higher tiers
              </div>
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: currentTier === 'seed' ? 'var(--amber-d)' : 'var(--sage-d)',
            border: `1px solid ${currentTier === 'seed' ? 'var(--amber-b)' : 'var(--sage-b)'}`,
            borderRadius: 20, padding: '3px 10px',
            fontSize: 11, fontWeight: 500,
            color: currentTier === 'seed' ? 'var(--amber)' : 'var(--sage)',
            fontFamily: 'DM Mono, monospace',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: currentTier === 'seed' ? 'var(--amber)' : 'var(--sage)', flexShrink: 0 }} />
            {tierBadgeLabel}
          </div>
        </div>

        {/* Honest assessment bar */}
        <div style={{
          padding: '10px 18px', background: 'var(--amber-d)',
          borderBottom: '1px solid var(--amber-b)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠</span>
          <div style={{ fontSize: 12.5, color: '#92400e', lineHeight: 1.55 }}>
            <strong>Honest assessment:</strong> {assessment}
          </div>
        </div>

        {/* Tier cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '14px 18px 18px' }}>
          {TIER_ORDER.map((tier) => (
            <TierCard
              key={tier}
              card={budgetReality[tier]}
              tier={tier}
              currentTier={currentTier}
              onGrow={() => handleGrow(tier as TargetTier)}
            />
          ))}
        </div>
      </div>

      {/* Decision modal */}
      {modalState === 'decision' && targetTier && (
        <DecisionModal
          targetTier={targetTier}
          onClose={() => { setModalState('closed'); setTargetTier(null); }}
          onSelectPath={handleSelectPath}
        />
      )}

      {/* Side-by-side preview — full overlay modal */}
      {modalState === 'preview' && targetTier && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '32px 24px', overflowY: 'auto',
          }}
          onClick={() => setModalState('decision')}
        >
          <div
            style={{
              background: 'var(--page)', borderRadius: 12, width: '100%', maxWidth: 860,
              boxShadow: '0 24px 64px rgba(0,0,0,0.18)', padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <BudgetPreview
              currentTier={currentTier}
              targetTier={targetTier}
              budgetReality={budgetReality}
              applying={applying}
              onApply={handleApply}
              onBack={() => setModalState('decision')}
              applyLabel={
                previewMode === 'upgrade'
                  ? `Upgrade to ${PLAN_FOR_TIER[targetTier].name} →`
                  : 'Apply this strategy'
              }
              applyNote={
                previewMode === 'upgrade'
                  ? `You'll be taken to billing to upgrade to ${PLAN_FOR_TIER[targetTier].name}. Nothing changes until you complete the upgrade.`
                  : `Your strategy will regenerate with ${budgetReality[targetTier].rangeLabel} budget. Current strategy is saved.`
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
