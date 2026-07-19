/**
 * @file app/(dashboard)/dashboard/intelligence/growth-brain/page.tsx
 * @description Growth Brain — living strategy view built from confirmed_icp + brand_voice_profile.
 *   Shows what LaunchMind knows about the product and its marketing strategy.
 * @security JWT from Supabase session. Read-only in Milestone 07.
 * @dependencies api.products (list), api.missions.create
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { api, type Product } from '@/lib/api';
import {
  IconSparkles,
  IconBolt,
  IconArrowRight,
  IconCheck,
  IconAlertCircle,
  IconBrain,
} from '@tabler/icons-react';

interface ICP {
  targetAudience?: string;
  painPoints?: string[];
  primaryGoal?: string;
  keyBenefits?: string[];
  competitiveAdvantage?: string;
  primaryChannel?: string;
  markets?: string[];
}

interface BrandVoice {
  tone?: string;
  personality?: string[];
  keywords?: string[];
  avoidWords?: string[];
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-4">
      <p className="text-[11px] text-ink3 uppercase tracking-wide font-medium mb-3">{title}</p>
      {children}
    </div>
  );
}

function Chip({ label, variant = 'default' }: { label: string; variant?: 'default' | 'sage' | 'red' }) {
  const cls = variant === 'sage'
    ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage'
    : variant === 'red'
    ? 'bg-[var(--danger-d)] border-[var(--danger-b)] text-[var(--danger)]'
    : 'bg-raised border-[var(--border2)] text-ink2';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-[4px] border text-[12px] ${cls}`}>
      {label}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value);
  const color = pct >= 80 ? 'bg-sage' : pct >= 60 ? 'bg-[var(--amber)]' : 'bg-[var(--ink3)]';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-raised rounded-full h-2 overflow-hidden border border-[var(--border2)]">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] font-medium text-ink w-10 text-right" style={{ fontFamily: 'DM Mono, monospace' }}>{pct}%</span>
    </div>
  );
}

export default function GrowthBrainPage() {
  const [product, setProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return; }
      const t = session.access_token;
      setToken(t);
      api.products.list(t)
        .then(res => {
          const products = (res as unknown as { products?: Product[]; data?: Product[] }).products
            ?? (res as unknown as { products?: Product[]; data?: Product[] }).data
            ?? [];
          const unarchived = products.filter((p: Product) => !p.archived_at);
          setAllProducts(unarchived);
          setProduct(unarchived[0] ?? null);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    });
  }, []);

  const icp: ICP | null = product?.confirmed_icp as ICP | null ?? null;
  const bv: BrandVoice | null = (product as unknown as { brand_voice_profile?: BrandVoice })?.brand_voice_profile ?? null;

  // Simple confidence heuristic
  const icpScore  = icp ? (
    (icp.targetAudience ? 20 : 0) +
    (icp.painPoints?.length ? 20 : 0) +
    (icp.primaryGoal ? 20 : 0) +
    (icp.keyBenefits?.length ? 20 : 0) +
    (icp.competitiveAdvantage ? 20 : 0)
  ) : 0;

  const createBrainMission = async () => {
    if (!token) return;
    await api.missions.create({ type: 'research', title: 'Refresh Growth Brain from latest data' }, token);
    window.location.href = '/dashboard/missions';
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex items-center gap-2 text-ink2">
          <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
          Loading Growth Brain…
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-ink" style={{ fontFamily: 'Syne, sans-serif' }}>Growth Brain</h1>
          <p className="text-[13px] text-ink2 mt-1">
            {product ? `Strategy for ${product.name}` : 'Add your app to activate the Growth Brain'}
          </p>
        </div>
        {product && (
          <button
            onClick={() => void createBrainMission()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--sage-d)] border border-[var(--sage-b)] text-sage text-[12px] font-medium rounded-[var(--r2)] hover:bg-sage hover:text-white transition-colors shrink-0"
          >
            <IconBolt size={13} /> Refresh
          </button>
        )}
      </div>

      {allProducts.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {allProducts.map(p => (
            <button
              key={p.id}
              onClick={() => setProduct(p)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-[var(--r2)] border transition-colors ${
                product?.id === p.id
                  ? 'bg-[var(--sage-d)] border-[var(--sage-b)] text-sage'
                  : 'bg-surface border-[var(--border2)] text-ink2 hover:bg-raised'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {!product && allProducts.length === 0 ? (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-8 text-center">
          <IconBrain size={32} color="var(--sage)" className="mx-auto mb-3" />
          <p className="text-[14px] font-medium text-ink">No product set up yet</p>
          <p className="text-[13px] text-ink2 mt-1">Add your app to activate your AI-powered Growth Brain.</p>
          <Link href="/products/new" className="mt-3 inline-flex items-center gap-1 text-[12px] text-sage font-medium hover:underline">
            Add your app <IconArrowRight size={11} />
          </Link>
        </div>
      ) : !product ? (
        <div className="bg-surface border border-[var(--border)] rounded-[var(--r)] p-6">
          <p className="text-[14px] font-medium text-ink mb-3">Pick a product</p>
          <p className="text-[13px] text-ink2 mb-4">Choose which product&apos;s Growth Brain you want to see.</p>
          <div className="flex flex-wrap gap-2">
            {allProducts.map(p => (
              <button
                key={p.id}
                onClick={() => setProduct(p)}
                className="px-3 py-1.5 bg-[var(--sage-d)] border border-[var(--sage-b)] text-sage text-[12px] font-medium rounded-[var(--r2)] hover:bg-sage hover:text-white transition-colors"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
          <div className="space-y-4">
            {/* ICP */}
            {icp ? (
              <SectionCard title="Ideal Customer Profile">
                <div className="space-y-3">
                  {icp.targetAudience && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1">Target audience</p>
                      <p className="text-[13px] text-ink">{icp.targetAudience}</p>
                    </div>
                  )}
                  {icp.primaryGoal && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1">Primary goal</p>
                      <p className="text-[13px] text-ink">{icp.primaryGoal}</p>
                    </div>
                  )}
                  {icp.painPoints && icp.painPoints.length > 0 && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1.5">Pain points</p>
                      <div className="space-y-1">
                        {icp.painPoints.map((p, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <IconAlertCircle size={13} color="var(--amber)" className="mt-0.5 shrink-0" />
                            <p className="text-[13px] text-ink2">{p}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {icp.keyBenefits && icp.keyBenefits.length > 0 && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1.5">Key benefits</p>
                      <div className="space-y-1">
                        {icp.keyBenefits.map((b, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <IconCheck size={13} color="var(--sage)" className="mt-0.5 shrink-0" />
                            <p className="text-[13px] text-ink2">{b}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {icp.competitiveAdvantage && (
                    <div className="bg-[var(--sage-d)] border border-[var(--sage-b)] rounded-[var(--r2)] px-3 py-2">
                      <p className="text-[11px] text-ink3 font-medium mb-0.5">Competitive advantage</p>
                      <p className="text-[13px] text-ink">{icp.competitiveAdvantage}</p>
                    </div>
                  )}
                  {(icp.primaryChannel || icp.markets) && (
                    <div className="flex flex-wrap gap-2">
                      {icp.primaryChannel && <Chip label={`Primary: ${icp.primaryChannel}`} variant="sage" />}
                      {icp.markets?.map(m => <Chip key={m} label={m.toUpperCase()} variant="default" />)}
                    </div>
                  )}
                </div>
              </SectionCard>
            ) : (
              <SectionCard title="Ideal Customer Profile">
                <div className="text-center py-4">
                  <p className="text-[13px] text-ink2">ICP not confirmed yet.</p>
                  <Link href="/products/new/icp" className="mt-2 inline-flex items-center gap-1 text-[12px] text-sage hover:underline">
                    Complete setup <IconArrowRight size={11} />
                  </Link>
                </div>
              </SectionCard>
            )}

            {/* Brand Voice */}
            {bv && (
              <SectionCard title="Brand Voice">
                <div className="space-y-3">
                  {bv.tone && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1">Tone</p>
                      <p className="text-[13px] text-ink capitalize">{bv.tone}</p>
                    </div>
                  )}
                  {bv.personality && bv.personality.length > 0 && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1.5">Personality</p>
                      <div className="flex flex-wrap gap-1.5">
                        {bv.personality.map((p, i) => <Chip key={i} label={p} variant="sage" />)}
                      </div>
                    </div>
                  )}
                  {bv.keywords && bv.keywords.length > 0 && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1.5">Key phrases</p>
                      <div className="flex flex-wrap gap-1.5">
                        {bv.keywords.map((k, i) => <Chip key={i} label={k} />)}
                      </div>
                    </div>
                  )}
                  {bv.avoidWords && bv.avoidWords.length > 0 && (
                    <div>
                      <p className="text-[11px] text-ink3 font-medium mb-1.5">Avoid</p>
                      <div className="flex flex-wrap gap-1.5">
                        {bv.avoidWords.map((w, i) => <Chip key={i} label={w} variant="red" />)}
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}
          </div>

          {/* Right sidebar: status + actions */}
          <div className="space-y-4">
            <SectionCard title="Brain status">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13px] text-ink">ICP confidence</p>
                    <IconSparkles size={13} color="var(--sage)" />
                  </div>
                  <ConfidenceBar value={icpScore} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13px] text-ink">Brand voice</p>
                  </div>
                  <ConfidenceBar value={bv ? 85 : 0} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13px] text-ink">Competitor data</p>
                  </div>
                  <ConfidenceBar value={product.competitor_set ? 70 : 0} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Product details">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[12px] text-ink2">Name</span>
                  <span className="text-[12px] font-medium text-ink">{product.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[12px] text-ink2">Platform</span>
                  <span className="text-[12px] font-medium text-ink capitalize">{product.platform.replace('_', ' ')}</span>
                </div>
                {product.category && (
                  <div className="flex justify-between">
                    <span className="text-[12px] text-ink2">Category</span>
                    <span className="text-[12px] font-medium text-ink">{product.category}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[12px] text-ink2">Markets</span>
                  <span className="text-[12px] font-medium text-ink">{(product.markets ?? ['usa']).map((m: string) => m.toUpperCase()).join(', ')}</span>
                </div>
              </div>
            </SectionCard>

            <div className="space-y-2">
              <Link href="/dashboard/intelligence/memory" className="flex items-center justify-between p-3 bg-surface border border-[var(--border)] rounded-[var(--r2)] hover:bg-raised transition-colors">
                <span className="text-[13px] text-ink">Marketing Memory</span>
                <IconArrowRight size={13} color="var(--ink3)" />
              </Link>
              <Link href="/dashboard/intelligence/knowledge" className="flex items-center justify-between p-3 bg-surface border border-[var(--border)] rounded-[var(--r2)] hover:bg-raised transition-colors">
                <span className="text-[13px] text-ink">Knowledge Graph</span>
                <IconArrowRight size={13} color="var(--ink3)" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
