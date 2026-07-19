'use client';

/**
 * @file app/(dashboard)/dashboard/products/setup/connect/page.tsx
 * @description Step 5 — Connect integrations: App Store, GA4, Firebase, Search Console,
 *   Website URL, Meta Ads, Google Ads. Optional step — can skip to complete intake.
 *   On complete: calls POST /products/:id/intake/complete and navigates to strategy page.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import { SetupSteps } from '../SetupSteps';
import {
  IconBrandGoogle,
  IconBrandFacebook,
  IconWorld,
  IconChartBar,
  IconBrandFirebase,
  IconSearch,
  IconCheck,
  IconArrowRight,
} from '@tabler/icons-react';

const STORAGE_KEY = 'lm_setup_v3';

interface ConnectorStatus {
  connected: boolean;
  loading:   boolean;
  error:     string | null;
}

const DEFAULT_STATUS: ConnectorStatus = { connected: false, loading: false, error: null };

export default function SetupConnectPage() {
  const router    = useRouter();
  const params    = useSearchParams();
  const productId = params.get('id') ?? (() => {
    try { return (JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')).productId; } catch { return null; }
  })();

  const [ga4Key, setGa4Key]         = useState('');
  const [ga4Config, setGa4Config]   = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [statuses, setStatuses]     = useState<Record<string, ConnectorStatus>>({
    ga4: { ...DEFAULT_STATUS },
    website: { ...DEFAULT_STATUS },
  });
  const [completing, setCompleting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  function setStatus(key: string, patch: Partial<ConnectorStatus>) {
    setStatuses(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function connectGa4() {
    if (!ga4Key.trim()) return;
    setStatus('ga4', { loading: true, error: null });
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      let config: Record<string, unknown> = {};
      if (ga4Config.trim()) {
        try { config = { propertyId: ga4Config.trim() }; } catch { /* ignore */ }
      }

      await api.integrations.connectGa4({ api_key: ga4Key.trim(), integration_config: config }, session.access_token);
      setStatus('ga4', { connected: true, loading: false });
    } catch (err) {
      setStatus('ga4', { loading: false, error: err instanceof Error ? err.message : 'Failed to connect' });
    }
  }

  async function connectWebsite() {
    if (!websiteUrl.trim()) return;
    setStatus('website', { loading: true, error: null });
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      await api.integrations.connectWebsite({ url: websiteUrl.trim() }, session.access_token);
      setStatus('website', { connected: true, loading: false });
    } catch (err) {
      setStatus('website', { loading: false, error: err instanceof Error ? err.message : 'Failed to connect' });
    }
  }

  async function handleComplete() {
    if (!productId) { setError('Product ID missing'); return; }
    setCompleting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      await api.products.completeIntake(productId, session.access_token);
      sessionStorage.removeItem(STORAGE_KEY);
      router.push(`/dashboard/products/${productId}/strategy`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setCompleting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, background: 'var(--raised)', border: '1px solid var(--border2)',
    borderRadius: 'var(--r2)', padding: '7px 10px', fontSize: 13,
    color: 'var(--ink)', outline: 'none',
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div style={{ maxWidth: 580 }}>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
          Set up your product
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 24 }}>
          Connect your analytics and ad accounts. All optional — you can add them later.
        </p>

        <SetupSteps current={5} />

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 24 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
            Connect data sources
          </h2>
          <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 20 }}>
            LaunchMind uses these to give you data-driven recommendations.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* GA4 */}
            <ConnectorRow
              icon={<IconChartBar size={18} color="#e37400" />}
              label="Google Analytics 4"
              sublabel="App install + conversion data"
              connected={statuses.ga4.connected}
              loading={statuses.ga4.loading}
              error={statuses.ga4.error}
            >
              {!statuses.ga4.connected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input style={inputStyle} value={ga4Key} onChange={e => setGa4Key(e.target.value)} placeholder="GA4 Measurement API secret" />
                    <input style={{ ...inputStyle, maxWidth: 140 }} value={ga4Config} onChange={e => setGa4Config(e.target.value)} placeholder="Property ID (optional)" />
                    <button type="button" onClick={connectGa4} disabled={!ga4Key.trim() || statuses.ga4.loading}
                      style={{ padding: '7px 14px', borderRadius: 'var(--r2)', background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      Connect
                    </button>
                  </div>
                </div>
              )}
            </ConnectorRow>

            {/* Website */}
            <ConnectorRow
              icon={<IconWorld size={18} color="var(--ink2)" />}
              label="Website URL"
              sublabel="Used to scrape hero images and metadata"
              connected={statuses.website.connected}
              loading={statuses.website.loading}
              error={statuses.website.error}
            >
              {!statuses.website.connected && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input style={inputStyle} value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://yourapp.com" />
                  <button type="button" onClick={connectWebsite} disabled={!websiteUrl.trim() || statuses.website.loading}
                    style={{ padding: '7px 14px', borderRadius: 'var(--r2)', background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                    Connect
                  </button>
                </div>
              )}
            </ConnectorRow>

            {/* Meta Ads — OAuth (coming soon) */}
            <ConnectorRow
              icon={<IconBrandFacebook size={18} color="#1877f2" />}
              label="Meta Ads"
              sublabel="Facebook & Instagram campaigns"
              connected={false}
              loading={false}
              error={null}
              comingSoon
            />

            {/* Google Ads — OAuth (coming soon) */}
            <ConnectorRow
              icon={<IconBrandGoogle size={18} color="#4285f4" />}
              label="Google Ads"
              sublabel="UAC + Performance Max campaigns"
              connected={false}
              loading={false}
              error={null}
              comingSoon
            />
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
              type="button"
              onClick={handleComplete}
              disabled={completing}
              style={{
                background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 'var(--r2)',
                padding: '9px 20px', fontSize: 14, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 6,
                cursor: completing ? 'not-allowed' : 'pointer', opacity: completing ? 0.6 : 1,
              }}
            >
              {completing ? 'Setting up…' : <><span>Generate strategy</span><IconArrowRight size={16} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectorRow({
  icon, label, sublabel, connected, loading, error, comingSoon, children,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  connected: boolean;
  loading: boolean;
  error: string | null;
  comingSoon?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      background: connected ? 'var(--sage-d)' : 'var(--raised)',
      border: connected ? '1.5px solid var(--sage-b)' : '1px solid var(--border2)',
      borderRadius: 'var(--r2)',
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface)', border: '1px solid var(--border)', flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{sublabel}</div>
        </div>
        {connected && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 12,
            padding: '2px 8px', fontSize: 12, color: 'var(--sage)',
          }}>
            <IconCheck size={12} /> Connected
          </div>
        )}
        {loading && <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Connecting…</span>}
        {comingSoon && (
          <span style={{ fontSize: 11, color: 'var(--ink3)', background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 10, padding: '2px 8px' }}>
            Soon
          </span>
        )}
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      {children}
    </div>
  );
}
