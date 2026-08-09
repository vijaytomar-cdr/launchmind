/**
 * @file components/launchmind/RecoveryNotice.tsx
 * @description The single owner-facing explanation for every way a connection can
 *   fail to produce full intelligence (spec §14).
 *
 *   One component rather than seven inline blocks, because these messages are the
 *   ones an owner reads when something has gone wrong and trust is thinnest. Keeping
 *   them together makes it possible to see at a glance that all seven say what
 *   happened, what LaunchMind can and cannot do as a result, and what to do next.
 *
 *   Three rules hold across all of them:
 *     1. Previously learned data is never described as lost, because it is not.
 *     2. A successful connection with no history is NOT a failure and is not
 *        styled like one (spec §14.5).
 *     3. No raw provider text, error body, or stack trace is ever rendered.
 *
 * @security Renders only the fixed copy below plus a machine error code. Callers
 *   pass a ProviderError kind, never a provider message.
 */

'use client';

/** The recovery cases. Maps 1:1 to ProviderError kinds plus the two sync outcomes. */
export type RecoveryKind =
  | 'PERMISSION_DENIED'
  | 'WRONG_ACCOUNT'
  | 'NEEDS_REAUTH'
  | 'PARTIAL'
  | 'NO_HISTORY'
  | 'PROVIDER_UNAVAILABLE'
  | 'SYNC_FAILED'
  | 'ADAPTER_UNAVAILABLE'
  | 'CREDENTIAL_VAULT_UNAVAILABLE';

type Tone = 'info' | 'warning' | 'danger' | 'positive';

interface RecoveryCopy {
  tone:      Tone;
  title:     string;
  /** What happened, in the owner's terms. */
  body:      string;
  /** What LaunchMind can still do, and what it cannot. Always both. */
  boundary:  string;
  primary?:  { label: string; action: 'retry' | 'reauthorize' | 'chooseAccount' | 'dismiss' };
  secondary?: { label: string; action: 'retry' | 'reauthorize' | 'chooseAccount' | 'dismiss' };
}

