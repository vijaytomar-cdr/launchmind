/**
 * @file page.tsx
 * @description Onboarding — "Did I understand your business correctly?"
 *
 *   REPLACES A BLANK STRATEGY FORM. This screen used to render three empty
 *   textareas for positioning, value and customer problem. It had prefill code
 *   and a "✦ suggestion" badge, but they read claim categories that were never
 *   generated and that the database CHECK constraint forbade — so the prefill
 *   silently resolved to empty every time and the owner was asked to write
 *   marketing strategy from nothing. That contradicts the product promise:
 *   LaunchMind does the research; the owner provides the truth only they know.
 *
 *   The owner now REACTS to LaunchMind's understanding. Each card carries a
 *   suggestion drawn from verified public evidence, and the owner confirms,
 *   corrects, or marks it not applicable.
 *
 *   AUTHORITY COMES FROM AN EXPLICIT ACTION, NEVER FROM DISPLAY. A suggestion
 *   rendered on screen — or merely scrolled past — is not a confirmation. Every
 *   one of the three founder-authoritative cards requires a deliberate click,
 *   and `confirmedFields` is built from those actions alone. There is no
 *   "confirm everything" button, because viewport visibility is not proof that
 *   a founder read and agreed with a claim about their own business.
 *
 *   OBSERVED PRESENCE IS NOT MARKETING. The App Store / Play / website listings
 *   LaunchMind found are shown as verified presence, separately from the
 *   channels the owner says they actively use to acquire customers. Having a
 *   store listing is a precondition for distribution, not a channel the founder
 *   chose to invest in, and the two must never be recorded as the same thing.
 *
 * @security Sends no authority claim. Suggestion text is rendered as text, never
 *   as markup. The server independently strips confirmations the owner did not
 *   make, so a tampered payload cannot manufacture founder authority.
 * @dependencies api.onboarding.getAlignment, api.onboarding.savePositioning
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, type AlignmentUnderstanding, type AlignmentSuggestionCard } from '@/lib/api';
import { trackOnboarding } from '@/lib/analytics';

type MarketType = 'country' | 'region' | 'metro';
interface Market { type: MarketType; value: string; label: string }

/** Owner-facing prompt per card. The question, not the field name. */
const CARD_COPY: Record<string, { kicker: string; question: string; ask: string }> = {
  positioning: {
    kicker: 'Positioning',
    question: 'How customers should think about your product',
    ask: 'How would you describe the way customers should think about your product?',
  },
  value_prop: {
    kicker: 'Value',
    question: 'Why customers choose you',
    ask: 'Why do customers choose you over the alternatives?',
  },
  problem: {
    kicker: 'Customer problem',
    question: 'What customers are hiring you to solve',
    ask: 'What problem are customers hiring your product to solve?',
  },
};

const CARD_ORDER = ['positioning', 'value_prop', 'problem'] as const;

/** Channels the owner may claim as ACTIVE acquisition. Store listings are absent
 *  on purpose: those are observed presence, surfaced separately. */
const ACTIVE_CHANNELS: Array<{ id: string; label: string }> = [
  { id: 'google_search', label: 'Google Search / SEO' },
  { id: 'google_ads',    label: 'Google Ads' },
  { id: 'meta',          label: 'Meta Ads' },
  { id: 'instagram',     label: 'Instagram' },
  { id: 'facebook',      label: 'Facebook' },
  { id: 'linkedin',      label: 'LinkedIn' },
  { id: 'email',         label: 'Email' },
  { id: 'referrals',     label: 'Referrals' },
  { id: 'partnerships',  label: 'Partnerships' },
];

type CardState = 'UNREVIEWED' | 'CONFIRMED' | 'CORRECTED' | 'REJECTED';

