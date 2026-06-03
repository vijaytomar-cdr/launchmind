/**
 * @file lib/types/content.ts
 * @description TypeScript types for content assets, preferences, and approval flow.
 */

export type AssetStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved' | 'held'
export type ApprovalMode = 'manual' | 'one_tap' | 'auto'

export type AssetType =
  | 'whatsapp_broadcast' | 'whatsapp_voice_note'
  | 'meta_headline' | 'meta_body' | 'meta_image_brief'
  | 'google_uac_variants' | 'aso_subtitle' | 'aso_description' | 'aso_keywords'
  | 'email_day1' | 'email_day5' | 'email_day14'
  | 'linkedin_founder_story' | 'linkedin_data_post'
  | 'video_reels_30s' | 'video_shorts_60s' | 'video_app_preview'
  | 'carousel_brief' | 'community_whatsapp_group' | 'community_facebook'
  | 'community_indiehackers' | 'community_twitter_thread'
  | 'social_proof_case_study' | 'social_proof_testimonial'
  | 'social_proof_review_response' | 'social_proof_producthunt'

// Snake_case to match the Fastify API response (DB column names)
export interface ContentAsset {
  id: string
  product_id: string
  brief_id: string | null
  asset_type: AssetType
  channel: string
  market: string
  language: string
  text_content: string | null
  structured_data: Record<string, unknown> | null
  media_url: string | null
  media_type: 'mp4' | 'mp3' | 'jpg' | 'png' | null
  duration_seconds: number | null
  thumbnail_url: string | null
  quality_score: number | null
  quality_flags: Record<string, boolean> | null
  hook_angle: string | null
  generation_week: number
  status: AssetStatus
  auto_approved: boolean
  approved_at: string | null
  regen_count: number
  regen_reasons: Array<{ reason: string; note?: string; timestamp: string }> | null
  installs: number | null
  impressions: number | null
  cpi: number | null
  created_at: string
  updated_at: string
}

export interface ContentPreferences {
  text: {
    whatsappBroadcast: boolean
    email: boolean
    adCopy: boolean
    linkedin: boolean
  }
  video: {
    reels30s: boolean
    shorts60s: boolean
    appStorePreview: boolean
    whatsappVoiceNote: boolean
  }
  visual: {
    metaImageBrief: boolean
    carouselBrief: boolean
  }
  community: {
    whatsappGroupPost: boolean
    facebookGroupPost: boolean
    indieHackersPost: boolean
    twitterThread: boolean
  }
  socialProof: {
    caseStudy: boolean
    testimonialBrief: boolean
    reviewResponseTemplates: boolean
  }
}

export const REGEN_REASONS = [
  'Tone is off',
  'Wrong hook angle',
  'Too salesy',
  'Too long',
  'Not my voice',
  'Try different angle',
  'Competitor mentioned wrong',
  'Wrong language style',
]

export const VIDEO_REGEN_REASONS = [
  'Voice tone wrong',
  'Script too generic',
  'Hook not strong enough',
  'Try Hinglish instead',
  'Show app UI more',
  'Different opening scene',
  'Too fast / too slow',
]

export interface AssetMeta {
  label: string
  iconName: string
  color: string
  channel: string
}

export const ASSET_META: Record<AssetType, AssetMeta> = {
  whatsapp_broadcast:           { label: 'WhatsApp broadcast',       iconName: 'whatsapp',  color: '#059669', channel: 'WhatsApp' },
  whatsapp_voice_note:          { label: 'WhatsApp voice note',       iconName: 'mic',       color: '#059669', channel: 'WhatsApp' },
  meta_headline:                { label: 'Meta headline A/B',         iconName: 'facebook',  color: '#4f46e5', channel: 'Meta' },
  meta_body:                    { label: 'Meta ad body',              iconName: 'facebook',  color: '#4f46e5', channel: 'Meta' },
  meta_image_brief:             { label: 'Meta image brief',          iconName: 'photo',     color: '#4f46e5', channel: 'Meta' },
  google_uac_variants:          { label: 'Google UAC variants',       iconName: 'google',    color: '#4f46e5', channel: 'Google' },
  aso_subtitle:                 { label: 'ASO subtitle',              iconName: 'mobile',    color: '#059669', channel: 'ASO' },
  aso_description:              { label: 'ASO description',           iconName: 'filetext',  color: '#059669', channel: 'ASO' },
  aso_keywords:                 { label: 'ASO keywords',              iconName: 'tags',      color: '#059669', channel: 'ASO' },
  email_day1:                   { label: 'Email — Day 1',             iconName: 'mail',      color: '#4f46e5', channel: 'Email' },
  email_day5:                   { label: 'Email — Day 5',             iconName: 'mail',      color: '#4f46e5', channel: 'Email' },
  email_day14:                  { label: 'Email — Day 14',            iconName: 'mail',      color: '#4f46e5', channel: 'Email' },
  linkedin_founder_story:       { label: 'LinkedIn — Founder story',  iconName: 'linkedin',  color: '#4f46e5', channel: 'LinkedIn' },
  linkedin_data_post:           { label: 'LinkedIn — Data post',      iconName: 'chart',     color: '#4f46e5', channel: 'LinkedIn' },
  video_reels_30s:              { label: 'Reels / Shorts 30s',        iconName: 'video',     color: '#dc2626', channel: 'Video' },
  video_shorts_60s:             { label: 'YouTube Shorts 60s',        iconName: 'video',     color: '#dc2626', channel: 'Video' },
  video_app_preview:            { label: 'App Store preview',         iconName: 'mobile',    color: '#4f46e5', channel: 'Video' },
  carousel_brief:               { label: 'Carousel brief',            iconName: 'layout',    color: '#4f46e5', channel: 'Visual' },
  community_whatsapp_group:     { label: 'WhatsApp group post',       iconName: 'whatsapp',  color: '#059669', channel: 'Community' },
  community_facebook:           { label: 'Facebook group post',       iconName: 'facebook',  color: '#4f46e5', channel: 'Community' },
  community_indiehackers:       { label: 'IndieHackers post',         iconName: 'rocket',    color: '#d97706', channel: 'Community' },
  community_twitter_thread:     { label: 'Twitter/X thread',          iconName: 'twitter',   color: '#626880', channel: 'Community' },
  social_proof_case_study:      { label: 'Case study',                iconName: 'analytics', color: '#059669', channel: 'Social Proof' },
  social_proof_testimonial:     { label: 'Testimonial card',          iconName: 'quote',     color: '#059669', channel: 'Social Proof' },
  social_proof_review_response: { label: 'Review responses',          iconName: 'star',      color: '#d97706', channel: 'Social Proof' },
  social_proof_producthunt:     { label: 'Product Hunt comment',      iconName: 'rocket',    color: '#d97706', channel: 'Social Proof' },
}

/** Groups assets by their channel for display in the right column. */
export const CHANNEL_ORDER = ['WhatsApp', 'Meta', 'Google', 'ASO', 'Email', 'LinkedIn', 'Video', 'Visual', 'Community', 'Social Proof']

export function groupAssetsByChannel(assets: ContentAsset[]): Record<string, ContentAsset[]> {
  const groups: Record<string, ContentAsset[]> = {}
  for (const asset of assets) {
    const meta = ASSET_META[asset.asset_type]
    if (!meta) continue
    const ch = meta.channel
    if (!groups[ch]) groups[ch] = []
    groups[ch].push(asset)
  }
  return groups
}
