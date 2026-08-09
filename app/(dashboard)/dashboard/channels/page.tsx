/**
 * @file app/(dashboard)/dashboard/channels/page.tsx
 * @description Improve Intelligence page — Phase 2 capability unlocks with 5-step
 *   connection modal. Shows recommended source, compact grid, connection health.
 * @security JWT from Supabase session. Credentials passed to Fastify backend only.
 * @dependencies api.intelligence.coverage, api.connections.*, api.integrations.*
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  api,
  type GrowthBrainCoverage,
  type WorkspaceConnection,
  type CanonicalConnectionState,
  type ConnectionHealth,
  type ExecutionBoundary,
  type ConnectionPermissionHistoryEntry,
  type PermissionLevel,
  type ProviderAccount,
} from '@/lib/api';
import { trackIntelligence } from '@/lib/analytics';
import { Dialog, AsyncStatus } from '@/components/launchmind/Dialog';
import { RecoveryNotice, recoveryKindFromError, type RecoveryKind } from '@/components/launchmind/RecoveryNotice';

/** Owner-facing label for a canonical connection status. */
function describeStatus(status: string, needsAttention: boolean): string {
  if (status === 'HEALTHY')    return 'Connected · healthy';
  if (status === 'PARTIAL')    return 'Connected · partial data';
  if (status === 'NO_HISTORY') return 'Connected · no history yet';
  if (status === 'SYNCING' || status === 'SYNC_QUEUED') return 'Syncing…';
  if (status === 'NEEDS_REAUTH') return 'Needs reconnecting';
  if (needsAttention)          return 'Needs attention';
  return 'Connected';
}

/** Compact "2h ago" style timestamp. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return 'Just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Types ───────────────────────────────────��─────────────────────────────────

type ConnectPlatform = 'app_store_connect' | 'revenue_cat' | 'ga4' | 'stripe' | 'search_console' | 'google_ads' | 'meta_ads' | 'hubspot' | 'mailchimp';

interface ConnectField { label: string; key: string; placeholder: string; required: boolean }
interface PlatformConfig { name: string; fields: ConnectField[]; endpoint: 'api_key' | 'oauth'; logoChar: string; category: 'observe' | 'execute' }

const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  app_store_connect: {
    name: 'App Store Connect', logoChar: 'A', endpoint: 'api_key', category: 'observe',
    fields: [
      { label: 'Private key (.p8 contents)',  key: 'api_key',   placeholder: '-----BEGIN PRIVATE KEY-----…', required: true  },
      { label: 'Issuer ID',                   key: 'issuer_id', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: false },
      { label: 'Key ID',                       key: 'key_id',   placeholder: 'XXXXXXXXXX', required: false },
    ],
  },
  revenue_cat: {
    name: 'RevenueCat', logoChar: 'R', endpoint: 'api_key', category: 'observe',
    fields: [
      { label: 'Secret API key', key: 'api_key', placeholder: 'sk_…', required: true },
      { label: 'App ID (optional)', key: 'app_id', placeholder: 'app…', required: false },
    ],
  },
  ga4: {
    name: 'Google Analytics', logoChar: 'G', endpoint: 'api_key', category: 'observe',
    fields: [
      { label: 'API secret / service account key', key: 'api_key', placeholder: 'Paste JSON or key…', required: true },
      { label: 'Property ID', key: 'property_id', placeholder: '123456789', required: false },
    ],
  },
  stripe: {
    name: 'Stripe', logoChar: 'S', endpoint: 'api_key', category: 'observe',
    fields: [
      { label: 'Restricted key (read-only)', key: 'api_key', placeholder: 'rk_live_…', required: true },
    ],
  },
  search_console: {
    name: 'Search Console', logoChar: 'G', endpoint: 'api_key', category: 'observe',
    fields: [
      { label: 'Service account key JSON', key: 'api_key', placeholder: '{"type":"service_account"…}', required: true },
      { label: 'Site URL', key: 'site_url', placeholder: 'https://yourapp.com', required: true },
    ],
  },
  google_ads: { name: 'Google Ads', logoChar: 'G', endpoint: 'oauth', category: 'execute', fields: [] },
  meta_ads:   { name: 'Meta',       logoChar: 'M', endpoint: 'oauth', category: 'execute', fields: [] },
  hubspot: {
    name: 'HubSpot', logoChar: 'H', endpoint: 'api_key', category: 'observe',
    fields: [
      { label: 'Private App access token', key: 'api_key', placeholder: 'pat-na1-…', required: true },
    ],
  },
  mailchimp: {
    name: 'Mailchimp', logoChar: 'M', endpoint: 'api_key', category: 'observe',
    fields: [
      { label: 'API key', key: 'api_key', placeholder: 'xxxx-us21', required: true },
    ],
  },
};

// Provider descriptions for compact grid
const PROVIDER_DESCRIPTIONS: Record<string, { headline: string; tags: string; note?: string }> = {
  revenue_cat:    { headline: 'Know which installs become paying, retained customers.', tags: 'Trials · churn · retention · LTV' },
  ga4:            { headline: 'See where website intent strengthens or disappears.', tags: 'Funnels · source quality · landing pages' },
  stripe:         { headline: 'Connect realized revenue to plans, upgrades, refunds, and acquisition.', tags: 'MRR · plan movement · realized revenue' },
  search_console: { headline: 'Learn what customers search before they discover you.', tags: 'Queries · rankings · CTR · pages' },
  google_ads:     { headline: 'Observe paid-search economics before any execution access.', tags: 'Spend · search terms · CAC · conversions', note: 'Read-only first · execution requires a later approval' },
  meta_ads:       { headline: 'Learn which creative, audiences, and placements actually work.', tags: 'Creative fatigue · audiences · CPA · placements', note: 'Read-only first · publish/spend stay locked' },
  hubspot:        { headline: 'Connect marketing activity to qualified leads and lifecycle movement.', tags: 'Lead quality · lifecycle · source attribution' },
  mailchimp:      { headline: 'Learn which lifecycle messages create meaningful action.', tags: 'Open · click · conversion · audience response' },
};

// Provider metadata for Phase2Modal
const PROVIDER_META: Record<string, {
  name: string;
  description: string;
  accessType: string;
  permissions: string[];
  benefit: string;
  decisionImproved: string;
  scoreGain: string;
  steps: string[];
  credFields: Array<{ key: string; label: string; placeholder: string; required: boolean }>;
}> = {
  app_store_connect: {
    name: 'App Store Connect',
    description: 'Read product-page performance and acquisition source data.',
    accessType: 'Read-only reporting',
    permissions: ['App analytics (read)', 'Sales and trends (read)', 'Payments and financial reports (read)'],
    benefit: 'Replace estimated download numbers with actual impressions, conversion rates, and acquisition source breakdown from Apple.',
    decisionImproved: 'Where to invest before increasing demand',
    scoreGain: '62% → 74%',
    steps: ['Reading product-page history','Mapping acquisition sources','Fetching download cohorts','Analyzing store conversion','Building performance baseline'],
    credFields: [
      { key: 'api_key', label: 'Private Key (.p8 content)', placeholder: 'Paste your .p8 key content', required: true },
      { key: 'issuer_id', label: 'Issuer ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: false },
      { key: 'key_id', label: 'Key ID', placeholder: 'XXXXXXXXXX', required: false },
    ],
  },
  revenue_cat: {
    name: 'RevenueCat',
    description: 'Read subscription and revenue data across all platforms.',
    accessType: 'Read-only revenue data',
    permissions: ['Projects (read)', 'Subscribers (read)', 'Revenue and LTV (read)'],
    benefit: 'See actual trial-to-paid conversion, churn, LTV by cohort — replaces estimates with observed revenue truth.',
    decisionImproved: 'When to prioritize retention vs acquisition',
    scoreGain: '62% → 71%',
    steps: ['Authenticating RevenueCat project','Fetching subscription events','Mapping trial conversions','Calculating LTV cohorts','Building revenue baseline'],
    credFields: [
      { key: 'api_key', label: 'Secret API Key', placeholder: 'sk_live_...', required: true },
      { key: 'app_id', label: 'App ID (optional)', placeholder: 'app1234567890', required: false },
    ],
  },
  ga4: {
    name: 'Google Analytics 4',
    description: 'Read session, acquisition, and event data.',
    accessType: 'Read-only analytics',
    permissions: ['Analytics data (read)', 'Property metadata (read)'],
    benefit: 'Map web traffic to app installs. Understand organic vs paid acquisition split with real session data.',
    decisionImproved: 'Which channels drive quality installs',
    scoreGain: '62% → 69%',
    steps: ['Connecting GA4 property','Reading session sources','Mapping app install events','Fetching retention cohorts','Building web-to-app funnel'],
    credFields: [
      { key: 'api_key', label: 'Measurement Protocol API Secret', placeholder: 'paste API secret here', required: true },
    ],
  },
  stripe: {
    name: 'Stripe',
    description: 'Read revenue, subscription, and payment data.',
    accessType: 'Read-only revenue',
    permissions: ['Balance (read)', 'Charges (read)', 'Subscriptions (read)', 'Customers (read)'],
    benefit: 'See real MRR, churn, plan mix, and cohort LTV — replaces revenue estimates with observed Stripe truth.',
    decisionImproved: 'Which plan and pricing drives the most durable revenue',
    scoreGain: '62% → 72%',
    steps: ['Authenticating Stripe account','Fetching payment events','Mapping subscription tiers','Calculating revenue cohorts','Building payment baseline'],
    credFields: [
      { key: 'api_key', label: 'Restricted API Key', placeholder: 'rk_live_...', required: true },
    ],
  },
  search_console: {
    name: 'Search Console',
    description: 'Read organic search performance for your web presence.',
    accessType: 'Read-only search',
    permissions: ['Search analytics (read)', 'Sitemaps (read)'],
    benefit: 'Discover which search queries drive installs. Plan content to capture organic demand with real data.',
    decisionImproved: 'Which organic content amplifies paid campaigns',
    scoreGain: '62% → 67%',
    steps: ['Connecting Search Console','Fetching query performance','Reading click-through rates','Mapping organic sources','Building SEO baseline'],
    credFields: [
      { key: 'api_key', label: 'Service Account JSON Key', placeholder: '{ "type": "service_account", ... }', required: true },
    ],
  },
  google_ads: {
    name: 'Google Ads',
    description: 'Read campaign performance and spend data.',
    accessType: 'Read-only advertising',
    permissions: ['Campaign data (read)', 'Ad group data (read)', 'Keyword performance (read)'],
    benefit: 'See real CPI, keyword performance, and campaign ROI — replace spend estimates with observed Google Ads data.',
    decisionImproved: 'Which keywords and campaigns deserve more budget',
    scoreGain: '62% → 70%',
    steps: ['Authenticating Google Ads','Reading campaign performance','Fetching keyword data','Mapping conversion paths','Building paid acquisition baseline'],
    credFields: [
      { key: 'api_key', label: 'Developer Token', placeholder: 'paste developer token', required: true },
    ],
  },
  meta_ads: {
    name: 'Meta Ads',
    description: 'Read Meta/Facebook campaign performance.',
    accessType: 'Read-only advertising',
    permissions: ['Ad account data (read)', 'Campaign insights (read)', 'Creative data (read)'],
    benefit: 'See real Meta CPI, creative performance, and audience overlap — replaces estimates with observed Meta campaign data.',
    decisionImproved: 'Which creative format and audience drives best Meta CAC',
    scoreGain: '62% → 69%',
    steps: ['Authenticating Meta Business','Reading ad account data','Fetching creative performance','Mapping audience segments','Building Meta baseline'],
    credFields: [
      { key: 'api_key', label: 'Access Token', placeholder: 'EAAxxxxxx...', required: true },
    ],
  },
  hubspot: {
    name: 'HubSpot',
    description: 'Read contact lifecycle and deal pipeline data.',
    accessType: 'Read-only CRM',
    permissions: ['Contacts (read)', 'Deals (read)', 'Companies (read)'],
    benefit: 'Map B2B sales cycle and MQL conversion — understand where in the funnel your marketing investment pays off.',
    decisionImproved: 'Which marketing activities convert to closed deals',
    scoreGain: '62% → 66%',
    steps: ['Connecting HubSpot portal','Fetching contact lifecycle','Reading deal pipeline','Mapping MQL sources','Building CRM baseline'],
    credFields: [
      { key: 'api_key', label: 'Private App Access Token', placeholder: 'pat-na1-...', required: true },
    ],
  },
  mailchimp: {
    name: 'Mailchimp',
    description: 'Read email campaign performance and audience data.',
    accessType: 'Read-only email',
    permissions: ['Campaigns (read)', 'Lists (read)', 'Reports (read)'],
    benefit: 'See email open rates, click-to-trial conversion, and audience engagement — understand which email content drives installs.',
    decisionImproved: 'Which email sequences and segments drive product activation',
    scoreGain: '62% → 65%',
    steps: ['Connecting Mailchimp audience','Reading email campaigns','Fetching open/click rates','Mapping audience segments','Building email baseline'],
    credFields: [
      { key: 'api_key', label: 'API Key', placeholder: 'xxxxxxxxxxxxxxxx-us1', required: true },
    ],
  },
};

// ── Toast ───────��────────────────────────────���────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => { const t = setTimeout(onDismiss, 3000); return () => clearTimeout(t); }, [onDismiss]);
  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--ink)', color: '#fff', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 500, zIndex: 1201, boxShadow: '0 8px 24px rgba(27,31,46,0.10)', whiteSpace: 'nowrap' }}>
      {message}
    </div>
  );
}

// ── Connection badge ───────────────────────────────────────────────────────────

function ConnectionBadge({ connected, syncing }: { connected: boolean; syncing?: boolean }) {
  if (syncing)   return <span style={{ padding: '4px 8px', borderRadius: 999, background: 'var(--amber2)', color: 'var(--amber)', fontSize: 10, fontWeight: 700 }}>Syncing</span>;
  if (connected) return <span style={{ padding: '4px 8px', borderRadius: 999, background: 'var(--sage2)', color: 'var(--sage)', fontSize: 10, fontWeight: 700 }}>Connected</span>;
  return <span style={{ padding: '4px 8px', borderRadius: 999, background: 'var(--raised)', color: 'var(--ink3)', fontSize: 10, fontWeight: 700 }}>Not connected</span>;
}

// ── Phase2Modal ───────────────────────────────────────────────────────────────

/**
 * The connect flow, as a sequence of named steps.
 *
 * Named rather than numbered because the order changed in Step 7 (a permission
 * review and an account selection were added), and numeric indices scattered
 * through the file made that change unsafe.
 */
