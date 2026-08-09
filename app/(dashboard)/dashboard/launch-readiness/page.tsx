/**
 * @file launch-readiness.tsx
 * @description Launch Readiness — architectural, security, and operational controls checklist.
 *   Shows production blockers with priority tags and remediation guidance.
 * @security No secret data. Read-only display page.
 * @dependencies CSS vars from globals.css
 */

'use client';

import { useState } from 'react';
import {
  IconRocket,
  IconDatabase,
  IconShieldLock,
  IconStack2,
  IconUsers,
  IconHeartbeat,
  IconBrain,
  IconDownload,
  IconCheck,
  IconInfoCircle,
} from '@tabler/icons-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = 'P0' | 'P1' | 'P2';
type PriorityLevel = 'high' | 'med' | 'low';
type CardStatus = 'open' | 'resolved';

interface RiskCard {
  id: string;
  priority: Priority;
  level: PriorityLevel;
  category: string;
  title: string;
  body: string;
  icon: React.ReactNode;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const RISK_CARDS: RiskCard[] = [
  {
    id: 'db',
    priority: 'P0',
    level: 'high',
    category: 'Database',
    title: 'Apply and verify migrations 031–061',
    body: 'The documentation calls the build production-ready while the hosted database is still behind. Release must fail closed until schema and RLS verification succeeds.',
    icon: <IconDatabase size={16} />,
  },
  {
    id: 'security',
    priority: 'P0',
    level: 'high',
    category: 'Security',
    title: 'Complete SSRF and webhook hardening',
    body: 'Enforce DNS/IP re-resolution, private-network blocks, payload size limits, signed webhook replay protection, and idempotency at the database boundary.',
    icon: <IconShieldLock size={16} />,
  },
  {
    id: 'scale',
    priority: 'P1',
    level: 'med',
    category: 'Scale',
    title: 'Add pooling, indexes, queue isolation',
    body: 'Enable pgBouncer, ship migration 062, separate CPU-heavy scraper/render workers, set per-tenant concurrency, and add real dead-letter queues.',
    icon: <IconStack2 size={16} />,
  },
  {
    id: 'tenant',
    priority: 'P1',
    level: 'med',
    category: 'Tenant safety',
    title: 'Unify workspace authorization',
    body: 'RLS examples are founder-centric while Studio introduces workspace members. Every table and route needs a single workspace-scoped authorization model with role checks.',
    icon: <IconUsers size={16} />,
  },
  {
    id: 'reliability',
    priority: 'P1',
    level: 'med',
    category: 'Reliability',
    title: 'Define recovery targets',
    body: 'Add tested backup restore procedures, RPO/RTO, Redis outage behavior, queue reconciliation, scheduler leader election, and provider API circuit breakers.',
    icon: <IconHeartbeat size={16} />,
  },
  {
    id: 'ai',
    priority: 'P2',
    level: 'low',
    category: 'AI governance',
    title: 'Strengthen untrusted-content boundaries',
    body: 'Prompt stripping alone is insufficient. Treat scraped content as data, isolate it structurally, require output schemas, add tool allowlists, and evaluate injection attacks continuously.',
    icon: <IconBrain size={16} />,
  },
];

// ─── Pill styles by priority level ────────────────────────────────────────────

function pillStyle(level: PriorityLevel): React.CSSProperties {
  if (level === 'high') {
    return {
      background: 'var(--danger-d)',
      border: '1px solid var(--danger-b)',
      color: 'var(--danger)',
    };
  }
  if (level === 'med') {
    return {
      background: 'var(--amber-d)',
      border: '1px solid var(--amber-b)',
      color: 'var(--amber)',
    };
  }
  return {
    background: 'var(--sage-d)',
    border: '1px solid var(--sage-b)',
    color: 'var(--sage)',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LaunchReadinessPage() {
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>(() =>
    Object.fromEntries(RISK_CARDS.map((c) => [c.id, 'open']))
  );
  const [detailOpen, setDetailOpen] = useState<string | null>(null);

  const resolvedCount = Object.values(statuses).filter((s) => s === 'resolved').length;
  const totalCount = RISK_CARDS.length;

  // Readiness: base 72% (2 P0 + 3 P1 + 1 P2 open), climb as cards are resolved
  const baseScore = 72;
  const pointsPerCard = Math.floor((100 - baseScore) / totalCount);
  const score = Math.min(100, baseScore + resolvedCount * pointsPerCard);

  const p0Remaining = RISK_CARDS.filter(
    (c) => c.priority === 'P0' && statuses[c.id] === 'open'
  ).length;
  const p1Remaining = RISK_CARDS.filter(
    (c) => c.priority === 'P1' && statuses[c.id] === 'open'
  ).length;
  const p2Remaining = RISK_CARDS.filter(
    (c) => c.priority === 'P2' && statuses[c.id] === 'open'
  ).length;

  function toggleResolved(id: string) {
    setStatuses((prev) => ({
      ...prev,
      [id]: prev[id] === 'resolved' ? 'open' : 'resolved',
    }));
  }

  function handleExport() {
    const lines: string[] = [
      'LaunchMind — Remediation Plan',
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      `Overall readiness: ${score}%`,
      '',
    ];
    for (const card of RISK_CARDS) {
      const status = statuses[card.id];
      lines.push(`[${card.priority}] ${card.category} — ${card.title}`);
      lines.push(`Status: ${status}`);
      lines.push(card.body);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'launchmind-remediation-plan.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 32px)' }}>

      {/* ── Page head ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 28,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'var(--sage-d)',
              border: '1px solid var(--sage-b)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--sage)',
              flexShrink: 0,
            }}
          >
            <IconRocket size={22} />
          </div>
          <div>
            <h1
              style={{
                fontFamily: 'Syne, sans-serif',
                fontSize: 30,
                fontWeight: 700,
                color: 'var(--ink)',
                margin: 0,
                lineHeight: 1.15,
              }}
            >
              Launch readiness
            </h1>
            <p
              style={{
                fontSize: 14,
                color: 'var(--ink2)',
                margin: '4px 0 0',
                lineHeight: 1.5,
              }}
            >
              Architecture, security, scale, reliability, and operational controls required
              before production traffic.
            </p>
          </div>
        </div>

        <button
          onClick={handleExport}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            height: 40,
            padding: '0 18px',
            background: 'var(--sage)',
            color: '#fff',
            border: 'none',
            borderRadius: 14,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <IconDownload size={15} />
          Export remediation plan
        </button>
      </div>

      {/* ── Summary score card ── */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '20px 24px',
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        {/* Score circle */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: score >= 90 ? 'var(--sage-d)' : score >= 75 ? 'var(--amber-d)' : 'var(--danger-d)',
            border: `3px solid ${score >= 90 ? 'var(--sage)' : score >= 75 ? 'var(--amber)' : 'var(--danger)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 18,
              fontWeight: 500,
              color: score >= 90 ? 'var(--sage)' : score >= 75 ? 'var(--amber)' : 'var(--danger)',
            }}
          >
            {score}%
          </span>
        </div>

        {/* Text + bar */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: 'Syne, sans-serif',
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--ink)',
              marginBottom: 6,
            }}
          >
            {score}% overall readiness
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--ink2)',
              marginBottom: 12,
            }}
          >
            {p0Remaining > 0 && (
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                {p0Remaining} P0 blocker{p0Remaining !== 1 ? 's' : ''}
              </span>
            )}
            {p0Remaining > 0 && (p1Remaining > 0 || p2Remaining > 0) && ', '}
            {p1Remaining > 0 && (
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                {p1Remaining} P1 improvement{p1Remaining !== 1 ? 's' : ''}
              </span>
            )}
            {p1Remaining > 0 && p2Remaining > 0 && ', '}
            {p2Remaining > 0 && (
              <span style={{ color: 'var(--sage)', fontWeight: 600 }}>
                {p2Remaining} P2 enhancement{p2Remaining !== 1 ? 's' : ''}
              </span>
            )}
            {p0Remaining === 0 && p1Remaining === 0 && p2Remaining === 0 && (
              <span style={{ color: 'var(--sage)', fontWeight: 600 }}>
                All items resolved — ready for production
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div
            style={{
              height: 8,
              background: 'var(--raised)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${score}%`,
                background:
                  score >= 90
                    ? 'var(--sage)'
                    : score >= 75
                    ? 'var(--amber)'
                    : 'var(--danger)',
                borderRadius: 999,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>

        {/* Resolved counter */}
        <div
          style={{
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 28,
              fontWeight: 500,
              color: resolvedCount === totalCount ? 'var(--sage)' : 'var(--ink)',
              lineHeight: 1,
            }}
          >
            {resolvedCount}/{totalCount}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>resolved</div>
        </div>
      </div>

      {/* ── Risk grid ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
        }}
        className="xl:grid-cols-3 md:grid-cols-2"
      >
        {RISK_CARDS.map((card) => {
          const resolved = statuses[card.id] === 'resolved';
          const isOpen = detailOpen === card.id;

          return (
            <div
              key={card.id}
              style={{
                background: resolved ? 'var(--raised)' : 'var(--surface)',
                border: `1px solid ${resolved ? 'var(--border)' : 'var(--border)'}`,
                borderRadius: 14,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
                opacity: resolved ? 0.72 : 1,
                transition: 'opacity 0.2s ease',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Resolved overlay stripe */}
              {resolved && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: 'var(--sage)',
                    borderRadius: '14px 14px 0 0',
                  }}
                />
              )}

              {/* Priority pill */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  width: 'fit-content',
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  ...pillStyle(card.level),
                }}
              >
                {card.icon}
                {card.priority} · {card.category}
              </span>

              {/* Title */}
              <h3
                style={{
                  fontFamily: 'Syne, sans-serif',
                  fontSize: 15,
                  fontWeight: 700,
                  color: resolved ? 'var(--ink2)' : 'var(--ink)',
                  margin: '10px 0 8px',
                  lineHeight: 1.35,
                  textDecoration: resolved ? 'line-through' : 'none',
                }}
              >
                {card.title}
              </h3>

              {/* Body */}
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--ink2)',
                  lineHeight: 1.55,
                  margin: 0,
                  flex: 1,
                }}
              >
                {card.body}
              </p>

              {/* Detail expansion */}
              {isOpen && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    background: 'var(--raised)',
                    border: '1px solid var(--border2)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--ink2)',
                    lineHeight: 1.6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 6,
                      color: 'var(--ink3)',
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    <IconInfoCircle size={13} />
                    Remediation guidance
                  </div>
                  <p style={{ margin: 0 }}>
                    {card.priority === 'P0' && card.id === 'db' &&
                      'Run each migration file against the hosted Supabase instance in order (031–061). After each batch, query information_schema.columns to verify new columns exist and confirm RLS policies with SELECT * FROM pg_policies WHERE tablename = \'<table>\'.'}
                    {card.priority === 'P0' && card.id === 'security' &&
                      'In icpService.scrapeWebsite(), wrap the fetch call with an SSRF guard that resolves the hostname via DNS and blocks RFC-1918 / loopback ranges before the request is sent. For webhooks, verify HMAC-SHA256 signatures and add a nonce + created_at timestamp check to prevent replay within a 5-minute window.'}
                    {card.id === 'scale' &&
                      'Enable Transaction mode pgBouncer in Supabase project settings → Database → Connection pooling. Ship migration 062 with GIN/BRIN indexes on hot columns. Move scraper and render workers to a separate Docker service with CPU limits in docker-compose.prod.yml.'}
                    {card.id === 'tenant' &&
                      'Introduce a workspace_members RLS helper function: CREATE OR REPLACE FUNCTION is_workspace_member(wsid uuid) RETURNS boolean ... and reference it in every table policy that stores workspace_id. Audit all Fastify routes for workspace_id ownership checks at the route layer.'}
                    {card.id === 'reliability' &&
                      'Document RPO ≤ 1 hour / RTO ≤ 4 hours in docs/sla.md. Add a BullMQ job to reconcile any missions stuck in "queued" state after a Redis restart. Wire bull-board for queue visibility. Test Supabase PITR restore on a staging clone monthly.'}
                    {card.id === 'ai' &&
                      'In contextEngine.ts, wrap all untrusted strings (scraped_meta, competitor_set, reviews) in a structural separator: "---BEGIN UNTRUSTED CONTENT---\\n...\\n---END UNTRUSTED CONTENT---". Add a Zod schema for every AI JSON response and throw on parse failure rather than passing through raw text. Log prompt injection attempts to audit_logs.'}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  onClick={() => toggleResolved(card.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 32,
                    padding: '0 13px',
                    background: resolved ? 'var(--sage-d)' : 'var(--sage)',
                    color: resolved ? 'var(--sage)' : '#fff',
                    border: resolved ? '1px solid var(--sage-b)' : 'none',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <IconCheck size={13} />
                  {resolved ? 'Undo resolve' : 'Mark resolved'}
                </button>

                <button
                  onClick={() => setDetailOpen(isOpen ? null : card.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 32,
                    padding: '0 13px',
                    background: 'var(--raised)',
                    color: 'var(--ink2)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <IconInfoCircle size={13} />
                  {isOpen ? 'Hide details' : 'View details'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer note ── */}
      <p
        style={{
          marginTop: 28,
          fontSize: 12,
          color: 'var(--ink3)',
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        Readiness score updates as items are resolved. Export the remediation plan for
        handoff to your infrastructure or security team.
      </p>
    </div>
  );
}
