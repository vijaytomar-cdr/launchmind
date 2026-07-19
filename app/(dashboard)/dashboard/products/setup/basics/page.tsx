'use client';

/**
 * @file app/(dashboard)/dashboard/products/setup/basics/page.tsx
 * @description Step 1 — Product basics: name, category, stage, store URL, country, language.
 *   On submit: creates the product via POST /products/setup/start, saves productId to
 *   sessionStorage, and navigates to Step 2.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import { SetupSteps } from '../SetupSteps';

const STORAGE_KEY = 'lm_setup_v3';

const STAGES = [
  { value: 'idea',     label: 'Idea / Pre-launch' },
  { value: 'beta',     label: 'Beta / Soft launch' },
  { value: 'launched', label: 'Live' },
  { value: 'scaling',  label: 'Scaling' },
];

const CATEGORIES = [
  'Productivity', 'Health & Fitness', 'Finance', 'Education', 'Social', 'Entertainment',
  'Shopping', 'Travel', 'Food & Drink', 'Utilities', 'Games', 'Business', 'Other',
];

export default function SetupBasicsPage() {
  const router = useRouter();
  const [name, setName]           = useState('');
  const [category, setCategory]   = useState('');
  const [stage, setStage]         = useState<string>('launched');
  const [storeUrl, setStoreUrl]   = useState('');
  const [country, setCountry]     = useState('');
  const [language, setLanguage]   = useState('en');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Product name is required'); return; }
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      const result = await api.products.setupStart({
        name: name.trim(),
        category: category || undefined,
        stage: stage || undefined,
        primary_language: language || undefined,
        country: country || undefined,
        store_url: storeUrl.trim() || undefined,
      }, session.access_token);

      const productId = result.product.id;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ productId, step: 2 }));
      router.push(`/dashboard/products/setup/business?id=${productId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--raised)', border: '1px solid var(--border2)',
    borderRadius: 'var(--r2)', padding: '8px 12px', fontSize: 14,
    color: 'var(--ink)', outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginBottom: 6,
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div style={{ maxWidth: 580 }}>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
          Set up your product
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 24 }}>
          Tell us about your product to personalise your AI strategy.
        </p>

        <SetupSteps current={1} />

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 20 }}>
            Product basics
          </h2>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Name */}
              <div>
                <label style={labelStyle}>Product name <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input
                  style={inputStyle}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. ClientPulse, AllignX"
                  maxLength={200}
                />
              </div>

              {/* Category */}
              <div>
                <label style={labelStyle}>Category</label>
                <select style={inputStyle} value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">Select a category</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Stage */}
              <div>
                <label style={labelStyle}>Stage</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {STAGES.map(s => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStage(s.value)}
                      style={{
                        padding: '6px 14px', borderRadius: 20, fontSize: 13,
                        border: stage === s.value ? '1.5px solid var(--sage)' : '1.5px solid var(--border2)',
                        background: stage === s.value ? 'var(--sage-d)' : 'var(--raised)',
                        color: stage === s.value ? 'var(--sage)' : 'var(--ink2)',
                        cursor: 'pointer', fontWeight: stage === s.value ? 600 : 400,
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Store URL (optional) */}
              <div>
                <label style={labelStyle}>App Store / Play Store URL <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  style={inputStyle}
                  value={storeUrl}
                  onChange={e => setStoreUrl(e.target.value)}
                  placeholder="https://apps.apple.com/... or https://play.google.com/..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Country */}
                <div>
                  <label style={labelStyle}>Primary country</label>
                  <input
                    style={inputStyle}
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    placeholder="e.g. US, IN"
                    maxLength={8}
                  />
                </div>

                {/* Language */}
                <div>
                  <label style={labelStyle}>Primary language</label>
                  <select style={inputStyle} value={language} onChange={e => setLanguage(e.target.value)}>
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                    <option value="hinglish">Hinglish</option>
                    <option value="es">Spanish</option>
                    <option value="pt">Portuguese</option>
                    <option value="fr">French</option>
                  </select>
                </div>
              </div>
            </div>

            {error && (
              <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--danger-d)', border: '1px solid var(--danger-b)', borderRadius: 'var(--r2)', color: 'var(--danger)', fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                style={{
                  background: 'var(--sage)', color: '#fff',
                  border: 'none', borderRadius: 'var(--r2)',
                  padding: '9px 20px', fontSize: 14, fontWeight: 500,
                  cursor: loading || !name.trim() ? 'not-allowed' : 'pointer',
                  opacity: loading || !name.trim() ? 0.6 : 1,
                }}
              >
                {loading ? 'Saving…' : 'Next: Business →'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
