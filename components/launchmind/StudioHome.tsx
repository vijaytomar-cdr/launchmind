/**
 * @file StudioHome.tsx
 * @description The Content Studio home — everything LaunchMind made, B6 closure §2, §5.
 *
 *   THE DEFECT THIS FIXES. Governed content was reachable only at
 *   /dashboard/content?campaign=<uuid>. An owner clicking "Content Studio" in
 *   the sidebar landed on the legacy 31-type generator and saw none of their own
 *   campaigns, copy or approved creative — while LaunchMind had been telling
 *   them it had created exactly those things. A query parameter nobody can guess
 *   is not navigation; it is a hidden door.
 *
 *   ORDERED BY WHAT THE OWNER MUST DO, not by what the system produced:
 *
 *     NEEDS ATTENTION   something is waiting on them, with the reason
 *     READY FOR REVIEW  finished work they have not looked at
 *     CAMPAIGNS         why each exists, what it covers, how ready it is
 *     RECENT CREATIVE   the pictures, because those are what people scan for
 *     APPROVED          what they already signed off
 *
 *   A library sorted by created_at answers "what happened"; this answers "what
 *   do I do next", which is the only question an owner opens this page with.
 *
 *   No publish, launch, schedule, post, boost or spend control exists here.
 *
 * @security Everything comes from the owner-safe read model. No campaign id,
 *   evidence handle, authority tier, policy version or provider reference is
 *   rendered — ids appear only inside hrefs the owner never reads.
 * @dependencies lib/api (contentIntelligence.studioHome)
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type StudioHome as StudioHomeModel, type StudioHomeItem } from '@/lib/api';
import { Button } from '@/components/launchmind/Button';
import { ContentStudioLoading } from '@/components/launchmind/LoadingState';
import { ErrorState } from '@/components/launchmind/ErrorState';
import { EmptyState } from '@/components/launchmind/EmptyState';
import * as T from '@/lib/design-system/typography';
import {studioSections} from '@/lib/studioSections';

/** Shared card. Every owner surface uses the same one — see typography.ts. */
const card: React.CSSProperties = T.card;
const eyebrow: React.CSSProperties = T.eyebrow;

function ArtifactRow({ item, onOpen, tone, actionLabel }: {
  item: StudioHomeItem; onOpen: () => void; tone: 'attention' | 'plain';
  actionLabel: 'Review and fix' | 'Review' | 'Open';
}) {
  return (
    <button className="lm-studio-artifact-row" type="button" onClick={onOpen} style={{
      display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', width: '100%',
      padding: '11px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
      border: 'none', borderBottom: `1px solid ${tone === 'attention' ? '#f2d29f' : 'var(--border)'}`,
      background: 'transparent',
    }}>
      <span className="lm-studio-artifact-channel" style={{ minWidth: 116, fontSize: 13, fontWeight: 650,
        color: tone === 'attention' ? '#7d4306' : 'var(--ink)' }}>
        {item.channel}{item.variantLabel ? ` · ${item.variantLabel}` : ''}
      </span>
      <span className="lm-studio-artifact-copy" style={{ flex: 1, minWidth: 160 }}>
        <span style={{ display: 'block', fontSize: 13,
          color: tone === 'attention' ? '#7d4306' : 'var(--ink2)' }}>
          {item.campaignName ?? 'No campaign'}
        </span>
        {item.reason && (
          <span style={{ display: 'block', fontSize: 12, color: '#7d4306', marginTop: 3 }}>
            {item.reason}
          </span>
        )}
      </span>
      {/* Status is a word, never colour alone. */}
      <span className="lm-studio-artifact-action" style={{ fontSize: 12, color: 'var(--ink3)' }}>
        {actionLabel} →
      </span>
    </button>
  );
}