const COPY: Record<RecoveryKind, RecoveryCopy> = {
  PERMISSION_DENIED: {
    tone: 'warning',
    title: 'LaunchMind was not granted the access it needs',
    body:
      'The account authorized the connection but withheld read access to the reports ' +
      'LaunchMind asked for. Nothing was imported.',
    boundary:
      'LaunchMind only ever requests read access — it cannot post, change settings, or ' +
      'spend from this source, with or without this permission. Until read access is ' +
      'granted, your Growth Brain keeps using public intelligence.',
    primary:   { label: 'Try again', action: 'retry' },
    secondary: { label: 'Not now', action: 'dismiss' },
  },
  WRONG_ACCOUNT: {
    tone: 'warning',
    title: 'This looks like a different account',
    body:
      'The credential is valid, but it belongs to an account that does not hold the app ' +
      'or property this workspace is about.',
    boundary:
      'Nothing was imported, and nothing already learned was changed. Choosing the right ' +
      'account will start a fresh read.',
    primary:   { label: 'Choose a different account', action: 'chooseAccount' },
    secondary: { label: 'Not now', action: 'dismiss' },
  },
  NEEDS_REAUTH: {
    tone: 'warning',
    title: 'This source needs reconnecting',
    body:
      'The authorization has expired or been revoked at the provider, so no new data is ' +
      'arriving.',
    boundary:
      'Everything this source already taught LaunchMind is preserved and still in use — ' +
      'it is simply marked as no longer current. Reconnecting resumes updates without ' +
      'widening what LaunchMind may do.',
    primary:   { label: 'Reconnect', action: 'reauthorize' },
    secondary: { label: 'Not now', action: 'dismiss' },
  },
  PARTIAL: {
    tone: 'info',
    title: 'Some data imported, some was unavailable',
    body:
      'LaunchMind read part of what it asked for. The rest was not available from the ' +
      'provider during this sync.',
    boundary:
      'What arrived is being used and is labelled as partial. LaunchMind will not fill ' +
      'the gap with estimates — the dimensions that depend on the missing reports stay ' +
      'unobserved until a later sync succeeds.',
    primary: { label: 'Try again now', action: 'retry' },
  },
  NO_HISTORY: {
    tone: 'positive',
    title: 'Connected — no history to read yet',
    body:
      'The connection is healthy. The provider simply does not hold enough history for ' +
      'this account yet.',
    boundary:
      'This is not a failure. LaunchMind will begin learning as data arrives, and will ' +
      'not estimate anything in the meantime.',
  },
  PROVIDER_UNAVAILABLE: {
    tone: 'danger',
    title: 'The provider is not responding',
    body:
      'The provider’s API is unavailable or rate-limiting requests right now. This is a ' +
      'problem at their end, not with your connection.',
    boundary:
      'Your connection and everything already imported are untouched. LaunchMind will ' +
      'keep the connection in place and retry.',
    primary:   { label: 'Retry', action: 'retry' },
    secondary: { label: 'Not now', action: 'dismiss' },
  },
  SYNC_FAILED: {
    tone: 'danger',
    title: 'The import could not be completed',
    body:
      'Something went wrong while reading this source. The details have been recorded for ' +
      'the LaunchMind team.',
    boundary:
      'No partial data was kept, and your existing intelligence is unchanged. Retrying is ' +
      'safe — a repeated import cannot create duplicate signals.',
    primary:   { label: 'Retry', action: 'retry' },
    secondary: { label: 'Not now', action: 'dismiss' },
  },
  CREDENTIAL_VAULT_UNAVAILABLE: {
    tone: 'danger',
    title: 'LaunchMind cannot store credentials safely right now',
    body:
      'This is a problem inside LaunchMind, not with your account or your provider. ' +
      'The secure vault that encrypts connection credentials is temporarily unavailable, ' +
      'so the connection was stopped before anything was saved.',
    boundary:
      'Nothing was stored, nothing was sent to the provider, and no existing connection ' +
      'or imported data was changed. LaunchMind will not fall back to storing credentials ' +
      'unencrypted. Trying again once the vault is back will pick up exactly where you left off.',
    primary:   { label: 'Try again', action: 'retry' },
    secondary: { label: 'Not now', action: 'dismiss' },
  },
  ADAPTER_UNAVAILABLE: {
    tone: 'info',
    title: 'This source is not available to connect yet',
    body: 'LaunchMind does not have a real integration for this provider yet.',
    boundary:
      'Rather than show estimated numbers in its place, LaunchMind leaves this dimension ' +
      'unobserved. Your Growth Brain keeps using public intelligence.',
    secondary: { label: 'Close', action: 'dismiss' },
  },
};

const TONES: Record<Tone, { bg: string; border: string; text: string; icon: string; word: string }> = {
  // Symbol + word accompany every colour, so state is never colour-only (spec §21).
  info:     { bg: 'var(--raised)',  border: 'var(--border2)',   text: 'var(--ink2)', icon: 'ℹ', word: 'Note' },
  warning:  { bg: 'var(--amber2)',  border: 'var(--amber-b)',   text: '#7d4306',     icon: '!', word: 'Action needed' },
  danger:   { bg: 'var(--danger2)', border: 'var(--danger-b)',  text: 'var(--danger)', icon: '✕', word: 'Problem' },
  positive: { bg: 'var(--sage2)',   border: 'var(--sage3)',     text: '#087253',     icon: '✓', word: 'Healthy' },
};

export interface RecoveryNoticeProps {
  kind: RecoveryKind;
  /** Provider display name, woven into the copy where it reads naturally. */
  providerName?: string;
  /** Machine code shown in small print so support can correlate. Never a message. */
  errorCode?: string | null;
  busy?: boolean;
  onRetry?: () => void;
  onReauthorize?: () => void;
  onChooseAccount?: () => void;
  onDismiss?: () => void;
}

