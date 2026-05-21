/**
 * @file app/(dashboard)/dashboard/channels/page.tsx
 * @description Platform channel management — connect WhatsApp, Meta, Google, LinkedIn, and Email.
 *   Lists connected channels with status badges and connect/disconnect CTAs.
 *   OAuth connect initiates via backend (/channels/whatsapp/oauth/init) — no tokens in frontend.
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
  { label: string; icon: string; description: string }
> = {
  whatsapp: {
    label: 'WhatsApp Business',
    icon: '💬',
    description: 'Send broadcast messages and receive read receipts via Meta Cloud API.',
  },
  meta: {
    label: 'Meta Ads',
    icon: '📘',
    description: 'Run Facebook and Instagram ad campaigns.',
  },
  google: {
    label: 'Google Ads',
    icon: '🔍',
    description: 'Run Google Search and App Install campaigns.',
  },
  linkedin: {
    label: 'LinkedIn Ads',
    icon: '💼',
    description: 'Reach B2B audiences with LinkedIn campaigns.',
  },
  email: {
    label: 'Email (Resend)',
    icon: '✉️',
    description: 'Send transactional and campaign emails via Resend.',
  },
};

const ALL_PLATFORMS: SupportedPlatform[] = ['whatsapp', 'meta', 'google', 'linkedin', 'email'];
const CONNECTABLE: SupportedPlatform[] = ['whatsapp']; // Phase 5: WhatsApp only; others in Phase 3

export default function ChannelsPage() {
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [channels, setChannels] = useState<ConnectedChannel[]>([]);
  const [loading, setLoading] = useState(true);
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
    setConnecting(platform);
    setError(null);
    try {
      const token = await getToken();
      if (platform === 'whatsapp') {
        const { url } = await api.channels.oauthInit(token);
        window.location.href = url;
      }
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

  return (
    <div className="p-6 max-w-3xl">
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
            const isConnectable = CONNECTABLE.includes(platform);
            const isConnecting = connecting === platform;
            const isDisconnecting = disconnecting === platform;
            const awaitingConfirm = disconnectConfirm === platform;

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
                          style={{ fontSize: 11, background: 'var(--sage-d)', color: 'var(--sage)' }}
                        >
                          Connected
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
                  ) : isConnectable ? (
                    <button
                      onClick={() => handleConnect(platform)}
                      disabled={isConnecting}
                      className="rounded-[6px] px-3 py-1.5 font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
                      style={{ fontSize: 12, background: 'var(--sage)', color: '#fff' }}
                    >
                      {isConnecting ? 'Redirecting…' : 'Connect'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic' }}>
                      Coming soon
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6" style={{ fontSize: 11, color: 'var(--ink3)' }}>
        Disconnect removes your token from LaunchMind. You may also need to revoke access in the
        platform&apos;s own app settings.
      </p>
    </div>
  );
}
