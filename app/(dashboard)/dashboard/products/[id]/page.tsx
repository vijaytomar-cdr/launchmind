/**
 * @file app/(dashboard)/dashboard/products/[id]/page.tsx
 * @description Product detail page — shows confirmed ICP brief and competitor set.
 *   Strategy generation CTA added in Week 3.
 * @dependencies lib/supabase/server, lib/api
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

interface Props {
  params: { id: string };
}

export default async function ProductDetailPage({ params }: Props) {
  const supabase = createClient();
  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!product) notFound();

  const icp = product.confirmed_icp as {
    targetUser: string;
    geography: string[];
    priceTier: string;
    painPoints: string[];
    competitorGaps: string[];
    suggestedMarkets: string[];
  } | null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6" style={{ fontSize: 13, color: 'var(--ink3)' }}>
        <Link href="/dashboard/products" className="transition-opacity hover:opacity-70" style={{ color: 'var(--ink2)' }}>
          Products
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--ink)' }}>{product.name}</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--ink)' }}>
            {product.name}
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <span
              className="rounded-full px-2.5 py-1 font-medium"
              style={{
                fontSize: 11,
                background: product.platform === 'app_store' ? 'var(--indigo-d)' : 'var(--sage-d)',
                color: product.platform === 'app_store' ? 'var(--indigo)' : 'var(--sage)',
              }}
            >
              {product.platform === 'app_store' ? 'App Store' : 'Play Store'}
            </span>
            {(product.markets as string[])?.map((m: string) => (
              <span
                key={m}
                className="rounded-full px-2.5 py-1 font-medium"
                style={{
                  fontSize: 11,
                  background: m === 'india' ? 'var(--amber-d)' : 'var(--sage-d)',
                  color: m === 'india' ? 'var(--amber)' : 'var(--sage)',
                }}
              >
                {m === 'india' ? '🇮🇳 India' : '🇺🇸 USA'}
              </span>
            ))}
          </div>
        </div>
        <Link
          href={`/dashboard/products/${params.id}/strategy`}
          className="rounded-[6px] px-4 py-2.5 font-medium transition-opacity hover:opacity-90"
          style={{ background: 'var(--indigo)', color: '#fff', fontSize: 13 }}
        >
          Generate strategy →
        </Link>
      </div>

      {icp && (
        <div
          className="rounded-[10px] p-6 space-y-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <h2 className="font-semibold" style={{ fontSize: 14, color: 'var(--ink)' }}>ICP Brief</h2>

          <div>
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Target user</p>
            <p style={{ fontSize: 13, color: 'var(--ink)' }}>{icp.targetUser}</p>
          </div>

          <div>
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>Pain points</p>
            <ul className="space-y-1">
              {icp.painPoints.map((p, i) => (
                <li key={i} className="flex gap-2" style={{ fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ color: 'var(--danger)', marginTop: 1 }}>•</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>Competitor gaps</p>
            <ul className="space-y-1">
              {icp.competitorGaps.map((g, i) => (
                <li key={i} className="flex gap-2" style={{ fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ color: 'var(--sage)', marginTop: 1 }}>→</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
