'use client'

/**
 * @file AssetBlock.tsx
 * @description Renders a single content asset with approve/hold/regen actions.
 *   Handles all 24 asset types: video inline player, audio player, structured JSON.
 *   Design: raised card with left channel-colour border matching launchmind-ux-slate-sage.html.
 * @security No token handling here — parent passes callbacks.
 * @dependencies lib/types/content, @tabler/icons-react
 */

import { useState } from 'react'
import {
  IconBrandWhatsapp, IconMicrophone, IconBrandFacebook, IconPhoto, IconBrandGoogle,
  IconDeviceMobile, IconFileText, IconTags, IconMail, IconBrandLinkedin, IconChartBar,
  IconBrandInstagram, IconBrandYoutube, IconLayoutColumns, IconRocket, IconBrandTwitter,
  IconFileAnalytics, IconQuote, IconStar, IconCheck, IconAlertCircle, IconPlayerPause,
  IconLoader, IconDownload, IconPencil, IconRefresh, IconVideo, IconSparkles,
} from '@tabler/icons-react'
import type { ContentAsset, AssetType, AssetStatus } from '@/lib/types/content'
import { ASSET_META, REGEN_REASONS, VIDEO_REGEN_REASONS } from '@/lib/types/content'

// ─── Icon map ────────────────────────────────────────────────────────────────

type IconComp = React.ComponentType<{ size?: number | string; color?: string; stroke?: number | string; className?: string; style?: React.CSSProperties }>

const ICONS: Record<string, IconComp> = {
  whatsapp:  IconBrandWhatsapp,
  mic:       IconMicrophone,
  facebook:  IconBrandFacebook,
  photo:     IconPhoto,
  google:    IconBrandGoogle,
  mobile:    IconDeviceMobile,
  filetext:  IconFileText,
  tags:      IconTags,
  mail:      IconMail,
  linkedin:  IconBrandLinkedin,
  chart:     IconChartBar,
  video:     IconVideo,
  layout:    IconLayoutColumns,
  rocket:    IconRocket,
  twitter:   IconBrandTwitter,
  analytics: IconFileAnalytics,
  quote:     IconQuote,
  star:      IconStar,
  instagram: IconBrandInstagram,
  youtube:   IconBrandYoutube,
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AssetStatus }) {
  const cfg: Record<AssetStatus, { bg: string; color: string; text: string }> = {
    pending:      { bg: 'var(--amber-d)',   color: 'var(--amber)', text: 'Pending' },
    approved:     { bg: 'var(--sage-d)',    color: 'var(--sage)',  text: '✓ Approved' },
    auto_approved:{ bg: 'var(--sage-d)',    color: 'var(--sage)',  text: '⚡ Auto' },
    rejected:     { bg: 'var(--danger-d)',     color: 'var(--danger)',   text: 'Rejected' },
    held:         { bg: 'var(--amber-d)',   color: 'var(--amber)', text: '⏸ Held' },
    concept:      { bg: 'var(--indigo-d)',  color: 'var(--indigo)', text: 'Script ready' },
  }
  const s = cfg[status]
  return (
    <span style={{
      fontSize: 9, padding: '2px 7px', borderRadius: 99,
      background: s.bg, color: s.color, fontWeight: 500, whiteSpace: 'nowrap' as const,
    }}>
      {s.text}
    </span>
  )
}

// ─── Asset content renderer ───────────────────────────────────────────────────

