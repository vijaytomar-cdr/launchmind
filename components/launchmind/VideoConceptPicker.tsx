'use client'

/**
 * @file VideoConceptPicker.tsx
 * @description Shows video/voice-note concept cards so the owner picks which one
 *   to render before committing Creatomate + ElevenLabs time.
 *   Concepts are content_assets rows with status='concept'.
 *   After the owner clicks "Render", the card transitions to a rendering state
 *   and the parent polls for status change (concept → pending with media_url).
 * @security Token passed from parent. Never stored here.
 * @dependencies lib/api, lib/types/content
 */

import { useState } from 'react'
import { api } from '@/lib/api'
import type { ContentAsset } from '@/lib/types/content'

// ── metadata per video/voice type ────────────────────────────────────────────

const VIDEO_META: Record<string, {
  label: string
  format: string
  formatNote: string
  eta: string
  icon: string
  etaWarning?: boolean
}> = {
  video_reels_30s: {
    label: '30s Reel',
    format: 'Meta Reels · TikTok · YouTube Shorts',
    formatNote: '1080 × 1920 · 30 fps',
    eta: '~2–3 min to render',
    icon: '🎬',
    etaWarning: true,
  },
  video_shorts_60s: {
    label: '60s Short',
    format: 'YouTube Shorts · Meta Reels',
    formatNote: '1080 × 1920 · 30 fps',
    eta: '~3–4 min to render',
    icon: '📽️',
    etaWarning: true,
  },
  video_app_preview: {
    label: 'App Preview',
    format: 'App Store · Play Store listing',
    formatNote: '886 × 1920 · portrait',
    eta: '~2–3 min to render',
    icon: '📱',
    etaWarning: true,
  },
  whatsapp_voice_note: {
    label: 'Voice Note',
    format: 'WhatsApp broadcast',
    formatNote: 'MP3 audio · auto-transcribed',
    eta: '~60s to generate',
    icon: '🎙️',
    etaWarning: false,
  },
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getSceneInfo(asset: ContentAsset): { scenes: number; duration: number } {
  const data = asset.structured_data as Record<string, unknown> | null
  if (!data) return { scenes: 0, duration: 0 }
  if (Array.isArray(data.scenes)) {
    const scenes = data.scenes as Array<{ durationSeconds?: number }>
    const duration = scenes.reduce((s, sc) => s + (sc.durationSeconds ?? 0), 0)
    return { scenes: scenes.length, duration }
  }
  if (typeof data.script === 'string') {
    const words = (data.script as string).split(' ').length
    return { scenes: 1, duration: Math.ceil(words / 2.5) }
  }
  return { scenes: 0, duration: 0 }
}

// ── ConceptCard ───────────────────────────────────────────────────────────────

interface ConceptCardProps {
  asset: ContentAsset
  token: string
  onRenderStarted: (assetId: string) => void
}

function ConceptCard({ asset, token, onRenderStarted }: ConceptCardProps) {
  const [state, setState] = useState<'idle' | 'starting' | 'rendering'>(() =>
    asset.status === 'pending' && asset.render_started_at ? 'rendering' : 'idle'
  )

  const meta = VIDEO_META[asset.asset_type] ?? {
    label: asset.asset_type, format: '', formatNote: '', eta: '~2 min', icon: '🎬', etaWarning: true,
  }
  const { scenes, duration } = getSceneInfo(asset)
  const openingLine = asset.text_content?.trim() ?? ''

  async function handleRender() {
    setState('starting')
    try {
      await api.contentAssets.render(asset.id, token)
      setState('rendering')
      onRenderStarted(asset.id)
    } catch {
      setState('idle')
    }
  }

  const isRendering = state === 'rendering'
  const isStarting = state === 'starting'

  return (
    <div style={{
      background: 'var(--surface)',
      border: isRendering
        ? '1.5px solid var(--amber-b)'
        : '1px solid var(--border)',
      borderRadius: 10,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minWidth: 0,
      flex: '1 1 200px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22 }}>{meta.icon}</span>
        <div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 1 }}>
            {meta.format}
          </div>
        </div>

        {isRendering && (
          <span style={{
            marginLeft: 'auto',
            background: 'var(--amber-d)',
            border: '1px solid var(--amber-b)',
            color: '#92400e',
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 4,
            padding: '2px 8px',
          }}>
            Rendering…
          </span>
        )}
      </div>

      {/* Script preview */}
      {openingLine && (
        <div style={{
          background: 'var(--raised)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 12,
          color: 'var(--ink2)',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          &ldquo;{openingLine}&rdquo;
        </div>
      )}

      {/* Specs row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {scenes > 0 && (
          <span style={{
            background: 'var(--raised)', border: '1px solid var(--border2)',
            color: 'var(--ink2)', fontSize: 11, borderRadius: 4, padding: '2px 7px',
          }}>
            {scenes} scene{scenes !== 1 ? 's' : ''}
          </span>
        )}
        {duration > 0 && (
          <span style={{
            background: 'var(--raised)', border: '1px solid var(--border2)',
            color: 'var(--ink2)', fontSize: 11, borderRadius: 4, padding: '2px 7px',
          }}>
            {duration}s
          </span>
        )}
        <span style={{
          background: 'var(--raised)', border: '1px solid var(--border2)',
          color: 'var(--ink3)', fontSize: 11, borderRadius: 4, padding: '2px 7px',
        }}>
          {meta.formatNote}
        </span>
      </div>

      {/* Footer: ETA + render button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <span style={{
          fontSize: 11,
          color: meta.etaWarning ? 'var(--amber)' : 'var(--ink3)',
        }}>
          ⏱ {meta.eta}
        </span>

        {!isRendering && (
          <button
            onClick={handleRender}
            disabled={isStarting}
            style={{
              marginLeft: 'auto',
              background: isStarting ? 'var(--raised)' : 'var(--sage-d)',
              border: `1px solid ${isStarting ? 'var(--border2)' : 'var(--sage-b)'}`,
              color: isStarting ? 'var(--ink3)' : 'var(--sage)',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: isStarting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              whiteSpace: 'nowrap',
            }}
          >
            {isStarting ? (
              <>
                <span style={{
                  display: 'inline-block',
                  width: 10, height: 10,
                  borderRadius: '50%',
                  border: '2px solid var(--ink3)',
                  borderTopColor: 'transparent',
                  animation: 'spin 0.7s linear infinite',
                }} />
                Starting…
              </>
            ) : (
              <>Render this →</>
            )}
          </button>
        )}

        {isRendering && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink3)' }}>
            Check back in {meta.eta.replace('~', '')}
          </span>
        )}
      </div>
    </div>
  )
}

// ── VideoConceptPicker ────────────────────────────────────────────────────────

interface VideoConceptPickerProps {
  concepts: ContentAsset[]
  token: string
  onRenderStarted: (assetId: string) => void
}

export function VideoConceptPicker({ concepts, token, onRenderStarted }: VideoConceptPickerProps) {
  if (concepts.length === 0) return null

  const allRendering = concepts.every(
    (c) => c.status === 'pending' && c.render_started_at !== null
  )

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Section header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontFamily: 'Syne, sans-serif',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span>🎬</span> Video concepts
          {allRendering && (
            <span style={{
              background: 'var(--amber-d)',
              border: '1px solid var(--amber-b)',
              color: '#92400e',
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 4,
              padding: '2px 8px',
            }}>
              Rendering
            </span>
          )}
        </div>
        {!allRendering && (
          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '4px 0 0' }}>
            Claude wrote {concepts.length} video script{concepts.length !== 1 ? 's' : ''}.
            Pick the one you want rendered — video takes 2–4 min.
          </p>
        )}
        {allRendering && (
          <p style={{ fontSize: 12, color: 'var(--ink3)', margin: '4px 0 0' }}>
            Your video is rendering. Refresh this section in a few minutes to see the result.
          </p>
        )}
      </div>

      {/* Concept cards */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        {concepts.map((c) => (
          <ConceptCard
            key={c.id}
            asset={c}
            token={token}
            onRenderStarted={onRenderStarted}
          />
        ))}
      </div>

      {/* Spin keyframe — injected once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
