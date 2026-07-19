'use client';

/**
 * @file app/(dashboard)/dashboard/products/setup/business/page.tsx
 * @description Step 2 — Business model: revenue model, pricing, budget, KPIs, goals, timeline.
 *   Saves via PATCH /products/:id/intake/step/2.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import { SetupSteps } from '../SetupSteps';

const STORAGE_KEY = 'lm_setup_v3';

const REVENUE_MODELS = [
  { value: 'subscription', label: 'Subscription', desc: 'Monthly / annual plans' },
  { value: 'one_time',     label: 'One-time purchase', desc: 'Paid upfront' },
  { value: 'freemium',     label: 'Freemium', desc: 'Free + paid upgrades' },
  { value: 'ads',          label: 'Ad-supported', desc: 'Free with ads' },
  { value: 'marketplace',  label: 'Marketplace', desc: 'Transaction or listing fees' },
];

const KPIS = ['App installs', 'Daily active users', 'Subscription conversions', 'Revenue', 'Retention', 'Reviews / ratings', 'Cost per install'];

export default function SetupBusinessPage() {
  const router       = useRouter();
  const params       = useSearchParams();
  const productId    = params.get('id') ?? (() => {
    try { return (JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')).productId; } catch { return null; }
  })();

  const [revenueModel, setRevenueModel] = useState('freemium');
  const [budget, setBudget]             = useState('');
  const [kpis, setKpis]                 = useState<string[]>([]);
  const [goals, setGoals]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  function toggleKpi(kpi: string) {
    setKpis(prev => prev.includes(kpi) ? prev.filter(k => k !== kpi) : [...prev, kpi]);
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

      await api.products.saveIntakeStep(productId, 2, {
        revenue_model:  revenueModel,
        monthly_budget: budget ? parseInt(budget, 10) : undefined,
        confirmed_icp:  { kpis, goals },
      }, session.access_token);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ productId, step: 3 }));
      router.push(`/dashboard/products/setup/audience?id=${productId}`);
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
          Tell us about your business model and goals.
        </p>

        <SetupSteps current={2} />

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 20 }}>
            Business model
          </h2>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Revenue model */}
              <div>
                <label style={labelStyle}>Revenue model</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {REVENUE_MODELS.map(m => (
                    <div
                      key={m.value}
                      onClick={() => setRevenueModel(m.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 'var(--r2)', cursor: 'pointer',
                        border: revenueModel === m.value ? '1.5px solid var(--sage)' : '1px solid var(--border2)',
                        background: revenueModel === m.value ? 'var(--sage-d)' : 'var(--raised)',
                      }}
                    >
                      <div
                        style={{
                          width: 16, height: 16, borderRadius: '50%',
                          border: revenueModel === m.value ? '5px solid var(--sage)' : '2px solid var(--border2)',
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: revenueModel === m.value ? 'var(--sage)' : 'var(--ink)' }}>
                          {m.label}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{m.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly budget */}
              <div>
                <label style={labelStyle}>Monthly marketing budget (USD) <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  placeholder="e.g. 500"
                />
              </div>

              {/* KPIs */}
              <div>
                <label style={labelStyle}>Key metrics you care about <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(select all that apply)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {KPIS.map(kpi => (
                    <button
                      key={kpi}
                      type="button"
                      onClick={() => toggleKpi(kpi)}
                      style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 12,
                        border: kpis.includes(kpi) ? '1.5px solid var(--sage)' : '1.5px solid var(--border2)',
                        background: kpis.includes(kpi) ? 'var(--sage-d)' : 'var(--raised)',
                        color: kpis.includes(kpi) ? 'var(--sage)' : 'var(--ink2)',
                        cursor: 'pointer',
                      }}
                    >
                      {kpi}
                    </button>
                  ))}
                </div>
              </div>

              {/* Goals */}
              <div>
                <label style={labelStyle}>What's your primary goal for the next 90 days? <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  style={{ ...inputStyle, minHeight: 80, resize: 'vertical', lineHeight: 1.5 }}
                  value={goals}
                  onChange={e => setGoals(e.target.value)}
                  placeholder="e.g. Reach 10,000 installs, improve D7 retention to 40%, launch India market..."
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
                {loading ? 'Saving…' : 'Next: Audience →'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
