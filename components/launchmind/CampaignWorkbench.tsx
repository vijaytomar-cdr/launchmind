/**
 * @file CampaignWorkbench.tsx
 * @description Content Studio as a WORKBENCH — Phase 3.5B5.
 *
 *   Content Intelligence answers "what should we say and why". This answers
 *   "show me the content and let me work on it". Keeping them apart is the
 *   point: a decision surface and a workbench are different jobs, and merging
 *   them produces a page that does neither well.
 *
 *   MOUNTED ADDITIVELY. The existing Content Studio (library, generator, stats,
 *   editor, transforms) is untouched and still reachable; this renders only when
 *   a `?campaign=` id is present, which is exactly the link Content Intelligence
 *   emits. Progressive refactor, not replacement.
 *
 *   NO EXECUTION VERB APPEARS HERE. No Publish, Launch, Schedule, Deploy or
 *   Spend — the legacy library tab still carries a publish action for the
 *   ungoverned Studio lane, and this surface deliberately does not.
 *
 * @security Renders only the owner-safe projection from
 *   GET /studio/governed/campaign/:id. Nothing internal reaches the browser.
 * @dependencies lib/api, existing LaunchMind tokens and Button
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CampaignWorkbenchView, type WorkbenchArtifact } from '@/lib/api';
import { Button } from '@/components/launchmind/Button';
import { CreativePanel } from '@/components/launchmind/CreativePanel';
import { PageLoading } from '@/components/launchmind/LoadingState';
import { EmptyState } from '@/components/launchmind/EmptyState';
import { ErrorState } from '@/components/launchmind/ErrorState';
import * as T from '@/lib/design-system/typography';
import { ConceptComparison } from '@/components/launchmind/ConceptComparison';
import { useRouter } from 'next/navigation';

const CHANNEL_LABEL: Record<string, string> = {
  google_rsa: 'Google Ads', meta_ad: 'Meta', landing_page: 'Landing page',
  linkedin_post: 'LinkedIn', short_form_video_script: 'Short video',
  google_uac_variants: 'Google Ads', meta_body: 'Meta',
  landing_page_copy: 'Landing page', linkedin_founder_story: 'LinkedIn',
  video_reels_30s: 'Short video',
};

/** Owner-facing status words. Backend enums never reach the screen. */
const STATUS_LABEL: Record<string, { text: string; tone: 'ready' | 'attention' | 'done' }> = {
  ELIGIBLE_FOR_CONTENT_APPROVAL: { text: 'Copy ready', tone: 'ready' },
  REWRITE_REQUIRED:              { text: 'Not ready for review', tone: 'attention' },
  OWNER_CONFIRMATION_REQUIRED:   { text: 'Needs you', tone: 'attention' },
  CONTENT_APPROVED:              { text: 'Approved', tone: 'done' },
  DRAFT:                         { text: 'Draft', tone: 'attention' },
};

/** Shared card. Every owner surface uses the same one — see typography.ts. */
const card: React.CSSProperties = T.card;
const eyebrow: React.CSSProperties = T.eyebrow;

function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { text: status, tone: 'attention' as const };
  const tone = s.tone === 'ready'
    ? { background: 'var(--sage-d)', border: '1px solid var(--sage-b)', color: 'var(--sage)' }
    : s.tone === 'done'
      ? { background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)', color: 'var(--indigo)' }
      : { background: 'var(--amber-d)', border: '1px solid var(--amber-b)', color: 'var(--amber)' };
  return (
    <span style={{ ...tone, borderRadius: 999, padding: '2px 9px', fontSize: 11,
      fontWeight: 700, whiteSpace: 'nowrap' }}>
      {/* Symbol as well as colour — status is never colour-only. */}
      {s.tone === 'ready' ? '✓ ' : s.tone === 'done' ? '● ' : '! '}{s.text}
    </span>
  );
}

