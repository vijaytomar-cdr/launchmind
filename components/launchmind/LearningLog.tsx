/**
 * @file components/launchmind/LearningLog.tsx
 * @description The explainability surface behind "View learning log →" (spec §4.3).
 *
 *   Shows the full history of what changed LaunchMind's mind, not just the most
 *   recent entry. For each change: when, what triggered it, which source, the
 *   evidence, what LaunchMind believed before and after, how confidence moved,
 *   whether it decided that on its own or a person confirmed it, and what
 *   downstream work it affected.
 *
 *   Two things it deliberately does not do:
 *     - It never renders a confidence delta the server did not measure. An entry
 *       with no measured movement says "No measured change" rather than "+0".
 *     - It never invents a link. A recommendation or mission that no longer exists
 *       (or belongs to another tenant) is filtered out server-side and simply does
 *       not appear, rather than rendering as a dead reference.
 *
 * @security Reads a workspace-scoped endpoint. No provider payloads or credentials
 *   are present in any field it renders.
 * @dependencies api.intelligence.learningLog
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type LearningLogEntry } from '@/lib/api';

/** Absolute date plus a relative hint — the log is read both ways. */
function formatWhen(iso: string): { absolute: string; relative: string } {
  const d = new Date(iso);
  const absolute = d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  const relative =
    mins < 1    ? 'just now'
    : mins < 60 ? `${mins} min ago`
    : mins < 1440 ? `${Math.floor(mins / 60)}h ago`
    : `${Math.floor(mins / 1440)}d ago`;

  return { absolute, relative };
}

const EVENT_LABELS: Record<LearningLogEntry['eventType'], string> = {
  source_connected:      'Source connected',
  source_synced:         'Source reported data',
  source_disconnected:   'Source disconnected',
  source_reauthorized:   'Source reconnected',
  context_updated:       'Context updated',
  context_delta_updated: 'Launch plan updated',
  recommendation_updated: 'Recommendation updated',
  authority_changed:     'Permissions changed',
};

const LABEL: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, letterSpacing: '.09em',
  textTransform: 'uppercase', color: 'var(--ink3)', margin: '0 0 3px',
};

