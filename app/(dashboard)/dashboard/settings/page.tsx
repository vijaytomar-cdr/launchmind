/**
 * @file settings/page.tsx
 * @description Redirects /dashboard/settings to the default profile tab.
 *   Navigation is handled by the main sidebar accordion.
 */

import { redirect } from 'next/navigation';

export default function SettingsPage() {
  redirect('/dashboard/settings/profile');
}
