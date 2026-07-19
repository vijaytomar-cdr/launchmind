'use client';

/**
 * @file app/(dashboard)/dashboard/products/setup/audience/page.tsx
 * @description Step 3 — ICP / Target audience: persona, age range, geography, pain points, outcomes.
 *   Saves confirmed_icp JSONB via PATCH /products/:id/intake/step/3.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import { SetupSteps } from '../SetupSteps';

const STORAGE_KEY = 'lm_setup_v3';

const AGE_RANGES  = ['13–17', '18–24', '25–34', '35–44', '45–54', '55+'];
const MARKETS     = ['USA', 'India', 'UK', 'Canada', 'Australia', 'Southeast Asia', 'Europe', 'Global'];

export default function SetupAudiencePage() {
  const router    = useRouter();
  const params    = useSearchParams();
  const productId = params.get('id') ?? (() => {
    try { return (JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')).productId; } catch { return null; }
  })();

  const [persona, setPersona]         = useState('');
  const [ageRanges, setAgeRanges]     = useState<string[]>([]);
  const [geos, setGeos]               = useState<string[]>([]);
  const [painPoints, setPainPoints]   = useState('');
  const [outcomes, setOutcomes]       = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  function toggle<T>(arr: T[], setArr: (v: T[]) => void, val: T) {
    setArr(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
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

      await api.products.saveIntakeStep(productId, 3, {
        confirmed_icp: {
          persona,
          age_ranges:  ageRanges,
          geographies: geos,
          pain_points: painPoints,
          outcomes,
        },
      }, session.access_token);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ productId, step: 4 }));
      router.push(`/dashboard/products/setup/brand?id=${productId}`);
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
          Who are you building for?
        </p>

        <SetupSteps current={3} />

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 20 }}>
            Target audience
          </h2>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Persona */}
              <div>
                <label style={labelStyle}>Describe your ideal customer</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 72, resize: 'vertical', lineHeight: 1.5 }}
                  value={persona}
                  onChange={e => setPersona(e.target.value)}
                  placeholder="e.g. Early-career professionals aged 25–35 who struggle with habit building and want a structured daily routine..."
                  maxLength={800}
                />
              </div>

              {/* Age range */}
              <div>
                <label style={labelStyle}>Age range <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(select all that apply)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {AGE_RANGES.map(age => (
                    <button
                      key={age} type="button"
                      onClick={() => toggle(ageRanges, setAgeRanges, age)}
                      style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                        border: ageRanges.includes(age) ? '1.5px solid var(--sage)' : '1.5px solid var(--border2)',
                        background: ageRanges.includes(age) ? 'var(--sage-d)' : 'var(--raised)',
                        color: ageRanges.includes(age) ? 'var(--sage)' : 'var(--ink2)',
                      }}
                    >
                      {age}
                    </button>
                  ))}
                </div>
              </div>

              {/* Geography */}
              <div>
                <label style={labelStyle}>Primary markets <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(select all that apply)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {MARKETS.map(m => (
                    <button
                      key={m} type="button"
                      onClick={() => toggle(geos, setGeos, m)}
                      style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                        border: geos.includes(m) ? '1.5px solid var(--indigo)' : '1.5px solid var(--border2)',
                        background: geos.includes(m) ? 'var(--indigo-d)' : 'var(--raised)',
                        color: geos.includes(m) ? 'var(--indigo)' : 'var(--ink2)',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pain points */}
              <div>
                <label style={labelStyle}>What problem do you solve?</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 64, resize: 'vertical', lineHeight: 1.5 }}
                  value={painPoints}
                  onChange={e => setPainPoints(e.target.value)}
                  placeholder="e.g. Users forget to track habits, motivation drops after 3 days, existing apps are overwhelming..."
                  maxLength={600}
                />
              </div>

              {/* Outcomes */}
              <div>
                <label style={labelStyle}>What outcome does your user get?</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 64, resize: 'vertical', lineHeight: 1.5 }}
                  value={outcomes}
                  onChange={e => setOutcomes(e.target.value)}
                  placeholder="e.g. Builds a consistent routine in 30 days, visible progress dashboard, accountability partner features..."
                  maxLength={600}
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
                {loading ? 'Saving…' : 'Next: Brand →'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