/** One log entry. */
function Entry({ entry }: { entry: LearningLogEntry }) {
  const when = formatWhen(entry.createdAt);
  const founderMade = entry.changeOrigin === 'founder_confirmed';
  const delta = entry.confidenceDelta;

  return (
    <li
      data-testid="learning-log-entry"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 14,
        background: 'var(--surface)',
        listStyle: 'none',
      }}
    >
      {/* Header: when · who · which source */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={LABEL}>
            {EVENT_LABELS[entry.eventType] ?? entry.eventType.replace(/_/g, ' ')}
          </p>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.45 }}>
            {entry.trigger}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Automatic vs founder-confirmed — the distinction the log exists for.
              Symbol and word, never colour alone. */}
          <span
            style={{
              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
              background: founderMade ? 'var(--sage2)' : 'var(--violet2)',
              border: `1px solid ${founderMade ? 'var(--sage3)' : '#d7d0ff'}`,
              color: founderMade ? '#087253' : 'var(--ai)',
              whiteSpace: 'nowrap',
            }}
          >
            {founderMade ? '● You confirmed this' : '✦ LaunchMind concluded this'}
          </span>
          {entry.providerLabel && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--raised)', border: '1px solid var(--border)', color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
              {entry.providerLabel}
            </span>
          )}
          <time
            dateTime={entry.createdAt}
            title={when.absolute}
            style={{ fontSize: 10, color: 'var(--ink3)', whiteSpace: 'nowrap' }}
          >
            {when.relative}
          </time>
        </div>
      </div>

      {/* Before → after */}
      {(entry.previousState || entry.newState) && (
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 18px minmax(0,1fr)',
            gap: 8, alignItems: 'start',
            background: 'var(--raised)', border: '1px solid var(--border)',
            borderRadius: 9, padding: '10px 12px', marginBottom: 9,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={LABEL}>Previously</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5 }}>
              {entry.previousState ?? 'Nothing recorded'}
            </p>
          </div>
          <span aria-hidden style={{ alignSelf: 'center', color: 'var(--ink3)', fontSize: 13, textAlign: 'center' }}>→</span>
          <div style={{ minWidth: 0 }}>
            <p style={LABEL}>Now</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink)', fontWeight: 550, lineHeight: 1.5 }}>
              {entry.newState ?? 'Unchanged'}
            </p>
          </div>
        </div>
      )}

      {/* Evidence */}
      {entry.evidence.length > 0 && (
        <div style={{ marginBottom: 9 }}>
          <p style={LABEL}>Evidence</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {entry.evidence.map((e, i) => (
              <span
                key={`${e.label}-${i}`}
                style={{ fontSize: 10, background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 9px', color: 'var(--ink2)' }}
              >
                {e.label}: <strong style={{ color: 'var(--ink)' }}>{String(e.value)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Confidence movement */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <p style={LABEL}>Confidence</p>
          {delta === null ? (
            /* The server measured only one side, or neither. Rendering "+0" or a
               made-up lift here would be exactly the kind of claim this log exists
               to make impossible. */
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>No measured change</span>
          ) : (
            <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--ink)' }}>
              {entry.priorConfidence}% <span aria-hidden>→</span> {entry.newConfidence}%{' '}
              <strong style={{ color: delta > 0 ? 'var(--sage)' : delta < 0 ? 'var(--danger)' : 'var(--ink3)' }}>
                ({delta > 0 ? '+' : ''}{delta})
              </strong>
            </span>
          )}
        </div>

        {(entry.affectedRecommendations.length > 0 || entry.affectedMissions.length > 0) && (
          <div style={{ minWidth: 0 }}>
            <p style={LABEL}>Affected</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {entry.affectedRecommendations.map(r => (
                <Link
                  key={r.id}
                  href="/dashboard/opportunities"
                  style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 600, textDecoration: 'none' }}
                >
                  {r.title ?? 'Recommendation'} →
                </Link>
              ))}
              {entry.affectedMissions.map(m => (
                <Link
                  key={m.id}
                  href={`/dashboard/missions/${m.id}`}
                  style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 600, textDecoration: 'none' }}
                >
                  {m.title ?? 'Mission'} →
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export interface LearningLogProps {
  token: string;
  productId?: string | null;
  /** Rendered inside a dialog; keeps its own scroll region. */
  maxHeight?: number;
}

export function LearningLog({ token, productId, maxHeight = 460 }: LearningLogProps) {
  const [entries, setEntries]   = useState<LearningLogEntry[]>([]);
  const [cursor, setCursor]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setMore]  = useState(false);
  const [error, setError]       = useState(false);

  const load = useCallback(async (before?: string) => {
    if (before) setMore(true); else { setLoading(true); setError(false); }
    try {
      const page = await api.intelligence.learningLog(token, {
        limit: 20,
        before,
        productId: productId ?? undefined,
      });
      setEntries(prev => (before ? [...prev, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } catch {
      // Only a first-page failure is an error state. A failed "load more" leaves
      // what the owner is already reading on screen.
      if (!before) setError(true);
    } finally {
      setLoading(false); setMore(false);
    }
  }, [token, productId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" style={{ padding: '28px 0', textAlign: 'center', fontSize: 13, color: 'var(--ink3)' }}>
        Loading the learning history…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" style={{ padding: 16, background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <p style={{ margin: '0 0 9px', fontSize: 13, color: 'var(--ink)' }}>
          The learning history could not be loaded. Nothing has changed.
        </p>
        <button
          onClick={() => void load()}
          style={{ height: 32, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border2)', background: '#fff', color: 'var(--ink)', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.65, margin: 0 }}>
        Nothing has changed LaunchMind&apos;s understanding yet. Entries appear here when a
        connected source reports data, or when you update your context or launch plan.
      </p>
    );
  }

  return (
    <div>
      <p role="status" aria-live="polite" style={{ fontSize: 11, color: 'var(--ink3)', margin: '0 0 10px' }}>
        {entries.length} change{entries.length === 1 ? '' : 's'} recorded
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, maxHeight, overflowY: 'auto' }}>
        {entries.map(e => <Entry key={e.id} entry={e} />)}
      </ul>
      {cursor && (
        <button
          onClick={() => void load(cursor)}
          disabled={loadingMore}
          style={{ marginTop: 12, height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border2)', background: '#fff', color: 'var(--ink2)', fontSize: 12, fontWeight: 650, cursor: loadingMore ? 'not-allowed' : 'pointer' }}
        >
          {loadingMore ? 'Loading…' : 'Load earlier changes'}
        </button>
      )}
    </div>
  );
}
