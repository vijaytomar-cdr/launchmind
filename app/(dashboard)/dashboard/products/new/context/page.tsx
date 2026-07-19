'use client';
/**
 * @file context/page.tsx — Step 2: Founder context (5 conversations)
 * @description 5 conversation screens grouped by theme.
 *   Chip-based selection with minimal typing. Progress bar shows 1/5 → 5/5.
 *   Auto-saves to POST /products/intake/context after each conversation.
 *   Stores merged context in sessionStorage for later steps.
 * @security productId read from sessionStorage — verified server-side on each save.
 * @dependencies lib/api, lib/types/intake, next/navigation
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { api, ApiError } from '@/lib/api';
import { IntakeSteps } from '@/components/launchmind/IntakeSteps';
import { INTAKE_STORAGE, type FounderContext } from '@/lib/types/intake';

const TOTAL_CONVS = 5;

// ── Chip helpers ──────────────────────────────────────────────────────────────

type ChipMode = 'single' | 'multi';

interface ChipGroupProps {
  options: string[];
  selected: string | string[];
  onChange: (v: string | string[]) => void;
  mode?: ChipMode;
  amber?: boolean;
  danger?: boolean;
}

function ChipGroup({ options, selected, onChange, mode = 'single', amber = false, danger = false }: ChipGroupProps) {
  const selectedArr = Array.isArray(selected) ? selected : selected ? [selected] : [];

  function toggle(opt: string) {
    if (mode === 'single') {
      onChange(opt);
    } else {
      const next = selectedArr.includes(opt)
        ? selectedArr.filter((s) => s !== opt)
        : [...selectedArr, opt];
      onChange(next);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selectedArr.includes(opt);
        let bg = 'var(--raised)', color = 'var(--ink2)', border = 'var(--border2)';
        if (active) {
          if (danger) { bg = 'var(--danger-d)'; color = 'var(--danger)'; border = 'var(--danger-b)'; }
          else if (amber) { bg = 'var(--amber-d)'; color = 'var(--amber)'; border = 'var(--amber-b)'; }
          else { bg = 'var(--sage-d)'; color = 'var(--sage)'; border = 'var(--sage-b)'; }
        }
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className="rounded-full px-3 py-1.5 font-medium transition-all text-sm"
            style={{ fontSize: 13, background: bg, color, border: `1px solid ${border}` }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function ConvRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)' }}>{label}</p>
      {hint && <p style={{ fontSize: 11, color: 'var(--ink3)' }}>{hint}</p>}
      {children}
    </div>
  );
}

// ── First-action placeholder keyed to app category ───────────────────────────

function getFirstActionPlaceholder(category?: string): string {
  const c = (category ?? '').toLowerCase();
  if (/health|fitness|wellness|sport|gym|workout/.test(c))
    return 'e.g. Log first workout · Set a fitness goal · Connect wearable';
  if (/education|learning|school|tutor|study|course/.test(c))
    return 'e.g. Enrol in first course · Set a daily goal · Complete first lesson';
  if (/finance|banking|accounting|tax|invoice|payment/.test(c))
    return 'e.g. Link a bank account · Create first invoice · Set a budget';
  if (/crm|sales|lead|pipeline/.test(c))
    return 'e.g. Add first contact · Create a deal · Book first call';
  if (/house|home|cleaning|repair|maintenance|property/.test(c))
    return 'e.g. Post first job · Browse nearby services · Get first quote';
  if (/travel|hotel|flight|booking|vacation|trip/.test(c))
    return 'e.g. Search first destination · Save a trip · Book a stay';
  if (/food|restaurant|recipe|delivery|grocery|dining/.test(c))
    return 'e.g. Place first order · Save a favourite · Browse nearby restaurants';
  if (/shopping|retail|fashion|clothing|commerce/.test(c))
    return 'e.g. Browse first category · Add to wishlist · Complete first purchase';
  if (/game|gaming|entertainment|music/.test(c))
    return 'e.g. Complete tutorial · Unlock first achievement · Invite a friend';
  if (/social|chat|message|community|dating/.test(c))
    return 'e.g. Create profile · Send first message · Join first group';
  if (/photo|camera|video|creative/.test(c))
    return 'e.g. Take first photo · Apply a filter · Share first creation';
  if (/business|productivity|tool|utility|work/.test(c))
    return 'e.g. Create first project · Invite a teammate · Complete onboarding';
  return 'e.g. Complete first action · Invite a friend · Unlock first feature';
}

// ── MOAT placeholder keyed to app category ────────────────────────────────────

function getMoatPlaceholder(category?: string): string {
  const c = (category ?? '').toLowerCase();
  if (/health|fitness|wellness|sport|gym|workout/.test(c))
    return "e.g. Only app that syncs with both Apple Health and Google Fit — built by a marathon coach who trained 500+ athletes over 10 years.";
  if (/education|learning|school|tutor|study|course/.test(c))
    return "e.g. Only platform built for Indian tutors with official WhatsApp Business API — no banned workarounds. Built by a tutor who spent 8 years chasing payments.";
  if (/finance|banking|accounting|tax|invoice|payment/.test(c))
    return "e.g. Only invoicing app with built-in GST filing — built by a CA who spent 10 years doing it manually for SMEs.";
  if (/crm|sales|lead|pipeline/.test(c))
    return "e.g. Only CRM that auto-logs WhatsApp conversations — built by a sales rep who lost deals to missed follow-ups.";
  if (/house|home|cleaning|repair|maintenance|property/.test(c))
    return "e.g. Only home services app that guarantees same-day booking or it's free — 4 years of operations data behind our matching algorithm.";
  if (/travel|hotel|flight|booking|vacation|trip/.test(c))
    return "e.g. Only travel app with offline maps verified for remote India — built after getting stranded in Spiti Valley with no signal.";
  if (/food|restaurant|recipe|delivery|grocery|dining/.test(c))
    return "e.g. Only delivery platform that settles restaurants in 24 hours, not 7–30 days — built by a restaurant owner tired of cash flow gaps.";
  if (/shopping|retail|fashion|clothing|commerce/.test(c))
    return "e.g. Only fashion resale app that authenticates in-house before listing — built by a sneaker collector tired of buying fakes.";
  if (/game|gaming|entertainment|music/.test(c))
    return "e.g. Only casual game designed for 2G networks — 40% smaller APK than competitors, fully playable offline.";
  if (/social|chat|message|community|dating/.test(c))
    return "e.g. Only community app built exclusively for Indian expats — founder spent 5 years isolated abroad and built the network they wished existed.";
  if (/photo|camera|video|creative/.test(c))
    return "e.g. Only editing app that processes entirely on-device — no cloud upload, no privacy risk, works on phones from 2018 onward.";
  if (/business|productivity|tool|utility|work/.test(c))
    return "e.g. Only project tool that works fully offline and syncs when reconnected — built for teams in areas with unreliable connectivity.";
  return "e.g. Only [your app type] built for [specific audience] with [unique capability] — [your founder story in one line].";
}

// ── Peak season options keyed to app category ─────────────────────────────────

function getPeakSeasonOptions(category?: string): string[] {
  const c = (category ?? '').toLowerCase();
  if (/health|fitness|wellness|sport|gym|workout/.test(c))
    return ['New year (Jan)', 'Summer prep (Apr–Jun)', 'No clear peak — year round', 'Not sure'];
  if (/education|learning|school|tutor|study|course/.test(c))
    return ['Back to school (Aug–Sept)', 'Exam season (Mar–May)', 'New year (Jan)', 'No clear peak — year round', 'Not sure'];
  if (/crm|sales|lead|pipeline/.test(c))
    return ['New year (Jan)', 'Q4 push (Oct–Dec)', 'Financial year start (Apr)', 'No clear peak — year round', 'Not sure'];
  if (/finance|banking|accounting|tax|invoice|payment/.test(c))
    return ['Tax season (Feb–Apr)', 'Financial year start (Apr)', 'Q4 / New year (Oct–Jan)', 'No clear peak — year round', 'Not sure'];
  if (/house|home|cleaning|repair|maintenance|service|property/.test(c))
    return ['Spring cleaning (Mar–May)', 'Summer (Jun–Aug)', 'Pre-winter (Sept–Oct)', 'No clear peak — year round', 'Not sure'];
  if (/travel|hotel|flight|booking|vacation|trip/.test(c))
    return ['Summer (Jun–Aug)', 'Winter holidays (Nov–Jan)', 'Spring break (Mar–Apr)', 'No clear peak — year round', 'Not sure'];
  if (/food|restaurant|recipe|delivery|grocery|dining/.test(c))
    return ['Festive / Diwali (Oct–Nov)', 'Holiday season (Nov–Jan)', 'Summer (Jun–Aug)', 'No clear peak — year round', 'Not sure'];
  if (/shopping|retail|fashion|clothing|commerce/.test(c))
    return ['Q4 holiday (Oct–Dec)', 'Diwali (Oct–Nov)', 'End of season sale (Jun, Dec)', 'No clear peak — year round', 'Not sure'];
  if (/game|gaming|entertainment|music/.test(c))
    return ['Q4 holiday (Oct–Dec)', 'Summer (Jun–Aug)', 'No clear peak — year round', 'Not sure'];
  if (/social|chat|message|community|dating/.test(c))
    return ['New year (Jan)', 'Valentine\'s (Feb)', 'No clear peak — year round', 'Not sure'];
  if (/photo|camera|video|creative/.test(c))
    return ['New year (Jan)', 'Summer (Jun–Aug)', 'Holiday season (Nov–Jan)', 'No clear peak — year round', 'Not sure'];
  if (/business|productivity|tool|utility|work/.test(c))
    return ['New year (Jan)', 'Financial year start (Apr)', 'Q4 planning (Oct–Nov)', 'No clear peak — year round', 'Not sure'];
  return ['New year (Jan)', 'Q4 holiday (Oct–Dec)', 'No clear peak — year round', 'Not sure'];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContextPage() {
  const router = useRouter();
  const supabase = createClient();

  const [token, setToken]     = useState('');
  const [productId, setProductId] = useState('');
  const [conv, setConv]       = useState(1);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // Conv 1
  const [stage, setStage]           = useState('');
  const [primaryGoal, setPrimaryGoal] = useState<string[]>([]);
  const [budget, setBudget]         = useState('');

  // Conv 2
  const [audienceSize, setAudienceSize]   = useState('');
  const [warmNetwork, setWarmNetwork]     = useState<string[]>([]);
  const [geography, setGeography]         = useState('');
  const [language, setLanguage]           = useState<string[]>([]);

  // Conv 3
  const [channelsTried, setChannelsTried]     = useState<string[]>([]);
  const [channelsToAvoid, setChannelsToAvoid] = useState<string[]>([]);
  const [monetization, setMonetization]       = useState('');
  const [dropOffPoint, setDropOffPoint]       = useState('');
  const [firstUserAction, setFirstUserAction] = useState('');

  // Conv 4
  const [moat, setMoat]               = useState('');
  const [peakSeason, setPeakSeason]   = useState('');
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [appCategory, setAppCategory] = useState<string | undefined>(undefined);

  // Conv 5
  const [bestCustomerQuote, setBestCustomerQuote] = useState('');
  const [contentFormats, setContentFormats] = useState<string[]>([]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // ── Sync reads (immediate) ────────────────────────────────────────────────
    const pid = sessionStorage.getItem(INTAKE_STORAGE.productId);
    if (!pid) { router.replace('/dashboard/products/new'); return; }
    setProductId(pid);

    // If scrapeResult already cached (user came back from analysis page), use it immediately
    const cached = sessionStorage.getItem(INTAKE_STORAGE.scrapeResult);
    if (cached) {
      try {
        const r = JSON.parse(cached);
        const cat: string | undefined = r.category ?? r.scraped?.category;
        if (cat) setAppCategory(cat);
      } catch { /* ignore */ }
    }

    // ── Async: token + one-shot job poll for category ─────────────────────────
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const tkn = data.session?.access_token;
      if (!tkn || cancelled) return;
      setToken(tkn);

      if (!cached) {
        const jid = sessionStorage.getItem(INTAKE_STORAGE.jobId);
        if (!jid) return;

        const tryFetch = async (): Promise<boolean> => {
          if (cancelled) return true;
          try {
            const status = await api.products.pollScrapeJob(jid, tkn);
            const done = status.status === 'complete' || status.status === 'completed';
            if (done && !cancelled) {
              const r = status.result ?? status.partialResult;
              const cat = r?.category ?? (r as { scraped?: { category?: string } })?.scraped?.category;
              if (cat) setAppCategory(cat);
              if (r) sessionStorage.setItem(INTAKE_STORAGE.scrapeResult, JSON.stringify(r));
            }
            return done;
          } catch { return false; }
        };

        if (!(await tryFetch())) {
          // Job still running — retry once after 15 s (covers slow scrapes)
          timer = setTimeout(() => { void tryFetch(); }, 15_000);
        }
      }
    })();

    // Restore any saved context
    const saved = sessionStorage.getItem(INTAKE_STORAGE.context);
    if (saved) {
      try {
        const ctx: FounderContext = JSON.parse(saved);
        if (ctx.stage) setStage(ctx.stage);
        if (ctx.primaryGoal) setPrimaryGoal(Array.isArray(ctx.primaryGoal) ? ctx.primaryGoal : [ctx.primaryGoal]);
        if (ctx.budget) setBudget(ctx.budget);
        if (ctx.audienceSize) setAudienceSize(ctx.audienceSize);
        if (ctx.warmNetwork) setWarmNetwork(ctx.warmNetwork);
        if (ctx.geography) setGeography(ctx.geography);
        if (ctx.language) setLanguage(ctx.language);
        if (ctx.channelsTried) setChannelsTried(ctx.channelsTried);
        if (ctx.channelsToAvoid) setChannelsToAvoid(ctx.channelsToAvoid);
        if (ctx.monetization) setMonetization(ctx.monetization);
        if (ctx.dropOffPoint) setDropOffPoint(ctx.dropOffPoint);
        if (ctx.firstUserAction) setFirstUserAction(ctx.firstUserAction);
        if (ctx.moat) setMoat(ctx.moat);
        if (ctx.peakSeason) setPeakSeason(ctx.peakSeason);
        if (ctx.bestCustomerQuote) setBestCustomerQuote(ctx.bestCustomerQuote);
        if (ctx.contentFormats) setContentFormats(ctx.contentFormats);
      } catch { /* ignore */ }
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  function buildContext(): FounderContext {
    return {
      stage: stage || undefined,
      primaryGoal: primaryGoal.length ? primaryGoal.join(', ') : undefined,
      budget: budget || undefined,
      audienceSize: audienceSize || undefined,
      warmNetwork: warmNetwork.length ? warmNetwork : undefined,
      geography: geography || undefined,
      language: language.length ? language : undefined,
      channelsTried: channelsTried.length ? channelsTried : undefined,
      channelsToAvoid: channelsToAvoid.length ? channelsToAvoid : undefined,
      monetization: monetization || undefined,
      dropOffPoint: dropOffPoint || undefined,
      firstUserAction: firstUserAction || undefined,
      moat: moat || undefined,
      peakSeason: peakSeason || undefined,
      bestCustomerQuote: bestCustomerQuote || undefined,
      contentFormats: contentFormats.length ? contentFormats : undefined,
    };
  }

  async function saveAndAdvance(nextConv: number | 'next-step') {
    if (!productId || !token) return;
    setSaving(true);
    setError('');
    const ctx = buildContext();
    sessionStorage.setItem(INTAKE_STORAGE.context, JSON.stringify(ctx));

    try {
      await api.products.saveContext(productId, ctx, token);
    } catch (err) {
      // Non-fatal — context already in sessionStorage, will retry on next save
      console.warn('Context save failed, will retry:', err instanceof ApiError ? err.message : err);
    } finally {
      setSaving(false);
    }

    if (nextConv === 'next-step') {
      router.push('/dashboard/products/new/analysis');
    } else {
      setConv(nextConv);
    }
  }

  async function handleScreenshots(files: FileList | null) {
    if (!files || !productId || !token) return;
    const arr = Array.from(files).slice(0, 3);
    setScreenshots(arr);
    try {
      await api.products.uploadScreenshots(productId, arr, token);
    } catch { /* non-fatal */ }
  }

  const pct = Math.round(((conv - 1) / TOTAL_CONVS) * 100);

  return (
    <div>
      <IntakeSteps currentStep="context" />

      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border2)' }}>
          <div
            style={{
              width: `${pct + 20}%`,
              height: '100%',
              borderRadius: 2,
              background: 'var(--sage)',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>
          {conv} / {TOTAL_CONVS}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-[6px] px-3 py-2" style={{ background: 'var(--danger-d)', border: '1px solid var(--danger-b)' }}>
          <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>
        </div>
      )}

      {/* ── Conv 1 ── */}
      {conv === 1 && (
        <ConvCard
          heading="Where are you right now?"
          onNext={() => saveAndAdvance(2)}
          saving={saving}
          showBack={false}
        >
          <ConvRow label="App stage">
            <ChipGroup
              options={['Pre-launch', 'Just launched', 'Growing (100+ users)', 'Scaling']}
              selected={stage}
              onChange={(v) => setStage(v as string)}
            />
          </ConvRow>
          <ConvRow label="Primary goal">
            <ChipGroup
              options={['More installs', 'More paying users', 'Better reviews', 'Brand awareness']}
              selected={primaryGoal}
              mode="multi"
              onChange={(v) => setPrimaryGoal(v as string[])}
            />
          </ConvRow>
          <ConvRow label="Paid marketing budget">
            <ChipGroup
              options={['$0 — organic only', '$50–$200/mo', '$200–$500/mo', '$500+/mo']}
              selected={budget}
              onChange={(v) => setBudget(v as string)}
            />
          </ConvRow>
        </ConvCard>
      )}

      {/* ── Conv 2 ── */}
      {conv === 2 && (
        <ConvCard
          heading="Who do you already have access to?"
          onBack={() => setConv(1)}
          onNext={() => saveAndAdvance(3)}
          saving={saving}
        >
          <ConvRow label="Existing audience">
            <ChipGroup
              options={['None — starting fresh', 'Small (<1K)', 'Medium (1K–10K)', 'Large (10K+)']}
              selected={audienceSize}
              onChange={(v) => setAudienceSize(v as string)}
            />
          </ConvRow>
          <ConvRow label="Warm network (multi-select)">
            <ChipGroup
              options={['WhatsApp group', 'Newsletter', 'Facebook group', 'Slack/Discord', 'Twitter/X following', 'None']}
              selected={warmNetwork}
              onChange={(v) => setWarmNetwork(v as string[])}
              mode="multi"
            />
          </ConvRow>
          <ConvRow label="Geography">
            <input
              type="text"
              value={geography}
              onChange={(e) => setGeography(e.target.value)}
              placeholder="e.g. Bangalore, Mumbai · or · Phoenix, Dallas · or · mixed globally"
              className="autofill-light w-full rounded-[6px] px-3 py-2 outline-none"
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
            />
          </ConvRow>
          <ConvRow label="App language (multi-select)" hint="LaunchMind generates WhatsApp copy in your users' language">
            <ChipGroup
              options={['English', 'Hindi', 'Hinglish', 'Tamil', 'Telugu', 'Other']}
              selected={language}
              onChange={(v) => setLanguage(v as string[])}
              mode="multi"
            />
          </ConvRow>
        </ConvCard>
      )}

      {/* ── Conv 3 ── */}
      {conv === 3 && (
        <ConvCard
          heading="What has and hasn't worked?"
          onBack={() => setConv(2)}
          onNext={() => saveAndAdvance(4)}
          saving={saving}
        >
          <ConvRow
            label="Channels you've tried (multi-select)"
            hint="Helps LaunchMind understand your history — these are NOT auto-excluded from your strategy"
          >
            <ChipGroup
              options={['Meta Ads', 'Google Ads', 'WhatsApp', 'LinkedIn', 'Cold email', 'Instagram', 'Nothing yet']}
              selected={channelsTried}
              onChange={(v) => setChannelsTried(v as string[])}
              mode="multi"
              amber
            />
          </ConvRow>
          <ConvRow
            label="Any channels you want to skip entirely? (optional)"
            hint="Hard-excluded from your strategy — only if you genuinely don't want to run on a channel"
          >
            <ChipGroup
              options={['Meta Ads', 'Google Ads', 'WhatsApp', 'LinkedIn', 'Cold email', 'Instagram']}
              selected={channelsToAvoid}
              onChange={(v) => setChannelsToAvoid(v as string[])}
              mode="multi"
              danger
            />
          </ConvRow>
          <ConvRow label="Monetization">
            <ChipGroup
              options={['Free', 'Freemium', 'Monthly subscription', 'Annual plan', 'One-time purchase']}
              selected={monetization}
              onChange={(v) => setMonetization(v as string)}
            />
          </ConvRow>
          <ConvRow
            label="Where do users drop off?"
            hint="We add a re-engagement message right before your drop-off cliff"
          >
            <ChipGroup
              options={[
                'Day 1 — before first action',
                'Day 3–7 — before seeing value',
                'Week 2–4 — after trial',
                "Don't know yet",
              ]}
              selected={dropOffPoint}
              onChange={(v) => setDropOffPoint(v as string)}
            />
          </ConvRow>
          <ConvRow label="What should a new user do in their first 3 minutes?">
            <input
              type="text"
              value={firstUserAction}
              onChange={(e) => setFirstUserAction(e.target.value)}
              placeholder={getFirstActionPlaceholder(appCategory)}
              className="autofill-light w-full rounded-[6px] px-3 py-2 outline-none"
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
            />
          </ConvRow>
        </ConvCard>
      )}

      {/* ── Conv 4 ── */}
      {conv === 4 && (
        <ConvCard
          heading="What makes you different?"
          onBack={() => setConv(3)}
          onNext={() => saveAndAdvance(5)}
          saving={saving}
        >
          <ConvRow
            label="Why can't a competitor copy you tomorrow?"
            hint="Not 'better UX' — something defensible. Your technology, story, data, or distribution."
          >
            <textarea
              value={moat}
              onChange={(e) => setMoat(e.target.value)}
              rows={4}
              placeholder={getMoatPlaceholder(appCategory)}
              className="w-full rounded-[6px] px-3 py-2 outline-none resize-none"
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
            />
            <p style={{ fontSize: 11, color: moat.length >= 50 ? 'var(--sage)' : 'var(--ink3)', marginTop: 4 }}>
              {moat.length} chars{moat.length < 50 ? ' — 50+ chars encouraged' : ' ✓'}
            </p>
          </ConvRow>
          <ConvRow
            label="Peak season"
            hint={appCategory ? `Suggested for: ${appCategory}` : undefined}
          >
            <ChipGroup
              options={getPeakSeasonOptions(appCategory)}
              selected={peakSeason}
              onChange={(v) => setPeakSeason(v as string)}
            />
          </ConvRow>
          <ConvRow label="App Store screenshots" hint="Optional — adds ASO rewrite to your strategy">
            <label
              className="flex items-center gap-2 cursor-pointer rounded-[6px] px-3 py-2 inline-block"
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', fontSize: 13, color: 'var(--ink2)' }}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleScreenshots(e.target.files)}
              />
              📎 {screenshots.length > 0 ? `${screenshots.length} file${screenshots.length > 1 ? 's' : ''} selected` : 'Choose screenshots (max 3)'}
            </label>
            {screenshots.length > 0 && (
              <div className="flex gap-2 mt-2">
                {screenshots.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-[4px] px-2 py-1"
                    style={{ fontSize: 11, background: 'var(--sage-d)', color: 'var(--sage)', border: '1px solid var(--sage-b)' }}
                  >
                    {f.name.length > 18 ? f.name.slice(0, 15) + '…' : f.name}
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
              AI reads your screenshots to understand core features. Max 3 files, 5 MB each.
            </p>
          </ConvRow>
        </ConvCard>
      )}

      {/* ── Conv 5 ── */}
      {conv === 5 && (
        <ConvCard
          heading="What content do you want to create?"
          sub="LaunchMind will generate these for you. Pick all that apply — skip if unsure."
          onBack={() => setConv(4)}
          onNext={() => saveAndAdvance('next-step')}
          onSkip={() => saveAndAdvance('next-step')}
          saving={saving}
        >
          <ConvRow
            label="Content formats (multi-select)"
            hint="These become your first batch of campaign assets after strategy generation"
          >
            <ChipGroup
              options={['Video ad (30–60s)', 'Static visual', 'Carousel', 'WhatsApp copy', 'Email sequence', 'Text / headline copy']}
              selected={contentFormats}
              onChange={(v) => setContentFormats(v as string[])}
              mode="multi"
            />
          </ConvRow>
          <ConvRow label="Paste a DM, review, or email your happiest user ever sent you">
            <textarea
              value={bestCustomerQuote}
              onChange={(e) => setBestCustomerQuote(e.target.value)}
              rows={4}
              placeholder={"e.g. 'Finally stopped chasing fees. My students' parents get a reminder before I even think about it.' — Priya S."}
              className="w-full rounded-[6px] px-3 py-2 outline-none resize-none"
              style={{ background: 'var(--raised)', border: '1px solid var(--border2)', color: 'var(--ink)', fontSize: 13 }}
            />
          </ConvRow>
          <div
            className="rounded-[10px] p-4"
            style={{ background: 'var(--sage-d)', border: '1px solid var(--sage-b)' }}
          >
            <p style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
              This exact quote becomes the opening line of your first WhatsApp broadcast and your top ad headline.
              Real words from real users convert 3–5× better than AI-generated copy.
            </p>
          </div>
        </ConvCard>
      )}
    </div>
  );
}

interface ConvCardProps {
  heading: string;
  sub?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext: () => void;
  onSkip?: () => void;
  saving: boolean;
  showBack?: boolean;
}

function ConvCard({ heading, sub, children, onBack, onNext, onSkip, saving, showBack = true }: ConvCardProps) {
  return (
    <div
      className="rounded-[10px] p-6 space-y-5"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div>
        <h2 className="font-display font-semibold" style={{ fontSize: 18, color: 'var(--ink)' }}>
          {heading}
        </h2>
        {sub && <p style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>{sub}</p>}
      </div>

      {children}

      <div className="flex items-center justify-between pt-2">
        <div>
          {showBack && onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{ fontSize: 13, color: 'var(--ink3)' }}
              className="hover:opacity-70 transition-opacity"
            >
              ← Back
            </button>
          )}
        </div>
        <div className="flex gap-3">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className="rounded-[6px] px-4 py-2 transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ fontSize: 13, color: 'var(--ink2)', border: '1px solid var(--border2)' }}
            >
              Skip →
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={saving}
            className="rounded-[6px] px-5 py-2 font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--sage)', color: '#fff', fontSize: 13 }}
          >
            {saving ? 'Saving…' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}
