/**
 * @file app/(dashboard)/dashboard/brief/page.tsx
 * @description Morning Brief — thin server shell. All data-fetching and caching
 *   lives in BriefClientView so the page renders immediately from sessionStorage cache
 *   on repeat visits (stale-while-revalidate). First visit shows a spinner once.
 * @dependencies BriefClientView
 */

import { BriefClientView } from './BriefClientView';

export default function BriefPage() {
  const demoPerformanceRequested = process.env.NODE_ENV !== 'production'
    && process.env.MORNING_BRIEF_DEMO_DATA === 'true';
  return <BriefClientView demoPerformanceRequested={demoPerformanceRequested} />;
}
