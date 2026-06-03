/**
 * @file contentService.ts
 * @description Core content generation service for LaunchMind.
 *   Structured pipeline producing validated multi-format marketing assets:
 *
 *   Step 1: assembleContext() — metrics, ICP, founder context, playbook, competitors
 *   Step 2: callSonnet()     — strategy + all long-form assets (structured JSON)
 *   Step 3: callHaiku()      — char-limit enforcement + quality scoring
 *   Step 4: textToSpeech()   — voiceover MP3 (if video/voice enabled)
 *   Step 5: renderVideo()    — final MP4 via Creatomate (if video enabled)
 *   Step 6: saveAssets()     — write rows to content_assets table
 *
 * @security All Claude calls go through consumeTokens(). Video never auto-approves.
 *   founderId verified against product.founder_id on every DB write.
 * @dependencies
 *   content_assets, content_learnings, campaign_metrics, products, founders tables
 *   aiClient, elevenLabsClient, creatomateClient, playbookService, tokens
 */

import { z } from 'zod';
import * as Sentry from '@sentry/node';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { consumeTokens } from '../lib/tokens';
import { callSonnet, callHaiku } from '../lib/aiClient';
import { textToSpeech } from '../lib/elevenLabsClient';
import { renderVideo, pollRender } from '../lib/creatomateClient';
import { buildPlaybookContext } from './playbookService';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

export const ContentOutputSchema = z.object({
  whatsapp: z.object({
    painFirst:    z.string().max(160),
    socialProof:  z.string().max(160),
    reEngagement: z.string().max(160),
    hinglish:     z.string().max(160).optional(),
  }),
  meta: z.object({
    headlineA: z.string().max(40),
    headlineB: z.string().max(40),
    bodyIndia: z.string().max(125),
    bodyUSA:   z.string().max(125),
    linkDesc:  z.string().max(30),
  }),
  googleUAC: z.object({
    v1: z.string().max(30),
    v2: z.string().max(30),
    v3: z.string().max(30),
    v4: z.string().max(30),
    v5: z.string().max(30),
  }),
  aso: z.object({
    subtitle:            z.string().max(30),
    descriptionOpening:  z.string().max(250),
    keywordsIndia:       z.array(z.string()).length(10),
    keywordsUSA:         z.array(z.string()).length(10),
  }),
  email: z.object({
    day1Subject:  z.string().max(50),
    day1Body:     z.string().max(800),
    day5Subject:  z.string().max(50),
    day5Body:     z.string().max(400),
    day14Subject: z.string().max(50),
    day14Body:    z.string().max(300),
  }),
  linkedin: z.object({
    founderStoryHook: z.string().max(120),
    founderStoryFull: z.string().max(3000),
    buildInPublicHook:z.string().max(120),
    buildInPublicFull:z.string().max(2000),
  }),
  videoScripts: z.object({
    reels30s: z.object({
      scenes: z.array(z.object({
        sceneNumber:     z.number(),
        durationSeconds: z.number(),
        label:           z.string(),
        voiceScript:     z.string(),
        textOverlay:     z.string().max(60),
        visualDirection: z.string(),
        backgroundColor: z.string(),
      })).length(4),
    }),
    shorts60s: z.object({
      scenes: z.array(z.object({
        sceneNumber:     z.number(),
        durationSeconds: z.number(),
        label:           z.string(),
        voiceScript:     z.string(),
        textOverlay:     z.string().max(60),
        visualDirection: z.string(),
        backgroundColor: z.string(),
      })).length(5),
    }),
    appStorePreview: z.object({
      scenes: z.array(z.object({
        sceneNumber:     z.number(),
        durationSeconds: z.number(),
        voiceScript:     z.string(),
        textOverlay:     z.string().max(60),
        useScreenshot:   z.boolean(),
      })).length(5),
    }),
    whatsappVoiceNote: z.object({
      script:   z.string().max(400),
      language: z.string(),
    }),
  }).optional(),
  visualBriefs: z.object({
    metaImageBrief: z.object({
      backgroundColor: z.string(),
      mainVisual:      z.string(),
      headline:        z.string().max(40),
      subtext:         z.string().max(80),
      textColors:      z.object({ headline: z.string(), subtext: z.string() }),
      emotionToConvey: z.string(),
      doNotInclude:    z.string(),
      canvaTemplate:   z.string(),
    }),
    carousel: z.object({
      slides: z.array(z.object({
        slideNumber: z.number(),
        type:        z.string(),
        headline:    z.string().max(60),
        body:        z.string().max(120),
        visual:      z.string(),
      })).length(7),
    }),
  }).optional(),
  community: z.object({
    whatsappGroupPost:  z.string().max(600),
    facebookGroupPost:  z.string().max(1500),
    indieHackersPost:   z.string().max(3000),
    twitterThread:      z.array(z.string().max(280)).length(5),
    productHuntComment: z.string().max(500),
  }).optional(),
  socialProof: z.object({
    caseStudy: z.object({
      headline:        z.string().max(80),
      situation:       z.string().max(300),
      recommendation:  z.string().max(200),
      whatHappened:    z.string().max(400),
      insight:         z.string().max(200),
      currentPosition: z.string().max(200),
    }),
    testimonialCardBrief: z.object({
      quoteToUse:      z.string(),
      attribution:     z.string(),
      backgroundColor: z.string(),
      quoteStyle:      z.string(),
    }),
    reviewResponsePositive: z.string().max(300),
    reviewResponseNegative: z.string().max(300),
  }).optional(),
  strategy: z.object({
    day30: z.array(z.object({ week: z.number(), channel: z.string(), action: z.string(), budget: z.string() })),
    day60: z.array(z.object({ week: z.number(), channel: z.string(), action: z.string(), budget: z.string() })),
    day90: z.array(z.object({ week: z.number(), channel: z.string(), action: z.string(), budget: z.string() })),
    primaryChannel:   z.string(),
    weekOneFocus:     z.string(),
    budgetAllocation: z.record(z.string(), z.number()),
    excludedChannels: z.array(z.string()),
    peakSeasonNote:   z.string().optional(),
  }),
});