/**
 * Owner confirmation and missing evidence are different problems and must not
 * share a sentence.
 *
 * An owner CAN settle a certification, a guarantee they offer, an endorsement
 * they are authorised to make, an offer, a CTA destination or their own price —
 * they are the source of truth for those. They CANNOT settle a customer count,
 * a conversion rate, CAC, ROAS or a comparative claim by confirming it, because
 * confirming is not measuring. Presenting both as "needs confirmation" would
 * invite exactly the substitution the claim engine exists to prevent.
 */
/** Renders whatever channel shape the artifact happens to carry. */
function ContentFields({ content }: { content: Record<string, unknown> }) {
  const rows: Array<[string, string]> = [];
  const push = (k: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) rows.push([k, v]);
    else if (Array.isArray(v) && v.length) rows.push([k, v.filter(x => typeof x === 'string').join(' · ')]);
  };
  push('H1', content.h1); push('Subhead', content.subhead);
  push('Primary text', content.primaryText); push('Headline', content.headline);
  push('Description', content.description);
  push('Headlines', content.headlines); push('Descriptions', content.descriptions);
  push('Hook', content.hook); push('Body', content.body);
  push('CTA', content.cta); push('CTAs', content.ctas);
  push('Benefits', content.benefits);

  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--ink3)' }}>No content on this version.</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <div style={{ ...eyebrow, marginBottom: 4 }}>{k}</div>
          <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, margin: 0 }}>{v}</p>
        </div>
      ))}
    </div>
  );
}

function approachFor(label: string | null) {
  if (/product demonstration/i.test(label ?? '')) return {
    role: 'Product demonstration',
    rationale: 'This concept leads with the verified product capability so the viewer can understand what the product is before evaluating the message.',
    hypothesis: 'Immediate product clarity may reduce comprehension friction.',
  };
  if (/relief/i.test(label ?? '')) return {
    role: 'Relief',
    rationale: 'This concept leads with a calmer possible direction, then introduces the product without claiming a measured customer outcome.',
    hypothesis: 'A hedged relief frame may create emotional relevance without promising a result.',
  };
  return {
    role: 'Problem recognition',
    rationale: 'This concept leads with the coordination frustration before the product so the audience can recognise the problem first.',
    hypothesis: 'Immediate problem recognition may create a reason to stop and keep reading.',
  };
}

