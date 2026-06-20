/**
 * @file settings/[tab]/page.tsx
 * @description Dynamic route for settings tabs — profile, security, content, voice,
 *   notifications, products, account. Navigation lives in the main sidebar accordion.
 *   No second left panel (SettingsLayout not used here).
 * @security Each tab component fetches its own Supabase session token on mount.
 * @dependencies tab components in ../tabs/
 */

import { notFound } from 'next/navigation';
import { ProfileTab }           from '../tabs/ProfileTab';
import { SecurityTab }          from '../tabs/SecurityTab';
import { ContentTypesTab }      from '../tabs/ContentTypesTab';
import { VoiceCloneTab }        from '../tabs/VoiceCloneTab';
import { NotificationsTab }     from '../tabs/NotificationsTab';
import { ProductsTab }          from '../tabs/ProductsTab';
import { AccountManagementTab } from '../tabs/AccountManagementTab';

const TAB_META: Record<string, { title: string; sub: string; component: React.FC }> = {
  profile: {
    title: 'Profile',
    sub: 'Your name, email, and account details.',
    component: ProfileTab,
  },
  security: {
    title: 'Security',
    sub: 'Password, MFA, and active sessions.',
    component: SecurityTab,
  },
  content: {
    title: 'Content types',
    sub: 'Choose what LaunchMind generates each week · Set once, change anytime.',
    component: ContentTypesTab,
  },
  voice: {
    title: 'Voice clone',
    sub: 'Your AI voice used in voice notes and video narration.',
    component: VoiceCloneTab,
  },
  notifications: {
    title: 'Notifications',
    sub: 'When and how LaunchMind reaches you.',
    component: NotificationsTab,
  },
  products: {
    title: 'Products',
    sub: 'Manage active and archived products.',
    component: ProductsTab,
  },
  account: {
    title: 'Account',
    sub: 'Data export, account deletion, and API keys.',
    component: AccountManagementTab,
  },
};

export default function SettingsTabPage({ params }: { params: { tab: string } }) {
  const meta = TAB_META[params.tab];
  if (!meta) return notFound();

  const { title, sub, component: TabComponent } = meta;

  return (
    <div className="p-4 sm:p-6">
      <div style={{ marginBottom: 24 }}>
        <h1 className="font-display font-bold" style={{ fontSize: 20, color: 'var(--ink)' }}>
          {title}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>{sub}</p>
      </div>
      <TabComponent />
    </div>
  );
}