export type ContentOutput = z.infer<typeof ContentOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// CHAR LIMITS
// ─────────────────────────────────────────────────────────────────────────────

const CHAR_LIMITS: Record<string, number> = {
  'whatsapp.painFirst':      160,
  'whatsapp.socialProof':    160,
  'whatsapp.reEngagement':   160,
  'whatsapp.hinglish':       160,
  'meta.headlineA':           40,
  'meta.headlineB':           40,
  'meta.bodyIndia':          125,
  'meta.bodyUSA':            125,
  'meta.linkDesc':            30,
  'googleUAC.v1':             30,
  'googleUAC.v2':             30,
  'googleUAC.v3':             30,
  'googleUAC.v4':             30,
  'googleUAC.v5':             30,
  'aso.subtitle':             30,
  'aso.descriptionOpening':  250,
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: CONTEXT ASSEMBLY
// ─────────────────────────────────────────────────────────────────────────────

async function assembleContext(productId: string, founderId: string) {
  const supabase = getSupabaseAdmin();

  const { data: product, error } = await supabase
    .from('products')
    .select('*, founders(*)')
    .eq('id', productId)
    .eq('founder_id', founderId)
    .single();

  if (error || !product) throw new Error(`Product not found: ${productId}`);

  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rawMetrics } = await supabase
    .from('campaign_metrics')
    .select('*, campaigns(channel, market, hook_type, copy_text)')
    .eq('founder_id', founderId)
    .gte('week_start', fourWeeksAgo)
    .order('week_start', { ascending: false });

  const metrics = rawMetrics ?? [];
  const channelPerformance = groupMetricsByChannel(metrics);
  const winningChannel = getWinningChannel(channelPerformance);
  const losingChannels = getLosingChannels(channelPerformance);

  const primaryMarket: 'usa' | 'india' =
    (product.selected_markets as string[] | null)?.includes('india') ? 'india' : 'usa';

  const playbookSignals = await buildPlaybookContext(
    product.category ?? 'Productivity',
    primaryMarket,
    product.icp_embedding ?? null
  );

  const { data: learnings } = await supabase
    .from('content_learnings')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(20);

  const sixWeeksAgo = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleCampaigns } = await supabase
    .from('campaigns')
    .select('id, channel, hook_type, launched_at')
    .eq('founder_id', founderId)
    .eq('status', 'launched')
    .lt('launched_at', sixWeeksAgo);

  const { data: previousAssets } = await supabase
    .from('content_assets')
    .select('asset_type, hook_angle, generation_week, channel')
    .eq('product_id', productId)
    .order('generation_week', { ascending: false })
    .limit(20);

  const weeksLive = Math.max(1, Math.ceil(
    (Date.now() - new Date(product.created_at as string).getTime()) / (7 * 24 * 60 * 60 * 1000)
  ));

  const founders = product.founders as Record<string, unknown> | null;

  return {
    product,
    founderContext: (product.founder_context as Record<string, unknown>) ?? {},
    confirmedIcp: (product.confirmed_icp as Record<string, unknown>) ?? {},
    competitorSet: (product.competitor_set as Array<Record<string, unknown>>) ?? [],
    metrics,
    channelPerformance,
    winningChannel,
    losingChannels,
    playbookSignals,
    learnings: learnings ?? [],
    staleCampaigns: staleCampaigns ?? [],
    previousAssets: previousAssets ?? [],
    weeksLive,
    contentPreferences: (product.content_preferences as Record<string, unknown>) ?? {},
    approvalMode: (product.approval_mode as string) ?? 'manual',
    voiceCloneId: (product.voice_clone_id as string | null) ?? (founders?.voice_clone_id as string | null) ?? null,
    brandVoice: (product.brand_voice_profile as Record<string, unknown>) ?? {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof assembleContext>>): string {
  const fc = ctx.founderContext;
  const icp = ctx.confirmedIcp;
  const competitors = ctx.competitorSet.filter((c) => c.confirmed);

  const winnerLine = ctx.winningChannel
    ? `WINNING: ${ctx.winningChannel.channel} — ${ctx.winningChannel.installs} installs at ${ctx.winningChannel.cpi} CPI. Generate 2 variants of the winning hook angle this week.`
    : 'Week 1 — no performance data yet.';

  const loserLine = ctx.losingChannels.length > 0
    ? `UNDERPERFORMING: ${ctx.losingChannels.map((c) => c.channel).join(', ')} — recommend pause or new creative angle.`
    : '';

  const learningsLine = ctx.learnings.length > 0
    ? ctx.learnings.map((l) => `- ${(l as Record<string, unknown>).insight}`).join('\n')
    : 'No learnings yet — week 1.';

  const bv = ctx.brandVoice as Record<string, unknown>;

  return `You are the marketing brain of LaunchMind — an AI marketing OS for app founders.
You generate structured marketing content that is specific, authentic, and immediately usable.

## Product
App: ${(ctx.product as Record<string, unknown>).name}
Category: ${(ctx.product as Record<string, unknown>).category}
Markets: ${((ctx.product as Record<string, unknown>).selected_markets as string[] ?? ['india', 'usa']).join(', ')}
Monetization: ${fc.monetization ?? fc.monetisation ?? 'freemium'}
Price tier: ${(ctx.product as Record<string, unknown>).price_tier}

## Ideal Customer Profile
Target user: ${(icp.targetUser as string) ?? 'app users'}
Pain points: ${((icp.painPoints as string[]) ?? []).join('; ')}
Copy signals (exact phrases from real reviews): ${((icp.copySignals as string[]) ?? []).join('; ')}

## Founder Context — CRITICAL
MOAT (why competitors can't copy tomorrow):
"${(fc.moat as string) ?? 'Not provided'}"

Best customer quote (use VERBATIM in whatsapp.painFirst and meta.bodyIndia):
"${(fc.bestCustomerQuote as string) ?? ''}"

Budget: ${(fc.budget as string) ?? 'not specified'}
Stage: ${(fc.stage as string) ?? 'not specified'}
Primary goal: ${(fc.primaryGoal as string) ?? 'more installs'}
Geography: ${(fc.geography as string) ?? 'India + USA'}
Language: ${((fc.language as string[]) ?? ['english']).join(', ')}
Drop-off point: ${(fc.dropOffPoint as string) ?? 'unknown'} — time re-engagement message 2 days before this
Peak season: ${(fc.peakSeason as string) ?? 'none specified'}
First user action: ${(fc.firstUserAction as string) ?? 'sign up'}
Warm network: ${((fc.warmNetwork as string[]) ?? []).join(', ') || 'none'}

## Channels to EXCLUDE from week 1
${((fc.channelsToAvoid as string[]) ?? []).length > 0 ? ((fc.channelsToAvoid as string[]) ?? []).join(', ') : 'none'}

## Week ${ctx.weeksLive} — Performance Context
${winnerLine}
${loserLine}

## Brand Voice Learnings
${learningsLine}
${Array.isArray(bv.avoidPhrases) && bv.avoidPhrases.length ? `AVOID: ${(bv.avoidPhrases as string[]).join(', ')}` : ''}
${Array.isArray(bv.preferPhrases) && bv.preferPhrases.length ? `PREFER: ${(bv.preferPhrases as string[]).join(', ')}` : ''}
${bv.tone ? `Tone: ${bv.tone}` : ''}

## Content Calendar (avoid repeating these angles this week)
${ctx.previousAssets.slice(0, 5).map((a) => `- ${(a as Record<string, unknown>).channel}: ${(a as Record<string, unknown>).hook_angle}`).join('\n') || 'No previous assets.'}

## Competitor Intelligence
${competitors.map((c) => `${c.name}: Gap = "${c.gap}"`).join('\n') || 'No confirmed competitors yet.'}

## Playbook Signals
${ctx.playbookSignals || 'No playbook signals loaded yet.'}

## India Localisation
Mumbai/Pune: Direct, aspirational, business-focused.
Delhi/NCR: Formal tone acceptable. Price-sensitive.
Bangalore: Tech-savvy, English-comfortable. Direct pain-first works.
Chennai: Conservative, relationship-first. Lead with community/network signals.

## Creative Fatigue
${ctx.staleCampaigns.length > 0 ? `⚠ Running 6+ weeks — flag for refresh: ${ctx.staleCampaigns.map((c) => (c as Record<string, unknown>).channel).join(', ')}` : 'No creative fatigue detected.'}

## Output Rules — STRICT
1. Return ONLY valid JSON. No prose before or after.
2. Customer quote must appear VERBATIM in whatsapp.painFirst and meta.bodyIndia.
3. MOAT must appear in meta.bodyIndia, meta.bodyUSA, and linkedin.founderStoryFull.
4. Character limits are HARD — never exceed them.
5. India and USA copy must be distinct.
6. If language includes 'hinglish', generate whatsapp.hinglish.
7. Video scripts must have exactly 4 scenes for reels30s, 5 for shorts60s.
8. Community posts must sound like a real person — never like an ad.
9. Strategy must exclude channels from "Channels to EXCLUDE" in day30 week 1.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: QUALITY SCORING + CHAR LIMITS
// ─────────────────────────────────────────────────────────────────────────────

async function scoreAsset(
  assetType: string,
  content: string,
  founderContext: Record<string, unknown>
): Promise<{ score: number; flags: Record<string, boolean> }> {
  const raw = await callHaiku(`
Score this marketing copy on 4 criteria. Return ONLY JSON.

Asset type: ${assetType}
Content: "${content}"
MOAT to check for: "${(founderContext.moat as string) ?? ''}"
Customer quote to check for: "${((founderContext.bestCustomerQuote as string) ?? '').substring(0, 50)}"

Criteria:
1. painFirst: Does it open with a pain point or problem?
2. moatPresent: Does it mention or imply the MOAT? (true for non-meta/linkedin assets)
3. ctaClear: Is there one clear call to action?
4. charLimitOk: Is the content under the character limit for ${assetType}?

Return: { "painFirst": bool, "moatPresent": bool, "ctaClear": bool, "charLimitOk": bool, "score": 0.0-1.0 }`);

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      score: (parsed.score as number) ?? 0,
      flags: {
        painFirst:    Boolean(parsed.painFirst),
        moatPresent:  Boolean(parsed.moatPresent),
        ctaClear:     Boolean(parsed.ctaClear),
        charLimitOk:  Boolean(parsed.charLimitOk),
      },
    };
  } catch {
    return { score: 0.5, flags: { painFirst: false, moatPresent: false, ctaClear: false, charLimitOk: true } };
  }
}

async function enforceCharLimits(content: ContentOutput, founderId: string): Promise<ContentOutput> {
  const violations: string[] = [];

  for (const [field, limit] of Object.entries(CHAR_LIMITS)) {
    const [section, key] = field.split('.') as [string, string];
    const sectionObj = content[section as keyof ContentOutput] as Record<string, unknown> | undefined;
    const value = sectionObj?.[key];
    if (typeof value === 'string' && value.length > limit) {
      violations.push(`${field}: ${value.length} chars (limit: ${limit})`);
    }
  }

  if (violations.length === 0) return content;

  await consumeTokens(founderId, 'char_limit_rewrite', 5);
  const rewritten = await callHaiku(`
Rewrite these marketing copy fields to fit character limits. Return ONLY JSON with same structure.

Violations:
${violations.join('\n')}

Original content:
${JSON.stringify(content, null, 2)}

Rules:
- Preserve the core message and pain point
- Keep customer quote if present
- Never exceed the character limit
- Return the FULL content object with only violations fixed`, 4096);

  try {
    const cleaned = rewritten.replace(/```json|```/g, '').trim();
    return ContentOutputSchema.parse(JSON.parse(cleaned));
  } catch {
    return content;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: VIDEO PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

interface VideoJobParams {
  productId: string;
  founderId: string;
  briefId: string | null;
  scenes: Array<{ durationSeconds: number; voiceScript: string; textOverlay: string; backgroundColor?: string }>;
  videoType: 'reels30s' | 'shorts60s' | 'appStorePreview';
  language: string;
  voiceCloneId: string | null;
  assetType: string;
}

async function generateVideo(params: VideoJobParams): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { productId, founderId, briefId, scenes, videoType, language, voiceCloneId, assetType } = params;

  const audioBuffers: Buffer[] = [];
  for (const scene of scenes) {
    const mp3 = await textToSpeech(scene.voiceScript, language, voiceCloneId);
    audioBuffers.push(mp3);
  }

  // Upload audio files to Supabase Storage (skip if empty buffers from missing API key)
  const audioUrls: string[] = [];
  for (let i = 0; i < audioBuffers.length; i++) {
    if (audioBuffers[i].length === 0) {
      audioUrls.push('');
      continue;
    }
    const path = `${founderId}/${productId}/audio/${videoType}_scene${i}_${Date.now()}.mp3`;
    await supabase.storage.from('content-assets').upload(path, audioBuffers[i]);
    const { data } = supabase.storage.from('content-assets').getPublicUrl(path);
    audioUrls.push(data.publicUrl);
  }

  const dimensions = {
    reels30s:        { width: 1080, height: 1920 },
    shorts60s:       { width: 1080, height: 1920 },
    appStorePreview: { width: 886, height: 1920 },
  }[videoType];

  const creatomateScenes = scenes.map((scene, i) => ({
    duration: scene.durationSeconds,
    backgroundColor: scene.backgroundColor ?? '#1a1a2e',
    textOverlay: scene.textOverlay,
    audioUrl: audioUrls[i] || undefined,
  }));

  const renderId = await renderVideo({ scenes: creatomateScenes, outputFormat: 'mp4', ...dimensions, frameRate: 30, captionsEnabled: true });
  const videoUrl = await pollRender(renderId);

  // Save to content_assets — video always status='pending'
  await supabase.from('content_assets').insert({
    product_id: productId,
    founder_id: founderId,
    brief_id: briefId,
    asset_type: assetType,
    channel: videoType === 'appStorePreview' ? 'aso' : 'video',
    market: 'both',
    media_url: videoUrl,
    media_type: 'mp4',
    duration_seconds: scenes.reduce((s, sc) => s + sc.durationSeconds, 0),
    model_used: 'sonnet',
    status: 'pending',
    auto_approved: false,
    generation_week: 1,
  });
}

async function generateVoiceNote(params: {
  productId: string; founderId: string; briefId: string | null;
  script: string; language: string; voiceCloneId: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { productId, founderId, briefId, script, language, voiceCloneId } = params;

  const mp3 = await textToSpeech(script, language, voiceCloneId);
  if (mp3.length === 0) return;

  const path = `${founderId}/${productId}/audio/voice_note_${Date.now()}.mp3`;
  await supabase.storage.from('content-assets').upload(path, mp3);
  const { data } = supabase.storage.from('content-assets').getPublicUrl(path);

  await supabase.from('content_assets').insert({
    product_id: productId, founder_id: founderId, brief_id: briefId,
    asset_type: 'whatsapp_voice_note', channel: 'whatsapp', market: 'india',
    media_url: data.publicUrl, media_type: 'mp3',
    duration_seconds: Math.ceil(script.split(' ').length / 2.5),
    model_used: 'sonnet', status: 'pending', auto_approved: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: SAVE ASSETS TO DB
// ─────────────────────────────────────────────────────────────────────────────

function determineInitialStatus(channel: string, approvalMode: string, weeksLive: number): string {
  const paidChannels = ['meta', 'google'];
  if (paidChannels.includes(channel)) return 'pending';
  if (approvalMode === 'auto' && weeksLive >= 5) return 'auto_approved';
  return 'pending';
}

async function saveAssets(
  content: ContentOutput,
  ctx: Awaited<ReturnType<typeof assembleContext>>,
  briefId: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { product, founderContext, contentPreferences, weeksLive } = ctx;
  const prefs = contentPreferences as Record<string, Record<string, boolean>>;
  const productId = (product as Record<string, unknown>).id as string;
  const founderId = (product as Record<string, unknown>).founder_id as string;
  const lang = ((founderContext.language as string[]) ?? ['english'])[0] ?? 'english';

  type AssetRow = {
    product_id: string; founder_id: string; brief_id: string | null;
    asset_type: string; channel: string; market: string; language: string;
    text_content?: string; structured_data?: unknown; hook_angle: string;
    model_used: string; status: string; auto_approved: boolean; generation_week: number;
  };

  const rows: AssetRow[] = [];

  const addTextAsset = (type: string, channel: string, market: string, textContent: string, hookAngle: string) => {
    rows.push({
      product_id: productId, founder_id: founderId, brief_id: briefId,
      asset_type: type, channel, market, language: lang,
      text_content: textContent, hook_angle: hookAngle,
      model_used: 'sonnet',
      status: determineInitialStatus(channel, ctx.approvalMode, weeksLive),
      auto_approved: false, generation_week: weeksLive,
    });
  };

  // WhatsApp
  addTextAsset('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.painFirst, 'pain_first');
  addTextAsset('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.socialProof, 'social_proof');
  addTextAsset('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.reEngagement, 're_engagement');
  if (content.whatsapp.hinglish) {
    addTextAsset('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.hinglish, 'pain_first_hinglish');
  }

  // Meta
  if (prefs?.text?.adCopy !== false) {
    addTextAsset('meta_headline', 'meta', 'both', JSON.stringify({ a: content.meta.headlineA, b: content.meta.headlineB }), 'pain_first');
    addTextAsset('meta_body', 'meta', 'india', content.meta.bodyIndia, 'pain_first');
    addTextAsset('meta_body', 'meta', 'usa', content.meta.bodyUSA, 'pain_first');
  }

  // Google UAC
  if (prefs?.text?.adCopy !== false) {
    addTextAsset('google_uac_variants', 'google', 'both', JSON.stringify(content.googleUAC), 'mixed');
  }

  // ASO
  addTextAsset('aso_subtitle', 'aso', 'both', content.aso.subtitle, 'pain_first');
  addTextAsset('aso_description', 'aso', 'both', content.aso.descriptionOpening, 'pain_first');

  // Email
  if (prefs?.text?.email !== false) {
    addTextAsset('email_day1', 'email', 'both', JSON.stringify({ subject: content.email.day1Subject, body: content.email.day1Body }), 'onboarding');
    addTextAsset('email_day5', 'email', 'both', JSON.stringify({ subject: content.email.day5Subject, body: content.email.day5Body }), 're_engagement');
    addTextAsset('email_day14', 'email', 'both', JSON.stringify({ subject: content.email.day14Subject, body: content.email.day14Body }), 'review_request');
  }

  // LinkedIn
  if (prefs?.text?.linkedin !== false) {
    addTextAsset('linkedin_founder_story', 'linkedin', 'both', content.linkedin.founderStoryFull, 'founder_story');
    addTextAsset('linkedin_data_post', 'linkedin', 'both', content.linkedin.buildInPublicFull, 'data_post');
  }

  // Community
  if (content.community) {
    if (prefs?.community?.whatsappGroupPost) addTextAsset('community_whatsapp_group', 'whatsapp', 'india', content.community.whatsappGroupPost, 'warm_network');
    if (prefs?.community?.facebookGroupPost) addTextAsset('community_facebook', 'meta', 'both', content.community.facebookGroupPost, 'discussion');
    if (prefs?.community?.indieHackersPost)  addTextAsset('community_indiehackers', 'other', 'both', content.community.indieHackersPost, 'build_in_public');
    if (prefs?.community?.twitterThread)     addTextAsset('community_twitter_thread', 'other', 'both', JSON.stringify(content.community.twitterThread), 'thread');
  }

  // Social proof
  if (content.socialProof) {
    if (prefs?.socialProof?.caseStudy)           addTextAsset('social_proof_case_study', 'other', 'both', JSON.stringify(content.socialProof.caseStudy), 'metrics_based');
    if (prefs?.socialProof?.testimonialBrief)    addTextAsset('social_proof_testimonial', 'other', 'both', JSON.stringify(content.socialProof.testimonialCardBrief), 'quote');
    addTextAsset('social_proof_review_response', 'other', 'both', JSON.stringify({ positive: content.socialProof.reviewResponsePositive, negative: content.socialProof.reviewResponseNegative }), 'response');
  }

  if (rows.length > 0) {
    await supabase.from('content_assets').insert(rows);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: LEARNING LOOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts learnings from regen reasons and updates brand_voice_profile.
 * Called weekly after metrics are available, and after each manual regeneration.
 * @param productId - Product UUID
 * @param founderId - Founder UUID
 */
export async function extractAndSaveLearnings(productId: string, founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: regenAssets } = await supabase
    .from('content_assets')
    .select('asset_type, channel, regen_reasons, text_content')
    .eq('product_id', productId)
    .not('regen_reasons', 'is', null)
    .gt('regen_count', 0);

  const learnings: Record<string, unknown>[] = [];
  const avoidPhrases: string[] = [];

  for (const asset of regenAssets ?? []) {
    const reasons = (asset.regen_reasons as Array<{ reason: string; note?: string }>) ?? [];
    for (const r of reasons) {
      if (r.reason === 'Too salesy') {
        learnings.push({ product_id: productId, founder_id: founderId, channel: asset.channel, learning_type: 'regen_reason', insight: 'Avoid salesy language — owner regenerated for being too promotional', applies_to: [asset.asset_type], week_number: 0 });
        avoidPhrases.push('limited time', "don't miss out", 'act now');
      }
      if (r.reason === 'Not my voice') {
        learnings.push({ product_id: productId, founder_id: founderId, channel: asset.channel, learning_type: 'regen_reason', insight: 'Owner prefers personal, conversational tone. Less corporate.', applies_to: [asset.asset_type], week_number: 0 });
      }
      if (r.note) {
        learnings.push({ product_id: productId, founder_id: founderId, channel: asset.channel, learning_type: 'regen_reason', insight: `Owner note: "${r.note}"`, applies_to: [asset.asset_type], week_number: 0 });
      }
    }
  }

  if (learnings.length > 0) {
    await supabase.from('content_learnings').insert(learnings);
  }

  if (avoidPhrases.length > 0) {
    const { data: product } = await supabase.from('products').select('brand_voice_profile').eq('id', productId).single();
    const existing = (product?.brand_voice_profile as Record<string, unknown>) ?? {};
    await supabase.from('products').update({
      brand_voice_profile: {
        ...existing,
        avoidPhrases: [...new Set([...((existing.avoidPhrases as string[]) ?? []), ...avoidPhrases])],
        extractedAt: new Date().toISOString(),
      },
    }).eq('id', productId);
  }

  // Advance approval_mode based on weeks count
  const { data: product } = await supabase.from('products').select('approval_weeks_count, approval_mode').eq('id', productId).single();
  const newCount = ((product?.approval_weeks_count as number) ?? 0) + 1;
  let newMode = (product?.approval_mode as string) ?? 'manual';
  if (newCount >= 5 && newMode === 'one_tap') newMode = 'auto';
  if (newCount >= 3 && newMode === 'manual') newMode = 'one_tap';

  await supabase.from('products').update({ approval_weeks_count: newCount, approval_mode: newMode }).eq('id', productId);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates all content assets for a product and saves them to content_assets table.
 * Called by weeklyBriefWorker (weekly) and POST /products/:id/content (manual trigger).
 * @param productId - UUID of the product
 * @param founderId - Must match product.founder_id
 * @param briefId   - Weekly brief to attach assets to (null for manual trigger)
 * @returns         The generated ContentOutput object
 * @throws {Error}  If product not found, ICP missing, or Claude returns invalid JSON
 * @security        founderId verified via DB query. consumeTokens() called before each Claude call.
 */
export async function generateContentAssets(
  productId: string,
  founderId: string,
  briefId: string | null = null
): Promise<ContentOutput> {
  const ctx = await assembleContext(productId, founderId);

  await consumeTokens(founderId, 'content_generation_sonnet', 30);

  const prefs = ctx.contentPreferences as Record<string, Record<string, boolean>>;
  const wantsVideo = prefs?.video && Object.values(prefs.video).some(Boolean);
  const wantsCommunity = prefs?.community && Object.values(prefs.community).some(Boolean);
  const wantsSocialProof = prefs?.socialProof && Object.values(prefs.socialProof).some(Boolean);
  const wantsVisual = prefs?.visual && Object.values(prefs.visual).some(Boolean);

  const productName = ((ctx.product as Record<string, unknown>).name as string);

  const userPrompt = `Generate complete marketing content for ${productName}.

Include:
- All text assets (whatsapp, meta, googleUAC, aso, email, linkedin)
- strategy (30/60/90 day plan)
${wantsVideo ? '- videoScripts (reels30s, shorts60s, appStorePreview, whatsappVoiceNote)' : ''}
${wantsVisual ? '- visualBriefs (metaImageBrief, carousel)' : ''}
${wantsCommunity ? '- community (all 5 post types)' : ''}
${wantsSocialProof ? `- socialProof (case study based on metrics: ${JSON.stringify(ctx.channelPerformance)})` : ''}

Performance prediction: predict which hook angle will outperform and explain why in strategy.weekOneFocus.

Creative fatigue: ${ctx.staleCampaigns.length > 0 ? `Flag for refresh in 30-day plan: ${ctx.staleCampaigns.map((c) => (c as Record<string, unknown>).channel).join(', ')}` : 'None.'}

Return ONLY valid JSON matching the schema. No other text.`;

  const rawOutput = await callSonnet(buildSystemPrompt(ctx), userPrompt, 4096);

  let content: ContentOutput;
  try {
    const cleaned = rawOutput.replace(/```json|```/g, '').trim();
    content = ContentOutputSchema.parse(JSON.parse(cleaned));
  } catch (e) {
    Sentry.captureException(e, { tags: { service: 'contentService', productId } });
    throw new Error(`Content generation JSON validation failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Haiku: char-limit enforcement + quality gate on WhatsApp painFirst
  await consumeTokens(founderId, 'content_generation_haiku', 15);
  content = await enforceCharLimits(content, founderId);

  const { score: waScore, flags: waFlags } = await scoreAsset('whatsapp_broadcast', content.whatsapp.painFirst, ctx.founderContext);
  if (waScore < 0.7) {
    await consumeTokens(founderId, 'content_regen_quality', 5);
    const regenWa = await callHaiku(
      `Rewrite this WhatsApp broadcast to score higher on quality.\nCurrent: "${content.whatsapp.painFirst}"\nIssues: ${JSON.stringify(waFlags)}\nRules: Max 160 chars. Pain-first opening. Clear CTA. Use customer quote if available: "${ctx.founderContext.bestCustomerQuote ?? ''}"\nReturn ONLY the rewritten text, no quotes.`
    );
    content = { ...content, whatsapp: { ...content.whatsapp, painFirst: regenWa.trim().substring(0, 160) } };
  }

  // Save text assets
  await saveAssets(content, ctx, briefId);

  // Video pipeline — async, non-blocking
  if (wantsVideo && content.videoScripts) {
    const videoPrefs = (prefs.video ?? {}) as Record<string, boolean>;
    const language = ((ctx.founderContext.language as string[]) ?? ['english_india'])[0] ?? 'english_india';
    const { voiceCloneId } = ctx;

    if (videoPrefs.reels30s && content.videoScripts.reels30s) {
      void generateVideo({ productId, founderId, briefId, scenes: content.videoScripts.reels30s.scenes, videoType: 'reels30s', language, voiceCloneId, assetType: 'video_reels_30s' }).catch((err) => Sentry.captureException(err));
    }
    if (videoPrefs.shorts60s && content.videoScripts.shorts60s) {
      void generateVideo({ productId, founderId, briefId, scenes: content.videoScripts.shorts60s.scenes, videoType: 'shorts60s', language, voiceCloneId, assetType: 'video_shorts_60s' }).catch((err) => Sentry.captureException(err));
    }
    if (videoPrefs.appStorePreview && content.videoScripts.appStorePreview) {
      void generateVideo({ productId, founderId, briefId, scenes: content.videoScripts.appStorePreview.scenes, videoType: 'appStorePreview', language, voiceCloneId, assetType: 'video_app_preview' }).catch((err) => Sentry.captureException(err));
    }
    if (videoPrefs.whatsappVoiceNote && content.videoScripts.whatsappVoiceNote) {
      void generateVoiceNote({ productId, founderId, briefId, script: content.videoScripts.whatsappVoiceNote.script, language: content.videoScripts.whatsappVoiceNote.language, voiceCloneId }).catch((err) => Sentry.captureException(err));
    }
  }

  // Learning loop — async
  void extractAndSaveLearnings(productId, founderId).catch((err) => Sentry.captureException(err));

  return content;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regenerates a single content asset with owner feedback applied.
 * Max 3 regenerations per asset per week.
 * Saves the regen reason to content_learnings for future generation improvement.
 * @param assetId        - UUID of the content_assets row
 * @param founderId      - Must match asset.founder_id
 * @param reason         - Regen reason (e.g. 'Too salesy', 'Not my voice')
 * @param additionalNote - Optional free-text note from the owner
 * @throws {Error} If asset not found, wrong founder, or regen limit reached
 * @security founderId verified against asset.founder_id before any write.
 */
export async function regenerateAsset(
  assetId: string,
  founderId: string,
  reason: string,
  additionalNote?: string
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: asset } = await supabase
    .from('content_assets')
    .select('*, products(*)')
    .eq('id', assetId)
    .eq('founder_id', founderId)
    .single();

  if (!asset) throw new Error('Asset not found or access denied');
  if ((asset.regen_count as number) >= 3) throw new Error('Maximum 3 regenerations per asset per week');

  await consumeTokens(founderId, 'content_regen', 5);

  const ctx = await assembleContext(asset.product_id as string, founderId);

  const newContent = await callSonnet(
    buildSystemPrompt(ctx),
    `Regenerate ONLY this specific asset: ${asset.asset_type}

Original content: "${asset.text_content}"

Owner feedback:
- Reason: ${reason}
- Additional note: ${additionalNote ?? 'none'}

Apply the feedback. Keep the same channel (${asset.channel}) and market (${asset.market}).
Return ONLY the new text content for this single asset. No JSON wrapper, no explanation.`
  );

  // Save regen reason as a learning
  await supabase.from('content_learnings').insert({
    product_id: asset.product_id, founder_id: founderId, channel: asset.channel,
    learning_type: 'regen_reason',
    insight: `${reason}${additionalNote ? ` — "${additionalNote}"` : ''}`,
    applies_to: [asset.asset_type],
    week_number: asset.generation_week ?? 0,
  });

  // Save as new asset (child of original)
  await supabase.from('content_assets').insert({
    product_id: asset.product_id, founder_id: founderId, brief_id: asset.brief_id,
    asset_type: asset.asset_type, channel: asset.channel, market: asset.market,
    language: asset.language, text_content: newContent.trim(),
    model_used: 'sonnet', status: 'pending', generation_week: asset.generation_week ?? 0,
    parent_asset_id: assetId, regen_count: 0, regen_reasons: [],
  });

  // Increment regen count on original
  const existingReasons = (asset.regen_reasons as Array<{ reason: string; note?: string; timestamp: string }>) ?? [];
  await supabase.from('content_assets').update({
    regen_count: (asset.regen_count as number) + 1,
    regen_reasons: [...existingReasons, { reason, note: additionalNote, timestamp: new Date().toISOString() }],
    updated_at: new Date().toISOString(),
  }).eq('id', assetId);

  void extractAndSaveLearnings(asset.product_id as string, founderId).catch((err) => Sentry.captureException(err));
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

type ChannelPerfMap = Record<string, { channel: string; installs: number; cpi: number; count: number }>;

function groupMetricsByChannel(metrics: Array<Record<string, unknown>>): ChannelPerfMap {
  return metrics.reduce<ChannelPerfMap>((acc, m) => {
    const campaign = m.campaigns as Record<string, unknown> | null;
    const ch = campaign?.channel as string | undefined;
    if (!ch) return acc;
    if (!acc[ch]) acc[ch] = { channel: ch, installs: 0, cpi: 0, count: 0 };
    acc[ch]!.installs += (m.installs as number | undefined) ?? 0;
    acc[ch]!.cpi += (m.cpi as number | undefined) ?? 0;
    acc[ch]!.count++;
    return acc;
  }, {});
}

function getWinningChannel(perf: Record<string, { channel: string; installs: number; cpi: number; count: number }>) {
  return Object.values(perf).sort((a, b) => b.installs - a.installs)[0] ?? null;
}

function getLosingChannels(perf: Record<string, { channel: string; installs: number; cpi: number; count: number }>) {
  const values = Object.values(perf);
  if (values.length < 2) return [];
  const avgCpi = values.reduce((s, v) => s + v.cpi, 0) / values.length;
  return values.filter((v) => v.cpi > avgCpi * 2 && v.installs < 5);
}
