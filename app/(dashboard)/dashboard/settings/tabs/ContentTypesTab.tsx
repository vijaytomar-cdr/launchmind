'use client';
/**
 * @file tabs/ContentTypesTab.tsx
 * @description Settings → Content types tab. 2-column card grid per section.
 *   Each card has a toggle + sub-item chips. Required cards (WhatsApp broadcast,
 *   email) show a "Required" badge and are always on.
 *   Auto-saved (debounced 1s after last toggle).
 * @security API token fetched fresh from Supabase session on mount.
 * @dependencies api.settings.updateContentPreferences, api.products.list
 */

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  IconBrandWhatsapp, IconMail, IconTags, IconBrandLinkedin,
  IconBrandInstagram, IconDeviceMobile, IconMicrophone, IconLayoutColumns,
  IconBrandFacebook, IconRocket, IconBrandTwitter,
  IconFileAnalytics, IconQuote, IconStar,
  IconFileText, IconVideo, IconPhoto,
} from '@tabler/icons-react';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api';
import type { ContentPreferences } from '@/lib/types/content';

type IconComp = React.ComponentType<{ size?: number | string; color?: string; stroke?: number | string }>;

const SECTION_ICONS: Record<string, IconComp> = {
  text: IconFileText, video: IconVideo, visual: IconPhoto,
  community: IconBrandWhatsapp, socialProof: IconStar,
};

const CARD_ICONS: Record<string, IconComp> = {
  whatsapp: IconBrandWhatsapp, mail: IconMail, tags: IconTags, linkedin: IconBrandLinkedin,
  instagram: IconBrandInstagram, mobile: IconDeviceMobile, mic: IconMicrophone, layout: IconLayoutColumns,
  facebook: IconBrandFacebook, rocket: IconRocket, twitter: IconBrandTwitter,
  analytics: IconFileAnalytics, quote: IconQuote, star: IconStar,
};

const TOKEN_COSTS: Record<keyof ContentPreferences, Record<string, number>> = {
  text:        { whatsappBroadcast: 2, email: 3, adCopy: 2, linkedin: 2 },
  video:       { reels30s: 5, shorts60s: 5, appStorePreview: 5, whatsappVoiceNote: 3 },
  visual:      { metaImageBrief: 2, carouselBrief: 2 },
  community:   { whatsappGroupPost: 2, facebookGroupPost: 2, indieHackersPost: 2, twitterThread: 2 },
  socialProof: { caseStudy: 3, testimonialBrief: 2, reviewResponseTemplates: 2 },
};

const MAX_TOKENS_PER_WEEK = (Object.values(TOKEN_COSTS) as Record<string, number>[])
  .flatMap(s => Object.values(s))
  .reduce((a, b) => a + b, 0);

const PLAN_MONTHLY_LIMIT: Record<string, number> = {
  free: 50, solo: 300, builder: 1000, studio: 3000,
};

const DEFAULT_PREFS: ContentPreferences = {
  text:        { whatsappBroadcast: true, email: true, adCopy: true, linkedin: true },
  video:       { reels30s: false, shorts60s: false, appStorePreview: false, whatsappVoiceNote: false },
  visual:      { metaImageBrief: true, carouselBrief: true },
  community:   { whatsappGroupPost: true, facebookGroupPost: false, indieHackersPost: true, twitterThread: true },
  socialProof: { caseStudy: true, testimonialBrief: true, reviewResponseTemplates: true },
};

interface CardDef {
  key: string;
  label: string;
  desc: string;
  iconName: string;
  required?: boolean;
  subItems?: string[];
  costLabel: string;
}

interface SectionDef {
  key: keyof ContentPreferences;
  title: string;
  badge?: { text: string; color: string; bg: string };
  cards: CardDef[];
}

