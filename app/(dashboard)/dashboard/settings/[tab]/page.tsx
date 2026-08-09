/**
 * @file settings/[tab]/page.tsx
 * @description Dynamic route for settings tabs — profile, security, content, voice,
 *   notifications, products, account. Left nav (170px) + content panel per spec.
 * @security Each tab component fetches its own Supabase session token on mount.
 * @dependencies tab components in ../tabs/
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProfileTab }           from '../tabs/ProfileTab';
import { SecurityTab }          from '../tabs/SecurityTab';
import { ContentTypesTab }      from '../tabs/ContentTypesTab';
import { VoiceCloneTab }        from '../tabs/VoiceCloneTab';
import { NotificationsTab }     from '../tabs/NotificationsTab';
import { ProductsTab }          from '../tabs/ProductsTab';
import { AccountManagementTab } from '../tabs/AccountManagementTab';

const TABS = [
  { key: 'profile',       label: 'Profile',        sub: 'Your name, email, and account details.',                                   component: ProfileTab },
  { key: 'security',      label: 'Security',        sub: 'Password, MFA, and active sessions.',                                    component: SecurityTab },
  { key: 'content',       label: 'Content types',   sub: 'Choose what LaunchMind generates each week.',                            component: ContentTypesTab },
  { key: 'voice',         label: 'Voice clone',     sub: 'Your AI voice used in voice notes and video narration.',                 component: VoiceCloneTab },
  { key: 'notifications', label: 'Notifications',   sub: 'When and how LaunchMind reaches you.',                                   component: NotificationsTab },
  { key: 'products',      label: 'Products',        sub: 'Manage active and archived products.',                                   component: ProductsTab },
  { key: 'account',       label: 'Account',         sub: 'Data export, account deletion, and API keys.',                          component: AccountManagementTab },
] as const;

export default function SettingsTabPage({ params }: { params: { tab: string } }) {
  const activeTab = TABS.find(t => t.key === params.tab);
  if (!activeTab) return notFound();

  const { sub, component: TabComponent } = activeTab;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page title */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="font-display font-bold" style={{ fontSize: 20, color: 'var(--ink)' }}>Settings</h1>
      </div>

      {/* Two-col layout: left nav + content */}
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>

        {/* Left nav — 170px, sticky */}
        <nav style={{
          width: 170, flexShrink: 0,
          position: 'sticky', top: 88,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {TABS.map(t => {
            const isActive = t.key === params.tab;
            return (
              <Link
                key={t.key}
                href={`/dashboard/settings/${t.key}`}
                style={{
                  display: 'block',
                  padding: '8px 11px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: isActive ? 650 : 450,
                  color: isActive ? 'var(--ink)' : 'var(--ink2)',
                  background: isActive ? 'var(--raised)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--sage)' : '2px solid transparent',
                  textDecoration: 'none',
                  transition: 'background .12s, color .12s',
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        {/* Content panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
              {activeTab.label}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>{sub}</p>
          </div>
          <TabComponent />
        </div>
      </div>
    </div>
  );
}
