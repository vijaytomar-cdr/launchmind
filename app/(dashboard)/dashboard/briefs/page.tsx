'use client';
/**
 * @file app/(dashboard)/dashboard/briefs/page.tsx
 * @description Weekly performance briefs — the Learn loop (step 4 of core loop).
 *   LEFT col:   "Your week at a glance" narrative + "This week's numbers" metrics + brief history list
 *   RIGHT col:  "Generated assets — approve to deploy" — content assets with Approve buttons
 * @security Auth token from Supabase session. All data via Fastify backend.
 * @dependencies lib/api, lib/types/content
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import type { WeeklyBrief } from '@/lib/api';
import type { ContentAsset } from '@/lib/types/content';
import { trackOnboarding } from '@/lib/analytics';
import {
  IconSparkles,
  IconBrandWhatsapp,
  IconBrandFacebook,
  IconBrandGoogle,
  IconBrandLinkedin,
  IconMail,
  IconDeviceMobile,
  IconStar,
} from '@tabler/icons-react';

const STATUS_STYLE: Record<WeeklyBrief['status'], React.CSSProperties> = {
  draft:        { background: 'var(--raised)',   color: 'var(--ink2)',   border: '1px solid var(--border2)' },
  sent:         { background: 'var(--indigo-d)', color: 'var(--indigo)', border: '1px solid var(--indigo-b)' },
  acknowledged: { background: 'var(--sage-d)',   color: 'var(--sage)',   border: '1px solid var(--sage-b)' },
};

const STATUS_LABEL: Record<WeeklyBrief['status'], string> = {
  draft: 'Draft', sent: 'Sent', acknowledged: 'Acknowledged',
};

// Map asset type to a readable title + icon
type IconComp = React.ComponentType<{ size?: number | string; color?: string; stroke?: number | string }>;
const ASSET_DISPLAY: Record<string, { title: string; Icon: IconComp; color: string }> = {
  whatsapp_broadcast:    { title: 'WhatsApp broadcast',     Icon: IconBrandWhatsapp, color: 'var(--sage)' },
  whatsapp_voice_note:   { title: 'WhatsApp voice note',    Icon: IconBrandWhatsapp, color: 'var(--sage)' },
  meta_headline:         { title: 'Meta ad headline',        Icon: IconBrandFacebook, color: 'var(--indigo)' },
  meta_body:             { title: 'Meta ad copy',            Icon: IconBrandFacebook, color: 'var(--indigo)' },
  meta_image_brief:      { title: 'Meta image brief',        Icon: IconBrandFacebook, color: 'var(--indigo)' },
  google_uac_variants:   { title: 'Google UAC variants',     Icon: IconBrandGoogle,   color: 'var(--indigo)' },
  aso_subtitle:          { title: 'App Store subtitle',       Icon: IconDeviceMobile,  color: 'var(--ink2)' },
  aso_description:       { title: 'App Store description',   Icon: IconDeviceMobile,  color: 'var(--ink2)' },
  aso_keywords:          { title: 'ASO keywords',            Icon: IconDeviceMobile,  color: 'var(--ink2)' },
  email_day1:            { title: 'Onboarding email — Day 1', Icon: IconMail,          color: 'var(--indigo)' },
  email_day5:            { title: 'Onboarding email — Day 5', Icon: IconMail,          color: 'var(--indigo)' },
  email_day14:           { title: 'Re-engagement email',     Icon: IconMail,          color: 'var(--indigo)' },
  linkedin_founder_story:{ title: 'LinkedIn founder story',  Icon: IconBrandLinkedin, color: 'var(--indigo)' },
  linkedin_data_post:    { title: 'LinkedIn data post',      Icon: IconBrandLinkedin, color: 'var(--indigo)' },
  social_proof_review_response: { title: 'Review request template', Icon: IconStar,   color: 'var(--amber)' },
  social_proof_case_study:      { title: 'Case study',              Icon: IconStar,   color: 'var(--amber)' },
  social_proof_testimonial:     { title: 'Testimonial',             Icon: IconStar,   color: 'var(--amber)' },
};

function getAssetDisplay(assetType: string) {
  return ASSET_DISPLAY[assetType] ?? { title: assetType.replace(/_/g, ' '), Icon: IconSparkles, color: 'var(--ink2)' };
}

export default function BriefsPage() {
  const supabase = createClient();
  const [briefs, setBriefs] = useState<WeeklyBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      tokenRef.current = session.access_token;
      const { briefs: data } = await api.briefs.list(session.access_token);
      setBriefs(data);
      if (data.length > 0) setSelectedId(data[0].id);
      if (data.some((b) => b.status === 'sent' || b.status === 'acknowledged')) {
        trackOnboarding('brief_received', { count: data.length });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load briefs');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const selectedBrief = briefs.find((b) => b.id === selectedId) ?? null;

  // Load content assets when a brief is selected
  useEffect(() => {
    if (!selectedBrief?.product_id || !tokenRef.current) return;
    setAssetsLoading(true);
    api.contentAssets.list(selectedBrief.product_id, tokenRef.current)
      .then(({ assets: data }) => setAssets(data.slice(0, 6)))
      .catch(() => setAssets([]))
      .finally(() => setAssetsLoading(false));
  }, [selectedBrief?.product_id]);

  async function handleApproveAsset(assetId: string) {
    if (!tokenRef.current) return;
    setApprovingId(assetId);
    try {
      await api.contentAssets.approve(assetId, tokenRef.current);
      setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, status: 'approved' as const } : a));
    } catch {
      // Non-fatal — user can retry
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="font-display font-semibold" style={{ fontSize: 22, color: 'var(--ink)' }}>
          Weekly brief
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 3 }}>
          Sunday performance briefs — what worked, what to kill, and your next 7-day actions.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-[8px] px-4 py-3" style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16" style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading briefs…</div>
      ) : briefs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" style={{ alignItems: 'start' }}>

          {/* LEFT column — narrative + metrics + history */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Card 1: Your week at a glance */}
            {selectedBrief ? (
              <BriefNarrative brief={selectedBrief} />
            ) : (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--ink3)' }}>Select a brief from the list below</p>
              </div>
            )}

            {/* Card 2: This week's numbers */}
            {selectedBrief && <WeekMetrics brief={selectedBrief} />}

            {/* Card 3: Brief history */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 500, marginBottom: 10, marginTop: 0 }}>
                Brief history
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {briefs.map((brief) => (
                  <button
                    key={brief.id}
                    onClick={() => setSelectedId(brief.id)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 7,
                      background: selectedId === brief.id ? 'var(--raised)' : 'transparent',
                      border: selectedId === brief.id ? '1px solid var(--border2)' : '1px solid transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: selectedId === brief.id ? 500 : 400 }}>
                        {brief.productName ?? 'Product'} — {new Date(brief.week_of + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span style={{ fontSize: 10, flexShrink: 0, borderRadius: 9999, padding: '1px 7px', ...STATUS_STYLE[brief.status] }}>
                        {STATUS_LABEL[brief.status]}
                      </span>
                    </div>
                    {brief.what_worked && (
                      <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2, marginBottom: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {brief.what_worked}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT column — generated assets */}
          <div className="xl:sticky xl:top-6">
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12, marginTop: 0 }}>
                Generated assets — approve to deploy
              </p>

              {assetsLoading ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--ink3)' }}>
                  Loading assets…
                </div>
              ) : assets.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                  <IconSparkles size={28} color="var(--ink3)" />
                  <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 8 }}>
                    Assets will appear here after your first brief is generated.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {assets.map((asset) => (
                    <AssetBlock
                      key={asset.id}
                      asset={asset}
                      onApprove={handleApproveAsset}
                      approving={approvingId === asset.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Brief narrative card ─────────────────────────────────────────────────────

function BriefNarrative({ brief }: { brief: WeeklyBrief }) {
  const nextActions = brief.next_actions as { actions?: string[] } | null;

  return (
    <div style={{ background: 'var(--surface)', border: '1.5px solid var(--sage-b)', borderRadius: 10, padding: 20 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '0 0 2px' }}>
        Your week at a glance
      </p>
      <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 14 }}>
        {brief.productName ?? 'Product'} · Week of {new Date(brief.week_of + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {brief.what_worked && (
        <div style={{ borderLeft: '3px solid var(--sage)', paddingLeft: 12, marginBottom: 14 }}>
          <p style={{ fontSize: 10, color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 4, marginTop: 0 }}>
            What worked
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>{brief.what_worked}</p>
        </div>
      )}

      {brief.what_to_kill && (
        <div style={{ borderLeft: '3px solid var(--danger)', paddingLeft: 12, marginBottom: 14 }}>
          <p style={{ fontSize: 10, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 4, marginTop: 0 }}>
            What to kill
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0 }}>{brief.what_to_kill}</p>
        </div>
      )}

      {nextActions?.actions && nextActions.actions.length > 0 && (
        <div style={{ borderLeft: '3px solid var(--indigo)', paddingLeft: 12 }}>
          <p style={{ fontSize: 10, color: 'var(--indigo)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginBottom: 8, marginTop: 0 }}>
            Next 7 days — {nextActions.actions.length} actions
          </p>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nextActions.actions.map((action: string, i: number) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{
                  flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--indigo-d)', color: 'var(--indigo)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, marginTop: 1,
                }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>{action}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!brief.what_worked && !brief.what_to_kill && !nextActions?.actions?.length && (
        <p style={{ fontSize: 13, color: 'var(--ink3)', textAlign: 'center', padding: '16px 0' }}>
          Brief is being prepared — check back Sunday evening.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <span style={{ fontSize: 11, ...STATUS_STYLE[brief.status], borderRadius: 9999, padding: '2px 8px' }}>
          {STATUS_LABEL[brief.status]}
        </span>
        {brief.sent_at && (
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
            Sent {new Date(brief.sent_at).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── This week's numbers ──────────────────────────────────────────────────────

function WeekMetrics({ brief }: { brief: WeeklyBrief }) {
  // Parse installs and best CPI from next_actions metadata if available
  const meta = brief.next_actions as { installs?: number; bestCPI?: string; bestChannel?: string } | null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <p style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 500, marginBottom: 10, marginTop: 0 }}>
        This week&apos;s numbers
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: 'var(--raised)', borderRadius: 6, padding: '11px 13px' }}>
          <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4 }}>Installs</div>
          <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: meta?.installs ? 'var(--sage)' : 'var(--ink)', marginBottom: 2 }}>
            {meta?.installs ?? '—'}
          </div>
          {meta?.installs && (
            <div style={{ fontSize: 11, color: 'var(--sage)' }}>this week</div>
          )}
        </div>
        <div style={{ background: 'var(--raised)', borderRadius: 6, padding: '11px 13px' }}>
          <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4 }}>Best CPI</div>
          <div className="font-mono" style={{ fontSize: 20, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
            {meta?.bestCPI ?? '—'}
          </div>
          {meta?.bestChannel && (
            <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'capitalize' }}>{meta.bestChannel}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Asset block (approve to deploy) ─────────────────────────────────────────

function AssetBlock({
  asset,
  onApprove,
  approving,
}: {
  asset: ContentAsset;
  onApprove: (id: string) => void;
  approving: boolean;
}) {
  const { title, Icon, color } = getAssetDisplay(asset.asset_type);
  const isApproved = asset.status === 'approved' || asset.status === 'auto_approved';
  const preview = asset.text_content?.slice(0, 160) ?? '(no text content)';

  return (
    <div style={{
      background: 'var(--raised)', borderRadius: 8, padding: '12px 14px',
      border: isApproved ? '1px solid var(--sage-b)' : '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon size={14} color={color} />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{title}</span>
          {asset.market && (
            <span style={{
              fontSize: 10, borderRadius: 9999, padding: '1px 6px',
              background: asset.market === 'india' ? 'var(--amber-d)' : 'var(--sage-d)',
              color: asset.market === 'india' ? 'var(--amber)' : 'var(--sage)',
            }}>
              {asset.market.toUpperCase()}
            </span>
          )}
        </div>
        {isApproved ? (
          <span style={{ fontSize: 11, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)', borderRadius: 9999, padding: '2px 8px', fontWeight: 500 }}>
            Approved
          </span>
        ) : (
          <button
            onClick={() => onApprove(asset.id)}
            disabled={approving}
            style={{
              fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6,
              background: 'var(--sage)', color: '#fff', border: 'none',
              cursor: approving ? 'not-allowed' : 'pointer', opacity: approving ? 0.6 : 1,
            }}
          >
            {approving ? '…' : 'Approve'}
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5, margin: 0 }}>
        {preview}{(asset.text_content?.length ?? 0) > 160 ? '…' : ''}
      </p>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--raised)' }}>
        <IconSparkles size={24} color="var(--ink3)" />
      </div>
      <h3 className="font-semibold mb-2" style={{ fontSize: 15, color: 'var(--ink)' }}>No weekly briefs yet</h3>
      <p style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: 340 }}>
        Briefs are generated every Sunday once your campaigns have at least one week of performance data.
      </p>
    </div>
  );
}