export function RecoveryNotice({
  kind, providerName, errorCode, busy = false,
  onRetry, onReauthorize, onChooseAccount, onDismiss,
}: RecoveryNoticeProps) {
  const copy = COPY[kind];
  const tone = TONES[copy.tone];

  const handlerFor = (action: 'retry' | 'reauthorize' | 'chooseAccount' | 'dismiss') => {
    switch (action) {
      case 'retry':         return onRetry;
      case 'reauthorize':   return onReauthorize;
      case 'chooseAccount': return onChooseAccount;
      case 'dismiss':       return onDismiss;
    }
  };

  // A button whose handler was not supplied would do nothing when pressed, which is
  // worse than not offering it.
  const buttons = [copy.primary, copy.secondary]
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .filter(b => Boolean(handlerFor(b.action)));

  return (
    <div
      role={copy.tone === 'danger' || copy.tone === 'warning' ? 'alert' : 'status'}
      data-testid={`recovery-${kind.toLowerCase()}`}
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        padding: '13px 15px',
        color: tone.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <span
          aria-hidden
          style={{
            width: 18, height: 18, borderRadius: 999, flexShrink: 0, marginTop: 1,
            display: 'grid', placeItems: 'center',
            background: '#fff', border: `1px solid ${tone.border}`,
            fontSize: 11, fontWeight: 800, color: tone.text,
          }}
        >
          {tone.icon}
        </span>
        <div style={{ minWidth: 0 }}>
          {/* The state in words, for anyone who cannot use the colour. */}
          <p style={{ margin: 0, fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.75 }}>
            {tone.word}
          </p>
          <p style={{ margin: '2px 0 5px', fontSize: 13, fontWeight: 700 }}>
            {providerName ? `${providerName} — ${copy.title.charAt(0).toLowerCase()}${copy.title.slice(1)}` : copy.title}
          </p>
          <p className="lm-permission-copy" style={{ margin: '0 0 6px' }}>{copy.body}</p>
          <p className="lm-permission-copy" style={{ margin: 0, opacity: 0.9 }}>{copy.boundary}</p>

          {buttons.length > 0 && (
            <div className="lm-dialog-actions" style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
              {buttons.map((b, i) => (
                <button
                  key={b.action}
                  onClick={handlerFor(b.action)}
                  disabled={busy}
                  style={{
                    height: 32, padding: '0 13px', borderRadius: 8,
                    border: i === 0 ? 'none' : `1px solid ${tone.border}`,
                    background: i === 0 ? tone.text : '#fff',
                    color: i === 0 ? '#fff' : tone.text,
                    fontSize: 11, fontWeight: 700,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.65 : 1,
                  }}
                >
                  {busy && i === 0 ? 'Working…' : b.label}
                </button>
              ))}
            </div>
          )}

          {errorCode && (
            <p style={{ margin: '9px 0 0', fontSize: 10, opacity: 0.7, fontFamily: 'DM Mono, monospace' }}>
              Reference: {errorCode}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Maps a thrown API error to a recovery case.
 *
 * Deliberately matches on the machine code the backend sends, not on message text.
 * Message matching worked only as long as the wording never changed, which is not a
 * property anyone was maintaining.
 *
 * @returns The recovery kind, or null when the error is not a connection-recovery case
 */
export function recoveryKindFromError(err: unknown): RecoveryKind | null {
  const raw = err as { code?: string; kind?: string; message?: string } | null;
  const code = (raw?.code ?? raw?.kind ?? '').toUpperCase();

  const known: RecoveryKind[] = [
    'PERMISSION_DENIED', 'WRONG_ACCOUNT', 'NEEDS_REAUTH',
    'PROVIDER_UNAVAILABLE', 'SYNC_FAILED', 'ADAPTER_UNAVAILABLE',
    'CREDENTIAL_VAULT_UNAVAILABLE',
  ];
  if ((known as string[]).includes(code)) return code as RecoveryKind;

  // Fallback for older responses that carried the reason only in the message.
  const msg = (raw?.message ?? '').toLowerCase();
  if (!msg) return null;
  if (msg.includes('not available to connect yet')) return 'ADAPTER_UNAVAILABLE';
  if (msg.includes('permission'))                   return 'PERMISSION_DENIED';
  if (msg.includes('different account') || msg.includes('wrong account')) return 'WRONG_ACCOUNT';
  if (msg.includes('reconnect') || msg.includes('expired'))               return 'NEEDS_REAUTH';
  if (msg.includes('unavailable') || msg.includes('temporarily'))         return 'PROVIDER_UNAVAILABLE';
  return null;
}