/** Scene plan and the honest state of everything a video still needs. */
function VideoReadiness({ content }: { content: Record<string, unknown> }) {
  const scenes = Array.isArray(content.scenePlan) ? content.scenePlan.length : 0;
  const rows: Array<[string, string]> = [
    ['Script', scenes > 0 ? 'Ready' : 'Not created yet'],
    ['Scene plan', scenes > 0 ? `${scenes} scenes` : 'Not created yet'],
    ['Captions', scenes > 0 ? 'Ready' : 'Not created yet'],
    // Never implied as done: no provider has run, and saying otherwise would be
    // the most damaging kind of small lie.
    ['Presenter', 'Not selected'],
    ['Voice', 'Not selected'],
    ['Rendered video', 'Not created yet'],
  ];
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
          <span style={{ minWidth: 120, color: 'var(--ink3)' }}>{k}</span>
          <span style={{ color: v === 'Ready' || v.includes('scenes') ? 'var(--ink)' : 'var(--ink3)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function CampaignWorkbench({ campaignId, token, initialView, initialArtifactId }: {
  campaignId: string; token: string;
  /** Studio-home deep link. Selects only when the artifact belongs to this campaign. */
  initialArtifactId?: string | null;
  /** §20 — deep link. "Compare concepts" must land ON the comparison. */
  initialView?: 'compare' | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<CampaignWorkbenchView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'regenerate' | 'edit' | 'approve' | 'rewrite' | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  // Opened directly from Content Intelligence's "Compare concepts". Landing on
  // the workbench and making the owner find the compare button is the "generic
  // library" failure this deep link exists to avoid.
  const [comparing, setComparing] = useState(initialView === 'compare');
  const [inspectVersion, setInspectVersion] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const v = await api.contentIntelligence.campaign(campaignId, token);
      setView(v);
      setSelectedId(prev => prev
        ?? v.artifacts.find(artifact => artifact.id === initialArtifactId)?.id
        ?? v.artifacts[0]?.id
        ?? null);
    } catch {
      setError("I couldn't load this campaign's content. Nothing was changed.");
    } finally { if (showLoading) setLoading(false); }
  }, [campaignId, initialArtifactId, token]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const byRole = new Map<string, WorkbenchArtifact[]>();
    for (const a of view?.artifacts ?? []) {
      const key = `${a.channel}:${a.variantLabel ?? 'default'}`;
      byRole.set(key, [...(byRole.get(key) ?? []), a]);
    }
    const current: WorkbenchArtifact[] = [];
    const earlier: WorkbenchArtifact[] = [];
    for (const artifacts of byRole.values()) {
      const sorted = [...artifacts].sort((a, b) => String(b.createdAt ?? '')
        .localeCompare(String(a.createdAt ?? '')));
      if (sorted[0]) current.push(sorted[0]);
      earlier.push(...sorted.slice(1));
    }
    return { current, earlier };
  }, [view]);

  /** Persisted asset_type / channel back to the B3 channel the route expects. */
  const toB3Channel = (channel: string) => {
    if (/google/.test(channel)) return 'GOOGLE_RSA' as const;
    if (/meta/.test(channel)) return 'META_AD' as const;
    if (/landing/.test(channel)) return 'LANDING_PAGE' as const;
    if (/linkedin/.test(channel)) return 'LINKEDIN_POST' as const;
    return 'SHORT_FORM_VIDEO_SCRIPT' as const;
  };

  /**
   * Regenerate or owner-edit, both through the governed route.
   *
   * The UI never writes content. It asks the server to re-run the pipeline and
   * append a version, then reloads what the server decided — so an owner cannot
   * make something true by typing it, and a regeneration cannot inherit the
   * approval of the version it replaced.
   */
  const revise = async (kind: 'regenerate' | 'edit' | 'rewrite', a: WorkbenchArtifact,
                        editedContent?: Record<string, unknown>) => {
    if (!a.strategyId || !a.briefId || !a.productId || !view) return;
    setBusy(kind); setNotice(null);
    try {
      const res = await api.contentIntelligence.reviseArtifact({
        productId: a.productId, campaignId: view.campaign.id,
        strategyId: a.strategyId, briefId: a.briefId,
        channel: toB3Channel(a.channel), assetId: a.id,
        ...(a.variantLabel ? { variantLabel: a.variantLabel } : {}),
        ...(editedContent ? { editedContent } : {}),
      }, token);
      // The server decides. A rewrite is not trusted because LaunchMind wrote
      // it — it re-enters the same pipeline and may still fail, which is then
      // reported honestly rather than smoothed over.
      setNotice(res.message ?? (res.ownerState === 'READY_FOR_OWNER_REVIEW'
        ? 'Ready for your review' : res.ownerState === 'NEEDS_OWNER_INPUT'
          ? 'LaunchMind needs your confirmation.' : res.ownerState === 'LAUNCHMIND_CAN_REPAIR'
            ? 'LaunchMind could not finish within its internal repair limit. Your previous version is unchanged.'
            : `Version ${res.versionNumber} created.`));
      setEditing(false);
      await load(false);
    } catch {
      setNotice(kind === 'edit'
        ? "I couldn't save that edit. Your existing content was not changed."
        : kind === 'rewrite'
          ? "I couldn't rewrite this safely. Your existing content was not changed."
          : "LaunchMind couldn't create a new version. Your existing content was not changed.");
    } finally { setBusy(null); }
  };

  /**
   * Approve exactly one version.
   *
   * Deliberately explicit rather than one-click: the owner reads what approval
   * does and does not do before it happens, because "approve" is the word most
   * likely to be misread as "publish".
   */
  const approve = async (a: WorkbenchArtifact) => {
    setBusy('approve'); setNotice(null);
    try {
      const res = await api.contentIntelligence.approveVersion(a.id, a.currentVersion, token);
      setNotice(`Content approved — version ${res.approvedVersion}. Nothing was published, launched, scheduled or spent.`);
      setConfirmApprove(false);
      await load();
    } catch {
      setNotice("I couldn't approve this version. Nothing was changed.");
    } finally { setBusy(null); }
  };

  if (loading) return <PageLoading message="Loading this campaign's content." />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!view) return null;

  if (view.artifacts.length === 0) {
    return (
      <EmptyState
        heading="No content has been created for this campaign yet"
        description="Open Content Intelligence to review the recommended package and create it."
      />
    );
  }

  const selected = view.artifacts.find(a => a.id === selectedId) ?? view.artifacts[0];
  const isVideo = /video/.test(selected.channel);
  const approvedIsStale = selected.approvedVersion != null
    && selected.approvedVersion < selected.currentVersion;
  const approach = approachFor(selected.variantLabel);

  // Comparison is a destination, not an accordion beneath the editor. Only
  // current artifacts participate; earlier generated sets remain history.
  if (comparing) {
    const activeSet = grouped.current.filter(artifact => artifact.variantLabel);
    return (
      <ConceptComparison artifacts={activeSet.length >= 2 ? activeSet : grouped.current}
        onOpen={id => { setSelectedId(id); setComparing(false); }}
        onClose={() => setComparing(false)} />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}
      className="grid-cols-1 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">

      {/* ── LEFT: campaign content navigator ─────────────────────────────── */}
      <nav style={{ ...card, padding: 14, alignSelf: 'start' }} aria-label="Campaign content">
        <div style={eyebrow}>Campaign content</div>
        <p style={{ fontFamily: 'var(--font-syne)', fontSize: 16, fontWeight: 700,
          color: 'var(--ink)', margin: '6px 0 12px' }}>{view.campaign.name}</p>

        {[...new Map(grouped.current.map(a => [CHANNEL_LABEL[a.channel] ?? a.channel, [] as WorkbenchArtifact[]])).keys()].map(channel => (
          <div key={channel} style={{ marginBottom: 12 }}>
            <div style={{ ...eyebrow, marginBottom: 6 }}>{channel}</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {grouped.current.filter(a => (CHANNEL_LABEL[a.channel] ?? a.channel) === channel).map(a => {
                const active = a.id === selected.id;
                return (
                  <button key={a.id} type="button"
                    onClick={() => setSelectedId(a.id)}
                    aria-current={active ? 'true' : undefined}
                    style={{
                      textAlign: 'left', width: '100%', cursor: 'pointer',
                      background: active ? 'var(--sage-d)' : 'transparent',
                      border: `1px solid ${active ? 'var(--sage-b)' : 'transparent'}`,
                      borderRadius: 10, padding: '7px 9px',
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    }}>
                    <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: active ? 650 : 500 }}>
                      {/* VARIANT — an alternative, never a version. */}
                      {a.variantLabel ?? 'Main'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ink3)',
                      fontFamily: 'var(--font-dm-mono)' }}>Copy version {a.currentVersion}</span>
                    <StatusPill status={a.status} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {grouped.earlier.length > 0 && (
          <details style={{ marginTop: 8 }} open={grouped.earlier.some(a => a.id === selected.id)}>
            <summary style={{ fontSize: 12, color: 'var(--ink3)', cursor: 'pointer' }}>
              Earlier generated sets ({grouped.earlier.length})
            </summary>
            <p style={{ ...T.meta, margin: '5px 0 7px' }}>
              Read-only history. Opening one does not make it current or approved.
            </p>
            <div style={{ display: 'grid', gap: 4 }}>
              {grouped.earlier.map(a => {
                const active = a.id === selected.id;
                return <button key={a.id} type="button" onClick={() => setSelectedId(a.id)}
                  aria-current={active ? 'true' : undefined}
                  style={{ textAlign: 'left', width: '100%', cursor: 'pointer',
                    background: active ? 'var(--sage-d)' : 'transparent',
                    border: `1px solid ${active ? 'var(--sage-b)' : 'transparent'}`,
                    borderRadius: 10, padding: '7px 9px', color: 'var(--ink2)', fontFamily: 'inherit' }}>
                  {CHANNEL_LABEL[a.channel] ?? a.channel} · {a.variantLabel ?? 'Main'} · Copy version {a.currentVersion}
                </button>;
              })}
            </div>
          </details>
        )}
      </nav>

      {/* ── CENTRE + supporting ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 16 }}>
        <section style={card} aria-labelledby="wb-artifact">
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline',
            justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <div style={eyebrow}>{CHANNEL_LABEL[selected.channel] ?? selected.channel}</div>
              <h2 id="wb-artifact" style={{ ...T.sectionTitle, margin: '4px 0 0' }}>
                {selected.variantLabel ?? 'Main'}
              </h2>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--ink3)', fontFamily: 'var(--font-dm-mono)' }}>
                {/* §11 — copy and visual version separately, in owner words. */}
                Copy version {selected.currentVersion}
                {selected.brandVersion != null && ` · Brand version ${selected.brandVersion}`}
              </span>
              <StatusPill status={selected.status} />
            </div>
          </div>

          {/* Artifact first: the work itself appears before editing controls and audit. */}
          <CreativePanel key={`${selected.id}-${selected.currentVersion}`} assetId={selected.id} token={token}
            workflowBusy={busy === 'regenerate' || busy === 'rewrite' || busy === 'edit'}
            channelLabel={CHANNEL_LABEL[selected.channel] ?? selected.channel}
            contentApproved={selected.status === 'CONTENT_APPROVED'}
            onReviewMedia={() => router.push('/dashboard/intelligence/content')} />

          {selected.status === 'OWNER_CONFIRMATION_REQUIRED' &&
            (selected.needsAttention.length > 0 || selected.confirmationGaps.length > 0) && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--amber2)',
              border: '1px solid var(--amber-b)', borderRadius: 10 }}>
              <div style={{ ...eyebrow, color: 'var(--amber)' }}>
                Needs you
              </div>
              <p style={{ ...T.body, color: '#7d4306', margin: '6px 0 0' }}>
                LaunchMind needs one decision from you before this content can be approved.
              </p>
            </div>
          )}

          {selected.status === 'REWRITE_REQUIRED' && (
            <p role="status" style={{ ...T.meta, margin: '12px 0 0', color: 'var(--ink2)' }}>
              This wording is not yet qualified for creative review.
            </p>
          )}

          {editing ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <h3 style={{ ...eyebrow, margin: '16px 0 0' }}>Edit copy</h3>
              {Object.entries(draft).map(([k, val]) => (
                <div key={k}>
                  <label htmlFor={`edit-${k}`} style={{ ...eyebrow, display: 'block', marginBottom: 4 }}>
                    {k}
                  </label>
                  <textarea id={`edit-${k}`} value={val}
                    onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                    rows={val.length > 90 ? 3 : 2}
                    style={{ width: '100%', background: 'var(--raised)',
                      border: '1px solid var(--border2)', borderRadius: 9,
                      padding: '8px 10px', fontSize: 14, color: 'var(--ink)',
                      fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />
                </div>
              ))}
              <p style={{ fontSize: 12, color: 'var(--ink2)', margin: 0 }}>
                Your edit is checked the same way LaunchMind checks its own writing.
                Typing something does not make it verified.
              </p>
            </div>
          ) : (
            <details style={{ ...T.innerBlock, marginTop: 14 }}>
              <summary style={{ ...T.bodyStrong, cursor: 'pointer' }}>Copy details</summary>
              <div style={{ marginTop: 12 }}><ContentFields content={selected.content} /></div>
            </details>
          )}
          {isVideo && <VideoReadiness content={selected.content} />}

          <details style={{ ...T.innerBlock, marginTop: 14 }}>
            <summary style={{ ...T.bodyStrong, cursor: 'pointer' }}>Why this creative?</summary>
            <p style={{ ...T.body, margin: '10px 0 0' }}>{approach.rationale}</p>
            <p style={{ ...T.meta, margin: '6px 0 0' }}>
              {approach.hypothesis} No first-party performance exists for this hook yet.
            </p>
          </details>

          {/* Actions. No Publish, Launch, Schedule, Deploy or Spend. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {editing ? (
              <>
                <Button
                  onClick={() => void revise('edit', selected, draft)}
                  disabled={busy !== null}>
                  {busy === 'edit' ? 'Checking your edit…' : 'Save and check'}
                </Button>
                <Button variant="ghost" onClick={() => { setEditing(false); setNotice(null); }}
                  disabled={busy !== null}>Cancel</Button>
              </>
            ) : selected.status !== 'REWRITE_REQUIRED' ? (
              <Button variant="ghost"
                onClick={() => {
                  const d: Record<string, string> = {};
                  for (const [k, val] of Object.entries(selected.content)) {
                    if (typeof val === 'string') d[k] = val;
                  }
                  setDraft(d); setEditing(true); setNotice(null);
                }}
                disabled={busy !== null}>Edit copy</Button>
            ) : null}
            {!editing && <Button variant="ghost"
              onClick={() => void revise('regenerate', selected)}
              disabled={busy !== null}>
              {/* "Regenerate" alone regenerated only the COPY — the visual was
                  untouched, so the owner clicked it and saw the same image and
                  reasonably concluded nothing happened. A label must name the
                  layer it changes. */}
              {busy === 'regenerate' ? 'LaunchMind is refining this…' : 'Regenerate copy'}
            </Button>}
            {selected.status === 'CONTENT_APPROVED' ? (
              <span style={{ fontSize: 13, color: 'var(--indigo)', fontWeight: 700,
                alignSelf: 'center' }}>
                ● Content approved — version {selected.approvedVersion}
              </span>
            ) : selected.status === 'ELIGIBLE_FOR_CONTENT_APPROVAL' ? (
              <Button
                onClick={() => setConfirmApprove(true)}
                disabled={busy !== null}>
                Review for approval
              </Button>
            ) : null}
          </div>
          {notice && (
            <p role="status" style={{ fontSize: 13, color: 'var(--ink)', margin: '10px 0 0' }}>
              {notice}
            </p>
          )}
          <p style={{ fontSize: 12, color: 'var(--ink2)', margin: '10px 0 0' }}>
            Approving this version approves the content only. Nothing will be
            published, launched, scheduled, or spent.
          </p>

          {confirmApprove && (
            <div role="dialog" aria-modal="false" aria-labelledby="approve-title"
              style={{ marginTop: 12, padding: 14, background: 'var(--raised)',
                border: '1px solid var(--border2)', borderRadius: 12 }}>
              <p id="approve-title" style={{ fontSize: 14, fontWeight: 700,
                color: 'var(--ink)', margin: '0 0 6px' }}>
                Approve version {selected.currentVersion}?
              </p>
              <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '0 0 12px', lineHeight: 1.55 }}>
                Approving this version approves the content only. Nothing will be
                published, launched, scheduled, or spent.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button onClick={() => void approve(selected)} disabled={busy !== null}>
                  {busy === 'approve' ? 'Approving…' : 'Yes, approve this version'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmApprove(false)}
                  disabled={busy !== null}>Cancel</Button>
              </div>
            </div>
          )}
          {approvedIsStale && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--amber2)',
              border: '1px solid var(--amber-b)', borderRadius: 10 }}>
              <p style={{ fontSize: 13, color: '#7d4306', margin: 0, fontWeight: 650 }}>
                Version {selected.approvedVersion} — approved
              </p>
              <p style={{ fontSize: 13, color: '#7d4306', margin: '2px 0 0' }}>
                Version {selected.currentVersion} — current, not approved
              </p>
              <p style={{ fontSize: 12, color: '#7d4306', margin: '6px 0 0' }}>
                You approved something earlier. What you are looking at now is newer.
              </p>
            </div>
          )}

        </section>

        {/* ── §19 Concept comparison ──────────────────────────────────────
            REPLACES a table with `minWidth: 520` and `overflowX: auto`. That
            worked on a desktop and turned into a sideways scroll on a phone,
            which is the one place a comparison stops being used. It was also
            scoped to `variantGroupId` siblings, so the A/B/C concept set — the
            thing an owner most wants to compare — was invisible to it.

            Still no winner, no score, no prediction: nothing here has run. */}
        {(() => {
          const siblings = (view.artifacts ?? []).filter(a =>
            a.channel === selected.channel);
          if (siblings.length < 2) return null;
          return (
              <section style={card} aria-label="Compare concepts">
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={eyebrow}>
                    {siblings.length} versions — alternatives, not revisions
                  </div>
                  <Button variant="ghost" onClick={() => setComparing(true)}>
                    Compare concepts
                  </Button>
                </div>
              </section>
            );
        })()}

        {/* ── Supporting: governance, provenance, history ────────────────── */}
        <details style={card}>
          <summary style={{ ...T.bodyStrong, cursor: 'pointer' }}>Safety &amp; evidence</summary>
          <div style={{ marginTop: 16 }} aria-label="Why this exists">
          <div style={{ display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <div style={{ ...eyebrow, marginBottom: 4 }}>Factual safety</div>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{selected.factualSafety}</p>
              {selected.proof.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--ink2)', margin: '4px 0 0' }}>
                  Supported by {selected.proof.join(' and ')}
                </p>
              )}
            </div>
            <div>
              <div style={{ ...eyebrow, marginBottom: 4 }}>Brand fit</div>
              <p style={{ fontSize: 13, color: 'var(--ink)', margin: 0 }}>{selected.brandFit}</p>
            </div>
            {selected.confirmationGaps.length > 0 && (
              <div>
                <div style={{ ...eyebrow, marginBottom: 4 }}>Needs your confirmation</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--ink)' }}>
                  {selected.confirmationGaps.map(g => <li key={g}>{g}</li>)}
                </ul>
              </div>
            )}
          </div>

          {selected.whyCreated.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...eyebrow, marginBottom: 4 }}>Why this exists</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--ink2)' }}>
                {selected.whyCreated.map(w => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}

          </div>
        </details>

        <details style={card}>
          <summary style={{ ...T.bodyStrong, cursor: 'pointer' }}>History</summary>
          <div style={{ marginTop: 16 }}>
            <div style={{ ...eyebrow, marginBottom: 6 }}>Copy version history</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {selected.versions.map(v => {
                const open = inspectVersion === v.number;
                return (
                  <div key={v.number}>
                    <button type="button"
                      onClick={() => setInspectVersion(open ? null : v.number)}
                      aria-expanded={open}
                      style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'center',
                        flexWrap: 'wrap', width: '100%', textAlign: 'left', cursor: 'pointer',
                        background: open ? 'var(--raised)' : 'transparent',
                        border: '1px solid ' + (open ? 'var(--border2)' : 'transparent'),
                        borderRadius: 10, padding: '5px 8px' }}>
                      <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--ink)',
                        minWidth: 34 }}>v{v.number}</span>
                      <span style={{ color: 'var(--ink2)' }}>{v.origin}</span>
                      {v.number === selected.currentVersion && (
                        <span style={{ fontSize: 11, color: 'var(--sage)', fontWeight: 700 }}>● current</span>
                      )}
                      {v.number === selected.approvedVersion && (
                        <span style={{ fontSize: 11, color: 'var(--indigo)', fontWeight: 700 }}>✓ approved</span>
                      )}
                    </button>
                    {open && (
                      <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '4px 0 0 8px' }}>
                        {v.brandVersion != null && `Built with brand kit v${v.brandVersion}. `}
                        {/* Inspecting never mutates: no revert exists, and inventing
                            one would be a state change disguised as a click. */}
                        Read-only — opening this does not make it current or approve it.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Read-only: no revert until a safe path for it exists. */}
            <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '8px 0 0' }}>
              History is read-only. Viewing it does not change the active version.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
