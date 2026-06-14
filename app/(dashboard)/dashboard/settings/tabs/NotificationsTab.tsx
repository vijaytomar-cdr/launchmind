'use client';
/**
 * @file tabs/NotificationsTab.tsx
 * @description Settings → Notifications tab.
 *   Toggles: Sunday brief delivery, Campaign approval reminders, Low token warning.
 */

import { useState } from 'react';

const row = 'flex items-center justify-between py-3 gap-4';
const divider: React.CSSProperties = { borderTop: '1px solid var(--border)' };
const text13b: React.CSSProperties = { fontSize: 13, color: 'var(--ink)', fontWeight: 500 };
const text12: React.CSSProperties = { fontSize: 12, color: 'var(--ink2)', marginTop: 2 };

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 9999, padding: 2, flexShrink: 0, cursor: 'pointer',
        border: on ? 'none' : '1px solid var(--border2)',
        background: on ? 'var(--sage)' : 'var(--raised)',
        display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background 0.15s',
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: on ? '#fff' : 'var(--ink3)', display: 'block' }} />
    </button>
  );
}

export function NotificationsTab() {
  const [briefOn, setBriefOn] = useState(true);
  const [approvalOn, setApprovalOn] = useState(true);
  const [tokenOn, setTokenOn] = useState(true);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 3 }}>Notifications</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Choose what LaunchMind emails you about.</div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0 20px' }}>
        {([
          { label: 'Sunday brief delivery',       desc: 'Receive your weekly performance brief every Sunday morning.',        on: briefOn,    set: setBriefOn },
          { label: 'Campaign approval reminders', desc: 'Get notified when campaigns are waiting for your approval.',        on: approvalOn, set: setApprovalOn },
          { label: 'Low token warning',           desc: 'Alert when your token balance drops below 20% of your plan limit.', on: tokenOn,    set: setTokenOn },
        ] as const).map(({ label, desc, on, set }, i) => (
          <div key={label} className={row} style={i > 0 ? divider : undefined}>
            <div>
              <p style={text13b}>{label}</p>
              <p style={text12}>{desc}</p>
            </div>
            <Toggle on={on} onChange={set} />
          </div>
        ))}
        <p style={{ fontSize: 11, color: 'var(--ink3)', paddingTop: 8, paddingBottom: 12 }}>
          Notification preferences saved automatically.
        </p>
      </div>
    </div>
  );
}
