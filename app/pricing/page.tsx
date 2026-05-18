/**
 * @file app/pricing/page.tsx
 * @description Public pricing page — 4 tier cards (Free, Solo, Builder, Studio)
 *   showing USD + INR prices. Currency detected from browser locale on the client.
 *   Authenticated users are redirected to the checkout flow.
 * @dependencies lib/supabase/server, lib/api
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PricingCards from '@/components/launchmind/PricingCards';

export const metadata = { title: 'Pricing — LaunchMind' };

export default async function PricingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-neutral-900">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-neutral-700">
        <span className="font-display font-bold text-white text-lg tracking-tight">
          LaunchMind
        </span>
        <div className="flex items-center gap-4">
          {user ? (
            <Link
              href="/dashboard/products"
              className="text-sm font-medium text-brand-teal hover:underline"
            >
              Dashboard →
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm text-neutral-300 hover:text-white">
                Login
              </Link>
              <Link
                href="/signup"
                className="text-sm font-semibold bg-brand-purple text-white px-4 py-2 rounded-lg hover:bg-brand-purple/90 transition-colors"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <div className="text-center pt-16 pb-10 px-6">
        <h1 className="text-4xl font-display font-bold text-white mb-3">
          Simple, transparent pricing
        </h1>
        <p className="text-neutral-300 text-base max-w-xl mx-auto">
          One subscription. Full marketing OS for your app — strategy, copy, campaigns, and
          weekly briefs. Cancel anytime.
        </p>
      </div>

      {/* Pricing cards (client component handles currency detection) */}
      <PricingCards isAuthenticated={!!user} />

      {/* Feature comparison */}
      <div className="max-w-4xl mx-auto px-6 pb-24 mt-16">
        <h2 className="text-lg font-display font-semibold text-white mb-6 text-center">
          What&apos;s included
        </h2>
        <div className="bg-neutral-800 border border-neutral-600 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-600">
                <th className="text-left p-4 text-neutral-300 font-medium w-1/2">Feature</th>
                <th className="p-4 text-neutral-300 font-medium">Free</th>
                <th className="p-4 text-neutral-300 font-medium">Solo</th>
                <th className="p-4 text-neutral-300 font-medium">Builder</th>
                <th className="p-4 text-neutral-300 font-medium">Studio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-700">
              {FEATURES.map((f) => (
                <tr key={f.label}>
                  <td className="p-4 text-neutral-200">{f.label}</td>
                  <td className="p-4 text-center">{cell(f.free)}</td>
                  <td className="p-4 text-center">{cell(f.solo)}</td>
                  <td className="p-4 text-center">{cell(f.builder)}</td>
                  <td className="p-4 text-center">{cell(f.studio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function cell(value: string | boolean) {
  if (value === true)
    return <span className="text-brand-teal font-bold">✓</span>;
  if (value === false)
    return <span className="text-neutral-600">—</span>;
  return <span className="text-white">{value}</span>;
}

const FEATURES = [
  { label: 'Products',              free: '1',    solo: '1',     builder: '3',     studio: '10'   },
  { label: 'AI token balance',      free: '50',   solo: '300',   builder: '1,000', studio: '3,000'},
  { label: 'Strategy generation',   free: false,  solo: true,    builder: true,    studio: true   },
  { label: 'Full 30/60/90 plan',    free: false,  solo: true,    builder: true,    studio: true   },
  { label: 'Content assets',        free: false,  solo: false,   builder: true,    studio: true   },
  { label: 'Weekly briefs',         free: false,  solo: true,    builder: true,    studio: true   },
  { label: 'USA + India markets',   free: true,   solo: true,    builder: true,    studio: true   },
  { label: 'UPI (Razorpay)',        free: false,  solo: true,    builder: true,    studio: true   },
  { label: 'Priority support',      free: false,  solo: false,   builder: true,    studio: true   },
];
