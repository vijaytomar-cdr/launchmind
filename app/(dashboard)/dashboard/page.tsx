/**
 * @file app/(dashboard)/dashboard/page.tsx
 * @description Root dashboard — redirects to Morning Brief per ADR-034.
 * @security No auth required here; brief page enforces auth.
 */

import { redirect } from 'next/navigation';

export default function DashboardRoot() {
  redirect('/dashboard/brief');
}
