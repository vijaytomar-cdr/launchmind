/**
 * @file components/launchmind/PricingCards.tsx
 * @description Client component rendering 4 tier cards.
 *   Detects user locale on mount to choose USD vs INR display.
 *   Routes authenticated users to /dashboard/settings/billing for plan change,
 *   unauthenticated users to /signup with plan param.
 * @security No payment details handled here — checkout initiated server-side via /billing/checkout.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    usd: 0,
    inr: 0,
    tokens: 50,
    products: 1,
    description: 'Explore the platform and generate your first strategy.',
    featured: false,
    features: ['1 product', '50 AI tokens', 'Strategy preview', 'USA + India markets'],
  },
  {
    id: 'solo' as const,
    name: 'Solo',
    usd: 19,
    inr: 999,
    tokens: 300,
    products: 1,
    description: 'Strategy generation + weekly briefs for one product.',
    featured: false,
    features: [
      '1 product',
      '300 AI tokens/month',
      '30/60/90 day strategy',
      'Weekly briefs',
      'USA + India markets',
    ],
  },
  {
    id: 'builder' as const,
    name: 'Builder',
    usd: 49,
    inr: 2499,
    tokens: 1000,
    products: 3,
    description: 'Full execution: strategy + content assets across 3 apps.',
    featured: true,
    features: [
      '3 products',
      '1,000 AI tokens/month',
      'Everything in Solo',
      'Content assets (WhatsApp, Email, Meta)',
      'Priority support',
    ],
  },
  {
    id: 'studio' as const,
    name: 'Studio',
    usd: 99,
    inr: 4999,
    tokens: 3000,
    products: 10,
    description: 'For studios managing a portfolio of apps.',
    featured: false,
    features: [
      '10 products',
      '3,000 AI tokens/month',
      'Everything in Builder',
      'Dedicated onboarding',
    ],
  },
] as const;

type PlanId = (typeof PLANS)[number]['id'];

function formatPrice(plan: (typeof PLANS)[number], currency: 'usd' | 'inr') {
  if (plan.id === 'free') return 'Free';
  if (currency === 'inr') return `₹${plan.inr.toLocaleString('en-IN')}/mo`;
  return `$${plan.usd}/mo`;
}

export default function PricingCards({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [currency, setCurrency] = useState<'usd' | 'inr'>('usd');

  useEffect(() => {
    const locale = navigator.language ?? '';
    if (locale.includes('IN') || Intl.DateTimeFormat().resolvedOptions().timeZone?.includes('Asia/Kolkata')) {
      setCurrency('inr');
    }
  }, []);

  function ctaHref(planId: PlanId) {
    if (planId === 'free') {
      return isAuthenticated ? '/dashboard/products' : '/signup';
    }
    if (isAuthenticated) {
      return `/dashboard/settings/billing?plan=${planId}&currency=${currency}`;
    }
    return `/signup?plan=${planId}&currency=${currency}`;
  }

  return (
    <div className="max-w-5xl mx-auto px-6">
      {/* Currency toggle */}
      <div className="flex justify-center mb-8">
        <div className="flex items-center gap-1 bg-neutral-800 border border-neutral-600 rounded-lg p-1">
          {(['usd', 'inr'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currency === c
                  ? 'bg-brand-teal text-neutral-900'
                  : 'text-neutral-300 hover:text-white'
              }`}
            >
              {c === 'usd' ? '🇺🇸 USD' : '🇮🇳 INR'}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`flex flex-col rounded-xl p-6 ${
              plan.featured
                ? 'bg-neutral-800 border-2 border-brand-teal'
                : 'bg-neutral-800 border border-neutral-600'
            }`}
          >
            {plan.featured && (
              <span className="text-xs font-semibold text-brand-teal uppercase tracking-wider mb-3">
                Most popular
              </span>
            )}
            <h3 className="text-base font-display font-bold text-white">{plan.name}</h3>
            <p className="text-2xl font-bold text-white mt-2 mb-1">
              {formatPrice(plan, currency)}
            </p>
            <p className="text-xs text-neutral-400 mb-5">{plan.description}</p>

            <ul className="space-y-2 mb-8 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-neutral-200">
                  <span className="text-brand-teal mt-0.5 shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href={ctaHref(plan.id)}
              className={`text-center text-sm font-semibold py-2.5 rounded-lg transition-colors ${
                plan.featured
                  ? 'bg-brand-teal text-neutral-900 hover:bg-brand-teal/90'
                  : plan.id === 'free'
                  ? 'bg-neutral-700 text-white hover:bg-neutral-600'
                  : 'bg-brand-purple text-white hover:bg-brand-purple/90'
              }`}
            >
              {plan.id === 'free' ? 'Get started free' : `Choose ${plan.name}`}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
