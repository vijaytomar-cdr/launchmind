'use client';

/**
 * @file app/(dashboard)/dashboard/products/setup/brand/page.tsx
 * @description Step 4 — Brand: voice, values, color palette, competitors, differentiators.
 *   Saves brand_voice_profile, brand_values, color_preferences, competitor_set via
 *   PATCH /products/:id/intake/step/4.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import { SetupSteps } from '../SetupSteps';

const STORAGE_KEY = 'lm_setup_v3';

const BRAND_VOICES = [
  { value: 'friendly',     label: '😊 Friendly',     desc: 'Warm, approachable, conversational' },
  { value: 'professional', label: '💼 Professional',  desc: 'Authoritative, polished, trustworthy' },
  { value: 'playful',      label: '🎉 Playful',       desc: 'Fun, energetic, light-hearted' },
  { value: 'bold',         label: '⚡ Bold',           desc: 'Direct, confident, unapologetic' },
  { value: 'inspiring',    label: '🚀 Inspiring',      desc: 'Motivational, aspirational, uplifting' },
];

const BRAND_VALUES_LIST = [
  'Simplicity', 'Trust', 'Innovation', 'Community', 'Empowerment',
  'Transparency', 'Performance', 'Wellness', 'Fun', 'Privacy',
];

const PRESET_COLORS = [
  '#059669', '#4f46e5', '#d97706', '#dc2626', '#0891b2',
  '#7c3aed', '#ea580c', '#16a34a', '#0284c7', '#be185d',
];

export default function SetupBrandPage() {
  const router    = useRouter();
  const params    = useSearchParams();
  const productId = params.get('id') ?? (() => {
    try { return (JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')).productId; } catch { return null; }
  })();

  const [voice, setVoice]               = useState('professional');
  const [values, setValues]             = useState<string[]>([]);
  const [primaryColor, setPrimaryColor] = useState('#059669');
  const [competitor1, setCompetitor1]   = useState('');
  const [competitor2, setCompetitor2]   = useState('');
  const [differentiator, setDifferentiator] = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  function toggleValue(v: string) {
    setValues(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) { setError('Product ID missing — please restart from Step 1'); return; }
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      const competitors = [competitor1, competitor2].filter(Boolean);

      await api.products.saveIntakeStep(productId, 4, {
        brand_voice_profile: { tone: voice, adjectives: [] },
        brand_values:        values,
        color_preferences:   { primary: primaryColor },
        competitor_set:      competitors.length > 0 ? { competitors } : undefined,
        confirmed_icp:       { differentiator },
      }, session.access_token);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ productId, step: 5 }));
      router.push(`/dashboard/products/setup/connect?id=${productId}`);
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
          Define your brand voice and visual identity.
        </p>

        <SetupSteps current={4} />

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 20 }}>
            Brand
          </h2>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Brand voice */}
              <div>
                <label style={labelStyle}>Brand voice</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {BRAND_VOICES.map(v => (
                    <div
                      key={v.value}
                      onClick={() => setVoice(v.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 12px', borderRadius: 'var(--r2)', cursor: 'pointer',
                        border: voice === v.value ? '1.5px solid var(--sage)' : '1px solid var(--border2)',
                        background: voice === v.value ? 'var(--sage-d)' : 'var(--raised)',
                      }}
                    >
                      <div style={{
                        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                        border: voice === v.value ? '4px solid var(--sage)' : '2px solid var(--border2)',
                      }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: voice === v.value ? 'var(--sage)' : 'var(--ink)' }}>{v.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{v.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Brand values */}
              <div>
                <label style={labelStyle}>Brand values <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(pick up to 4)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {BRAND_VALUES_LIST.map(v => (
                    <button
                      key={v} type="button"
                      onClick={() => toggleValue(v)}
                      disabled={!values.includes(v) && values.length >= 4}
                      style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                        border: values.includes(v) ? '1.5px solid var(--sage)' : '1.5px solid var(--border2)',
                        background: values.includes(v) ? 'var(--sage-d)' : 'var(--raised)',
                        color: values.includes(v) ? 'var(--sage)' : 'var(--ink2)',
                        opacity: !values.includes(v) && values.length >= 4 ? 0.4 : 1,
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary color */}
              <div>
                <label style={labelStyle}>Primary brand color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c} type="button"
                      onClick={() => setPrimaryColor(c)}
                      style={{
                        width: 28, height: 28, borderRadius: '50%', background: c,
                        border: primaryColor === c ? `3px solid var(--ink)` : '2px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={e => setPrimaryColor(e.target.value)}
                      style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0 }}
                    />
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--ink2)' }}>{primaryColor}</span>
                  </div>
                </div>
              </div>

              {/* Competitors */}
              <div>
                <label style={labelStyle}>Main competitors <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input style={inputStyle} value={competitor1} onChange={e => setCompetitor1(e.target.value)} placeholder="Competitor 1 name or URL" />
                  <input style={inputStyle} value={competitor2} onChange={e => setCompetitor2(e.target.value)} placeholder="Competitor 2 name or URL" />
                </div>
              </div>

              {/* Differentiator */}
              <div>
                <label style={labelStyle}>What makes you different? <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  style={{ ...inputStyle, minHeight: 64, resize: 'vertical', lineHeight: 1.5 }}
                  value={differentiator}
                  onChange={e => setDifferentiator(e.target.value)}
                  placeholder="e.g. Unlike Notion, we auto-prioritise your task list using AI based on your energy and deadlines..."
                  maxLength={500}
                />
              </div>
            </div>

            {error && (
              <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--danger-d)', border: '1px solid var(--danger-b)', borderRadius: 'var(--r2)', color: 'var(--danger)', fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
              <button
                type="button"
                onClick={() => router.back()}
                style={{
                  background: 'transparent', border: '1px solid var(--border2)', borderRadius: 'var(--r2)',
                  padding: '8px 16px', fontSize: 13, color: 'var(--ink2)', cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={loading}
                style={{
                  background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 'var(--r2)',
                  padding: '9px 20px', fontSize: 14, fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? 'Saving…' : 'Next: Connect →'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