function AssetContent({ assetType, textContent }: { assetType: AssetType; textContent: string | null }) {
  if (!textContent) {
    return <p style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>No content generated yet</p>
  }

  let parsed: unknown = null
  try { parsed = JSON.parse(textContent) } catch { /* plain text */ }

  // Google UAC — 5 variants
  if (assetType === 'google_uac_variants' && parsed && typeof parsed === 'object') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(parsed as Record<string, string>).map(([key, val], i) => (
          <div key={key} style={{ fontSize: 11, color: 'var(--ink)', display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--ink3)', width: 20, flexShrink: 0 }}>V{i + 1}</span>
            <span>{val}</span>
          </div>
        ))}
      </div>
    )
  }

  // Meta headline A/B
  if (assetType === 'meta_headline' && parsed && typeof parsed === 'object') {
    const p = parsed as { a?: string; b?: string }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {p.a && <div style={{ fontSize: 12, color: 'var(--ink)', display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--ink3)', width: 16 }}>A</span>
          <strong>{p.a}</strong>
        </div>}
        {p.b && <div style={{ fontSize: 12, color: 'var(--ink)', display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--ink3)', width: 16 }}>B</span>
          <strong>{p.b}</strong>
        </div>}
      </div>
    )
  }

  // Email — subject + body preview
  if (['email_day1', 'email_day5', 'email_day14'].includes(assetType) && parsed && typeof parsed === 'object') {
    const p = parsed as { subject?: string; body?: string }
    return (
      <div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Subject:</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>{p.subject}</div>
        <div style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.6, maxHeight: 80, overflow: 'hidden' }}>{p.body}</div>
      </div>
    )
  }

  // Twitter thread — numbered tweets
  if (assetType === 'community_twitter_thread' && Array.isArray(parsed)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(parsed as string[]).map((tweet, i) => (
          <div key={i} style={{ fontSize: 11, color: 'var(--ink)', display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--ink3)', width: 20, flexShrink: 0 }}>{i + 1}.</span>
            <span>{tweet}</span>
          </div>
        ))}
      </div>
    )
  }

  // Case study — structured sections
  if (assetType === 'social_proof_case_study' && parsed && typeof parsed === 'object') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(parsed as Record<string, string>).map(([key, val]) => (
          <div key={key}>
            <div style={{ fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '.04em', color: 'var(--ink3)', marginBottom: 3 }}>
              {key.replace(/([A-Z])/g, ' $1').trim()}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.55 }}>{val}</div>
          </div>
        ))}
      </div>
    )
  }

  // Review responses — positive + negative
  if (assetType === 'social_proof_review_response' && parsed && typeof parsed === 'object') {
    const p = parsed as { positive?: string; negative?: string }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {p.positive && <div>
          <div style={{ fontSize: 9, textTransform: 'uppercase' as const, color: 'var(--sage)', marginBottom: 3 }}>Positive review response</div>
          <div style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.55 }}>{p.positive}</div>
        </div>}
        {p.negative && <div>
          <div style={{ fontSize: 9, textTransform: 'uppercase' as const, color: 'var(--amber)', marginBottom: 3 }}>Negative review response</div>
          <div style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.55 }}>{p.negative}</div>
        </div>}
      </div>
    )
  }

  // Meta image brief — visual design spec
  if (assetType === 'meta_image_brief' && parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, string>
    const fields: [string, string][] = [
      ['Headline', p.headline], ['Subtext', p.subtext],
      ['Background', p.backgroundColor], ['Main visual', p.mainVisual],
      ['Emotion', p.emotionToConvey], ['Canva template', p.canvaTemplate],
      ['Avoid', p.doNotInclude],
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {fields.filter(([, v]) => v).map(([label, val]) => (
          <div key={label} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--ink3)', minWidth: 110, flexShrink: 0 }}>{label}</span>
            <span style={{ color: 'var(--ink)', lineHeight: 1.5 }}>{val}</span>
          </div>
        ))}
      </div>
    )
  }

  // Carousel brief — slide-by-slide breakdown
  if (assetType === 'carousel_brief' && parsed && typeof parsed === 'object') {
    const p = parsed as { slides?: Array<{ slideNumber?: number; type?: string; headline?: string; body?: string; visual?: string }> }
    if (p.slides && Array.isArray(p.slides)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.slides.map((slide, i) => (
            <div key={i} style={{ borderLeft: '2px solid var(--border2)', paddingLeft: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 2 }}>
                Slide {slide.slideNumber ?? i + 1} · {slide.type}
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{slide.headline}</div>
              {slide.body && <div style={{ fontSize: 11, color: 'var(--ink2)', lineHeight: 1.5 }}>{slide.body}</div>}
              {slide.visual && <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 2, fontStyle: 'italic' }}>Visual: {slide.visual}</div>}
            </div>
          ))}
        </div>
      )
    }
  }

  // ASO keywords array
  if (assetType === 'aso_keywords' && Array.isArray(parsed)) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(parsed as string[]).map((kw, i) => (
          <span key={i} style={{ fontSize: 10, background: 'var(--raised)', border: '0.5px solid var(--border2)', borderRadius: 4, padding: '2px 7px', color: 'var(--ink2)' }}>
            {kw}
          </span>
        ))}
      </div>
    )
  }

  // Default — plain text with left sage border
  return (
    <p style={{
      fontSize: 12, color: 'var(--ink)', lineHeight: 1.7,
      borderLeft: '2px solid var(--sage-b)', paddingLeft: 10,
      fontStyle: 'italic', margin: 0,
    }}>
      {textContent}
    </p>
  )
}

