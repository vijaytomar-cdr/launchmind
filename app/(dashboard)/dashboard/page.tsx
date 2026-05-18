/**
 * @file app/(dashboard)/dashboard/page.tsx
 * @description Empty dashboard home — redirects to /dashboard/products for now.
 *   Will become the analytics overview in Phase 2.
 */

import { redirect } from 'next/navigation';

export default function DashboardPage() {
  redirect('/dashboard/products');
}
