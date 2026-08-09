/**
 * @file app/(dashboard)/dashboard/brief/page.tsx
 * @description Morning Brief — thin client shell. All data-fetching and caching
 *   lives in BriefClientView so the page renders immediately from sessionStorage cache
 *   on repeat visits (stale-while-revalidate). First visit shows a spinner once.
 * @dependencies BriefClientView
 */

'use client';

import { BriefClientView } from './BriefClientView';

export default function BriefPage() {
  return <BriefClientView />;
}