const SECTIONS: SectionDef[] = [
  {
    key: 'text',
    title: 'Text content',
    badge: { text: 'Always on', color: 'var(--sage)', bg: 'var(--sage-d)' },
    cards: [
      { key: 'whatsappBroadcast', label: 'WhatsApp broadcasts', desc: 'Pain-first + social proof + re-engagement', iconName: 'whatsapp', required: true, subItems: ['Pain-first', 'Social proof', 'Re-engage'], costLabel: '~5 tokens' },
      { key: 'email', label: 'Email sequences', desc: 'Day 1 welcome · Day 5 re-engage · Day 14 review', iconName: 'mail', required: true, subItems: ['Day 1', 'Day 5', 'Day 14'], costLabel: '~5 tokens' },
      { key: 'adCopy', label: 'Ad copy', desc: 'Meta headlines · Google UAC 5 variants · ASO subtitle', iconName: 'tags', subItems: ['Meta', 'Google UAC', 'ASO'], costLabel: '~8 tokens' },
      { key: 'linkedin', label: 'LinkedIn posts', desc: 'Founder story · Build-in-public data post', iconName: 'linkedin', subItems: ['Founder story', 'Data post'], costLabel: '~5 tokens' },
    ],
  },
  {
    key: 'video',
    title: 'Video content',
    badge: { text: '~$0.43 per video', color: 'var(--amber)', bg: 'var(--amber-d)' },
    cards: [
      { key: 'reels30s', label: 'Reels / Shorts', desc: '30-sec vertical video · ElevenLabs voiceover · AI visuals', iconName: 'instagram', subItems: ['30 sec', '60 sec'], costLabel: '~$0.43 · 10 tokens' },
      { key: 'appStorePreview', label: 'App Store preview', desc: '30-sec preview using real app screenshots + voiceover', iconName: 'mobile', subItems: ['App Store', 'Play Store'], costLabel: '~$0.25 · 5 tokens' },
      { key: 'whatsappVoiceNote', label: 'WhatsApp voice note', desc: '30-sec Hinglish voice note for warm network groups', iconName: 'mic', subItems: ['Hinglish', 'Hindi', 'English'], costLabel: '~$0.05 · 3 tokens' },
      { key: 'shorts60s', label: 'Visual brief (Canva)', desc: '7-slide carousel + Meta image brief for Canva', iconName: 'layout', subItems: ['Carousel', 'Meta image'], costLabel: '~3 tokens (text only)' },
    ],
  },
  {
    key: 'community',
    title: 'Community content',
    badge: { text: 'Warm network', color: 'var(--ink2)', bg: 'var(--raised)' },
    cards: [
      { key: 'whatsappGroupPost', label: 'WhatsApp group post', desc: 'Personal Hinglish message for your community groups', iconName: 'whatsapp', costLabel: '~3 tokens' },
      { key: 'facebookGroupPost', label: 'Facebook group post', desc: 'Tailored post for relevant Facebook groups', iconName: 'facebook', costLabel: '~3 tokens' },
      { key: 'indieHackersPost', label: 'IndieHackers post', desc: 'Build-in-public post using real weekly metrics', iconName: 'rocket', costLabel: '~5 tokens' },
      { key: 'twitterThread', label: 'Twitter / X thread', desc: '5–7 tweet thread with hook and payoff', iconName: 'twitter', costLabel: '~5 tokens' },
    ],
  },
  {
    key: 'socialProof',
    title: 'Social proof',
    badge: { text: 'Trust builder', color: 'var(--indigo)', bg: 'var(--indigo-d)' },
    cards: [
      { key: 'caseStudy', label: 'Case study', desc: 'Full before/after story from a user interview', iconName: 'analytics', costLabel: '~3 tokens' },
      { key: 'testimonialBrief', label: 'Testimonial card', desc: 'Design brief for a testimonial visual', iconName: 'quote', costLabel: '~2 tokens' },
      { key: 'reviewResponseTemplates', label: 'Review responses', desc: 'Personalised replies to App Store / Play Store reviews', iconName: 'star', costLabel: '~2 tokens' },
    ],
  },
];

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={e => { e.stopPropagation(); onChange(); }}
      style={{
        width: 28, height: 16, borderRadius: 9999, padding: 2, flexShrink: 0,
        cursor: 'pointer', border: 'none', marginLeft: 'auto',
        background: on ? 'var(--sage)' : 'rgba(0,0,0,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background 0.15s',
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', display: 'block' }} />
    </button>
  );
}

interface ProductWithContent {
  id: string;
  name: string;
  content_preferences: ContentPreferences | null;
}

function calcTokensPerWeek(prefs: ContentPreferences): number {
  let total = 0;
  for (const [section, items] of Object.entries(TOKEN_COSTS)) {
    const prefSection = prefs[section as keyof ContentPreferences] as Record<string, boolean>;
    for (const [key, cost] of Object.entries(items)) {
      if (prefSection[key]) total += cost;
    }
  }
  return total;
}

