/**
 * @file app/page.tsx
 * @description Public marketing landing page + waitlist signup.
 *   Authenticated users are redirected to /dashboard via middleware.
 *   Unauthenticated visitors see the marketing page with waitlist form.
 * @security No auth required. Email submitted to POST /waitlist — never stored in client state beyond the form.
 */

'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const FEATURES = [
  {
    icon: '🔍',
    title: 'Discover in seconds',
    body: 'Paste your App Store or Play Store URL. We scrape reviews, ratings, and competitor gaps instantly.',
  },
  {
    icon: '🎯',
    title: 'AI-built ICP brief',
    body: 'Claude builds your ideal customer profile — target user, pain points, market opportunities — ready to edit and confirm.',
  },
  {
    icon: '🚀',
    title: '30/60/90-day strategy',
    body: 'Generate a full marketing strategy with WhatsApp, Meta, and Google campaigns for USA + India.',
  },
  {
    icon: '📊',
    title: 'Weekly learn loop',
    body: 'Every Sunday, get a brief: what worked, what to kill, and your next 3 moves — powered by real campaign data.',
  },
];

const MARKETS = [
  { flag: '🇺🇸', label: 'USA', note: 'Stripe · USD · App Store' },
  { flag: '🇮🇳', label: 'India', note: 'Razorpay · INR · Play Store' },
];

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'duplicate' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');

    try {
      const res = await fetch(`${API_URL}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), name: name.trim() || undefined, source: 'landing' }),
      });

      if (res.status === 201) {
        setStatus('success');
        setEmail('');
        setName('');
      } else if (res.status === 409) {
        setStatus('duplicate');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-50 font-sans">
      {/* Nav */}
      <nav className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-display text-xl font-semibold text-brand-teal">LaunchMind</span>
        <a
          href="/login"
          className="text-sm text-neutral-400 hover:text-neutral-100 transition-colors"
        >
          Sign in →
        </a>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          {MARKETS.map((m) => (
            <span key={m.label} className="text-sm bg-neutral-800 border border-neutral-700 rounded-full px-3 py-1 text-neutral-300">
              {m.flag} {m.label} · {m.note}
            </span>
          ))}
        </div>

        <h1 className="text-5xl sm:text-6xl font-display font-semibold leading-tight mb-6">
          The AI marketing OS<br />
          <span className="text-brand-teal">for app founders</span>
        </h1>

        <p className="text-xl text-neutral-400 max-w-2xl mx-auto mb-12">
          Paste your App Store URL. Get a full marketing strategy, content assets,
          and a weekly AI brief — for USA and India, from day one.
        </p>

        {/* Waitlist form */}
        <div className="max-w-md mx-auto">
          {status === 'success' ? (
            <div className="bg-brand-teal/10 border border-brand-teal/30 text-brand-teal rounded-xl px-6 py-5">
              <p className="font-semibold text-lg">You're on the list!</p>
              <p className="text-sm mt-1 text-brand-teal/80">We'll email you when early access opens.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                placeholder="Your name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-600 text-neutral-100 placeholder-neutral-500 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal"
              />
              <input
                type="email"
                placeholder="founder@yourapp.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-neutral-800 border border-neutral-600 text-neutral-100 placeholder-neutral-500 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-brand-teal text-neutral-900 font-semibold rounded-lg px-6 py-3 text-sm hover:bg-brand-teal/90 disabled:opacity-50 transition-colors"
              >
                {status === 'loading' ? 'Joining…' : 'Join the waitlist'}
              </button>
              {status === 'duplicate' && (
                <p className="text-brand-amber text-sm text-center">Already on the list — we'll be in touch!</p>
              )}
              {status === 'error' && (
                <p className="text-brand-coral text-sm text-center">Something went wrong. Please try again.</p>
              )}
            </form>
          )}
          <p className="text-xs text-neutral-500 mt-3">No spam. Early access only. Cancel anytime.</p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid sm:grid-cols-2 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-neutral-800 border border-neutral-700 rounded-xl p-6">
              <span className="text-3xl">{f.icon}</span>
              <h3 className="text-base font-semibold text-neutral-100 mt-3 mb-2">{f.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing preview */}
      <section className="max-w-3xl mx-auto px-6 pb-24 text-center">
        <h2 className="text-2xl font-display font-semibold text-neutral-100 mb-3">Simple pricing</h2>
        <p className="text-neutral-400 text-sm mb-8">Start free. Upgrade when you're ready to launch.</p>
        <div className="grid sm:grid-cols-4 gap-3">
          {[
            { plan: 'Free', price: '$0', note: '50 tokens · 1 product' },
            { plan: 'Solo', price: '$19', priceInr: '₹999', note: '300 tokens · 1 product', featured: true },
            { plan: 'Builder', price: '$49', priceInr: '₹2,499', note: '1,000 tokens · 3 products' },
            { plan: 'Studio', price: '$99', priceInr: '₹4,999', note: '3,000 tokens · 10 products' },
          ].map((tier) => (
            <div
              key={tier.plan}
              className={`rounded-xl p-5 border text-left ${
                tier.featured
                  ? 'border-2 border-brand-teal bg-neutral-800'
                  : 'border-neutral-700 bg-neutral-800/50'
              }`}
            >
              {tier.featured && (
                <span className="text-xs font-semibold text-brand-teal uppercase tracking-wide">Popular</span>
              )}
              <p className="text-base font-semibold text-neutral-100 mt-1">{tier.plan}</p>
              <p className="text-2xl font-display font-semibold text-neutral-50 mt-1">{tier.price}<span className="text-sm font-normal text-neutral-400">/mo</span></p>
              {tier.priceInr && <p className="text-xs text-neutral-500">{tier.priceInr}/mo in India</p>}
              <p className="text-xs text-neutral-400 mt-2">{tier.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-800 px-6 py-8 text-center text-xs text-neutral-500">
        <span className="font-display text-brand-teal font-semibold">LaunchMind</span>
        {' · '}Built for founders who ship.
        {' · '}
        <a href="/login" className="hover:text-neutral-300 transition-colors">Sign in</a>
        {' · '}
        <a href="/pricing" className="hover:text-neutral-300 transition-colors">Pricing</a>
      </footer>
    </div>
  );
}