type ConnectStep = 'preview' | 'permissions' | 'credentials' | 'accounts' | 'syncing' | 'insight';

/** Maps the caller's legacy numeric entry point onto a named step. */
const STEP_FROM_INDEX: Record<number, ConnectStep> = {
  0: 'preview',
  1: 'permissions',
  2: 'credentials',
  3: 'syncing',
  4: 'insight',
};

interface Phase2ModalProps {
  provider: string;
  token: string;
  initialStep: 0|1|2|3|4;
  onClose: () => void;
  onConnected: (provider: string) => void;
}

function Phase2Modal({ provider, token, initialStep, onClose, onConnected }: Phase2ModalProps) {
  const meta = PROVIDER_META[provider] ?? PROVIDER_META['app_store_connect'];
  const [step, setStep] = useState<ConnectStep>(STEP_FROM_INDEX[initialStep] ?? 'preview');
  const [creds, setCreds] = useState<Record<string, string>>({});
  /** Structured recovery case (spec §14). Free text is only used as a last resort. */
  const [recovery, setRecovery] = useState<RecoveryKind | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [plainError, setPlainError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncSteps, setSyncSteps] = useState<string[]>([]);
  const [connectionId, setConnectionId] = useState('');
  // Real outcome of the sync run. Drives the final screen — no invented insight.
  const [syncOutcome, setSyncOutcome] = useState<'complete'|'partial'|'no_history'|null>(null);
  const [signalsImported, setSignalsImported] = useState(0);
  const [firstInsight, setFirstInsight] = useState<ConnectionHealth['latest_insight']>(null);

  // Account selection (spec §14.2, §21 keyboard account selection).
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accountRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const clearError = useCallback(() => { setRecovery(null); setRecoveryCode(null); setPlainError(null); }, []);

  /** Translates a thrown API error into a recovery case, keeping the machine code. */
  const captureError = useCallback((err: unknown) => {
    const kind = recoveryKindFromError(err);
    const code = (err as { code?: string } | null)?.code ?? null;
    if (kind) { setRecovery(kind); setRecoveryCode(code); setPlainError(null); }
    else      { setRecovery(null); setRecoveryCode(code); setPlainError((err as Error)?.message ?? 'Connection failed'); }
  }, []);

  /**
   * Follows the real sync run. Progress and step labels come from
   * connection_sync_runs — there is no simulated timer and no forced completion,
   * so the owner never sees a progress bar that is ahead of the actual work.
   */
  const startSyncTracking = useCallback((connId: string) => {
    setSyncProgress(0);
    setSyncSteps([]);
    setSyncOutcome(null);
    setSignalsImported(0);
    setFirstInsight(null);

    if (!connId) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const syncRuns = await api.connections.syncRuns(connId, token);
        const latest = (syncRuns ?? [])[0];
        if (!latest) return;

        // Progress reflects the real sync run, not a timer.
        setSyncProgress(latest.progress ?? 0);
        setSyncSteps(latest.steps_completed ?? []);

        if (latest.status === 'completed' || latest.status === 'partial') {
          stopPolling();
          setSyncProgress(100);
          const imported = latest.signals_imported ?? 0;
          setSignalsImported(imported);
          trackIntelligence(latest.status === 'partial' ? 'sync_partial' : 'sync_completed', {
            provider, connectionId: connId, signalCount: imported,
          });

          const outcome = latest.status === 'partial' ? 'partial'
            : imported === 0 ? 'no_history'
            : 'complete';
          setSyncOutcome(outcome);

          // Read the insight the server actually derived. Nothing is composed here:
          // if the data supported no conclusion, the final screen says so.
          try {
            const health = await api.connections.health(connId, token);
            setFirstInsight(health.latest_insight ?? null);
            if (health.latest_insight) {
              trackIntelligence('first_insight_viewed', { provider, connectionId: connId });
            }
          } catch { /* the final screen has a no-insight state */ }

          setTimeout(() => { setStep('insight'); }, 400);
        } else if (latest.status === 'failed') {
          stopPolling();
          trackIntelligence('sync_failed', { provider, connectionId: connId });
          // The run's own error text is not shown — it can carry provider detail.
          // The recovery card explains the state instead (spec §14.7).
          setRecovery('SYNC_FAILED');
          setStep('credentials');
        }
      } catch { /* transient poll error — keep polling */ }
    }, 1500);
  }, [token, stopPolling, provider]);

  /** Queues the first sync for a connection whose resource is settled. */
  const beginSync = useCallback((connId: string, traceId?: string) => {
    trackIntelligence('sync_started', { provider, connectionId: connId, traceId });
    setStep('syncing');
    startSyncTracking(connId);
  }, [provider, startSyncTracking]);

  const handleConnect = useCallback(async () => {
    setConnecting(true); clearError();
    try {
      const result = await api.connections.connect(provider, creds, token);
      trackIntelligence('oauth_succeeded', { provider, connectionId: result.connection.id, traceId: result.traceId });
      setConnectionId(result.connection.id);

      const found = result.accounts ?? [];
      if (found.length > 1) {
        // Several accounts: the owner has to say which one this workspace is about.
        // Connecting without asking is how a multi-app account ends up syncing the
        // wrong product.
        setAccounts(found);
        setSelectedAccount(found[0]?.id ?? null);
        setStep('accounts');
      } else {
        // Exactly one account (or a provider whose token binds to one) — the server
        // auto-selected it and queued the first sync.
        if (found.length === 1) {
          trackIntelligence('account_selected', { provider, connectionId: result.connection.id, signalCount: 1 });
        }
        beginSync(result.connection.id, result.traceId);
      }
    } catch (err) {
      trackIntelligence('oauth_failed', {
        provider,
        errorCode: (err as { code?: string } | null)?.code,
      });
      captureError(err);
    } finally {
      setConnecting(false);
    }
  }, [provider, creds, token, beginSync, captureError, clearError]);

  const handleSelectAccount = useCallback(async () => {
    if (!selectedAccount || !connectionId) return;
    const chosen = accounts.find(a => a.id === selectedAccount);
    setSelecting(true); clearError();
    try {
      await api.connections.selectResource(connectionId, selectedAccount, chosen?.name ?? selectedAccount, token);
      trackIntelligence('account_selected', { provider, connectionId, signalCount: accounts.length });
      beginSync(connectionId);
    } catch (err) {
      captureError(err);
    } finally {
      setSelecting(false);
    }
  }, [selectedAccount, connectionId, accounts, token, provider, beginSync, captureError, clearError]);

  /** Arrow keys move between accounts; Enter/Space picks one (spec §21). */
  const onAccountKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const last = accounts.length - 1;
    const next =
      e.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
      : e.key === 'Home'    ? 0
      : last;
    setSelectedAccount(accounts[next]?.id ?? null);
    accountRefs.current[next]?.focus();
  }, [accounts]);

  /** Retries whatever step the owner was on when the failure happened. */
  const retryFromRecovery = useCallback(() => {
    clearError();
    if (step === 'accounts') { void handleSelectAccount(); return; }
    void handleConnect();
  }, [step, clearError, handleConnect, handleSelectAccount]);

  const recoveryBlock = (recovery || plainError) && (
    <div style={{ marginBottom: 12 }}>
      {recovery ? (
        <RecoveryNotice
          kind={recovery}
          providerName={meta.name}
          errorCode={recoveryCode}
          busy={connecting || selecting}
          onRetry={recovery === 'ADAPTER_UNAVAILABLE' ? undefined : retryFromRecovery}
          onReauthorize={recovery === 'NEEDS_REAUTH' ? retryFromRecovery : undefined}
          onChooseAccount={
            recovery === 'WRONG_ACCOUNT' && accounts.length > 0
              ? () => { clearError(); setStep('accounts'); }
              : undefined
          }
          onDismiss={clearError}
        />
      ) : (
        <div role="alert" style={{ background: 'var(--danger2)', border: '1px solid var(--danger-b)', borderRadius: 10, padding: '11px 13px', fontSize: 12, color: 'var(--danger)' }}>
          {plainError}
        </div>
      )}
    </div>
  );

  // The owner must not lose an in-flight sync by pressing Escape without seeing
  // its outcome; every other step is safely dismissible.
  const dismissible = step !== 'syncing';

  return (
    <Dialog
      label={`Connect ${meta.name}`}
      onClose={onClose}
      dismissible={dismissible}
      maxWidth={step === 'preview' ? 720 : 620}
    >
      {/* ── Preview ── */}
      {step === 'preview' && (
        <div className="lm-conn-split">
          <div className="lm-conn-rail" style={{ background: 'linear-gradient(135deg,#13231f,#0d1f1a)', padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: '#47d9ae', textTransform: 'uppercase', margin: '0 0 8px' }}>Intelligence source</p>
              <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>{meta.name}</h3>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.55 }}>{meta.description}</p>
            </div>
            <div>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: '#91a79e', textTransform: 'uppercase', margin: '0 0 8px' }}>What you&apos;ll learn</p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {meta.permissions.map(p => (
                  <li key={p} className="lm-permission-copy" style={{ color: 'rgba(255,255,255,0.75)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span aria-hidden style={{ color: '#47d9ae', marginTop: 1, flexShrink: 0 }}>✓</span>{p}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ marginTop: 'auto' }}>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: '#91a79e', textTransform: 'uppercase', margin: '0 0 4px' }}>Score gain</p>
              <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 22, fontWeight: 700, color: '#47d9ae', margin: 0 }}>{meta.scoreGain}</p>
            </div>
          </div>

          <div className="lm-conn-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Preview what this unlocks</h2>
              <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <div>
              <p style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700, margin: '0 0 6px' }}>Decision improved</p>
              <p style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, margin: 0 }}>{meta.decisionImproved}</p>
            </div>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)' }}>{meta.accessType}</span>
            </div>
            <div className="lm-dialog-actions" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => { trackIntelligence('connection_started', { provider }); setStep('permissions'); }}
                style={{ height: 44, borderRadius: 10, background: 'var(--sage)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 650, cursor: 'pointer' }}
              >
                Review what LaunchMind will access →
              </button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--sage)', textDecoration: 'underline', padding: 0, alignSelf: 'center' }}>
                See all intelligence sources
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Permission review ── */}
      {step === 'permissions' && (
        <div className="lm-conn-body" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>What LaunchMind will access</h2>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1, padding: 4 }}>×</button>
          </div>
          <p className="lm-permission-copy" style={{ color: 'var(--ink2)', marginBottom: 18 }}>
            Read this before you authorize. LaunchMind asks for the narrowest access that
            answers the question above, and nothing more.
          </p>

          <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 8px' }}>
            LaunchMind will be able to
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', display: 'grid', gap: 7 }}>
            {meta.permissions.map(p => (
              <li key={p} className="lm-permission-copy" style={{ display: 'flex', gap: 9, color: 'var(--ink2)' }}>
                <span aria-hidden style={{ color: 'var(--sage)', fontWeight: 800 }}>✓</span>
                <span>Read {p.toLowerCase()}</span>
              </li>
            ))}
          </ul>

          <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 8px' }}>
            LaunchMind will not be able to
          </h3>
          {/* Stated as flatly as the capability list. This is the guarantee the whole
              permission model exists to make, so it is not softened or hidden. */}
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', display: 'grid', gap: 7 }}>
            {['Change or pause anything in your account',
              'Publish, post, or send on your behalf',
              'Create campaigns or change budgets',
              'Spend any money'].map(p => (
              <li key={p} className="lm-permission-copy" style={{ display: 'flex', gap: 9, color: 'var(--ink2)' }}>
                <span aria-hidden style={{ color: 'var(--danger)', fontWeight: 800 }}>✗</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>

          <div style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 10, padding: '11px 13px', marginBottom: 16 }}>
            <p className="lm-permission-copy" style={{ margin: 0, color: 'var(--ink)' }}>
              You are granting <strong>{meta.accessType.toLowerCase()}</strong>. Anything beyond
              observation needs a separate request that an owner has to approve.
            </p>
          </div>

          <div className="lm-dialog-actions" style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            <button
              onClick={() => { trackIntelligence('permission_reviewed', { provider }); setStep('credentials'); }}
              style={{ flex: 1, height: 44, borderRadius: 10, background: 'var(--sage)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 650, cursor: 'pointer' }}
            >
              I understand — continue →
            </button>
            <button onClick={() => setStep('preview')} style={{ height: 44, padding: '0 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 13, cursor: 'pointer' }}>Back</button>
          </div>
        </div>
      )}

      {/* ── Credentials ── */}
      {step === 'credentials' && (
        <div className="lm-conn-body" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Connect {meta.name}</h2>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1, padding: 4 }}>×</button>
          </div>
          <p className="lm-permission-copy" style={{ color: 'var(--ink3)', marginBottom: 22 }}>
            Read-only access only. LaunchMind will never post, spend, or change settings.
          </p>
          {meta.credFields.map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label htmlFor={`cred-${f.key}`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 5 }}>
                {f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
              </label>
              <input
                id={`cred-${f.key}`}
                value={creds[f.key] ?? ''}
                onChange={e => setCreds(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                required={f.required}
                autoComplete="off"
                spellCheck={false}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9, background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
              />
            </div>
          ))}
          {recoveryBlock}
          <div className="lm-dialog-actions" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={handleConnect}
              disabled={connecting}
              style={{ flex: 1, height: 42, borderRadius: 10, background: 'var(--sage)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 650, cursor: connecting ? 'not-allowed' : 'pointer', opacity: connecting ? 0.7 : 1 }}
            >
              {connecting ? 'Connecting…' : `Connect ${meta.name} →`}
            </button>
            <button onClick={onClose} style={{ height: 42, padding: '0 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
          {connecting && <AsyncStatus message={`Verifying your ${meta.name} credentials…`} />}
        </div>
      )}

      {/* ── Account selection ── */}
      {step === 'accounts' && (
        <div className="lm-conn-body" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Which one should LaunchMind read?</h2>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink3)', lineHeight: 1, padding: 4 }}>×</button>
          </div>
          <p className="lm-permission-copy" style={{ color: 'var(--ink2)', marginBottom: 16 }}>
            This credential can read {accounts.length} accounts. LaunchMind will only read the
            one you choose, and will not touch the others.
          </p>

          {recoveryBlock}

          {/* A radiogroup rather than a list of buttons, so a screen reader announces
              the selection state and arrow keys behave as expected. */}
          <div
            role="radiogroup"
            aria-label={`${meta.name} accounts`}
            style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}
          >
            {accounts.map((a, i) => {
              const chosen = selectedAccount === a.id;
              return (
                <button
                  key={a.id}
                  ref={el => { accountRefs.current[i] = el; }}
                  role="radio"
                  aria-checked={chosen}
                  tabIndex={chosen || (!selectedAccount && i === 0) ? 0 : -1}
                  onClick={() => setSelectedAccount(a.id)}
                  onKeyDown={e => onAccountKeyDown(e, i)}
                  className="lm-account-row"
                  style={{
                    textAlign: 'left', cursor: 'pointer',
                    padding: '12px 14px', borderRadius: 10,
                    border: `1px solid ${chosen ? 'var(--sage)' : 'var(--border2)'}`,
                    background: chosen ? 'var(--sage-d)' : '#fff',
                  }}
                >
                  {/* Symbol, not colour alone. */}
                  <span aria-hidden style={{ fontSize: 13, fontWeight: 800, color: chosen ? 'var(--sage)' : 'var(--ink3)' }}>
                    {chosen ? '◉' : '○'}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: 'var(--ink)' }}>{a.name}</span>
                    {a.accessLevel && <span style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{a.accessLevel}</span>}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{a.id}</span>
                </button>
              );
            })}
          </div>

          <div className="lm-dialog-actions" style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            <button
              onClick={handleSelectAccount}
              disabled={!selectedAccount || selecting}
              style={{ flex: 1, height: 42, borderRadius: 10, background: 'var(--sage)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 650, cursor: !selectedAccount || selecting ? 'not-allowed' : 'pointer', opacity: !selectedAccount || selecting ? 0.7 : 1 }}
            >
              {selecting ? 'Starting…' : 'Use this account →'}
            </button>
            <button onClick={onClose} style={{ height: 42, padding: '0 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
          {selecting && <AsyncStatus message="Starting the first import…" />}
        </div>
      )}

      {/* ── Sync progress ── */}
      {step === 'syncing' && (
        <div className="lm-conn-body" style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', margin: '0 0 6px' }}>{meta.name}</p>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>Importing intelligence…</h2>
            <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 6 }}>
              You can safely close this window — LaunchMind continues in the background.
            </p>
          </div>

          {/* Visible bar plus a real progressbar role, so the value is available to
              assistive technology rather than only as a width. */}
          <div style={{ width: '100%', maxWidth: 440 }}>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={syncProgress}
              aria-label={`Importing from ${meta.name}`}
              style={{ height: 6, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}
            >
              <div
                className="sync-progress-bar lm-sync-pulse"
                style={{ height: '100%', borderRadius: 999, background: 'var(--sage)', width: `${syncProgress}%`, transition: 'width 0.6s ease' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--ink3)' }}>
              <span>Processing</span>
              <span>{syncProgress}%</span>
            </div>
          </div>

          {/* Steps completed so far, reported by the sync run itself. */}
          <ul style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
            {syncSteps.length === 0 ? (
              <li style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center' }}>
                Waiting for the first result from {meta.name}…
              </li>
            ) : (
              syncSteps.map((s, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ink)' }}>
                  <span aria-hidden style={{ width: 18, height: 18, borderRadius: 999, border: '1px solid var(--sage-b)', background: 'var(--sage-d)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--sage)', flexShrink: 0 }}>
                    ✓
                  </span>
                  {s}
                </li>
              ))
            )}
          </ul>

          <AsyncStatus
            message={
              syncSteps.length === 0
                ? `Waiting for ${meta.name} to respond.`
                : `${syncProgress}% complete. ${syncSteps[syncSteps.length - 1]}.`
            }
          />
        </div>
      )}

      {/* ── First insight ── */}
      {step === 'insight' && (
        <div className="lm-conn-body" style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, textAlign: 'center' }}>
          {syncOutcome === 'no_history' ? (
            <div style={{ width: '100%', textAlign: 'left' }}>
              {/* A healthy connection with no history is not a failure (spec §14.5). */}
              <RecoveryNotice kind="NO_HISTORY" providerName={meta.name} />
            </div>
          ) : syncOutcome === 'partial' ? (
            <div style={{ width: '100%', textAlign: 'left' }}>
              <RecoveryNotice kind="PARTIAL" providerName={meta.name} onRetry={() => beginSync(connectionId)} />
            </div>
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: 999, background: 'var(--sage)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <span aria-hidden style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>✓</span>
            </div>
          )}

          <div>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>
              {syncOutcome === 'no_history' ? `${meta.name} is connected` : 'Growth Brain updated'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
              {syncOutcome === 'no_history'
                ? `LaunchMind will start learning as data arrives — nothing is estimated in the meantime.`
                : `LaunchMind imported ${signalsImported} signal${signalsImported === 1 ? '' : 's'} from ${meta.name}.`}
            </p>
          </div>

          {/* The first insight, only when the server actually derived one. */}
          {firstInsight ? (
            <div data-testid="first-insight" style={{ width: '100%', textAlign: 'left', background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 12, padding: 15 }}>
              <p style={{ margin: '0 0 5px', fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>First insight</p>
              <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.45 }}>{firstInsight.headline}</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink2)', lineHeight: 1.55 }}>{firstInsight.detail}</p>
              {Array.isArray(firstInsight.evidence) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {(firstInsight.evidence as Array<{ label: string; value: string | number }>).map(e => (
                    <span key={e.label} style={{ fontSize: 10, background: '#fff', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 8px', color: 'var(--ink2)' }}>
                      {e.label}: <strong style={{ color: 'var(--ink)' }}>{String(e.value)}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : syncOutcome !== 'no_history' && (
            <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0, maxWidth: 440 }}>
              The data is in, but it does not yet support a conclusion worth acting on.
              LaunchMind will report one when it does.
            </p>
          )}

          <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 18px' }}>
            <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>Signals imported</p>
            <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 700, color: signalsImported > 0 ? 'var(--sage)' : 'var(--ink3)', margin: 0 }}>{signalsImported}</p>
          </div>

          <div className="lm-dialog-actions" style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 }}>
            <Link
              href="/dashboard/intelligence/growth-brain"
              onClick={() => {
                trackIntelligence('growth_brain_updated_from_source', {
                  provider, connectionId, signalCount: signalsImported,
                });
                onConnected(provider); onClose();
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 42, borderRadius: 10, background: 'var(--sage)', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 650 }}
            >
              See in Growth Brain →
            </Link>
            <button
              onClick={() => { onConnected(provider); onClose(); }}
              style={{ height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 12, cursor: 'pointer' }}
            >
              Back to Improve Intelligence
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ── Compact source card ───────────────────────────────────────────────────────

function CompactSource({
  providerKey, name, logoChar, connection, canonical, canConnect, statusLabel,
  onConnect, onPreview, onDisconnect, onReconnect,
}: {
  providerKey: string; name: string; logoChar: string;
  connection?: WorkspaceConnection;
  /** Canonical server state. Preferred over `connection` when present. */
  canonical?: CanonicalConnectionState | null;
  /** False when no real integration exists — show unavailable, not Connect. */
  canConnect: boolean;
  statusLabel: string;
  onConnect: () => void; onPreview: () => void;
  onDisconnect: () => void; onReconnect: () => void;
}) {
  const desc = PROVIDER_DESCRIPTIONS[providerKey];
  const status = canonical?.status ?? connection?.status ?? 'NOT_CONNECTED';
  // "Connected" means authorized AND holding observed data. SYNCING is in-flight.
  const isConnected = canonical
    ? canonical.healthy && canonical.signalCount > 0
    : status === 'HEALTHY' || status === 'PARTIAL';
  const isSyncing   = canonical?.inFlight ?? (status === 'SYNCING' || status === 'SYNC_QUEUED');
  const noHistory   = canonical?.noHistory ?? (status === 'NO_HISTORY');
  const needsReauth = canonical
    ? canonical.needsAttention
    : status === 'NEEDS_REAUTH' || status === 'SYNC_FAILED';
  const border = isConnected ? 'var(--sage3)' : 'var(--border)';
  const bg = isConnected ? '#f4fbf8' : canConnect ? '#fff' : 'var(--raised)';

  return (
    <article
      className="lm-source-card"
      style={{ gap: 12, alignItems: 'center', padding: 15, border: `1px solid ${border}`, borderRadius: 12, background: bg }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--raised)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 16, color: 'var(--ink)', border: '1px solid var(--border)' }}>
        {logoChar}
      </div>
      <div>
        <h4 style={{ margin: '0 0 3px', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{name}</h4>
        <p style={{ margin: '0 0 3px', fontSize: 10, color: 'var(--ink2)', lineHeight: 1.4 }}>{desc?.headline}</p>
        <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{desc?.tags}</span>
        {/* `note` is the access boundary ("read-only first · publish/spend stay
            locked"). Spec §22 forbids shrinking permission text: it was rendering at
            9px, smaller than the description above it, which is exactly backwards
            for the one line that states what LaunchMind may do. */}
        {desc?.note && (
          <div
            className="lm-permission-copy"
            style={{ color: 'var(--amber)', marginTop: 4, fontWeight: 650 }}
          >
            {desc.note}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {/* Status text always accompanies the colour, so health is never
            communicated by colour alone (accessibility, spec §21). */}
        {isConnected ? (
          <>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--sage2)', color: 'var(--sage)', fontSize: 10, fontWeight: 700 }}>{statusLabel}</span>
            {/* Freshness travels with the status: "Connected" on its own does not
                tell an owner whether the number they are about to act on is a day
                or a month old. */}
            {canonical?.freshnessLabel && (
              <span
                title={canonical.lastSyncedAt ? `Last synced ${relativeTime(canonical.lastSyncedAt)}` : undefined}
                style={{
                  fontSize: 9, color: canonical.freshness === 'stale' || canonical.freshness === 'outdated' ? 'var(--amber)' : 'var(--ink3)',
                  fontWeight: 650, whiteSpace: 'nowrap',
                }}
              >
                {canonical.freshnessLabel}
              </span>
            )}
            <Link href="/dashboard/intelligence/growth-brain" style={{ height: 30, padding: '0 10px', borderRadius: 8, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 10, fontWeight: 650, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>View →</Link>
            <button onClick={onDisconnect} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'white', color: 'var(--ink3)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Disconnect</button>
          </>
        ) : noHistory ? (
          <>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--sage2)', color: 'var(--sage)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{statusLabel}</span>
            <button onClick={onDisconnect} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'white', color: 'var(--ink3)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Disconnect</button>
          </>
        ) : isSyncing ? (
          <span
            role="status"
            aria-live="polite"
            style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--amber2)', color: 'var(--amber)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {statusLabel}
          </span>
        ) : needsReauth ? (
          <>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--amber2)', color: 'var(--amber)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{statusLabel}</span>
            <button onClick={onReconnect} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: 'none', background: 'var(--amber)', color: '#fff', fontSize: 10, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap' }}>Fix →</button>
          </>
        ) : canConnect ? (
          <>
            {/* Status in words, even when the status is "nothing yet". Previously
                this branch rendered only buttons, so the state had to be inferred
                from which controls existed — which fails the spec §21 rule that
                health is never communicated by affordance or colour alone. */}
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink3)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {statusLabel}
            </span>
            <button onClick={onPreview} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Preview</button>
            <button onClick={onConnect} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: 'none', background: 'var(--sage)', color: '#fff', fontSize: 10, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap' }}>Connect</button>
          </>
        ) : (
          /* No real integration yet: preview only. A Connect button here would
             promise something LaunchMind cannot deliver. */
          <>
            <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink3)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{statusLabel}</span>
            <button onClick={onPreview} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--ink2)', fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Preview</button>
          </>
        )}
      </div>
    </article>
  );
}

/** Health of one connected source, as reported by GET /connections/:id/health. */
interface ConnectedHealth extends ConnectionHealth {
  connectionId: string;
  providerName: string;
  statusLabel: string;
  lastSyncLabel: string;
}

/**
 * Connected-source card (spec §13, §16).
 *
 * Shows only what the server actually reported: status, the selected app/account,
 * last sync, freshness, how many signals were learned, and the latest evidence-backed
 * insight. When no insight exists yet the card says so rather than inventing one.
 */
function ConnectedSourceCard({
  health, busy, onRefresh, onReauthorize, onManageAccess, onDisconnect,
}: {
  health: ConnectedHealth;
  busy: boolean;
  onRefresh: () => void; onReauthorize: () => void;
  onManageAccess: () => void; onDisconnect: () => void;
}) {
  const attention = health.needs_attention;
  const tone = attention ? 'var(--amber)' : 'var(--sage)';
  const bg   = attention ? 'var(--amber2)' : '#f4fbf8';
  const brd  = attention ? 'var(--amber-b)' : 'var(--sage3)';
  const evidence = Array.isArray(health.latest_insight?.evidence)
    ? (health.latest_insight?.evidence as Array<{ label: string; value: string | number }>)
    : [];

  /**
   * Which recovery explanation this card needs, from the canonical connection
   * state. NO_HISTORY and PARTIAL are included deliberately: they are not
   * failures, but they DO need explaining, and leaving them as a bare status pill
   * is how "connected" ends up meaning four different things to an owner.
   */
  const recoveryKind: RecoveryKind | null =
    health.status === 'NEEDS_REAUTH'         ? 'NEEDS_REAUTH'
    : health.status === 'PERMISSION_DENIED'  ? 'PERMISSION_DENIED'
    : health.status === 'WRONG_ACCOUNT'      ? 'WRONG_ACCOUNT'
    : health.status === 'PROVIDER_UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE'
    : health.status === 'SYNC_FAILED'        ? 'SYNC_FAILED'
    : health.status === 'PARTIAL'            ? 'PARTIAL'
    : health.status === 'NO_HISTORY'         ? 'NO_HISTORY'
    : null;

  return (
    <article
      data-testid={`connected-source-${health.provider}`}
      style={{ background: bg, border: `1px solid ${brd}`, borderRadius: 14, padding: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
              {health.providerName}
            </h4>
            {/* Text label, never colour alone. */}
            <span style={{ fontSize: 10, fontWeight: 700, color: tone, background: '#fff', border: `1px solid ${brd}`, borderRadius: 999, padding: '3px 8px' }}>
              {health.statusLabel}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink2)' }}>
            {health.selected_resource_name ?? health.external_account_name ?? 'No app selected'}
          </p>
        </div>

        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, auto))', gap: 14, margin: 0 }}>
          <div>
            <dt style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink3)', fontWeight: 700 }}>Last sync</dt>
            <dd style={{ margin: 0, fontSize: 12, color: 'var(--ink)' }}>{health.lastSyncLabel}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink3)', fontWeight: 700 }}>Freshness</dt>
            {/* Server-computed from the age of the last sync, and rendered as words.
                The raw level ('stale') is only a machine value. */}
            <dd style={{ margin: 0, fontSize: 12, color: 'var(--ink)' }}>
              {health.freshness_label ?? health.freshness}
              {(health.freshness === 'stale' || health.freshness === 'outdated') && (
                <span style={{ display: 'block', fontSize: 10, color: 'var(--amber)', fontWeight: 650 }}>
                  Newer data may exist at {health.providerName}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink3)', fontWeight: 700 }}>Signals learned</dt>
            <dd style={{ margin: 0, fontSize: 12, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{health.signals_count}</dd>
          </div>
        </dl>
      </div>

      {/* Recovery, when the connection is not simply healthy. Each state gets the
          full explanation rather than a status pill the owner has to interpret. */}
      {recoveryKind && (
        <div style={{ marginTop: 13 }}>
          <RecoveryNotice
            kind={recoveryKind}
            providerName={health.providerName}
            busy={busy}
            onRetry={recoveryKind === 'PARTIAL' || recoveryKind === 'SYNC_FAILED' || recoveryKind === 'PROVIDER_UNAVAILABLE' ? onRefresh : undefined}
            onReauthorize={recoveryKind === 'NEEDS_REAUTH' || recoveryKind === 'PERMISSION_DENIED' ? onReauthorize : undefined}
            onChooseAccount={recoveryKind === 'WRONG_ACCOUNT' ? onReauthorize : undefined}
          />
        </div>
      )}

      {/* Latest insight — rendered only when one genuinely exists. */}
      <div style={{ marginTop: 14, padding: 13, background: '#fff', border: '1px solid var(--border)', borderRadius: 10 }}>
        <p style={{ margin: '0 0 5px', fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
          Latest insight
        </p>
        {health.latest_insight ? (
          <>
            <p data-testid="latest-insight-headline" style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.45 }}>
              {health.latest_insight.headline}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink2)', lineHeight: 1.55 }}>
              {health.latest_insight.detail}
            </p>
            {evidence.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {evidence.map(e => (
                  <span key={e.label} style={{ fontSize: 10, background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 8px', color: 'var(--ink2)' }}>
                    {e.label}: <strong style={{ color: 'var(--ink)' }}>{String(e.value)}</strong>
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink3)', lineHeight: 1.55 }}>
            {/* NO_HISTORY is already explained by the recovery notice above; repeating
                it here would read as two different problems. */}
            {health.status === 'NO_HISTORY'
              ? 'Nothing to conclude from yet.'
              : 'No insight yet. LaunchMind reports one only when the imported data supports a conclusion.'}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {attention ? (
          <button onClick={onReauthorize} disabled={busy}
            style={{ height: 32, padding: '0 12px', borderRadius: 8, border: 'none', background: 'var(--amber)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Working…' : 'Reconnect'}
          </button>
        ) : (
          <button onClick={onRefresh} disabled={busy}
            style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--sage-b)', background: 'var(--sage-d)', color: 'var(--sage)', fontSize: 11, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        <button onClick={onManageAccess}
          style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border2)', background: '#fff', color: 'var(--ink2)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Manage access
        </button>
        <button onClick={onDisconnect}
          style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border2)', background: '#fff', color: 'var(--ink3)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Disconnect
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink3)' }}>
          {health.permissions_granted.join(' · ')} — no publishing or spend
        </span>
      </div>
    </article>
  );
}


/**
 * Authority panel (spec §15).
 *
 * Shows what LaunchMind may and may not do with a connected platform, and lets a
 * workspace admin REQUEST a wider authority. Requesting is not granting: the panel
 * says so plainly, and the request is recorded for approval.
 *
 * Deliberately blunt about the current state — for an action-capable platform like
 * Google Ads or Meta the honest message is "LaunchMind can see this and cannot touch
 * it", and hiding that behind soft language would undersell the guarantee.
 */
function AuthorityPanel({
  connectionId, providerName, token, onClose,
}: {
  connectionId: string; providerName: string; token: string; onClose: () => void;
}) {
  const [boundary, setBoundary] = useState<ExecutionBoundary | null>(null);
  const [history, setHistory]   = useState<ConnectionPermissionHistoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [requesting, setRequesting] = useState<PermissionLevel | null>(null);
  const [reason, setReason]     = useState('');
  const [notice, setNotice]     = useState<string | null>(null);
  const [deciding, setDeciding] = useState<PermissionLevel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, p] = await Promise.all([
        api.connections.executionBoundary(connectionId, token),
        api.connections.permissions(connectionId, token),
      ]);
      setBoundary(b);
      setHistory(p.history ?? []);
    } catch { /* the panel renders its own empty state */ }
    setLoading(false);
  }, [connectionId, token]);

  useEffect(() => { load(); }, [load]);

  // "Viewed" fires when the boundary is actually shown. It previously fired on
  // submit, which made the funnel read as though nobody opened the panel without
  // requesting something.
  useEffect(() => {
    trackIntelligence('execution_permission_upgrade_viewed', { connectionId });
  }, [connectionId]);

  // role="dialog", aria-modal, focus trap, focus restoration and Escape all come
  // from the shared Dialog. This panel previously had the first two only.

  async function submitRequest(level: PermissionLevel) {
    if (reason.trim().length < 8) {
      setNotice('Say why this authority is needed — it is recorded with the request.');
      return;
    }
    try {
      const result = await api.connections.requestAuthorityUpgrade(connectionId, [level], reason.trim(), token);
      setNotice(
        result.affectsSpend
          ? 'Recorded. This would let LaunchMind commit money, so it needs an owner to approve it before anything changes.'
          : 'Recorded. An owner still has to approve it before anything changes.',
      );
      setRequesting(null);
      setReason('');
      load();
    } catch (err) {
      setNotice((err as Error).message ?? 'Could not record the request.');
    }
  }

  /**
   * Records an owner's decision on a requested authority.
   *
   * Approving is the ONLY path by which CHANGE, PUBLISH, or SPEND can ever appear
   * on a connection, and the server enforces admin role and a written reason on top
   * of whatever this UI does. Declining changes nothing except the audit trail —
   * which is the point: a refusal has to be as recorded as an approval.
   */
  async function decide(level: PermissionLevel, approve: boolean) {
    if (reason.trim().length < 8) {
      setNotice('Say why — the decision is recorded with this reason.');
      return;
    }
    setDeciding(level);
    try {
      if (approve) {
        await api.connections.approveAuthorityUpgrade(connectionId, [level], reason.trim(), token);
        trackIntelligence('execution_permission_upgrade_granted', { connectionId, levels: level });
        setNotice(`${level} granted and recorded. LaunchMind still has no implementation that can use it.`);
      } else {
        await api.connections.denyAuthorityUpgrade(connectionId, [level], reason.trim(), token);
        trackIntelligence('execution_permission_upgrade_declined', { connectionId, levels: level });
        setNotice(`${level} declined. Nothing changed; the refusal is recorded.`);
      }
      setRequesting(null);
      setReason('');
      load();
    } catch (err) {
      // A non-admin gets the server's 403 here rather than a disabled button that
      // never explains itself.
      setNotice((err as Error).message ?? 'The decision could not be recorded.');
    } finally {
      setDeciding(null);
    }
  }

  const EXECUTION_LEVELS: PermissionLevel[] = ['CHANGE', 'PUBLISH', 'SPEND'];

  return (
    <Dialog
      label={`Access and permissions for ${providerName}`}
      onClose={onClose}
      maxWidth={620}
      panelClassName="lm-modal-pad"
    >
      <>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
              Access and permissions
            </p>
            <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700, fontFamily: 'Syne, sans-serif', color: 'var(--ink)' }}>
              {providerName}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'var(--raised)', border: 'none', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 18, color: 'var(--ink2)' }}>×</button>
        </div>

        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 18 }}>Loading…</p>
        ) : !boundary ? (
          <p style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 18 }}>
            Permissions could not be loaded. Nothing has changed.
          </p>
        ) : (
          <>
            <div style={{ marginTop: 16, padding: 13, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', borderRadius: 10 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink)', lineHeight: 1.55 }}>
                <strong>LaunchMind currently has {boundary.granted.join(' and ')} access.</strong>{' '}
                It can observe {providerName} and use what it sees in recommendations. It cannot
                change campaigns, publish anything, or spend money.
              </p>
            </div>

            <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink3)', margin: '20px 0 8px' }}>
              What LaunchMind can do
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {boundary.actions.map(a => (
                <li key={a.action} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12, color: 'var(--ink2)' }}>
                  {/* Symbol plus text, never colour alone. */}
                  <span aria-hidden style={{ color: a.allowed ? 'var(--sage)' : 'var(--danger)', fontWeight: 800, lineHeight: 1.5 }}>
                    {a.allowed ? '✓' : '✗'}
                  </span>
                  <span>
                    <strong style={{ color: 'var(--ink)' }}>{a.action.replace(/_/g, ' ')}</strong>
                    {' — '}
                    {a.allowed ? 'allowed' : a.blockedBy}
                  </span>
                </li>
              ))}
            </ul>

            <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink3)', margin: '22px 0 8px' }}>
              Request wider authority
            </h3>
            <p style={{ fontSize: 12, color: 'var(--ink2)', margin: '0 0 10px', lineHeight: 1.55 }}>
              Requesting does not grant anything. It records what you want and why, for an owner to approve.
              Approval is also not execution: LaunchMind has not built these actions yet.
            </p>

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {EXECUTION_LEVELS.map(level => (
                <button
                  key={level}
                  onClick={() => { setRequesting(level); setNotice(null); }}
                  disabled={boundary.granted.includes(level)}
                  style={{
                    height: 32, padding: '0 12px', borderRadius: 8,
                    border: `1px solid ${requesting === level ? 'var(--sage)' : 'var(--border2)'}`,
                    background: requesting === level ? 'var(--sage-d)' : '#fff',
                    color: boundary.granted.includes(level) ? 'var(--ink3)' : 'var(--ink2)',
                    fontSize: 11, fontWeight: 700,
                    cursor: boundary.granted.includes(level) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {boundary.granted.includes(level) ? `${level} granted` : `Request ${level}`}
                </button>
              ))}
            </div>

            {requesting && (
              <div style={{ marginTop: 12 }}>
                <label htmlFor="authority-reason" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink2)', marginBottom: 5 }}>
                  Why does LaunchMind need {requesting}?
                </label>
                <textarea
                  id="authority-reason"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  style={{ width: '100%', border: '1px solid var(--border2)', borderRadius: 9, padding: 10, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }}
                  placeholder="This is recorded permanently with the request."
                />
                <div className="lm-dialog-actions" style={{ display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => submitRequest(requesting)}
                    disabled={deciding !== null}
                    style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--sage)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: deciding ? 'not-allowed' : 'pointer' }}
                  >
                    Record request
                  </button>
                  {/* Decisions are admin-only server-side; a non-admin who presses
                      these gets the server's refusal, spelled out in the notice. */}
                  <button
                    onClick={() => void decide(requesting, true)}
                    disabled={deciding !== null}
                    style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--sage-b)', background: 'var(--sage-d)', color: 'var(--sage)', fontSize: 11, fontWeight: 700, cursor: deciding ? 'not-allowed' : 'pointer' }}
                  >
                    {deciding === requesting ? 'Recording…' : 'Approve as owner'}
                  </button>
                  <button
                    onClick={() => void decide(requesting, false)}
                    disabled={deciding !== null}
                    style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--danger-b)', background: '#fff', color: 'var(--danger)', fontSize: 11, fontWeight: 700, cursor: deciding ? 'not-allowed' : 'pointer' }}
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => { setRequesting(null); setReason(''); }}
                    style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border2)', background: '#fff', color: 'var(--ink2)', fontSize: 11, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {notice && (
              <p role="status" style={{ marginTop: 10, fontSize: 12, color: 'var(--ink2)', background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', lineHeight: 1.5 }}>
                {notice}
              </p>
            )}

            {history.length > 0 && (
              <>
                <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink3)', margin: '22px 0 8px' }}>
                  Permission history
                </h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                  {history.slice(0, 8).map(h => (
                    <li key={h.id} style={{ fontSize: 11, color: 'var(--ink2)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                      <strong style={{ color: 'var(--ink)' }}>{h.action.replace(/_/g, ' ')}</strong>
                      {' · '}{new Date(h.created_at).toLocaleDateString()}
                      {h.reason ? <> — {h.reason}</> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </>
    </Dialog>
  );
}


// ── Main page ─────────��───────────────────────────────────────────────────────

export default function ChannelsPage() {
  const [token,        setToken]        = useState('');
  const [coverage,     setCoverage]     = useState<GrowthBrainCoverage | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [toast,        setToast]        = useState<string | null>(null);

  // Legacy connect modal (kept for backward compat with oauth flow)
  const [connectModal, setConnectModal] = useState<string | null>(null);

  // Phase2 modal state
  const [phase2Open,     setPhase2Open]     = useState(false);
  const [phase2Provider, setPhase2Provider] = useState('');
  const [phase2Step,     setPhase2Step]     = useState<0|1|2|3|4>(0);

  // Connections map (provider key → connection)
  const [connections, setConnections] = useState<Record<string, WorkspaceConnection>>({});
  // Providers with a real integration behind them. Anything not in this set cannot
  // be connected yet and must be presented as unavailable, never as connectable.
  const [availableProviders, setAvailableProviders] = useState<Set<string>>(new Set());
  // Server-reported health for connected sources, including the latest real insight.
  const [connectedHealth, setConnectedHealth] = useState<ConnectedHealth[]>([]);
  const [busyConnection, setBusyConnection] = useState<string | null>(null);
  const [permissionPanel, setPermissionPanel] = useState<string | null>(null);

  const loadCoverage = useCallback(async (tk: string) => {
    try {
      const cov = await api.intelligence.coverage(tk);
      setCoverage(cov);
      if (cov?.recommendedSource) {
        trackIntelligence('recommended_source_shown', {
          provider: cov.recommendedSource.key,
          status:   cov.recommendedSource.connectionStatus,
        });
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadConnections = useCallback(async (tk: string) => {
    let conns: WorkspaceConnection[] = [];
    try {
      conns = (await api.connections.list(tk)) ?? [];
      const map: Record<string, WorkspaceConnection> = {};
      conns.forEach(c => { map[c.provider] = c; });
      setConnections(map);
    } catch { /* ignore */ }

    try {
      const { available } = await api.connections.providers(tk);
      setAvailableProviders(new Set(available ?? []));
    } catch { setAvailableProviders(new Set()); }

    // Health (including the latest insight) for anything past the preview stage.
    const live = conns.filter(c => !['NOT_CONNECTED', 'PREVIEWING', 'DISCONNECTED'].includes(c.status));
    const health = await Promise.all(live.map(async c => {
      try {
        const h = await api.connections.health(c.id, tk);
        return {
          ...h,
          connectionId:  c.id,
          providerName:  PLATFORM_CONFIG[c.provider]?.name ?? c.provider,
          statusLabel:   describeStatus(h.status, h.needs_attention),
          lastSyncLabel: h.last_synced_at ? relativeTime(h.last_synced_at) : 'Not yet',
        } as ConnectedHealth;
      } catch { return null; }
    }));
    setConnectedHealth(health.filter((h): h is ConnectedHealth => h !== null));
  }, []);

  const handleRefresh = useCallback(async (connectionId: string, provider: string) => {
    setBusyConnection(connectionId);
    try {
      await api.connections.refresh(connectionId, token);
      trackIntelligence('connection_refreshed', { provider, connectionId });
      setToast('Refresh queued — LaunchMind will update when the source responds');
      // Give the worker a moment, then re-read canonical state.
      setTimeout(() => { loadCoverage(token); loadConnections(token); }, 1200);
    } catch (err) {
      setToast((err as Error).message ?? 'Refresh failed');
    } finally {
      setBusyConnection(null);
    }
  }, [token, loadCoverage, loadConnections]);

  useEffect(() => {
    trackIntelligence('improve_intelligence_viewed');
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) { setLoading(false); return; }
      setToken(session.access_token);
      loadCoverage(session.access_token);
      loadConnections(session.access_token);
    });
  }, [loadCoverage, loadConnections]);

  const openPhase2 = useCallback((providerKey: string, step: 0|1|2|3|4 = 0) => {
    trackIntelligence(step === 0 ? 'source_preview_opened' : 'connection_started', { provider: providerKey });
    setPhase2Provider(providerKey);
    setPhase2Step(step);
    setPhase2Open(true);
  }, []);

  const handleReauthorize = useCallback(async (connectionId: string, provider: string) => {
    setBusyConnection(connectionId);
    try {
      await api.connections.reauthorize(connectionId, token);
      trackIntelligence('connection_reauthorized', { provider, connectionId });
      openPhase2(provider, 2);
      loadConnections(token);
    } catch (err) {
      setToast((err as Error).message ?? 'Could not start reconnection');
    } finally {
      setBusyConnection(null);
    }
  }, [token, loadConnections, openPhase2]);


  const handleConnect = useCallback(async (platformKey: string) => {
    const cfg = PLATFORM_CONFIG[platformKey];
    if (!cfg) return;
    if (cfg.endpoint === 'oauth') {
      try {
        let result: { url: string } | null = null;
        if (platformKey === 'google_ads') result = await api.integrations.googleAdsOAuthInit(token);
        else if (platformKey === 'meta_ads') result = await api.integrations.metaAdsOAuthInit(token);
        if (result?.url) window.location.href = result.url;
        else openPhase2(platformKey, 0);
      } catch { openPhase2(platformKey, 0); }
    } else {
      openPhase2(platformKey, 0);
    }
  }, [token, openPhase2]);

  const handleDisconnect = useCallback(async (platformKey: string) => {
    // Try new connections API first, fall back to legacy
    const conn = connections[platformKey];
    try {
      if (conn) {
        await api.connections.disconnect(conn.id, token);
      } else {
        await api.integrations.disconnect(platformKey, token);
      }
      trackIntelligence('connection_disconnected', { provider: platformKey });
      setToast(`${PLATFORM_CONFIG[platformKey]?.name ?? platformKey} disconnected`);
      loadCoverage(token);
      loadConnections(token);
    } catch { setToast('Disconnect failed — try again'); }
  }, [token, connections, loadCoverage, loadConnections]);

  /**
   * Canonical connection state for a provider. Single source of truth — the server's
   * workspace_connections row. Never inferred from a token existing or a button label.
   */
  const stateFor = (key: string) => coverage?.connectionStates?.[key] ?? null;

  /** Connected AND holding observed data. SYNCING is in-flight, not connected. */
  const isConnected = (key: string): boolean => {
    const canonical = stateFor(key);
    if (canonical) return canonical.healthy && canonical.signalCount > 0;
    const conn = connections[key];
    return conn ? conn.status === 'HEALTHY' || conn.status === 'PARTIAL' : false;
  };

  /** True when a real integration exists and the owner can actually connect today. */
  const canConnect = (key: string): boolean =>
    availableProviders.has(key) || (stateFor(key)?.adapterAvailable ?? false);

  /** Short owner-facing status for a source card. Never invents a value. */
  const statusFor = (key: string): string => {
    const s = stateFor(key) ?? null;
    if (!canConnect(key)) return 'Not available yet';
    if (!s || s.status === 'NOT_CONNECTED' || s.status === 'PREVIEWING') return 'Not connected';
    if (s.status === 'DISCONNECTED')  return 'Disconnected';
    if (s.noHistory)                  return 'Connected · no history yet';
    if (s.needsAttention)             return s.status === 'NEEDS_REAUTH' ? 'Needs reconnecting' : 'Needs attention';
    if (s.inFlight)                   return 'Syncing…';
    if (s.status === 'PARTIAL')       return 'Connected · partial data';
    if (s.healthy)                    return 'Connected · healthy';
    return 'Not connected';
  };

  const rec = coverage?.recommendedSource ?? null;
  const recKey = rec?.key ?? 'app_store_connect';
  // No fabricated default: until coverage loads there is no score to show.
  const score = coverage?.overallScore ?? null;
  const connectedCount = coverage?.connections.connectedCount ?? 0;

  const COMPACT_PROVIDERS = [
    'revenue_cat', 'ga4', 'stripe', 'search_console', 'google_ads', 'meta_ads', 'hubspot', 'mailchimp',
  ].filter(k => k !== recKey);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ height: 32, width: '35%', background: 'var(--raised)', borderRadius: 8 }} />
        <div style={{ height: 100, background: 'var(--raised)', borderRadius: 14 }} />
        <div style={{ height: 320, background: 'var(--raised)', borderRadius: 14 }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* Page head */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', color: 'var(--sage)', textTransform: 'uppercase', margin: '0 0 7px' }}>
            Make LaunchMind more accurate
          </p>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -1, color: 'var(--ink)', margin: '0 0 6px', fontFamily: 'Syne, sans-serif' }}>
            Improve Intelligence
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: 0, maxWidth: 640, lineHeight: 1.55 }}>
            Add a source only when it makes a specific business decision better. LaunchMind explains the gain first, asks for the minimum access, and proves the value after sync.
          </p>
        </div>
        <Link href="/dashboard/intelligence/growth-brain"
          style={{ height: 38, padding: '0 14px', border: '1px solid var(--border)', background: 'white', color: 'var(--ink)', borderRadius: 10, fontWeight: 650, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
          See what LaunchMind knows
        </Link>
      </div>

      {/* Improve summary card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--sage)', background: 'var(--sage-d)', border: '1px solid var(--sage-b)', padding: '3px 8px', borderRadius: 999 }}>
            Recommended for your current goal
          </span>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: '6px 0', fontFamily: 'Syne, sans-serif' }}>
            {rec
              ? `Replace estimated ${recKey === 'app_store_connect' ? 'App Store performance' : recKey === 'revenue_cat' ? 'revenue data' : 'analytics'} with observed data.`
              : 'All primary observation sources are connected.'}
          </h2>
          <p style={{ fontSize: 11, color: 'var(--ink2)', margin: 0, lineHeight: 1.6, maxWidth: 760 }}>
            Your current objective depends on knowing whether acquisition is converting into real installs—not merely whether demand appears strong publicly.
          </p>
        </div>
        <div style={{ minWidth: 190, borderLeft: '1px solid var(--border)', paddingLeft: 22, flexShrink: 0 }}>
          <small style={{ display: 'block', fontSize: 9, color: 'var(--ink3)', marginBottom: 4 }}>Growth Brain understanding</small>
          <b style={{ display: 'block', fontSize: 24, letterSpacing: '-.02em', color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>
            {score === null ? '—' : `${score}%`}
            {score !== null && rec?.available && (
              <i style={{ fontStyle: 'normal', color: 'var(--sage)', fontSize: 18 }}> → {Math.min(100, score + 12)}%</i>
            )}
          </b>
          <span style={{ display: 'block', fontSize: 9, color: 'var(--ink3)' }}>Expected after a healthy first sync</span>
        </div>
      </div>

      {/* Recommended source card */}
      {rec && (
        <article style={{
          background: 'var(--surface)', padding: 22, borderRadius: 14,
          border: '1px solid var(--sage3)', boxShadow: '0 12px 35px rgba(11,143,105,.08)',
          display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(280px,.75fr)', gap: 28,
          marginBottom: 24,
        }}>
          {/* Left: main content */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--raised)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18, color: 'var(--ink)', border: '1px solid var(--border)', flexShrink: 0 }}>
                {rec.logoChar}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--sage)', background: 'var(--sage-d)', border: '1px solid var(--sage-b)', padding: '3px 7px', borderRadius: 999 }}>Best next source</span>
                  {/* The recommended source is a source card too: its connection
                      state has to be readable as text, not inferred from the
                      presence of a Connect button (spec §21). */}
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>
                    {statusFor(recKey)}
                  </span>
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', margin: '3px 0 0', fontFamily: 'Syne, sans-serif' }}>{rec.name}</h2>
                <small style={{ fontSize: 11, color: 'var(--ink3)' }}>Performance intelligence · Read-only reporting</small>
              </div>
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: '0 0 7px', fontFamily: 'Syne, sans-serif' }}>
              Answer the acquisition question LaunchMind cannot answer today.
            </h3>
            <p style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 14px' }}>
              <strong>Decision this improves:</strong> {rec.decisionImproved}
            </p>

            {/* Decision delta */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', marginBottom: 16, background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
              <div>
                <small style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: 'var(--ink3)', textTransform: 'uppercase' }}>Today LaunchMind estimates</small>
                <b style={{ display: 'block', fontSize: 12, color: 'var(--ink)', marginTop: 3 }}>Acquisition quality from rankings, reviews, and public demand</b>
              </div>
              <span style={{ fontSize: 18, color: 'var(--ink3)' }}>→</span>
              <div>
                <small style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: 'var(--sage)', textTransform: 'uppercase' }}>After connection LaunchMind observes</small>
                <b style={{ display: 'block', fontSize: 12, color: 'var(--ink)', marginTop: 3 }}>Impressions, downloads, conversion, source mix, and territories</b>
              </div>
            </div>

            {/* Permission note */}
            <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.55, marginBottom: 16, padding: '10px 12px', background: 'var(--sage-d)', borderRadius: 8, border: '1px solid var(--sage-b)' }}>
              <strong>Minimum access:</strong> reporting and analytics only. LaunchMind cannot edit metadata, publish releases, manage users, launch campaigns, or spend money.
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isConnected(recKey) ? (
                <Link
                  href="/dashboard/intelligence/growth-brain"
                  style={{ height: 40, padding: '0 18px', borderRadius: 10, background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)', fontSize: 13, fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                >
                  View in Growth Brain →
                </Link>
              ) : canConnect(recKey) ? (
                <button
                  onClick={() => openPhase2(recKey, 0)}
                  style={{ height: 40, padding: '0 18px', borderRadius: 10, background: 'var(--sage)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
                >
                  Connect read-only →
                </button>
              ) : (
                /* No real integration exists yet — offer the preview, not a Connect
                   button that cannot succeed. */
                <button
                  onClick={() => openPhase2(recKey, 0)}
                  style={{ height: 40, padding: '0 18px', borderRadius: 10, background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink2)', fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
                >
                  Preview what this unlocks
                </button>
              )}
              <small style={{ fontSize: 11, color: 'var(--ink3)' }}>
                {canConnect(recKey)
                  ? 'Read-only reporting access'
                  : 'Not available to connect yet — LaunchMind will not estimate this data in the meantime'}
              </small>
            </div>
          </div>

          {/* Right: dark preview */}
          <aside style={{ background: '#13231f', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <small style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: '#91a79e', textTransform: 'uppercase' }}>Example of what becomes possible</small>
            <div style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 14 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: '#47d9ae', textTransform: 'uppercase' }}>New evidence-backed insight</span>
              <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '6px 0', lineHeight: 1.4, fontFamily: 'Syne, sans-serif' }}>
                {recKey === 'app_store_connect'
                  ? 'Search is bringing qualified traffic, but the product page is converting below your category benchmark.'
                  : recKey === 'revenue_cat'
                    ? 'Trial-to-paid conversion is below category average in the first 72 hours.'
                    : 'Website landing pages are losing qualified traffic before they reach the install step.'}
              </h4>
              <p style={{ fontSize: 11, color: '#91a79e', margin: 0, lineHeight: 1.55 }}>
                {recKey === 'app_store_connect'
                  ? 'LaunchMind would change the next recommendation from "increase acquisition" to "test store positioning first."'
                  : 'LaunchMind would update the priority order in your next Morning Brief.'}
              </p>
            </div>
            {/* Metrics this source would make visible. Values are intentionally
                withheld until the provider actually reports them — a placeholder
                number here would read as a real measurement of this product. */}
            {(recKey === 'app_store_connect'
              ? ['Product-page conversion', 'Top discovery source', 'Data freshness']
              : recKey === 'revenue_cat'
                ? ['Trial-to-paid conversion', 'Retention by cohort', 'Estimated LTV']
                : ['Landing-page performance', 'Largest funnel drop-off', 'Source quality']
            ).map(label => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 8 }}>
                <span style={{ fontSize: 11, color: '#91a79e' }}>{label}</span>
                <b style={{ fontSize: 11, color: '#6f8a80', fontWeight: 600 }}>Not observed yet</b>
              </div>
            ))}
          </aside>
        </article>
      )}

      {/* Connected sources: real health, real insight, real actions (spec §13, §16) */}
      {connectedHealth.length > 0 && (
        <section data-testid="connected-intelligence" style={{ marginBottom: 24, display: 'grid', gap: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0, fontFamily: 'Syne, sans-serif' }}>
            Connected intelligence
          </h3>
          {connectedHealth.map(h => (
            <ConnectedSourceCard
              key={h.connectionId}
              health={h}
              busy={busyConnection === h.connectionId}
              onRefresh={() => handleRefresh(h.connectionId, h.provider)}
              onReauthorize={() => handleReauthorize(h.connectionId, h.provider)}
              onManageAccess={() => setPermissionPanel(h.connectionId)}
              onDisconnect={() => handleDisconnect(h.provider)}
            />
          ))}
        </section>
      )}

      {/* Compact grid header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 4px', fontFamily: 'Syne, sans-serif' }}>
            {rec ? 'Other intelligence you can add later' : 'Available intelligence sources'}
          </h3>
          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: 0 }}>
            These are not setup requirements. Connect them only when the decision becomes relevant.
          </p>
        </div>
      </div>

      {/* Compact 2-col provider grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginBottom: 20 }}>
        {COMPACT_PROVIDERS.map(key => {
          const cfg = PLATFORM_CONFIG[key];
          if (!cfg) return null;
          return (
            <CompactSource
              key={key}
              providerKey={key}
              name={cfg.name}
              logoChar={cfg.logoChar}
              connection={connections[key]}
              canonical={stateFor(key)}
              canConnect={canConnect(key)}
              statusLabel={statusFor(key)}
              onConnect={() => handleConnect(key)}
              onPreview={() => openPhase2(key, 0)}
              onDisconnect={() => handleDisconnect(key)}
              onReconnect={() => openPhase2(key, 2)}
            />
          );
        })}
      </div>

      {/* Footer grid. Two columns on desktop, one below 900px — a .75fr column at
          390px is narrower than its own content and forces the page to scroll
          sideways (spec §22). Tailwind handles the breakpoint; the inline style
          only carries what does not vary. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_.75fr]" style={{ gap: 12 }}>

        {/* Connected intelligence health */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 3px', fontFamily: 'Syne, sans-serif' }}>Connected intelligence</h3>
              <p style={{ fontSize: 11, color: 'var(--ink3)', margin: 0 }}>Health and freshness stay visible after you connect.</p>
            </div>
            <ConnectionBadge connected={connectedCount > 0} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Public product intelligence</span>
            <b style={{ fontSize: 12, color: 'var(--sage)', fontWeight: 700 }}>Healthy · refreshed today</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Private performance intelligence</span>
            <b style={{ fontSize: 12, color: connectedCount > 0 ? 'var(--sage)' : 'var(--amber)', fontWeight: 700 }}>
              {connectedCount > 0 ? `${connectedCount} source${connectedCount > 1 ? 's' : ''} connected` : 'Not connected'}
            </b>
          </div>
        </div>

        {/* Trust card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 8px' }}>Your control never changes silently</p>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px', fontFamily: 'Syne, sans-serif' }}>Observation is not execution.</h3>
          <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6, margin: '0 0 14px' }}>
            Read, recommend, edit, publish, and spend are separate permissions. Connecting a reporting source only gives LaunchMind the ability to learn from that source.
          </p>
          <button
            onClick={() => setToast('Permission model: each connection grants only the scopes listed — no cross-permission escalation')}
            style={{ height: 36, padding: '0 14px', border: '1px solid var(--border)', background: 'var(--raised)', color: 'var(--ink2)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Review permission model
          </button>
        </div>

      </div>

      {/* Authority panel — what LaunchMind may and may not do with this platform. */}
      {permissionPanel && (
        <AuthorityPanel
          connectionId={permissionPanel}
          providerName={
            connectedHealth.find(h => h.connectionId === permissionPanel)?.providerName ?? 'this source'
          }
          token={token}
          onClose={() => setPermissionPanel(null)}
        />
      )}

      {/* Phase 2 modal */}
      {phase2Open && (
        <Phase2Modal
          provider={phase2Provider}
          token={token}
          initialStep={phase2Step}
          onClose={() => setPhase2Open(false)}
          onConnected={(prov) => {
            loadCoverage(token);
            loadConnections(token);
            setToast(`${PROVIDER_META[prov]?.name ?? prov} connected`);
          }}
        />
      )}

      {/* Legacy connect modal placeholder (oauth redirect) */}
      {connectModal && (
        <div style={{ display: 'none' }} />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

    </div>
  );
}