export function ContentTypesTab() {
  const supabase = createClient();
  const [products, setProducts] = useState<ProductWithContent[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [contentPrefs, setContentPrefs] = useState<ContentPreferences>(DEFAULT_PREFS);
  const [plan, setPlan] = useState('free');
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef('');
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      tokenRef.current = session.access_token;
      const [subRes, prodsData] = await Promise.all([
        fetch(`${apiBase}/billing/subscription`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
        api.products.list(session.access_token).catch(() => [] as ProductWithContent[]),
      ]);
      if (subRes.ok) {
        const sub = await subRes.json() as { plan: string };
        setPlan(sub.plan);
      }
      const prods = prodsData as ProductWithContent[];
      setProducts(prods);
      if (prods.length > 0) {
        setSelectedProductId(prods[0].id);
        setContentPrefs(prods[0].content_preferences ?? DEFAULT_PREFS);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProductChange(id: string) {
    setSelectedProductId(id);
    const prod = products.find(p => p.id === id);
    setContentPrefs(prod?.content_preferences ?? DEFAULT_PREFS);
    setPrefsSaved(false);
  }

  function togglePref(section: keyof ContentPreferences, key: string) {
    if (!selectedProductId) return;
    const sectionPrefs = contentPrefs[section] as Record<string, boolean>;
    const updated: ContentPreferences = {
      ...contentPrefs,
      [section]: { ...sectionPrefs, [key]: !sectionPrefs[key] },
    };
    setContentPrefs(updated);
    scheduleSave(updated);
  }

  function updateVisualSetting(key: 'logoUrl' | 'imageStyle', value: string) {
    if (!selectedProductId) return;
    const updated: ContentPreferences = {
      ...contentPrefs,
      visual: { ...contentPrefs.visual, [key]: value },
    };
    setContentPrefs(updated);
    scheduleSave(updated);
  }

  function scheduleSave(updated: ContentPreferences) {
    setPrefsSaved(false);
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(async () => {
      if (!tokenRef.current) return;
      setPrefsSaving(true);
      try {
        await api.settings.updateContentPreferences(selectedProductId, updated, tokenRef.current);
        setPrefsSaved(true);
        setProducts(prev => prev.map(p => p.id === selectedProductId ? { ...p, content_preferences: updated } : p));
      } catch { /* silent */ }
      finally { setPrefsSaving(false); }
    }, 1000);
  }

  const tokensPerWeek = calcTokensPerWeek(contentPrefs);
  const barPct = Math.min((tokensPerWeek / MAX_TOKENS_PER_WEEK) * 100, 100);
  const planLimit = PLAN_MONTHLY_LIMIT[plan] ?? 300;

  return (
    <div className="space-y-5">
      {/* Product selector */}
      {products.length > 1 && (
        <div>
          <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            Apply to product
          </label>
          <select
            value={selectedProductId}
            onChange={e => handleProductChange(e.target.value)}
            style={{ background: 'var(--raised)', border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: 'var(--ink)', outline: 'none', cursor: 'pointer', minWidth: 220 }}
          >
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      {products.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--ink3)' }}>
          No products yet.{' '}
          <Link href="/dashboard/products/new" style={{ color: 'var(--sage)' }}>Add your first app →</Link>
        </p>
      )}

      {/* Token preview bar */}
      <div style={{ background: 'var(--raised)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }} data-token-cost={tokensPerWeek}>
        <div style={{ fontSize: 11, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>Weekly token cost:</div>
        <div style={{ flex: 1, height: 6, background: 'var(--surface)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${barPct}%`, borderRadius: 99, background: barPct > 75 ? 'var(--amber)' : 'var(--sage)', transition: 'width 0.3s ease' }} />
        </div>
        <div style={{ fontSize: 11, color: barPct > 75 ? 'var(--amber)' : 'var(--ink2)', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{tokensPerWeek} tokens / week</div>
        <div style={{ fontSize: 10, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>Plan: {planLimit.toLocaleString()}/mo</div>
      </div>

      {/* Content type sections */}
      {SECTIONS.map(section => {
        const SectionIcon = SECTION_ICONS[section.key];
        return (
          <div key={section.key}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              {SectionIcon && <SectionIcon size={13} color="var(--ink2)" stroke={1.75} />}
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{section.title}</span>
              {section.badge && (
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 99, background: section.badge.bg, color: section.badge.color, fontWeight: 500 }}>
                  {section.badge.text}
                </span>
              )}
            </div>

            {/* 2-column card grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              {section.cards.map(card => {
                const sectionPrefs = contentPrefs[section.key] as Record<string, boolean>;
                const isOn = sectionPrefs[card.key] ?? false;
                const CardIcon = CARD_ICONS[card.iconName];
                return (
                  <div
                    key={card.key}
                    style={{
                      background: isOn ? 'rgba(5,150,105,0.04)' : 'var(--surface)',
                      border: `1.5px solid ${isOn ? 'rgba(5,150,105,0.30)' : 'var(--border)'}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      position: 'relative',
                      transition: 'all 0.15s',
                      cursor: card.required ? 'default' : 'pointer',
                    }}
                    onClick={() => !card.required && togglePref(section.key, card.key)}
                  >
                    {/* Required badge */}
                    {card.required && (
                      <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 8, padding: '1px 5px', borderRadius: 99, background: 'var(--sage-d)', color: 'var(--sage)', border: '0.5px solid var(--sage-b)', fontWeight: 500 }}>
                        Required
                      </div>
                    )}

                    {/* Card header: icon + name + toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        background: isOn ? 'rgba(5,150,105,0.12)' : 'var(--raised)',
                        color: isOn ? 'var(--sage)' : 'var(--ink3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                      }}>
                        {CardIcon && <CardIcon size={13} color={isOn ? 'var(--sage)' : 'var(--ink3)'} stroke={1.75} />}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)', flex: 1, paddingRight: card.required ? 40 : 0 }}>{card.label}</span>
                      {!card.required && (
                        <Toggle on={isOn} onChange={() => togglePref(section.key, card.key)} />
                      )}
                    </div>

                    {/* Description */}
                    <div style={{ fontSize: 10, color: 'var(--ink2)', lineHeight: 1.45, marginBottom: 5 }}>{card.desc}</div>

                    {/* Sub-item chips */}
                    {card.subItems && card.subItems.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
                        {card.subItems.map(sub => (
                          <span key={sub} style={{
                            fontSize: 9, padding: '2px 6px', borderRadius: 99,
                            background: isOn ? 'rgba(5,150,105,0.10)' : 'var(--raised)',
                            color: isOn ? 'var(--sage)' : 'var(--ink3)',
                          }}>
                            {sub}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Cost */}
                    <div style={{ fontSize: 9, color: 'var(--amber)', marginTop: 2 }}>{card.costLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Visual generation settings */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <IconPhoto size={13} color="var(--ink2)" stroke={1.75} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>Visual generation settings</span>
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 99, background: 'var(--indigo-d)', color: 'var(--indigo)', fontWeight: 500 }}>
            Flux.1 Schnell
          </span>
        </div>

        {/* Default image style */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink2)', display: 'block', marginBottom: 5 }}>
            Default style
          </label>
          <div style={{ display: 'flex', gap: 5 }}>
            {(['photorealistic', 'graphic', 'mockup'] as const).map(s => {
              const active = (contentPrefs.visual?.imageStyle ?? 'photorealistic') === s;
              return (
                <button
                  key={s}
                  onClick={() => updateVisualSetting('imageStyle', s)}
                  disabled={!selectedProductId}
                  style={{
                    padding: '5px 11px', borderRadius: 99, fontSize: 10, cursor: selectedProductId ? 'pointer' : 'not-allowed',
                    border: active ? '0.5px solid var(--indigo-b)' : '0.5px solid var(--border)',
                    background: active ? 'var(--indigo-d)' : 'var(--raised)',
                    color: active ? 'var(--indigo)' : 'var(--ink3)',
                    fontFamily: 'inherit', fontWeight: active ? 500 : 400,
                  }}
                >
                  {s === 'photorealistic' ? '📷 Photorealistic' : s === 'graphic' ? '🎨 Graphic design' : '📱 App mockup'}
                </button>
              );
            })}
          </div>
        </div>

        {/* App logo URL */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink2)', display: 'block', marginBottom: 4 }}>
            App logo URL <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(optional — composited bottom-right on every image)</span>
          </label>
          <input
            type="url"
            value={contentPrefs.visual?.logoUrl ?? ''}
            onChange={e => updateVisualSetting('logoUrl', e.target.value)}
            placeholder="https://example.com/logo.png"
            disabled={!selectedProductId}
            style={{
              width: '100%', padding: '7px 10px',
              background: 'var(--raised)', border: '1px solid var(--border2)',
              borderRadius: 6, fontSize: 11, color: 'var(--ink)',
              outline: 'none', boxSizing: 'border-box' as const,
              fontFamily: 'inherit',
            }}
          />
          <p style={{ fontSize: 9, color: 'var(--ink3)', marginTop: 3, marginBottom: 0 }}>
            Direct link to a PNG/SVG logo with transparent background. Usually from your App Store listing or CDN.
          </p>
        </div>
      </div>

      {/* Save state indicator */}
      <div style={{ minHeight: 20 }}>
        {prefsSaving && <p style={{ fontSize: 11, color: 'var(--ink3)' }}>Saving…</p>}
        {!prefsSaving && prefsSaved && <p style={{ fontSize: 11, color: 'var(--sage)' }}>Preferences saved ✓</p>}
        {!prefsSaving && !prefsSaved && products.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--ink3)' }}>Saved automatically</p>
        )}
      </div>
    </div>
  );
}
