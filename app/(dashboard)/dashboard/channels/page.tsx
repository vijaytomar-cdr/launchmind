/**
 * @file app/(dashboard)/dashboard/channels/page.tsx
 * @description Platform channel management — connect WhatsApp, Meta, Google, LinkedIn, and Email.
 *   WhatsApp: connectable for all paid plans via OAuth.
 *   Meta/Google/LinkedIn/Email: Builder/Studio see active Connect button; Solo/Free see plan gate.
 *   Security trust callout at bottom.
 * @security
 *   - All channel mutations proxy through the Fastify backend.
 *   - OAuth initiation returns a URL; frontend redirects — no tokens handled here.
 *   - Disconnect calls DELETE /channels/:platform — backend sets revoked_at, row preserved.
 *   - connected=whatsapp and error= search params handled from OAuth callback redirect.
 * @dependencies lib/supabase/client, lib/api
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { ConnectedChannel, SupportedPlatform } from '@/lib/api';
import { trackOnboarding } from '@/lib/analytics';
import {
  IconBrandWhatsapp,
  IconBrandFacebook,
  IconBrandGoogle,
  IconBrandLinkedin,
  IconMail,
  IconLock,
  IconCheck,
} from '@tabler/icons-react';

type ChannelIconComp = React.ComponentType<{ size?: number | string; color?: string; stroke?: number | string }>;

const PLATFORM_META: Record<
  string,
  { label: string; Icon: ChannelIconComp; iconColor: string; iconBg: string; iconBorder: string; description: string; scopeLabel: string; minPlan: 'solo' | 'builder' }
> = {
  whatsapp: {
    label: 'WhatsApp Business',
    Icon: IconBrandWhatsapp,
    iconColor: 'var(--sage)',
    iconBg: 'var(--sage-d)',
    iconBorder: 'var(--sage-b)',
    description: 'Send broadcast messages and receive read receipts via Meta Cloud API.',
    scopeLabel: 'messaging scope',
    minPlan: 'solo',
  },
  meta: {
    label: 'Meta Ads',
    Icon: IconBrandFacebook,
    iconColor: 'var(--indigo)',
    iconBg: 'var(--indigo-d)',
    iconBorder: 'var(--indigo-b)',
    description: 'Run Facebook and Instagram ad campaigns.',
    scopeLabel: 'ads_management scope',
    minPlan: 'builder',
  },
  google: {
    label: 'Google Ads (UAC)',
    Icon: IconBrandGoogle,
    iconColor: 'var(--indigo)',
    iconBg: 'var(--indigo-d)',
    iconBorder: 'var(--indigo-b)',
    description: 'Run Google Search and App Install campaigns.',
    scopeLabel: 'campaign scope',
    minPlan: 'builder',
  },
  linkedin: {
    label: 'LinkedIn',
    Icon: IconBrandLinkedin,
    iconColor: 'var(--indigo)',
    iconBg: 'var(--indigo-d)',
    iconBorder: 'var(--indigo-b)',
    description: 'Reach B2B audiences with LinkedIn campaigns.',
    scopeLabel: 'ads scope',
    minPlan: 'builder',
  },
  email: {
    label: 'Email (Resend)',
    Icon: IconMail,
    iconColor: 'var(--ink2)',
    iconBg: 'var(--raised)',
    iconBorder: 'var(--border2)',
    description: 'Send transactional and campaign emails via Resend.',
    scopeLabel: 'send scope',
    minPlan: 'solo',
  },
};

const PLAN_RANK: Record<string, number> = { free: 0, solo: 1, builder: 2, studio: 3 };
const ALL_PLATFORMS: SupportedPlatform[] = ['whatsapp', 'meta', 'google', 'linkedin', 'email'];

const SECURITY_FEATURES = [
  'OAuth only — no passwords stored ever',
  'AES-256 token encryption at rest',
  'Campaign scope only — no billing access',
  'Spend cap enforced server-side',
];

export default function ChannelsPage() {
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [channels, setChannels] = useState<ConnectedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState('free');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }, [supabase]);

  const loadChannels = useCallback(async () => {
    try {
      const token = await getToken();
      const { channels: data } = await api.channels.list(token);
      setChannels(data);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/billing/subscription`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const sub = await res.json();
        if (sub?.plan) setPlan(sub.plan);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('error');
    if (connected) {
      setSuccessMsg(`${PLATFORM_META[connected]?.label ?? connected} connected successfully.`);
      trackOnboarding('channel_connected', { platform: connected });
      loadChannels();
    }
    if (oauthError === 'oauth_denied') setError('OAuth authorisation was denied.');
    if (oauthError === 'oauth_failed') setError('OAuth connection failed. Please try again.');
  }, [searchParams, loadChannels]);

  async function handleConnect(platform: SupportedPlatform) {
    if (platform !== 'whatsapp') {
      setSuccessMsg(`${PLATFORM_META[platform]?.label ?? platform} integration is coming soon — you're on the early access list.`);
      return;
    }
    setConnecting(platform);
    setError(null);
    try {
      const token = await getToken();
      const { url } = await api.channels.oauthInit(token);
      window.location.href = url;
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      setConnecting(null);
    }
  }

  async function handleDisconnect(platform: SupportedPlatform) {
    if (disconnectConfirm !== platform) {
      setDisconnectConfirm(platform);
      return;
    }
    setDisconnecting(platform);
    setDisconnectConfirm(null);
    setError(null);
    try {
      const token = await getToken();
      await api.channels.revoke(platform, token);
      setSuccessMsg(`${PLATFORM_META[platform]?.label ?? platform} disconnected.`);
      await loadChannels();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setDisconnecting(null);
    }
  }

  function getChannelStatus(platform: string): ConnectedChannel | undefined {
    return channels.find((c) => c.platform === platform && !c.revokedAt);
  }

  function canConnect(platform: SupportedPlatform): boolean {
    const meta = PLATFORM_META[platform];
    const required = PLAN_RANK[meta.minPlan] ?? 1;
    return PLAN_RANK[plan] >= required;
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
        Connected channels
      </h1>
      <p className="mb-5" style={{ fontSize: 12, color: 'var(--ink2)' }}>
        LaunchMind uses OAuth — we never store your passwords. Revoke access anytime from this page.
      </p>

      {error && (
        <div
          className="mb-4 rounded-[8px] px-4 py-3 flex justify-between items-center"
          style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}
        >
          {error}
          <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      {successMsg && (
        <div
          className="mb-4 rounded-[8px] px-4 py-3 flex justify-between items-center"
          style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 13 }}
        >
          {successMsg}
          <button onClick={() => setSuccessMsg(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center" style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading channels…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {ALL_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const connected = getChannelStatus(platform);
            const allowed = canConnect(platform);
            const isConnecting = connecting === platform;
            const isDisconnecting = disconnecting === platform;
            const awaitingConfirm = disconnectConfirm === platform;
            const requiredPlan = meta.minPlan === 'builder' ? 'Builder' : 'Solo';

            const iconColor = connected ? meta.iconColor : allowed ? meta.iconColor : 'var(--ink3)';
            const iconBg = connected ? meta.iconBg : allowed ? meta.iconBg : 'var(--raised)';
            const iconBorder = connected ? meta.iconBorder : allowed ? meta.iconBorder : 'var(--border2)';

            return (
              <div
                key={platform}
                style={{
                  background: 'var(--surface)',
                  border: connected ? '1.5px solid var(--sage-b)' : '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                {/* Platform icon */}
                <div style={{
                  width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: iconBg, border: `1px solid ${iconBorder}`,
                }}>
                  <meta.Icon size={18} color={iconColor} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{meta.label}</span>
                    {connected ? (
                      <span style={{ fontSize: 11, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)', borderRadius: 9999, padding: '1px 8px', fontWeight: 500 }}>
                        Active
                      </span>
                    ) : !allowed ? (
                      <span style={{ fontSize: 11, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)', borderRadius: 9999, padding: '1px 8px' }}>
                        {requiredPlan}+ required
                      </span>
                    ) : null}
                  </div>
                  <p style={{ fontSize: 12, color: connected ? 'var(--sage)' : 'var(--ink2)', margin: '2px 0 0' }}>
                    {connected
                      ? `Connected · ${meta.scopeLabel}`
                      : meta.description}
                  </p>
                  {connected && (
                    <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '1px 0 0' }}>
                      Since {new Date(connected.createdAt).toLocaleDateString()}
                      {connected.expiresAt && ` · Expires ${new Date(connected.expiresAt).toLocaleDateString()}`}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div style={{ flexShrink: 0 }}>
                  {connected ? (
                    awaitingConfirm ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setDisconnectConfirm(null)}
                          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border2)', color: 'var(--ink2)', background: 'var(--surface)', cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDisconnect(platform)}
                          disabled={isDisconnecting}
                          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', opacity: isDisconnecting ? 0.6 : 1 }}
                        >
                          {isDisconnecting ? '…' : 'Confirm'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDisconnect(platform)}
                        style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border2)', color: 'var(--ink2)', background: 'var(--surface)', cursor: 'pointer' }}
                      >
                        Disconnect
                      </button>
                    )
                  ) : allowed ? (
                    <button
                      onClick={() => handleConnect(platform)}
                      disabled={isConnecting}
                      style={{ fontSize: 12, fontWeight: 500, padding: '5px 14px', borderRadius: 6, background: 'var(--sage)', color: '#fff', border: 'none', cursor: isConnecting ? 'not-allowed' : 'pointer', opacity: isConnecting ? 0.6 : 1 }}
                    >
                      {isConnecting ? 'Redirecting…' : 'Connect'}
                    </button>
                  ) : (
                    <a
                      href="/dashboard/billing"
                      style={{ fontSize: 12, fontWeight: 500, padding: '5px 12px', borderRadius: 6, background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)', color: 'var(--indigo)', textDecoration: 'none', display: 'inline-block' }}
                    >
                      Upgrade to {requiredPlan}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Security features 2×2 grid */}
      <div
        className="mt-5 rounded-[10px] p-4"
        style={{ background: 'var(--raised)', border: '1px solid transparent' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <IconLock size={13} color="var(--sage)" />
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink2)' }}>
            How we protect your credentials
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 6 }}>
          {SECURITY_FEATURES.map((feature) => (
            <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconCheck size={12} color="var(--sage)" />
              <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{feature}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4" style={{ fontSize: 11, color: 'var(--ink3)' }}>
        Disconnect removes your token from LaunchMind. You may also need to revoke access in the
        platform&apos;s own app settings.
      </p>
    </div>
  );
}