export function StudioHome() {
  const router = useRouter();
  const [view, setView] = useState<StudioHomeModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login?next=/dashboard/content'); return; }
      setView(await api.contentIntelligence.studioHome(session.access_token));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your content.');
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const openCampaign = (id: string, artifactId?: string) => {
    const query = new URLSearchParams({ campaign: id });
    if (artifactId) query.set('artifact', artifactId);
    router.push(`/dashboard/content?${query.toString()}`);
  };

  if (loading) return <ContentStudioLoading message="Loading Content Studio…" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  const {currentReview,history:v,hasHistory}=studioSections(view!);
  const nothingYet = v.counts.campaigns === 0 && v.counts.artifacts === 0 && !v.planningWork?.length;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={T.pageTitle}>Content Studio</h1>
        <p style={T.pageLead}>
          Everything LaunchMind has created{v.product ? ` for ${v.product.name}` : ''}.
        </p>
      </div>

      {!!v.planningWork?.length && <section style={card} aria-label="Current production brief">
        <h2 style={eyebrow}>Current production brief</h2>
        <a href={`/dashboard/content?planning=${encodeURIComponent(v.planningWork[0].id)}`} style={{display:'block',marginTop:12,color:'var(--ink)'}}>
          <h3 style={T.sectionTitle}>{v.planningWork[0].service} — {v.planningWork[0].concept}</h3>
          <p style={{...T.eyebrow,color:v.planningWork[0].state==='Needs attention'?'#7d4306':'var(--sage)',marginTop:8}}>{v.planningWork[0].state}</p>
          {v.planningWork[0].recommended&&<p style={{...T.meta,marginTop:2}}>Recommended approach</p>}
          <span style={{display:'inline-block',marginTop:12,color:'var(--sage)',fontWeight:650}}>Open →</span>
        </a>
      </section>}
      {(v.planningWork?.length??0)>1&&<details style={card}><summary>Other prepared briefs</summary>{v.planningWork!.slice(1).map(w=><a key={w.id} href={`/dashboard/content?planning=${encodeURIComponent(w.id)}`} style={{display:'block',padding:12}}>{w.service} — {w.concept} · {w.state}</a>)}</details>}
      {nothingYet && (
        <EmptyState
          heading="LaunchMind hasn't created anything here yet"
          description="When it finds something worth marketing, the content it writes will appear here."
          action={{ label: 'See what it recommends',
            onClick: () => router.push('/dashboard/intelligence/content') }}
        />
      )}

      {currentReview.length>0&&<section style={card} aria-label="Ready for your review"><h2 style={eyebrow}>Ready for your review</h2>{currentReview.map(i=><ArtifactRow key={i.artifactId} item={i} tone="plain" actionLabel="Review" onOpen={()=>i.campaignId&&openCampaign(i.campaignId,i.artifactId)}/>)}</section>}
      {hasHistory&&<details style={card}><summary style={T.sectionTitle}>History</summary><div style={{display:'grid',gap:16,marginTop:16}}>
      {/* Only confirmation gaps belong in the owner's decision queue. */}
      {v.needsAttention.length > 0 && (
        <section style={{ ...card, borderColor: '#f2d29f' }} aria-labelledby="sh-attention">
          <div>
            <div id="sh-attention" style={eyebrow}>Needs your decision</div>
            <p style={{ ...T.bodyStrong, margin: '5px 0 0' }}>
              {v.needsAttention.length} item{v.needsAttention.length === 1 ? '' : 's'} genuinely need
              {v.needsAttention.length === 1 ? 's' : ''} something only you can confirm.
            </p>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {v.needsAttention.map(i => (
              <ArtifactRow key={i.artifactId} item={i} tone="attention" actionLabel="Review and fix"
                onOpen={() => i.campaignId && openCampaign(i.campaignId, i.artifactId)} />
            ))}
          </div>
        </section>
      )}

      {v.launchMindCanRepair.length > 0 && (
        <section style={card} aria-labelledby="sh-repairable">
          <details>
            <summary id="sh-repairable" style={{ ...T.bodyStrong, cursor: 'pointer',
              color: 'var(--ink2)' }}>
              LaunchMind is refining {v.launchMindCanRepair.length} current item{v.launchMindCanRepair.length === 1 ? '' : 's'}
            </summary>
            <p style={{ ...T.meta, margin: '6px 0 8px' }}>
              These are held for safer or stronger wording. They are not decisions waiting on you.
            </p>
            {v.launchMindCanRepair.map(i => (
              <ArtifactRow key={i.artifactId} item={i} tone="plain" actionLabel="Open"
                onOpen={() => i.campaignId && openCampaign(i.campaignId, i.artifactId)} />
            ))}
          </details>
        </section>
      )}

      {/* ── ready for review ─────────────────────────────────────────────── */}
      {v.readyForReview.length > 0 && (
        <section style={card} aria-labelledby="sh-ready">
          <div id="sh-ready" style={eyebrow}>Ready for your review</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {v.readyForReview.map(i => (
              <ArtifactRow key={i.artifactId} item={i} tone="plain" actionLabel="Review"
                onOpen={() => i.campaignId && openCampaign(i.campaignId, i.artifactId)} />
            ))}
          </div>
        </section>
      )}

      {/* ── in progress ──────────────────────────────────────────────────
          §16 — between "ready for review" and "campaigns", because that is
          where it sits in the owner's sequence: the thing they cannot act on
          yet, but should know is coming. Rendered ONLY when something is
          genuinely running; a permanently-present empty section is noise. */}
      {v.inProgress?.length > 0 && (
        <section style={card} aria-labelledby="sh-progress">
          <div id="sh-progress" style={eyebrow}>In progress</div>
          <ul role="status" aria-live="polite"
            style={{ display: 'grid', gap: 8, marginTop: 10, padding: 0, listStyle: 'none' }}>
            {v.inProgress.map(j => (
              <li key={j.renderJobId} style={{
                display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap',
                padding: '9px 11px', background: 'var(--raised)',
                border: '1px solid var(--border)', borderRadius: 10, fontSize: 13,
              }}>
                {/* A word, not a spinner alone — status is never motion-only. */}
                <span style={{ color: 'var(--ink3)', fontWeight: 700, fontSize: 11,
                  letterSpacing: '.06em', textTransform: 'uppercase' }}>Working</span>
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
                  {j.what}{j.concept ? ` — ${j.concept}` : ''}
                </span>
                <span style={{ color: 'var(--ink2)' }}>
                  LaunchMind is still building this. Nothing is approved yet.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── campaigns: why each exists ───────────────────────────────────── */}
      {v.campaigns.length > 0 && (
        <section style={card} aria-labelledby="sh-campaigns">
          <div id="sh-campaigns" style={eyebrow}>Previous work</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {v.campaigns.map(c => (
              <button key={c.id} type="button" onClick={() => openCampaign(c.id)}
                style={{
                  display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer',
                  padding: '13px 15px', borderRadius: 10, fontFamily: 'inherit',
                  border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent',
                }}>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between',
                  flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{c.readiness}</span>
                </div>
                {c.why && (
                  <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '6px 0 0', lineHeight: 1.5 }}>
                    {c.why.slice(0, 190)}{c.why.length > 190 ? '…' : ''}
                  </p>
                )}
                <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '8px 0 0' }}>
                  {c.channels.join(' · ') || 'No channels yet'}
                  {' · '}
                  {c.artifactCount === 0 ? 'nothing written yet'
                    : `${c.artifactCount} piece${c.artifactCount === 1 ? '' : 's'}`}
                  {c.approvedCount > 0 && ` · ${c.approvedCount} approved`}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── recent creative ──────────────────────────────────────────────── */}
      {v.recentCreative.length > 0 && (
        <section style={card} aria-labelledby="sh-creative">
          {/*
            "Recent creative" presented two brand-led stand-ins as if they were
            LaunchMind's current best work. They were made before any AllignX
            product image was approved, so the label now says so — an owner
            should not have to open a creative to learn it never saw their app.
          */}
          {/* §12/§13 — HISTORY MUST NOT COMPETE WITH CURRENT WORK.
              A grid of large thumbnails sat directly beneath the review queue
              and read as "LaunchMind's latest output", when several of these
              predate the owner authorising any product image. An old approved
              creative that looks exactly like the current one is not a neutral
              display choice — it invites the owner to review the wrong thing.
              Same data, same destinations, deliberately quieter: smaller
              tiles, muted heading, and the section collapsed by default once
              there is enough of it to be a history rather than a shortlist. */}
          <details>
            <summary id="sh-creative" style={{ ...T.bodyStrong, color: 'var(--ink2)',
              cursor: 'pointer', listStylePosition: 'inside' }}>
              Earlier creative ({v.recentCreative.length})
            </summary>
            <p style={{ ...T.meta, margin: '6px 0 0' }}>
              History is read-only. Opening it does not make anything current or approved.
            </p>
            {v.recentCreative.every(m => m.usedProductImagery === false) && (
              <p style={{ ...T.meta, margin: '4px 0 0' }}>
                These were made before you selected product images LaunchMind may use.
              </p>
            )}
            <div style={{ display: 'grid', gap: 8, marginTop: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
            {v.recentCreative.map((m, i) => (
              <button key={`${m.artifactId}-${i}`} type="button"
                onClick={() => {
                  const c = v.needsAttention.concat(v.readyForReview, v.approved)
                    .find(a => a.artifactId === m.artifactId)?.campaignId;
                  if (c) openCampaign(c);
                }}
                style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 10,
                  overflow: 'hidden', background: 'transparent', cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left' }}>
                {m.imageUrl && m.kind === 'Image'
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={m.imageUrl} alt={`${m.kind} created by LaunchMind`}
                      style={{ width: '100%', height: 78, objectFit: 'cover', display: 'block',
                        /* Visibly past tense. The image is unaltered; only its
                           presentation says "this is not the current work". */
                        opacity: 0.82 }} />
                  : <span aria-hidden style={{ display: 'block', height: 78,
                      background: 'var(--border)' }} />}
                <span style={{ display: 'block', padding: '7px 9px' }}>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--ink3)' }}>
                    {m.kind} · Copy version {m.contentVersion ?? '—'}
                  </span>
                  {m.usedProductImagery === false && (
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink3)', marginTop: 2 }}>
                      Created without product imagery
                    </span>
                  )}
                </span>
              </button>
            ))}
            </div>
          </details>
        </section>
      )}

      {v.earlierArtifacts.length > 0 && (
        <section style={card} aria-labelledby="sh-earlier-sets">
          <details>
            <summary id="sh-earlier-sets" style={{ ...T.bodyStrong, cursor: 'pointer',
              color: 'var(--ink2)' }}>
              Earlier generated sets ({v.earlierArtifacts.length})
            </summary>
            <p style={{ ...T.meta, margin: '6px 0 8px' }}>
              Read-only history. Opening an earlier item does not make it current or approved.
            </p>
            {v.earlierArtifacts.map(i => (
              <ArtifactRow key={i.artifactId} item={i} tone="plain" actionLabel="Open"
                onOpen={() => i.campaignId && openCampaign(i.campaignId, i.artifactId)} />
            ))}
          </details>
        </section>
      )}

      {/* ── approved ─────────────────────────────────────────────────────── */}
      {v.approved.length > 0 && (
        <section style={card} aria-labelledby="sh-approved">
          <div id="sh-approved" style={eyebrow}>Approved</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {v.approved.map(i => (
              <ArtifactRow key={i.artifactId} item={i} tone="plain" actionLabel="Open"
                onOpen={() => i.campaignId && openCampaign(i.campaignId, i.artifactId)} />
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '10px 0 0' }}>
            Approved means it represents you. Nothing here has been published, scheduled or spent.
          </p>
        </section>
      )}

      </div></details>}

      {/* Legacy creation tools remain routable, but are intentionally not
          promoted inside the AI CMO review journey. */}
    </div>
  );
}
