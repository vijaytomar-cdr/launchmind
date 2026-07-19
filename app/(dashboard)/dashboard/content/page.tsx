'use client'

/**
 * @file app/(dashboard)/dashboard/content/page.tsx
 * @description Content Studio — unified AI content generation, asset library,
 *   editor transforms, versioning, and publishing.
 *   Supports all 31 content types (26 original + 5 new in M08).
 * @security JWT from Supabase session passed to every API call. No tokens stored locally.
 * @dependencies api.studio, AssetBlock, @/lib/types/content
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api, ApiError } from '@/lib/api'
import type { ContentAsset, ContentVersion, StudioStats } from '@/lib/api'
import type { Product } from '@/lib/api'
import type { AssetType } from '@/lib/types/content'
import { ASSET_META, CHANNEL_ORDER } from '@/lib/types/content'
import { AssetBlock } from '@/components/launchmind/AssetBlock'
import {
  IconSparkles, IconSearch, IconFilter, IconX, IconRefresh,
  IconBookmark, IconGlobe, IconBell, IconFileText, IconChevronDown,
  IconChevronUp, IconHistory, IconSend, IconDownload, IconTrash,
  IconRestore, IconWand, IconArrowLeft, IconPlus, IconCheck,
  IconLoader2, IconAlertCircle, IconLayoutGrid, IconList,
} from '@tabler/icons-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'library' | 'generate' | 'stats'
type TransformType = 'rewrite' | 'expand' | 'shorten' | 'tone' | 'translate' | 'seo' | 'aso'

const TRANSFORM_LABELS: Record<TransformType, string> = {
  rewrite:   'Rewrite',
  expand:    'Expand',
  shorten:   'Shorten',
  tone:      'Change Tone',
  translate: 'Translate',
  seo:       'SEO Optimise',
  aso:       'ASO Optimise',
}

const NEW_TYPES: AssetType[] = ['blog_post', 'landing_page_copy', 'push_notification', 'release_notes', 'press_release']

const ALL_CHANNELS = ['WhatsApp', 'Meta', 'Google', 'ASO', 'Email', 'LinkedIn', 'Video', 'Visual', 'Community', 'Social Proof', 'Web', 'Push']

// ─── Small components ─────────────────────────────────────────────────────────

function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'sage' | 'amber' | 'indigo' | 'red' }) {
  const styles = {
    default: { background: 'var(--raised)',   border: '1px solid var(--border2)', color: 'var(--ink2)' },
    sage:    { background: 'var(--sage-d)',   border: '1px solid var(--sage-b)',  color: '#046c4e' },
    amber:   { background: 'var(--amber-d)',  border: '1px solid var(--amber-b)', color: '#92400e' },
    indigo:  { background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)',color: 'var(--indigo)' },
    red:     { background: 'var(--danger-d)',    border: '1px solid var(--danger-b)',   color: 'var(--danger)' },
  }
  return (
    <span style={{ ...styles[variant], borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {children}
    </span>
  )
}

function TypeCard({ type, selected, onClick }: { type: AssetType; selected: boolean; onClick: () => void }) {
  const meta = ASSET_META[type]
  const isNew = NEW_TYPES.includes(type)
  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? 'var(--sage-d)' : 'var(--raised)',
        border: `1.5px solid ${selected ? 'var(--sage-b)' : 'var(--border)'}`,
        borderRadius: 8, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
        transition: 'all 0.15s', position: 'relative',
      }}
    >
      {isNew && (
        <span style={{ position: 'absolute', top: 6, right: 6, background: 'var(--indigo-d)', border: '1px solid var(--indigo-b)', color: 'var(--indigo)', borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}>
          NEW
        </span>
      )}
      <div style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--sage)' : 'var(--ink)', marginBottom: 2 }}>
        {meta?.label ?? type.replace(/_/g, ' ')}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
        {meta?.channel ?? '—'}
      </div>
    </button>
  )
}

// ─── Editor panel ─────────────────────────────────────────────────────────────

function EditorPanel({
  asset, token, onClose, onSaved, onArchived,
}: {
  asset: ContentAsset;
  token: string;
  onClose: () => void;
  onSaved: (updated: ContentAsset) => void;
  onArchived: (id: string) => void;
}) {
  const [text, setText] = useState(asset.text_content ?? JSON.stringify(asset.structured_data, null, 2) ?? '')
  const [versions, setVersions] = useState<ContentVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [transforming, setTransforming] = useState<TransformType | null>(null)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const meta = ASSET_META[asset.asset_type as AssetType]

  const loadVersions = useCallback(async () => {
    const { versions: v } = await api.studio.versions(asset.id, token)
    setVersions(v)
  }, [asset.id, token])

  const handleSave = async () => {
    setSaving(true)
    try {
      const { asset: updated } = await api.studio.updateAsset(asset.id, { textContent: text }, token)
      onSaved(updated)
      setStatusMsg('Saved')
      setTimeout(() => setStatusMsg(''), 2000)
    } catch { setStatusMsg('Save failed') }
    setSaving(false)
  }

  const handleTransform = async (t: TransformType) => {
    setTransforming(t)
    try {
      const { asset: updated } = await api.studio.transform(asset.id, { transformType: t }, token)
      setText(updated.text_content ?? text)
      onSaved({ ...asset, text_content: updated.text_content, updated_at: updated.updated_at })
      setStatusMsg(`${TRANSFORM_LABELS[t]} applied`)
      setTimeout(() => setStatusMsg(''), 2500)
    } catch { setStatusMsg('Transform failed') }
    setTransforming(null)
  }

  const handleArchive = async () => {
    if (!window.confirm('Archive this asset? You can restore it later.')) return
    setArchiving(true)
    try {
      await api.studio.archive(asset.id, token)
      onArchived(asset.id)
      onClose()
    } catch { setStatusMsg('Archive failed') }
    setArchiving(false)
  }

  const handlePublish = async () => {
    if (!asset.approved_at) {
      setStatusMsg('Asset must be approved before publishing')
      return
    }
    setPublishing(true)
    try {
      await api.studio.publish(asset.id, { channel: asset.channel as 'meta' | 'google' | 'whatsapp' | 'email' | 'linkedin' | 'web' | 'app_store' | 'play_store' }, token)
      setStatusMsg('Published')
      setTimeout(() => setStatusMsg(''), 2500)
    } catch { setStatusMsg('Publish failed') }
    setPublishing(false)
  }

  return (
    <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 480, background: 'var(--surface)', borderLeft: '1px solid var(--border)', zIndex: 50, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.08)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', padding: 4, borderRadius: 4 }}>
          <IconX size={16} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{meta?.label ?? asset.asset_type.replace(/_/g, ' ')}</div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>{meta?.channel ?? asset.channel} · {asset.market ?? 'all markets'}</div>
        </div>
        <Badge variant={asset.approved_at ? 'sage' : 'default'}>{asset.approved_at ? 'Approved' : 'Pending'}</Badge>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Text editor */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Content</div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={10}
            style={{ width: '100%', background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: 'var(--ink)', resize: 'vertical', fontFamily: 'DM Mono, monospace', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            {statusMsg && <span style={{ fontSize: 12, color: statusMsg.includes('fail') ? 'var(--danger)' : 'var(--sage)' }}>{statusMsg}</span>}
            {!statusMsg && <span />}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {saving ? <IconLoader2 size={14} /> : <IconCheck size={14} />}
              Save
            </button>
          </div>
        </div>

        {/* AI Transforms */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            <IconWand size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            AI Transforms
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(Object.keys(TRANSFORM_LABELS) as TransformType[]).map(t => (
              <button
                key={t}
                onClick={() => handleTransform(t)}
                disabled={!!transforming}
                style={{ background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--ink2)', cursor: transforming ? 'not-allowed' : 'pointer', opacity: transforming ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.1s' }}
              >
                {transforming === t ? <IconLoader2 size={12} /> : <IconSparkles size={12} color="var(--sage)" />}
                {TRANSFORM_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Version history */}
        <div>
          <button
            onClick={async () => { if (!showVersions) await loadVersions(); setShowVersions(v => !v) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink2)', fontSize: 12, fontWeight: 500, padding: 0 }}
          >
            <IconHistory size={13} />
            Version history
            {showVersions ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
          </button>
          {showVersions && versions.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 8, paddingLeft: 4 }}>No prior versions — this is the original.</div>
          )}
          {showVersions && versions.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {versions.map(v => (
                <div key={v.id} style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>v{v.version_number} · {v.change_type.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>{v.change_summary ?? ''} · {new Date(v.created_at).toLocaleDateString()}</div>
                  </div>
                  <button
                    onClick={() => setText(v.text_content ?? JSON.stringify(v.structured_data, null, 2) ?? '')}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: 'var(--ink2)', cursor: 'pointer' }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <button
          onClick={handlePublish}
          disabled={publishing || !asset.approved_at}
          title={!asset.approved_at ? 'Approve the asset first' : 'Mark as published'}
          style={{ flex: 1, background: asset.approved_at ? 'var(--sage-d)' : 'var(--raised)', border: `1px solid ${asset.approved_at ? 'var(--sage-b)' : 'var(--border2)'}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: asset.approved_at ? 'var(--sage)' : 'var(--ink3)', cursor: asset.approved_at ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <IconSend size={13} />
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
        <button
          onClick={handleArchive}
          disabled={archiving}
          style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', borderRadius: 6, padding: '8px 14px', fontSize: 12, color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {archiving ? <IconLoader2 size={13} /> : <IconTrash size={13} />}
        </button>
      </div>
    </div>
  )
}

// ─── Generate panel ────────────────────────────────────────────────────────────

function GeneratePanel({ token, products, onGenerated }: {
  token: string;
  products: Product[];
  onGenerated: (asset: ContentAsset) => void;
}) {
  const [selectedType, setSelectedType] = useState<AssetType | null>(null)
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? '')
  const [channel, setChannel] = useState('meta')
  const [market, setMarket] = useState<'usa' | 'india' | 'both'>('usa')
  const [context, setContext] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [generatedAsset, setGeneratedAsset] = useState<ContentAsset | null>(null)
  const [filterChannel, setFilterChannel] = useState<string | null>(null)

  const orderedTypes = Object.entries(ASSET_META).sort((a, b) => {
    const ca = a[1].channel, cb = b[1].channel
    if (ca === cb) return 0
    return CHANNEL_ORDER.indexOf(ca) - CHANNEL_ORDER.indexOf(cb)
  })

  const filteredTypes = filterChannel
    ? orderedTypes.filter(([, m]) => m.channel === filterChannel)
    : orderedTypes

  const handleGenerate = async () => {
    if (!selectedType || !selectedProductId) { setError('Select a content type and product'); return }
    setGenerating(true)
    setError('')
    setGeneratedAsset(null)
    try {
      const { asset } = await api.studio.generate({
        productId: selectedProductId,
        assetType: selectedType,
        channel,
        market,
        context: context || undefined,
      }, token)
      setGeneratedAsset(asset)
      onGenerated(asset)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generation failed')
    }
    setGenerating(false)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
      {/* Type selector */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Choose a content type</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => setFilterChannel(null)}
              style={{ background: filterChannel === null ? 'var(--sage-d)' : 'var(--raised)', border: `1px solid ${filterChannel === null ? 'var(--sage-b)' : 'var(--border2)'}`, borderRadius: 4, padding: '3px 10px', fontSize: 11, color: filterChannel === null ? 'var(--sage)' : 'var(--ink2)', cursor: 'pointer' }}
            >
              All
            </button>
            {ALL_CHANNELS.map(ch => (
              <button
                key={ch}
                onClick={() => setFilterChannel(ch === filterChannel ? null : ch)}
                style={{ background: filterChannel === ch ? 'var(--sage-d)' : 'var(--raised)', border: `1px solid ${filterChannel === ch ? 'var(--sage-b)' : 'var(--border2)'}`, borderRadius: 4, padding: '3px 10px', fontSize: 11, color: filterChannel === ch ? 'var(--sage)' : 'var(--ink2)', cursor: 'pointer' }}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {filteredTypes.map(([type]) => (
            <TypeCard
              key={type}
              type={type as AssetType}
              selected={selectedType === type}
              onClick={() => setSelectedType(type as AssetType)}
            />
          ))}
        </div>
      </div>

      {/* Options + generate */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>
            <IconSparkles size={14} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--sage)' }} />
            Generation options
          </div>

          {products.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Product</label>
              <select
                value={selectedProductId}
                onChange={e => setSelectedProductId(e.target.value)}
                style={{ width: '100%', background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--ink)' }}
              >
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Market</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['usa', 'india', 'both'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMarket(m)}
                  style={{ flex: 1, background: market === m ? 'var(--sage-d)' : 'var(--raised)', border: `1px solid ${market === m ? 'var(--sage-b)' : 'var(--border2)'}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, color: market === m ? 'var(--sage)' : 'var(--ink2)', cursor: 'pointer' }}
                >
                  {m === 'usa' ? '🇺🇸 USA' : m === 'india' ? '🇮🇳 India' : '🌐 Both'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', display: 'block', marginBottom: 4 }}>Additional context (optional)</label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              rows={4}
              placeholder="Any specific angle, offer, or focus for this asset…"
              style={{ width: '100%', background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--ink)', resize: 'none', fontFamily: 'DM Sans, sans-serif', boxSizing: 'border-box' }}
            />
          </div>

          {selectedType && (
            <div style={{ background: 'var(--raised)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconCheck size={13} color="var(--sage)" />
              <span style={{ fontSize: 12, color: 'var(--ink2)' }}>
                Generating: <strong style={{ color: 'var(--ink)' }}>{ASSET_META[selectedType]?.label ?? selectedType}</strong>
              </span>
            </div>
          )}

          {error && (
            <div style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--danger)', display: 'flex', gap: 6 }}>
              <IconAlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating || !selectedType}
            style={{ width: '100%', background: selectedType ? 'var(--sage)' : 'var(--raised)', color: selectedType ? '#fff' : 'var(--ink3)', border: 'none', borderRadius: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: selectedType ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.15s' }}
          >
            {generating ? <IconLoader2 size={15} /> : <IconSparkles size={15} />}
            {generating ? 'Generating…' : 'Generate content'}
          </button>
        </div>

        {generatedAsset && (
          <div style={{ background: 'var(--surface)', border: '1.5px solid var(--sage-b)', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              <IconCheck size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Generated
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.6, maxHeight: 180, overflow: 'auto', fontFamily: 'DM Mono, monospace' }}>
              {generatedAsset.text_content ?? JSON.stringify(generatedAsset.structured_data, null, 2)}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink3)' }}>
              Asset saved to library · view and edit it there
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stats panel ──────────────────────────────────────────────────────────────

function StatsPanel({ stats }: { stats: StudioStats | null }) {
  if (!stats) return <div style={{ color: 'var(--ink3)', fontSize: 13, padding: 20 }}>Loading stats…</div>

  const topTypes = Object.entries(stats.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Total assets</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{stats.totalAssets}</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{stats.archivedAssets} archived</div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Versions saved</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{stats.totalVersions}</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>edit history preserved</div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Published</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--sage)', fontFamily: 'DM Mono, monospace' }}>{stats.publishedCount}</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>live publishing targets</div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>AI tokens used</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', fontFamily: 'DM Mono, monospace' }}>{stats.totalTokens.toLocaleString()}</div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>across all generations</div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>Top content types</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topTypes.map(([type, count]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--ink2)', width: 200, flexShrink: 0 }}>
                {ASSET_META[type as AssetType]?.label ?? type.replace(/_/g, ' ')}
              </div>
              <div style={{ flex: 1, background: 'var(--raised)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ background: 'var(--sage)', height: '100%', width: `${Math.max(4, (count / (topTypes[0]?.[1] ?? 1)) * 100)}%`, borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', fontFamily: 'DM Mono, monospace', width: 24, textAlign: 'right' }}>{count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContentStudioPage() {
  const [token, setToken] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [assets, setAssets] = useState<ContentAsset[]>([])
  const [stats, setStats] = useState<StudioStats | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('library')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterChannel, setFilterChannel] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<ContentAsset | null>(null)
  const [offset, setOffset] = useState(0)
  const LIMIT = 24
  const supabase = createClient()

  const fetchToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [supabase])

  const loadAssets = useCallback(async (tok: string, searchVal: string, typeVal: string, statusVal: string, channelVal: string, archivedVal: boolean, off: number) => {
    const { assets: a, total: t } = await api.studio.listAssets(tok, {
      search: searchVal || undefined,
      type: typeVal || undefined,
      status: statusVal || undefined,
      channel: channelVal ? channelVal.toLowerCase() : undefined,
      includeArchived: archivedVal,
      limit: LIMIT,
      offset: off,
    })
    return { assets: a, total: t }
  }, [])

  useEffect(() => {
    fetchToken().then(async tok => {
      if (!tok) return
      setToken(tok)
      const [{ data: ps }, assetsRes, statsRes] = await Promise.all([
        supabase.from('products').select('id, name, platform').order('created_at', { ascending: false }),
        loadAssets(tok, '', '', '', '', false, 0),
        api.studio.stats(tok),
      ])
      setProducts((ps ?? []) as Product[])
      setAssets(assetsRes.assets)
      setTotal(assetsRes.total)
      setStats(statsRes)
      setLoading(false)
    })
  }, [fetchToken, loadAssets, supabase])

  const applyFilters = useCallback(async () => {
    const tok = await fetchToken()
    if (!tok) return
    const res = await loadAssets(tok, search, filterType, filterStatus, filterChannel, includeArchived, offset)
    setAssets(res.assets)
    setTotal(res.total)
  }, [fetchToken, loadAssets, search, filterType, filterStatus, filterChannel, includeArchived, offset])

  const handleSearch = useCallback(async (val: string) => {
    setSearch(val)
    setOffset(0)
    const tok = await fetchToken()
    if (!tok) return
    const res = await loadAssets(tok, val, filterType, filterStatus, filterChannel, includeArchived, 0)
    setAssets(res.assets)
    setTotal(res.total)
  }, [fetchToken, loadAssets, filterType, filterStatus, filterChannel, includeArchived])

  // Stub approval handlers (content assets also support approve/hold/regen via existing routes)
  const handleApprove = useCallback(async (id: string) => {
    const tok = await fetchToken()
    if (!tok) return
    await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/content-assets/${id}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}',
    })
    setAssets(prev => prev.map(a => a.id === id ? { ...a, status: 'approved' as const, approved_at: new Date().toISOString() } : a))
    if (selectedAsset?.id === id) setSelectedAsset(prev => prev ? { ...prev, status: 'approved', approved_at: new Date().toISOString() } : prev)
  }, [fetchToken, selectedAsset])

  const handleHold = useCallback(async (id: string) => {
    const tok = await fetchToken()
    if (!tok) return
    await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/content-assets/${id}/hold`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}',
    })
    setAssets(prev => prev.map(a => a.id === id ? { ...a, status: 'held' as const } : a))
  }, [fetchToken])

  const handleRegen = useCallback(async (id: string, reason: string, note?: string) => {
    const tok = await fetchToken()
    if (!tok) return
    await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/content-assets/${id}/regenerate`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, additionalNote: note }),
    })
    await applyFilters()
  }, [fetchToken, applyFilters])

  const handleSaved = useCallback((updated: ContentAsset) => {
    setAssets(prev => prev.map(a => a.id === updated.id ? updated : a))
    setSelectedAsset(updated)
  }, [])

  const handleArchived = useCallback((id: string) => {
    setAssets(prev => prev.filter(a => a.id !== id))
    setSelectedAsset(null)
  }, [])

  const handleGenerated = useCallback((asset: ContentAsset) => {
    setAssets(prev => [asset, ...prev])
    setTotal(t => t + 1)
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '40px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink3)' }}>
        <IconLoader2 size={16} />
        <span style={{ fontSize: 14 }}>Loading Content Studio…</span>
      </div>
    )
  }

  return (
    <div style={{ padding: 'clamp(16px, 3vw, 32px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
            Content Studio
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink3)', margin: '4px 0 0' }}>
            31 content types · AI generation, editing, versioning, and publishing
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {stats && (
            <>
              <Badge variant="default">{stats.totalAssets} assets</Badge>
              <Badge variant="sage">{stats.publishedCount} live</Badge>
            </>
          )}
          <button
            onClick={() => setTab('generate')}
            style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <IconPlus size={14} />
            Generate
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {(['library', 'generate', 'stats'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--sage)' : '2px solid transparent', cursor: 'pointer', padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? 'var(--sage)' : 'var(--ink2)', marginBottom: -1, transition: 'all 0.15s' }}
          >
            {t === 'library' ? 'Library' : t === 'generate' ? 'Generate' : 'Analytics'}
          </button>
        ))}
      </div>

      {/* Library tab */}
      {tab === 'library' && (
        <div>
          {/* Filter row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
              <IconSearch size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
              <input
                type="text"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Search content…"
                style={{ width: '100%', background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 10px 8px 32px', fontSize: 13, color: 'var(--ink)', boxSizing: 'border-box' }}
              />
              {search && <button onClick={() => handleSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)' }}><IconX size={12} /></button>}
            </div>

            <select
              value={filterType}
              onChange={async e => { setFilterType(e.target.value); setOffset(0); const tok = await fetchToken(); if (!tok) return; const r = await loadAssets(tok, search, e.target.value, filterStatus, filterChannel, includeArchived, 0); setAssets(r.assets); setTotal(r.total); }}
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--ink2)', minWidth: 160 }}
            >
              <option value="">All types</option>
              {ALL_CHANNELS.map(ch => (
                <optgroup key={ch} label={ch}>
                  {Object.entries(ASSET_META).filter(([, m]) => m.channel === ch).map(([type, m]) => (
                    <option key={type} value={type}>{m.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={async e => { setFilterStatus(e.target.value); setOffset(0); const tok = await fetchToken(); if (!tok) return; const r = await loadAssets(tok, search, filterType, e.target.value, filterChannel, includeArchived, 0); setAssets(r.assets); setTotal(r.total); }}
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--ink2)' }}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="held">Held</option>
              <option value="rejected">Rejected</option>
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={async e => { setIncludeArchived(e.target.checked); setOffset(0); const tok = await fetchToken(); if (!tok) return; const r = await loadAssets(tok, search, filterType, filterStatus, filterChannel, e.target.checked, 0); setAssets(r.assets); setTotal(r.total); }}
              />
              Show archived
            </label>

            <div style={{ fontSize: 12, color: 'var(--ink3)', marginLeft: 'auto' }}>
              {total} asset{total !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Asset grid */}
          {assets.length === 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 40, textAlign: 'center' }}>
              <IconSparkles size={32} color="var(--ink3)" style={{ margin: '0 auto 12px', display: 'block' }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>No content assets yet</div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>Generate your first asset to see it here.</div>
              <button
                onClick={() => setTab('generate')}
                style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Generate content
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {assets.map(asset => (
                <div
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  style={{ cursor: 'pointer', borderRadius: 10, transition: 'box-shadow 0.15s' }}
                >
                  <AssetBlock
                    asset={asset}
                    onApprove={handleApprove}
                    onHold={handleHold}
                    onRegen={handleRegen}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
              <button
                disabled={offset === 0}
                onClick={async () => { const newOff = Math.max(0, offset - LIMIT); setOffset(newOff); const tok = await fetchToken(); if (!tok) return; const r = await loadAssets(tok, search, filterType, filterStatus, filterChannel, includeArchived, newOff); setAssets(r.assets); setTotal(r.total); }}
                style={{ background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 14px', fontSize: 12, color: 'var(--ink2)', cursor: offset === 0 ? 'not-allowed' : 'pointer', opacity: offset === 0 ? 0.5 : 1 }}
              >
                ← Previous
              </button>
              <span style={{ fontSize: 12, color: 'var(--ink3)', display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
              </span>
              <button
                disabled={offset + LIMIT >= total}
                onClick={async () => { const newOff = offset + LIMIT; setOffset(newOff); const tok = await fetchToken(); if (!tok) return; const r = await loadAssets(tok, search, filterType, filterStatus, filterChannel, includeArchived, newOff); setAssets(r.assets); setTotal(r.total); }}
                style={{ background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 14px', fontSize: 12, color: 'var(--ink2)', cursor: offset + LIMIT >= total ? 'not-allowed' : 'pointer', opacity: offset + LIMIT >= total ? 0.5 : 1 }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Generate tab */}
      {tab === 'generate' && token && (
        <GeneratePanel token={token} products={products} onGenerated={handleGenerated} />
      )}

      {/* Stats tab */}
      {tab === 'stats' && <StatsPanel stats={stats} />}

      {/* Editor panel overlay */}
      {selectedAsset && token && (
        <>
          <div
            onClick={() => setSelectedAsset(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 49 }}
          />
          <EditorPanel
            asset={selectedAsset}
            token={token}
            onClose={() => setSelectedAsset(null)}
            onSaved={handleSaved}
            onArchived={handleArchived}
          />
        </>
      )}
    </div>
  )
}