// ─── Main AssetBlock ──────────────────────────────────────────────────────────

type ImageStyle = 'photorealistic' | 'graphic' | 'mockup'

interface AssetBlockProps {
  asset: ContentAsset
  onApprove: (id: string) => Promise<void>
  onHold: (id: string) => Promise<void>
  onRegen: (id: string, reason: string, note?: string) => Promise<void>
  onGenerateImage?: (id: string, style?: ImageStyle) => Promise<void>
}

export function AssetBlock({ asset, onApprove, onHold, onRegen, onGenerateImage }: AssetBlockProps) {
  const [showRegen, setShowRegen] = useState(false)
  const [selectedReasons, setSelectedReasons] = useState<Set<string>>(new Set())
  const [regenNote, setRegenNote] = useState('')
  const [loading, setLoading] = useState<'approve' | 'hold' | 'regen' | 'genimage' | null>(null)
  const [showLightbox, setShowLightbox] = useState(false)
  const [imageStyle, setImageStyle] = useState<ImageStyle>('photorealistic')

  const meta = ASSET_META[asset.asset_type]
  if (!meta) return null

  const IconComp = ICONS[meta.iconName] ?? IconFileText
  const isVideo = asset.asset_type.startsWith('video_')
  const isAudio = asset.asset_type === 'whatsapp_voice_note'
  const isVisualBrief = asset.asset_type === 'meta_image_brief' || asset.asset_type === 'carousel_brief'
  const isPaid = ['meta', 'google'].includes(asset.channel)
  const reasons = isVideo ? VIDEO_REGEN_REASONS : REGEN_REASONS
  const canRegen = asset.regen_count < 3
  const isPending = asset.status === 'pending'
  const isApproved = asset.status === 'approved' || asset.status === 'auto_approved'
  const isGeneratingImage = loading === 'genimage'

  async function handleApprove() {
    setLoading('approve')
    try { await onApprove(asset.id) } finally { setLoading(null) }
  }

  async function handleHold() {
    setLoading('hold')
    try { await onHold(asset.id) } finally { setLoading(null) }
  }

  async function handleGenerateImage() {
    if (!onGenerateImage) return
    setLoading('genimage')
    try { await onGenerateImage(asset.id, imageStyle) } finally { setLoading(null) }
  }

  function toggleReason(r: string) {
    setSelectedReasons(prev => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r)
      else next.add(r)
      return next
    })
  }

  async function handleRegen() {
    if (selectedReasons.size === 0) return
    setLoading('regen')
    try {
      const reasonStr = Array.from(selectedReasons).join(', ')
      await onRegen(asset.id, reasonStr, regenNote || undefined)
      setShowRegen(false)
      setSelectedReasons(new Set())
      setRegenNote('')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div
      data-asset-type={asset.asset_type}
      style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--border)',
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 'var(--r)',
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '9px 13px', display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '0.5px solid var(--border)',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 5, flexShrink: 0,
          background: `${meta.color}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconComp size={13} color={meta.color} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 1 }}>
            {asset.market === 'both' ? 'USA + India' : asset.market?.toUpperCase()} · {asset.language}
            {asset.quality_score != null && ` · Q:${Math.round(asset.quality_score * 100)}%`}
          </div>
        </div>

        <StatusBadge status={asset.status} />
        <span style={{ fontSize: 9, color: 'var(--ink3)', whiteSpace: 'nowrap' as const }}>{asset.regen_count}/3</span>
      </div>

      {/* Content */}
      <div style={{ padding: '10px 13px' }}>
        {/* Video player */}
        {isVideo && asset.media_url && (
          <div data-video-player style={{ marginBottom: 8 }}>
            <video
              controls
              style={{ width: '100%', borderRadius: 6, maxHeight: 200, background: '#000', display: 'block' }}
              poster={asset.thumbnail_url ?? undefined}
            >
              <source src={asset.media_url} type="video/mp4" />
            </video>
            <p style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4, marginBottom: 0 }}>
              {asset.duration_seconds}s · MP4 · Watch before approving
            </p>
          </div>
        )}

        {/* Video generating */}
        {isVideo && !asset.media_url && (
          <div style={{
            background: 'var(--raised)', borderRadius: 6, height: 56,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--ink3)', gap: 6, marginBottom: 8,
          }}>
            <IconLoader size={14} style={{ animation: 'spin 1s linear infinite' }} />
            Generating video… usually 2–3 minutes
          </div>
        )}

        {/* Audio player */}
        {isAudio && asset.media_url && (
          <div style={{
            background: 'rgba(5,150,105,0.08)', borderRadius: 6,
            padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 8,
          }}>
            <audio controls style={{ flex: 1, height: 32 }}>
              <source src={asset.media_url} type="audio/mpeg" />
            </audio>
            <a
              href={asset.media_url} download
              style={{ fontSize: 10, color: 'var(--sage)', textDecoration: 'none' }}
            >
              <IconDownload size={14} />
            </a>
          </div>
        )}

        {/* Generated image thumbnail (click to enlarge) */}
        {isVisualBrief && asset.media_url && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <button
                onClick={() => setShowLightbox(true)}
                title="Click to enlarge"
                style={{
                  width: 72, height: 72, flexShrink: 0,
                  borderRadius: 6, overflow: 'hidden',
                  border: '1.5px solid var(--indigo-b)',
                  background: '#0d0d1a', cursor: 'zoom-in', padding: 0,
                  position: 'relative',
                }}
              >
                <img
                  src={asset.media_url}
                  alt="AI-generated marketing image"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 11, color: 'var(--indigo)', fontWeight: 500, margin: '0 0 3px' }}>
                  AI image generated · Flux.1 Schnell
                </p>
                <p style={{ fontSize: 10, color: 'var(--ink3)', margin: '0 0 6px' }}>
                  1:1 square · Click thumbnail to preview
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setShowLightbox(true)}
                    style={{
                      fontSize: 10, padding: '3px 9px', borderRadius: 4, cursor: 'pointer',
                      background: 'var(--raised)', border: '0.5px solid var(--border2)',
                      color: 'var(--ink2)', fontFamily: 'inherit',
                    }}
                  >
                    Preview
                  </button>
                  <a
                    href={asset.media_url} download target="_blank" rel="noreferrer"
                    style={{
                      fontSize: 10, padding: '3px 9px', borderRadius: 4,
                      background: 'var(--raised)', border: '0.5px solid var(--border2)',
                      color: 'var(--ink2)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    <IconDownload size={10} />
                    Download PNG
                  </a>
                </div>
              </div>
            </div>

            {/* Lightbox */}
            {showLightbox && (
              <div
                onClick={() => setShowLightbox(false)}
                style={{
                  position: 'fixed', inset: 0, zIndex: 9999,
                  background: 'rgba(0,0,0,0.88)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'zoom-out',
                }}
              >
                <img
                  src={asset.media_url}
                  alt="AI-generated marketing image"
                  style={{
                    maxWidth: '90vw', maxHeight: '90vh',
                    borderRadius: 8, display: 'block',
                    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={() => setShowLightbox(false)}
                  style={{
                    position: 'absolute', top: 20, right: 24,
                    background: 'rgba(255,255,255,0.12)', border: 'none',
                    color: '#fff', borderRadius: 99, width: 32, height: 32,
                    fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </>
        )}

        {/* Image generating spinner — shows when generating with or without existing image */}
        {isVisualBrief && isGeneratingImage && (
          <div style={{
            background: 'var(--raised)', borderRadius: 6, height: 48,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--ink3)', gap: 6, marginBottom: 10,
          }}>
            <IconLoader size={13} style={{ animation: 'spin 1s linear infinite' }} />
            Generating new image with Flux.1… usually 30–60 seconds
          </div>
        )}

        {/* Style selector — shown when visual brief and image generation is available */}
        {isVisualBrief && onGenerateImage && !isGeneratingImage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: 'var(--ink3)', whiteSpace: 'nowrap' as const }}>Style:</span>
            {(['photorealistic', 'graphic', 'mockup'] as ImageStyle[]).map((s) => (
              <button
                key={s}
                onClick={() => setImageStyle(s)}
                style={{
                  padding: '3px 9px', borderRadius: 99, fontSize: 9, cursor: 'pointer',
                  border: imageStyle === s ? '0.5px solid var(--indigo-b)' : '0.5px solid var(--border)',
                  background: imageStyle === s ? 'var(--indigo-d)' : 'var(--raised)',
                  color: imageStyle === s ? 'var(--indigo)' : 'var(--ink3)',
                  fontFamily: 'inherit', fontWeight: imageStyle === s ? 500 : 400,
                  transition: 'all 0.12s',
                }}
              >
                {s === 'photorealistic' ? '📷 Photo' : s === 'graphic' ? '🎨 Graphic' : '📱 Mockup'}
              </button>
            ))}
          </div>
        )}

        {/* Generate image button (only when no image and not already generating) */}
        {isVisualBrief && !asset.media_url && !isGeneratingImage && onGenerateImage && (
          <div style={{
            background: 'var(--indigo-d)', border: '0.5px solid var(--indigo-b)',
            borderRadius: 6, padding: '8px 12px', marginBottom: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <p style={{ fontSize: 11, color: 'var(--indigo)', fontWeight: 500, margin: 0 }}>
                Design brief ready
              </p>
              <p style={{ fontSize: 10, color: 'var(--ink3)', margin: '2px 0 0' }}>
                Generate AI image via Flux.1 Schnell · style: {imageStyle}
              </p>
            </div>
            <button
              onClick={handleGenerateImage}
              disabled={loading !== null}
              style={{
                background: 'var(--indigo)', color: '#fff',
                border: 'none', borderRadius: 5,
                padding: '6px 12px', fontSize: 11, fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                flexShrink: 0,
              }}
            >
              <IconSparkles size={12} />
              Generate image
            </button>
          </div>
        )}

        {/* Text content */}
        {!isVideo && !isAudio && (
          <AssetContent assetType={asset.asset_type} textContent={asset.text_content} />
        )}
      </div>

      {/* Pending actions */}
      {isPending && (
        <div style={{
          padding: '8px 13px', borderTop: '0.5px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
        }}>
          <button
            onClick={handleApprove}
            disabled={loading !== null}
            style={{
              background: 'var(--sage)', color: '#fff', border: 'none',
              borderRadius: 5, padding: '6px 14px', fontSize: 11, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <IconCheck size={12} />
            {loading === 'approve' ? 'Approving…' : 'Approve'}
          </button>

          {!isVideo && !isAudio && (
            <button style={{
              background: 'transparent', border: '0.5px solid var(--border2)',
              borderRadius: 5, padding: '6px 12px', fontSize: 11,
              color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <IconPencil size={12} />
              Edit
            </button>
          )}

          {isVideo && asset.media_url && (
            <a href={asset.media_url} download style={{
              background: 'transparent', border: '0.5px solid var(--border2)',
              borderRadius: 5, padding: '6px 12px', fontSize: 11,
              color: 'var(--ink2)', cursor: 'pointer', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <IconDownload size={12} />
              Download
            </a>
          )}

          {/* Visual briefs: "New image" re-runs Flux.1 on the same brief */}
          {isVisualBrief && asset.media_url && onGenerateImage && !isGeneratingImage && (
            <button
              onClick={handleGenerateImage}
              disabled={loading !== null}
              style={{
                background: 'rgba(79,70,229,0.08)', border: '0.5px solid rgba(79,70,229,0.22)',
                borderRadius: 5, padding: '6px 12px', fontSize: 11, color: '#4f46e5',
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <IconRefresh size={12} />
              New image
            </button>
          )}

          {/* Text assets: show standard regen drawer */}
          {canRegen && !isVisualBrief && (
            <button
              onClick={() => setShowRegen(!showRegen)}
              style={{
                background: 'rgba(79,70,229,0.08)', border: '0.5px solid rgba(79,70,229,0.22)',
                borderRadius: 5, padding: '6px 12px', fontSize: 11, color: '#4f46e5',
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <IconRefresh size={12} />
              Regenerate
            </button>
          )}

          {isPaid && (
            <div style={{
              marginLeft: 'auto', fontSize: 10, color: 'var(--amber)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <IconAlertCircle size={12} />
              Paid — manual only
            </div>
          )}
        </div>
      )}

      {/* Approved footer */}
      {isApproved && (
        <div style={{
          padding: '8px 13px', borderTop: '0.5px solid var(--border)',
          fontSize: 11, color: 'var(--sage)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <IconCheck size={13} />
          {asset.auto_approved ? 'Auto-approved — publishes Tuesday 9am' : 'Approved'}
          {asset.auto_approved && (
            <button
              onClick={handleHold}
              disabled={loading === 'hold'}
              style={{
                marginLeft: 8, background: 'transparent',
                border: '0.5px solid var(--border2)', borderRadius: 5,
                padding: '3px 10px', fontSize: 10, color: 'var(--ink2)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {loading === 'hold' ? '…' : 'Hold'}
            </button>
          )}
        </div>
      )}

      {/* Held footer */}
      {asset.status === 'held' && (
        <div style={{
          padding: '8px 13px', borderTop: '0.5px solid var(--border)',
          fontSize: 11, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <IconPlayerPause size={13} />
          Held — will not publish this week
        </div>
      )}

      {/* Regenerate drawer */}
      {showRegen && (
        <div style={{
          background: 'var(--surface)',
          border: '1.5px solid rgba(79,70,229,0.22)',
          borderRadius: 8, padding: 14, margin: '0 13px 12px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#4f46e5', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconRefresh size={13} color="#4f46e5" />
            {isVideo ? 'What should we change in the video?' : 'Why do you want to regenerate this?'}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5, marginBottom: 10 }}>
            {reasons.map((r) => {
              const sel = selectedReasons.has(r)
              return (
                <button
                  key={r}
                  onClick={() => toggleReason(r)}
                  style={{
                    padding: '5px 10px', borderRadius: 99, fontSize: 10, cursor: 'pointer',
                    border: sel ? '0.5px solid rgba(79,70,229,0.35)' : '0.5px solid var(--border)',
                    background: sel ? 'rgba(79,70,229,0.10)' : 'var(--raised)',
                    color: sel ? '#4f46e5' : 'var(--ink2)',
                    fontFamily: 'inherit',
                  }}
                >
                  {r}
                </button>
              )
            })}
          </div>

          <div style={{ fontSize: 10, color: 'var(--ink2)', marginBottom: 6 }}>
            Optional: tell LaunchMind specifically what to change
          </div>
          <textarea
            value={regenNote}
            onChange={(e) => setRegenNote(e.target.value)}
            placeholder="e.g. Make it warmer and less formal. Remove the competitor mention."
            style={{
              width: '100%', padding: '7px 10px', background: 'var(--raised)',
              border: '0.5px solid var(--border2)', borderRadius: 5,
              fontSize: 11, fontFamily: 'inherit', resize: 'none' as const,
              color: 'var(--ink)', marginBottom: 8, outline: 'none', boxSizing: 'border-box' as const,
            }}
            rows={2}
          />

          {asset.regen_count > 0 ? (
            <p style={{ fontSize: 9, color: 'var(--amber)', marginBottom: 8, marginTop: 0 }}>
              ⚠ {asset.regen_count} of 3 regenerations used for this asset this week
            </p>
          ) : (
            <p style={{ fontSize: 9, color: 'var(--ink3)', marginBottom: 8, marginTop: 0 }}>
              This reason will be saved so future generations avoid this issue · {3 - asset.regen_count} regenerations remaining
            </p>
          )}

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowRegen(false); setSelectedReasons(new Set()); setRegenNote('') }}
              style={{
                background: 'transparent', border: '0.5px solid var(--border2)',
                borderRadius: 5, padding: '6px 12px', fontSize: 11,
                color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleRegen}
              disabled={selectedReasons.size === 0 || loading !== null}
              style={{
                background: selectedReasons.size > 0 ? 'rgba(79,70,229,0.10)' : 'var(--raised)',
                border: `0.5px solid ${selectedReasons.size > 0 ? 'rgba(79,70,229,0.28)' : 'var(--border)'}`,
                color: selectedReasons.size > 0 ? '#4f46e5' : 'var(--ink3)',
                borderRadius: 5, padding: '6px 14px', fontSize: 11, fontWeight: 500,
                cursor: selectedReasons.size > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <IconRefresh size={12} />
              {loading === 'regen' ? 'Generating…' : 'Regenerate now'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
