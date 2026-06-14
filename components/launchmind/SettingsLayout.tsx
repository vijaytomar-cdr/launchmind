'use client';
/**
 * @file SettingsLayout.tsx
 * @description Shared layout for all settings tabs.
 *   Left nav (170px) + scrollable content area.
 *   Active tab driven by ?tab= query param (default: profile).
 *   Matches the Slate & Sage design system.
 */

import { useRouter } from 'next/navigation';
import {
  IconUser,
  IconShield,
  IconSpeakerphone,
  IconMicrophone,
  IconBell,
  IconApps,
  IconUserX,
} from '@tabler/icons-react';
import { SETTINGS_NAV, type SettingsTab } from '@/lib/types/settings';

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  profile:       <IconUser size={14} />,
  security:      <IconShield size={14} />,
  content:       <IconSpeakerphone size={14} />,
  voice:         <IconMicrophone size={14} />,
  notifications: <IconBell size={14} />,
  products:      <IconApps size={14} />,
  account:       <IconUserX size={14} />,
};

interface SettingsLayoutProps {
  children: React.ReactNode;
  activeTab: SettingsTab;
}

export function SettingsLayout({ children, activeTab }: SettingsLayoutProps) {
  const router = useRouter();

  const navigate = (tab: SettingsTab) => {
    router.push(`/dashboard/settings?tab=${tab}`);
  };

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>

      {/* Left nav */}
      <div style={{ width: 170, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {SETTINGS_NAV.map((item) => {
          const isAccount = item.id === 'account';
          const isActive = item.id === activeTab;

          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: isAccount ? '12px 10px 8px' : '8px 10px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 12,
                textAlign: 'left',
                width: '100%',
                transition: 'all .15s',
                marginTop: isAccount ? 8 : 0,
                borderTop: isAccount ? '0.5px solid var(--border)' : 'none',
                background: isActive ? 'rgba(5,150,105,0.10)' : 'transparent',
                color: isActive ? '#059669' : isAccount ? '#dc2626' : 'var(--ink2)',
                fontWeight: isActive ? 500 : 400,
              }}
            >
              <span style={{ flexShrink: 0, lineHeight: 0 }}>{TAB_ICONS[item.id]}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{
                  fontSize: 8,
                  padding: '1px 5px',
                  borderRadius: 99,
                  background: 'rgba(79,70,229,0.10)',
                  color: '#4f46e5',
                  border: '0.5px solid rgba(79,70,229,0.22)',
                  flexShrink: 0,
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 2 }}>
        {children}
      </div>

    </div>
  );
}
