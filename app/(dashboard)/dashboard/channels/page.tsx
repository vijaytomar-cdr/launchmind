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

const PLATFORM_META: Record<
  string,
  { label: string; icon: string; description: string; minPlan: 'solo' | 'builder' }
> = {
  whatsapp: {
    label: 'WhatsApp Business',
    icon: '💬',
    description: 'Send broadcast messages and receive read receipts via Meta Cloud API.',
    minPlan: 'solo',
  },
  meta: {
    label: 'Meta Ads',
    icon: '📘',
    description: 'Run Facebook and Instagram ad campaigns.',
    minPlan: 'builder',
  },
  google: {
    label: 'Google Ads',
    icon: '🔍',
    description: 'Run Google Search and App Install campaigns.',
    minPlan: 'builder',
  },
  linkedin: {
    label: 'LinkedIn Ads',
    icon: '💼',
    description: 'Reach B2B audiences with LinkedIn campaigns.',
    minPlan: 'builder',
  },
  email: {
    label: 'Email (Resend)',
    icon: '✉️',
    description: 'Send transactional and campaign emails via Resend.',
    minPlan: 'solo',
  },
};

const PLAN_RANK: Record<string, number> = { free: 0, solo: 1, builder: 2, studio: 3 };

const ALL_PLATFORMS: SupportedPlatform[] = ['whatsapp', 'meta', 'google', 'linkedin', 'email'];

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
  const [comingSoonPlatform, setComingSoonPlatform] = useState<string | null>(null);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }, [supabase]);

  const loadChannels = useCallback(async () => {
    try {
      const token = await getToken();
      const { channels: data } = await api.channels.list(token);
      setChannels(data);
      // Fetch plan
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

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

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
      setComingSoonPlatform(platform);
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
    <div className="p-6 max-w-3xl">
      {/* Coming soon modal */}
      {comingSoonPlatform && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => setComingSoonPlatform(null)}
        >
          <div
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '28px 32px', maxWidth: 380, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-2xl mb-3">{PLATFORM_META[comingSoonPlatform]?.icon}</div>
            <h3 className="font-display font-bold" style={{ fontSize: 16, color: 'var(--ink)', marginBottom: 8 }}>
              {PLATFORM_META[comingSoonPlatform]?.label} — coming soon
            </h3>
            <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6, marginBottom: 20 }}>
              Full OAuth integration for {PLATFORM_META[comingSoonPlatform]?.label} is launching in Phase 6.
              You&apos;re on the early access list.
            </p>
            <button
              onClick={() => setComingSoonPlatform(null)}
              style={{
                width: '100%', fontSize: 13, fontWeight: 500, padding: '9px 16px', borderRadius: 6,
                cursor: 'pointer', background: 'var(--sage)', color: '#fff', border: 'none',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <h1 className="font-display font-bold mb-1" style={{ fontSize: 22, color: 'var(--ink)' }}>
        Channels
      </h1>
      <p className="mb-6" style={{ fontSize: 13, color: 'var(--ink2)' }}>
        Connect marketing channels to send campaigns directly from LaunchMind.
      </p>

      {error && (
        <div
          className="mb-4 rounded-[8px] px-4 py-3 flex justify-between items-center"
          style={{ background: 'var(--red-d)', border: '1px solid var(--red-b)', color: 'var(--red)', fontSize: 13 }}
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
        <div className="py-8 text-center" style={{ fontSize: 13, color: 'var(--ink3)' }}>
          Loading channels…
        </div>
      ) : (
        <div className="space-y-3">
          {ALL_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            const connected = getChannelStatus(platform);
            const allowed = canConnect(platform);
            const isConnecting = connecting === platform;
            const isDisconnecting = disconnecting === platform;
            const awaitingConfirm = disconnectConfirm === platform;
            const requiredPlan = meta.minPlan === 'builder' ? 'Builder' : 'Solo';

            return (
              <div
                key={platform}
                className="rounded-[10px] p-5 flex items-start justify-between gap-4"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-2xl mt-0.5">{meta.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" style={{ fontSize: 13, color: 'var(--ink)' }}>
                        {meta.label}
                      </span>
                      {connected ? (
                        <span
                          className="rounded-full px-2 py-0.5 font-medium"
                          style={{ fontSize: 11, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' }}
                        >
                          Connected
                        </span>
                      ) : !allowed ? (
                        <span
                          className="rounded-full px-2 py-0.5 font-medium"
                          style={{ fontSize: 11, background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)' }}
                        >
                          {requiredPlan}+ required
                        </span>
                      ) : (
                        <span
                          className="rounded-full px-2 py-0.5"
                          style={{ fontSize: 11, background: 'var(--raised)', color: 'var(--ink3)' }}
                        >
                          Not connected
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 3 }}>{meta.description}</p>
                    {connected && (
                      <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
                        Connected {new Date(connected.createdAt).toLocaleDateString()}
                        {connected.expiresAt &&
                          ` · Expires ${new Date(connected.expiresAt).toLocaleDateString()}`}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  {connected ? (
                    awaitingConfirm ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDisconnectConfirm(null)}
                          className="rounded-[6px] px-3 py-1.5 transition-opacity hover:opacity-80"
                          style={{ fontSize: 12, border: '1px solid var(--border2)', color: 'var(--ink2)' }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDisconnect(platform)}
                          disabled={isDisconnecting}
                          className="rounded-[6px] px-3 py-1.5 font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
                          style={{ fontSize: 12, background: 'var(--red)', color: '#fff' }}
                        >
                          {isDisconnecting ? 'Disconnecting…' : 'Confirm disconnect'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDisconnect(platform)}
                        disabled={isDisconnecting}
                        className="rounded-[6px] px-3 py-1.5 disabled:opacity-50 transition-opacity hover:opacity-80"
                        style={{ fontSize: 12, border: '1px solid var(--border2)', color: 'var(--ink2)' }}
                      >
                        Disconnect
                      </button>
                    )
                  ) : allowed ? (
                    <button
                      onClick={() => handleConnect(platform)}
                      disabled={isConnecting}
                      className="rounded-[6px] px-3 py-1.5 font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
                      style={{ fontSize: 12, background: 'var(--sage)', color: '#fff' }}
                    >
                      {isConnecting ? 'Redirecting…' : 'Connect'}
                    </button>
                  ) : (
                    <a
                      href="/dashboard/billing"
                      className="rounded-[6px] px-3 py-1.5 font-medium transition-opacity hover:opacity-90"
                      style={{
                        fontSize: 12,
                        background: 'var(--indigo-d)',
                        border: '1px solid var(--indigo-b)',
                        color: 'var(--indigo)',
                        textDecoration: 'none',
                      }}
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

      {/* Security trust callout */}
      <div
        className="mt-6 rounded-[10px] p-5 flex items-start gap-3"
        style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)' }}
      >
        <svg style={{ width: 18, height: 18, color: 'var(--sage)', flexShrink: 0, marginTop: 1 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <div>
          <p className="font-semibold" style={{ fontSize: 12, color: 'var(--sage)', marginBottom: 3 }}>
            Your tokens are encrypted at rest
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
            All OAuth tokens are AES-256 encrypted using AWS KMS. LaunchMind never stores plaintext credentials.
            Disconnect at any time — your token is immediately revoked and removed.
          </p>
        </div>
      </div>

      <p className="mt-4" style={{ fontSize: 11, color: 'var(--ink3)' }}>
        Disconnect removes your token from LaunchMind. You may also need to revoke access in the
        platform&apos;s own app settings.
      </p>
    </div>
  );
}