export default function AlignmentPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<AlignmentUnderstanding | null>(null);

  /** Owner decision per card. The ONLY source of founder authority here. */
  const [decisions, setDecisions] = useState<Record<string, CardState>>({});
  /** Final text per card — LaunchMind's, or the owner's correction. */
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showWhy, setShowWhy] = useState<string | null>(null);

  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketConfirmed, setMarketConfirmed] = useState(false);
  const [editingMarkets, setEditingMarkets] = useState(false);
  const [marketDraft, setMarketDraft] = useState('');
  const [marketType, setMarketType] = useState<MarketType>('country');

  const [activeChannels, setActiveChannels] = useState<Record<string, 'using' | 'planning'>>({});
  const [nothingYet, setNothingYet] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login?next=/onboarding/positioning'); return; }
    const sid = sessionStorage.getItem('onboarding_session_id') ?? '';
    if (!sid) { router.replace('/onboarding'); return; }
    setSessionId(sid);

    try {
      const r = await api.onboarding.getAlignment(sid, session.access_token);
      setData(r);

      // Seed from what the owner has ALREADY decided, so a resumed session shows
      // their own words rather than re-proposing something they corrected.
      const d: Record<string, CardState> = {};
      const v: Record<string, string> = {};
      for (const s of r.suggestions) {
        d[s.category] = s.status;
        v[s.category] = s.body;
      }
      setDecisions(d);
      setValues(v);

      // Geography seed. A corrected market claim is owner truth, so it arrives
      // pre-filled — but still unconfirmed until the owner says so here.
      if (r.marketSeed && markets.length === 0) {
        const labels = r.marketSeed.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
        setMarkets(labels.map(label => ({
          type: 'country' as MarketType,
          value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
          label,
        })));
      }
      trackOnboarding('alignment_suggestions_ready', {
        cards: r.suggestions.length,
        unavailable: r.unavailable.length,
        partial: r.partial.failed.length > 0,
      });
    } catch (e) {
      setLoadError((e as Error).message ?? 'Could not load');
    } finally {
      setLoading(false);
    }
    // markets intentionally excluded: seeding must not re-run and clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => { load(); }, [load]);

  function decide(category: string, state: CardState, text?: string) {
    setDecisions(prev => ({ ...prev, [category]: state }));
    if (text !== undefined) setValues(prev => ({ ...prev, [category]: text }));
    setEditing(null);
    trackOnboarding(
      (state === 'CONFIRMED' ? 'alignment_suggestion_confirmed'
        : state === 'CORRECTED' ? 'alignment_suggestion_edited'
        : 'alignment_suggestion_rejected'),
      { category },   // never the text itself
    );
  }

  function addMarket() {
    const label = marketDraft.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (markets.some(m => m.value === value && m.type === marketType)) return;
    setMarkets([...markets, { type: marketType, value, label }]);
    setMarketDraft('');
    setMarketConfirmed(true);
    trackOnboarding('alignment_market_edited', { count: markets.length + 1 });
  }

  function toggleChannel(id: string) {
    setActiveChannels(prev => {
      const next = { ...prev };
      if (next[id] === 'using') next[id] = 'planning';
      else if (next[id] === 'planning') delete next[id];
      else next[id] = 'using';
      return next;
    });
    setNothingYet(false);
    trackOnboarding('alignment_channel_added', { channel: id });
  }

  // EVERY founder-authoritative card needs an explicit decision. A card with no
  // defensible suggestion is satisfied by the owner answering the question.
  const cards = CARD_ORDER.filter(
    c => data?.suggestions.some(s => s.category === c) || data?.unavailable.includes(c));
  const allDecided = cards.every(c => {
    const st = decisions[c];
    if (st === 'REJECTED') return true;
    return (st === 'CONFIRMED' || st === 'CORRECTED') && (values[c] ?? '').trim().length >= 10;
  });
  const marketsReady = markets.length > 0 && marketConfirmed;
  const ready = allDecided && marketsReady && !saving;

  async function handleContinue() {
    if (!ready) return;
    setSaving(true);
    setSaveError('');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }

    // Observed presence is sent with status 'observed' so the server records it
    // as detection, not as marketing the owner claims to do.
    const observed = (data?.observedChannels ?? [])
      .map(c => ({ channel: c.channel, status: 'observed' as const }));
    const owner = nothingYet
      ? [{ channel: 'none_yet', status: 'using' as const }]
      : Object.entries(activeChannels).map(([channel, status]) => ({ channel, status }));

    // Only cards the owner actually acted on. A REJECTED card contributes no
    // founder-authoritative value, so it is not listed as confirmed.
    const confirmedFields: string[] = [];
    if (decisions.positioning === 'CONFIRMED' || decisions.positioning === 'CORRECTED') confirmedFields.push('positioning');
    if (decisions.value_prop === 'CONFIRMED' || decisions.value_prop === 'CORRECTED') confirmedFields.push('valueProposition');
    if (decisions.problem === 'CONFIRMED' || decisions.problem === 'CORRECTED') confirmedFields.push('primaryCustomerProblem');
    if (marketConfirmed) confirmedFields.push('markets');
    if (nothingYet || Object.keys(activeChannels).length > 0) confirmedFields.push('currentChannels');

    const fallback = (c: string) => (values[c] ?? '').trim() || 'Not applicable to this product.';

    try {
      await api.onboarding.savePositioning(sessionId, {
        positioning:            fallback('positioning'),
        valueProposition:       fallback('value_prop'),
        primaryCustomerProblem: fallback('problem'),
        markets,
        currentChannels: [...observed, ...owner],
        confirmedFields,
      }, session.access_token);
      trackOnboarding('alignment_completed', {
        confirmed: confirmedFields.length,
        activeChannels: Object.keys(activeChannels).length,
      });
      router.push('/onboarding/context-delta');
    } catch (e) {
      setSaveError((e as Error).message ?? String(e));
      setSaving(false);
    }
  }

  // ── styles (existing design system — tokens only, no new palette) ──────────
  const kicker: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, letterSpacing: '.13em',
    textTransform: 'uppercase', color: 'var(--sage)', marginBottom: 10,
  };
  const card: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 14, padding: 16,
    background: 'var(--surface)', marginBottom: 12,
  };
  const badge = (bg: string, fg: string, bd: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
    borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: '.04em',
    background: bg, color: fg, border: `1px solid ${bd}`, whiteSpace: 'nowrap',
  });
  const btn: React.CSSProperties = {
    height: 34, padding: '0 13px', borderRadius: 10, fontSize: 12, fontWeight: 700,
    border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)', cursor: 'pointer',
  };
  const btnPrimary: React.CSSProperties = {
    ...btn, background: 'var(--sage-d)', borderColor: 'var(--sage-b)', color: 'var(--sage)',
  };
  const textarea: React.CSSProperties = {
    width: '100%', borderRadius: 9, border: '1px solid var(--border2)',
    background: '#fff', color: 'var(--ink)', padding: '10px 12px',
    fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5, minHeight: 92,
  };

  // ── state 1 · loading ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        <div style={kicker}>Check my understanding</div>
        <h1 style={{ fontFamily: 'var(--font-syne)', fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
          Reviewing what I found…
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 18 }}>
          Reading your product listings and website to form an understanding of your business.
        </p>
        {['Product sources located', 'Customer signals reviewed', 'Understanding drafted'].map(s => (
          <div key={s} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden style={{
              width: 14, height: 14, borderRadius: 999, border: '2px solid var(--border2)',
              borderTopColor: 'var(--sage)', display: 'inline-block',
              animation: 'lm-spin .9s linear infinite',
            }} />
            <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{s}</span>
          </div>
        ))}
        <style>{`@keyframes lm-spin{to{transform:rotate(360deg)}}
          @media (prefers-reduced-motion: reduce){*{animation:none!important}}`}</style>
      </div>
    );
  }

  // ── state 10 · retry ──────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div>
        <div style={kicker}>Alignment</div>
        <h1 style={{ fontFamily: 'var(--font-syne)', fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          I couldn&apos;t load my understanding
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 16 }}>{loadError}</p>
        <button type="button" style={btnPrimary} onClick={load}>Try again</button>
      </div>
    );
  }

  return (
    <div>
      <div style={kicker}>Check my understanding</div>
      <h1 style={{ fontFamily: 'var(--font-syne)', fontSize: 28, fontWeight: 700, lineHeight: 1.2, marginBottom: 8 }}>
        Did I understand your business correctly?
      </h1>
      <p style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 6, lineHeight: 1.6 }}>
        I reviewed {data?.sources.length ? data.sources.join(', ') : 'your product sources'}.
        Confirm what&apos;s right and change anything only you would know.
      </p>

      {/* ── state 8 · partial discovery (§19) ────────────────────────────── */}
      {data && data.partial.failed.length > 0 && (
        <div role="status" style={{
          ...card, background: 'var(--amber2)', borderColor: '#f2d29f', color: '#7d4306', fontSize: 13,
        }}>
          I couldn&apos;t read {data.partial.failed.join(' and ')}, so this understanding is based
          only on the sources I could verify.
        </div>
      )}

      {/* ── the three founder-authoritative cards ────────────────────────── */}
      {CARD_ORDER.map(cat => {
        const s: AlignmentSuggestionCard | undefined = data?.suggestions.find(x => x.category === cat);
        const unavailable = !s && data?.unavailable.includes(cat);
        if (!s && !unavailable) return null;
        const copy = CARD_COPY[cat];
        const state = decisions[cat] ?? 'UNREVIEWED';
        const text  = values[cat] ?? '';
        const isEditing = editing === cat;

        return (
          <section key={cat} style={{
            ...card,
            borderColor: state === 'CONFIRMED' || state === 'CORRECTED' ? 'var(--sage-b)'
              : state === 'REJECTED' ? 'var(--border2)' : 'var(--border)',
            background: state === 'REJECTED' ? 'var(--raised)' : 'var(--surface)',
          }} aria-labelledby={`h-${cat}`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <h2 id={`h-${cat}`} style={{ fontSize: 13, fontWeight: 800, margin: 0 }}>{copy.kicker}</h2>
              {/* Status is a WORD, never colour alone. */}
              {state === 'UNREVIEWED' && !unavailable && (
                <span style={badge('var(--violet2)', 'var(--violet)', '#d7d0ff')}>✦ suggestion — not yet confirmed</span>
              )}
              {state === 'CONFIRMED' && <span style={badge('var(--sage-d)', 'var(--sage)', 'var(--sage-b)')}>✓ confirmed by you</span>}
              {state === 'CORRECTED' && <span style={badge('var(--sage-d)', 'var(--sage)', 'var(--sage-b)')}>✓ your correction</span>}
              {state === 'REJECTED' && <span style={badge('var(--raised)', 'var(--ink3)', 'var(--border2)')}>✕ not applicable</span>}
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '0 0 10px' }}>{copy.question}</p>

            {/* ── state 6 · insufficient evidence (§20) ─────────────────── */}
            {unavailable && !isEditing && state === 'UNREVIEWED' && (
              <>
                <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.6, marginBottom: 10 }}>
                  I&apos;m not confident enough to suggest this from your public product
                  information. {copy.ask}
                </p>
                <button type="button" style={btnPrimary}
                  onClick={() => { setEditing(cat); setDraft(''); }}>
                  Answer this
                </button>
              </>
            )}

            {/* ── states 2/3/5 · suggestion, confirmed, corrected ───────── */}
            {!isEditing && (s || state !== 'UNREVIEWED') && !(unavailable && state === 'UNREVIEWED') && (
              <>
                <p style={{
                  fontSize: 14, color: state === 'REJECTED' ? 'var(--ink3)' : 'var(--ink)',
                  lineHeight: 1.6, marginBottom: 10,
                  textDecoration: state === 'REJECTED' ? 'line-through' : 'none',
                }}>{text}</p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {state !== 'CONFIRMED' && state !== 'CORRECTED' && (
                    <button type="button" style={btnPrimary} onClick={() => decide(cat, 'CONFIRMED')}>
                      That&apos;s right
                    </button>
                  )}
                  <button type="button" style={btn}
                    onClick={() => { setEditing(cat); setDraft(text); }}>
                    Edit
                  </button>
                  {state !== 'REJECTED' && (
                    <button type="button" style={btn} onClick={() => decide(cat, 'REJECTED')}>
                      Not applicable
                    </button>
                  )}
                  {/* §6 · provenance, not model debugging */}
                  {s && s.sources.length > 0 && (
                    <button type="button" style={{ ...btn, border: 'none', background: 'none', color: 'var(--ink3)' }}
                      aria-expanded={showWhy === cat}
                      onClick={() => setShowWhy(showWhy === cat ? null : cat)}>
                      Why I think this
                    </button>
                  )}
                </div>

                {showWhy === cat && s && (
                  <div style={{
                    marginTop: 10, padding: 10, borderRadius: 10,
                    background: 'var(--raised)', border: '1px solid var(--border)',
                    fontSize: 12, color: 'var(--ink2)',
                  }}>
                    Based on: {s.sources.join(' · ')}
                  </div>
                )}
              </>
            )}

            {/* ── state 4 · editing ─────────────────────────────────────── */}
            {isEditing && (
              <>
                <label htmlFor={`ta-${cat}`} style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink2)', display: 'block', marginBottom: 6 }}>
                  {copy.ask}
                </label>
                <textarea id={`ta-${cat}`} style={textarea} value={draft} autoFocus
                  onChange={e => setDraft(e.target.value)}
                  aria-describedby={`hint-${cat}`} />
                <p id={`hint-${cat}`} style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 5 }}>
                  At least 10 characters. Your wording replaces mine.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" style={{ ...btnPrimary, opacity: draft.trim().length >= 10 ? 1 : .5 }}
                    disabled={draft.trim().length < 10}
                    onClick={() => decide(cat, 'CORRECTED', draft.trim())}>
                    Save correction
                  </button>
                  <button type="button" style={btn} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </>
            )}
          </section>
        );
      })}

      {/* ── geography ──────────────────────────────────────────────────── */}
      <section style={card} aria-labelledby="h-market">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <h2 id="h-market" style={{ fontSize: 13, fontWeight: 800, margin: 0 }}>Where you operate</h2>
          {marketConfirmed
            ? <span style={badge('var(--sage-d)', 'var(--sage)', 'var(--sage-b)')}>✓ confirmed by you</span>
            : markets.length > 0
              ? <span style={badge('var(--violet2)', 'var(--violet)', '#d7d0ff')}>✦ suggestion — not yet confirmed</span>
              : null}
        </div>

        {markets.length > 0 && !editingMarkets ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 10px' }}>
              {markets.map(m => (
                <span key={`${m.type}:${m.value}`} style={badge('var(--raised)', 'var(--ink)', 'var(--border2)')}>
                  {m.label}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {!marketConfirmed && (
                <button type="button" style={btnPrimary}
                  onClick={() => { setMarketConfirmed(true); trackOnboarding('alignment_market_confirmed', { count: markets.length }); }}>
                  Yes, that&apos;s right
                </button>
              )}
              <button type="button" style={btn} onClick={() => setEditingMarkets(true)}>Edit markets</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 10, lineHeight: 1.6 }}>
              Where can customers currently use your product? Add each market — a metro,
              a region or a country. I won&apos;t assume a country you haven&apos;t told me.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {markets.map(m => (
                <button key={`${m.type}:${m.value}`} type="button"
                  style={{ ...badge('var(--raised)', 'var(--ink)', 'var(--border2)'), cursor: 'pointer' }}
                  aria-label={`Remove ${m.label}`}
                  onClick={() => setMarkets(markets.filter(x => !(x.value === m.value && x.type === m.type)))}>
                  {m.label} ✕
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <label htmlFor="mtype" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Market type
              </label>
              <select id="mtype" value={marketType} style={{ ...btn, width: 108 }}
                onChange={e => setMarketType(e.target.value as MarketType)}>
                <option value="country">Country</option>
                <option value="region">Region</option>
                <option value="metro">Metro</option>
              </select>
              <label htmlFor="mval" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Market name
              </label>
              <input id="mval" value={marketDraft} placeholder="e.g. Phoenix metro, Arizona, India"
                style={{ ...btn, flex: '1 1 180px', minWidth: 0, textAlign: 'left', fontWeight: 400 }}
                onChange={e => setMarketDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMarket(); } }} />
              <button type="button" style={btn} onClick={addMarket}>Add</button>
              {markets.length > 0 && (
                <button type="button" style={btnPrimary}
                  onClick={() => { setEditingMarkets(false); setMarketConfirmed(true); trackOnboarding('alignment_market_confirmed', { count: markets.length }); }}>
                  Done
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── observed presence · NOT marketing ───────────────────────────── */}
      {data && data.observedChannels.length > 0 && (
        <section style={{ ...card, background: 'var(--raised)' }} aria-labelledby="h-found">
          <h2 id="h-found" style={{ fontSize: 13, fontWeight: 800, margin: '0 0 4px' }}>Found by LaunchMind</h2>
          <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '0 0 10px' }}>
            Public presence I verified. This isn&apos;t marketing you told me you do — just where
            your product can be found.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.observedChannels.map(c => (
              <span key={c.channel} style={badge('var(--surface)', 'var(--ink2)', 'var(--border2)')}>
                ✓ {c.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── owner-confirmed active marketing ────────────────────────────── */}
      <section style={card} aria-labelledby="h-active">
        <h2 id="h-active" style={{ fontSize: 13, fontWeight: 800, margin: '0 0 4px' }}>
          What are you actively using to acquire customers?
        </h2>
        <p style={{ fontSize: 11, color: 'var(--ink3)', margin: '0 0 10px' }}>
          Only what you&apos;re actually investing in. Tap once for using, twice for planning.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-labelledby="h-active">
          {ACTIVE_CHANNELS.map(c => {
            const st = activeChannels[c.id];
            return (
              <button key={c.id} type="button" aria-pressed={Boolean(st)}
                style={{
                  ...badge(
                    st === 'using' ? 'var(--sage-d)' : st === 'planning' ? 'var(--amber-d)' : 'var(--surface)',
                    st === 'using' ? 'var(--sage)' : st === 'planning' ? 'var(--amber)' : 'var(--ink2)',
                    st === 'using' ? 'var(--sage-b)' : st === 'planning' ? 'var(--amber-b)' : 'var(--border2)'),
                  cursor: 'pointer', padding: '6px 11px', fontSize: 11,
                }}
                onClick={() => toggleChannel(c.id)}>
                {st === 'using' ? '✓ ' : st === 'planning' ? '◷ ' : ''}{c.label}
                {st === 'planning' ? ' (planning)' : ''}
              </button>
            );
          })}
          <button type="button" aria-pressed={nothingYet}
            style={{
              ...badge(nothingYet ? 'var(--sage-d)' : 'var(--surface)',
                       nothingYet ? 'var(--sage)' : 'var(--ink2)',
                       nothingYet ? 'var(--sage-b)' : 'var(--border2)'),
              cursor: 'pointer', padding: '6px 11px', fontSize: 11,
            }}
            onClick={() => { setNothingYet(!nothingYet); setActiveChannels({}); }}>
            Nothing yet
          </button>
        </div>
      </section>

      {/* ── state 9 · save error ────────────────────────────────────────── */}
      {saveError && (
        <div role="alert" style={{
          ...card, background: 'var(--danger2)', borderColor: 'var(--danger-b)', color: 'var(--danger)', fontSize: 13,
        }}>
          Couldn&apos;t save: {saveError}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        <button type="button" onClick={handleContinue} disabled={!ready}
          style={{
            height: 42, padding: '0 20px', borderRadius: 10, fontSize: 14, fontWeight: 700,
            border: '1px solid var(--sage)', cursor: ready ? 'pointer' : 'not-allowed',
            background: ready ? 'var(--sage)' : 'var(--border2)',
            color: ready ? '#fff' : 'var(--ink3)',
          }}>
          {saving ? 'Saving…' : 'Continue →'}
        </button>
        {!allDecided && (
          <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
            Review each card above — confirm, edit, or mark it not applicable.
          </span>
        )}
        {allDecided && !marketsReady && (
          <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Confirm where you operate.</span>
        )}
      </div>
    </div>
  );
}
