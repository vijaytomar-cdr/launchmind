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
import { callSonnet, callHaiku } from '../lib/aiPlatform';
import { textToSpeech } from '../lib/elevenLabsClient';
import { renderVideo, pollRender } from '../lib/creatomateClient';
import { generateImage, buildMarketingImagePrompt, ImageStyle } from '../lib/replicateClient';
import sharp from 'sharp';
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
    // ADR-066: products.icp_embedding retired in migration 090. Semantic
    // playbook matching returns to this call site in 3.1D via RetrievalService.
    null,
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

Return: { "painFirst": bool, "moatPresent": bool, "ctaClear": bool, "charLimitOk": bool, "score": 0.0-1.0 }`, 512, { promptId: 'content_score', action: 'content_score' });

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
- Return the FULL content object with only violations fixed`, 4096, { founderId, promptId: 'content_char_limit', action: 'content_char_limit' });

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
  existingAssetId?: string; // when set, update this row instead of inserting
}

async function generateVideo(params: VideoJobParams): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { productId, founderId, briefId, scenes, videoType, language, voiceCloneId, assetType, existingAssetId } = params;

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
  const totalDuration = scenes.reduce((s, sc) => s + sc.durationSeconds, 0);
  const channel = videoType === 'appStorePreview' ? 'aso' : 'video';

  if (existingAssetId) {
    // Update the concept row in place — it becomes the rendered asset
    await supabase.from('content_assets').update({
      media_url: videoUrl, media_type: 'mp4',
      duration_seconds: totalDuration, status: 'pending', model_used: 'sonnet+creatomate',
    }).eq('id', existingAssetId);
  } else {
    await supabase.from('content_assets').insert({
      product_id: productId, founder_id: founderId, brief_id: briefId,
      asset_type: assetType, channel, market: 'both',
      media_url: videoUrl, media_type: 'mp4',
      duration_seconds: totalDuration, model_used: 'sonnet',
      status: 'pending', auto_approved: false, generation_week: 1,
    });
  }
}

async function generateVoiceNote(params: {
  productId: string; founderId: string; briefId: string | null;
  script: string; language: string; voiceCloneId: string | null;
  existingAssetId?: string; // when set, update this row instead of inserting
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { productId, founderId, briefId, script, language, voiceCloneId, existingAssetId } = params;

  const mp3 = await textToSpeech(script, language, voiceCloneId);
  if (mp3.length === 0) return;

  const path = `${founderId}/${productId}/audio/voice_note_${Date.now()}.mp3`;
  await supabase.storage.from('content-assets').upload(path, mp3);
  const { data } = supabase.storage.from('content-assets').getPublicUrl(path);
  const duration = Math.ceil(script.split(' ').length / 2.5);

  if (existingAssetId) {
    await supabase.from('content_assets').update({
      media_url: data.publicUrl, media_type: 'mp3',
      duration_seconds: duration, status: 'pending', model_used: 'sonnet+elevenlabs',
    }).eq('id', existingAssetId);
  } else {
    await supabase.from('content_assets').insert({
      product_id: productId, founder_id: founderId, brief_id: briefId,
      asset_type: 'whatsapp_voice_note', channel: 'whatsapp', market: 'india',
      media_url: data.publicUrl, media_type: 'mp3',
      duration_seconds: duration, model_used: 'sonnet', status: 'pending', auto_approved: false,
    });
  }
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

type AssetRow = {
  product_id: string; founder_id: string; brief_id: string | null;
  asset_type: string; channel: string; market: string; language: string;
  text_content?: string; structured_data?: unknown; hook_angle: string;
  model_used: string; status: string; auto_approved: boolean; generation_week: number;
};

function makeRowBuilder(
  productId: string, founderId: string, briefId: string | null,
  lang: string, approvalMode: string, weeksLive: number
) {
  return (type: string, channel: string, market: string, textContent: string, hookAngle: string): AssetRow => ({
    product_id: productId, founder_id: founderId, brief_id: briefId,
    asset_type: type, channel, market, language: lang,
    text_content: textContent, hook_angle: hookAngle,
    model_used: 'sonnet',
    status: determineInitialStatus(channel, approvalMode, weeksLive),
    auto_approved: false, generation_week: weeksLive,
  });
}

/**
 * Saves core text assets (WhatsApp, Meta, Google, ASO, Email, LinkedIn) to DB.
 * Called first so the checklist "Ad copy & messaging" stage marks done immediately.
 */
async function saveCoreAssets(
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
  const row = makeRowBuilder(productId, founderId, briefId, lang, ctx.approvalMode, weeksLive);

  const rows: AssetRow[] = [
    row('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.painFirst, 'pain_first'),
    row('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.socialProof, 'social_proof'),
    row('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.reEngagement, 're_engagement'),
  ];
  if (content.whatsapp.hinglish) {
    rows.push(row('whatsapp_broadcast', 'whatsapp', 'india', content.whatsapp.hinglish, 'pain_first_hinglish'));
  }
  if (prefs?.text?.adCopy !== false) {
    rows.push(row('meta_headline', 'meta', 'both', JSON.stringify({ a: content.meta.headlineA, b: content.meta.headlineB }), 'pain_first'));
    rows.push(row('meta_body', 'meta', 'india', content.meta.bodyIndia, 'pain_first'));
    rows.push(row('meta_body', 'meta', 'usa', content.meta.bodyUSA, 'pain_first'));
    rows.push(row('google_uac_variants', 'google', 'both', JSON.stringify(content.googleUAC), 'mixed'));
  }
  rows.push(row('aso_subtitle', 'aso', 'both', content.aso.subtitle, 'pain_first'));
  rows.push(row('aso_description', 'aso', 'both', content.aso.descriptionOpening, 'pain_first'));
  rows.push(row('aso_keywords', 'aso', 'india', JSON.stringify(content.aso.keywordsIndia), 'keywords'));
  rows.push(row('aso_keywords', 'aso', 'usa', JSON.stringify(content.aso.keywordsUSA), 'keywords'));
  if (prefs?.text?.email !== false) {
    rows.push(row('email_day1', 'email', 'both', JSON.stringify({ subject: content.email.day1Subject, body: content.email.day1Body }), 'onboarding'));
    rows.push(row('email_day5', 'email', 'both', JSON.stringify({ subject: content.email.day5Subject, body: content.email.day5Body }), 're_engagement'));
    rows.push(row('email_day14', 'email', 'both', JSON.stringify({ subject: content.email.day14Subject, body: content.email.day14Body }), 'review_request'));
  }
  if (prefs?.text?.linkedin !== false) {
    rows.push(row('linkedin_founder_story', 'linkedin', 'both', content.linkedin.founderStoryFull, 'founder_story'));
    rows.push(row('linkedin_data_post', 'linkedin', 'both', content.linkedin.buildInPublicFull, 'data_post'));
  }

  if (rows.length > 0) await supabase.from('content_assets').insert(rows);
}

/**
 * Saves community and social proof assets to DB.
 * Called after saveCoreAssets so the checklist "Community & social proof" stage marks done separately.
 */
async function saveCommunityAssets(
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
  const row = makeRowBuilder(productId, founderId, briefId, lang, ctx.approvalMode, weeksLive);

  const rows: AssetRow[] = [];
  if (content.community) {
    if (prefs?.community?.whatsappGroupPost) rows.push(row('community_whatsapp_group', 'whatsapp', 'india', content.community.whatsappGroupPost, 'warm_network'));
    if (prefs?.community?.facebookGroupPost) rows.push(row('community_facebook', 'meta', 'both', content.community.facebookGroupPost, 'discussion'));
    if (prefs?.community?.indieHackersPost)  rows.push(row('community_indiehackers', 'other', 'both', content.community.indieHackersPost, 'build_in_public'));
    if (prefs?.community?.twitterThread)     rows.push(row('community_twitter_thread', 'other', 'both', JSON.stringify(content.community.twitterThread), 'thread'));
  }
  if (content.socialProof) {
    if (prefs?.socialProof?.caseStudy)        rows.push(row('social_proof_case_study', 'other', 'both', JSON.stringify(content.socialProof.caseStudy), 'metrics_based'));
    if (prefs?.socialProof?.testimonialBrief) rows.push(row('social_proof_testimonial', 'other', 'both', JSON.stringify(content.socialProof.testimonialCardBrief), 'quote'));
    rows.push(row('social_proof_review_response', 'other', 'both', JSON.stringify({ positive: content.socialProof.reviewResponsePositive, negative: content.socialProof.reviewResponseNegative }), 'response'));
  }

  if (rows.length > 0) await supabase.from('content_assets').insert(rows);
}

/**
 * Saves visual brief assets to DB.
 * Called after saveCommunityAssets so the checklist "Visual assets" stage marks done separately.
 */
async function saveVisualAssets(
  content: ContentOutput,
  ctx: Awaited<ReturnType<typeof assembleContext>>,
  briefId: string | null
): Promise<void> {
  if (!content.visualBriefs) return;
  const supabase = getSupabaseAdmin();
  const { product, founderContext, weeksLive } = ctx;
  const productId = (product as Record<string, unknown>).id as string;
  const founderId = (product as Record<string, unknown>).founder_id as string;
  const lang = ((founderContext.language as string[]) ?? ['english'])[0] ?? 'english';
  const row = makeRowBuilder(productId, founderId, briefId, lang, ctx.approvalMode, weeksLive);

  const rows: AssetRow[] = [
    row('meta_image_brief', 'meta', 'both', JSON.stringify(content.visualBriefs.metaImageBrief), 'visual'),
    row('carousel_brief', 'meta', 'both', JSON.stringify(content.visualBriefs.carousel), 'visual'),
  ];

  await supabase.from('content_assets').insert(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5b: VIDEO CONCEPT ROWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Saves video scripts as 'concept' rows so the owner can pick which one to render.
 * No Creatomate or ElevenLabs calls — just the script stored in structured_data.
 */
async function saveVideoConcepts(
  videoScripts: NonNullable<ContentOutput['videoScripts']>,
  ctx: Awaited<ReturnType<typeof assembleContext>>,
  briefId: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const product = ctx.product as Record<string, unknown>;
  const productId = product.id as string;
  const founderId = product.founder_id as string;
  const lang = ((ctx.founderContext.language as string[]) ?? ['english'])[0] ?? 'english';
  const prefs = ctx.contentPreferences as Record<string, Record<string, boolean>>;
  const videoPrefs = (prefs?.video ?? {}) as Record<string, boolean>;

  type ConceptRow = {
    product_id: string; founder_id: string; brief_id: string | null;
    asset_type: string; channel: string; market: string; language: string;
    text_content: string; structured_data: unknown; hook_angle: string;
    model_used: string; status: string; auto_approved: boolean; generation_week: number;
  };

  const rows: ConceptRow[] = [];

  const makeRow = (
    assetType: string, channel: string, openingLine: string, data: unknown
  ): ConceptRow => ({
    product_id: productId, founder_id: founderId, brief_id: briefId,
    asset_type: assetType, channel, market: 'both', language: lang,
    text_content: openingLine, structured_data: data,
    hook_angle: 'pain_first', model_used: 'sonnet',
    status: 'concept', auto_approved: false, generation_week: ctx.weeksLive,
  });

  if (videoPrefs.reels30s && videoScripts.reels30s) {
    const scenes = videoScripts.reels30s.scenes;
    rows.push(makeRow('video_reels_30s', 'meta',
      scenes[0]?.voiceScript?.slice(0, 120) ?? '',
      { videoType: 'reels30s', language: lang, voiceCloneId: ctx.voiceCloneId, scenes }
    ));
  }
  if (videoPrefs.shorts60s && videoScripts.shorts60s) {
    const scenes = videoScripts.shorts60s.scenes;
    rows.push(makeRow('video_shorts_60s', 'meta',
      scenes[0]?.voiceScript?.slice(0, 120) ?? '',
      { videoType: 'shorts60s', language: lang, voiceCloneId: ctx.voiceCloneId, scenes }
    ));
  }
  if (videoPrefs.appStorePreview && videoScripts.appStorePreview) {
    const scenes = videoScripts.appStorePreview.scenes;
    rows.push(makeRow('video_app_preview', 'aso',
      scenes[0]?.voiceScript?.slice(0, 120) ?? '',
      { videoType: 'appStorePreview', language: lang, voiceCloneId: ctx.voiceCloneId, scenes }
    ));
  }
  if (videoPrefs.whatsappVoiceNote && videoScripts.whatsappVoiceNote) {
    rows.push(makeRow('whatsapp_voice_note', 'whatsapp',
      videoScripts.whatsappVoiceNote.script.slice(0, 120),
      { videoType: 'voiceNote', language: videoScripts.whatsappVoiceNote.language, voiceCloneId: ctx.voiceCloneId, script: videoScripts.whatsappVoiceNote.script }
    ));
  }

  if (rows.length > 0) {
    await supabase.from('content_assets').insert(rows);
  }
}

/**
 * Triggers actual Creatomate / ElevenLabs render for a video concept the owner selected.
 * Updates the concept row in place: concept → pending (rendering) → pending (done, awaits approval).
 * @param assetId   - UUID of the content_assets row with status='concept'
 * @param founderId - Must match asset.founder_id
 * @throws {Error} If asset not found or not a concept
 * @security founderId verified against asset.founder_id before write.
 */
export async function renderConceptAsset(assetId: string, founderId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: asset, error } = await supabase
    .from('content_assets')
    .select('*')
    .eq('id', assetId)
    .eq('founder_id', founderId)
    .eq('status', 'concept')
    .single();

  if (error || !asset) throw new Error('Concept asset not found or already rendering');

  // Mark as rendering immediately so the frontend can show progress
  await supabase
    .from('content_assets')
    .update({ status: 'pending', render_started_at: new Date().toISOString() })
    .eq('id', assetId);

  const data = asset.structured_data as Record<string, unknown>;
  const productId = asset.product_id as string;
  const briefId = (asset.brief_id as string | null) ?? null;
  const language = (data.language as string) ?? 'english_india';
  const voiceCloneId = (data.voiceCloneId as string | null) ?? null;
  const videoType = data.videoType as string;

  if (videoType === 'voiceNote') {
    const script = data.script as string;
    await generateVoiceNote({ productId, founderId, briefId, script, language, voiceCloneId, existingAssetId: assetId });
  } else {
    const scenes = data.scenes as VideoJobParams['scenes'];
    const validType = videoType as 'reels30s' | 'shorts60s' | 'appStorePreview';
    const assetTypeMap: Record<string, string> = {
      reels30s: 'video_reels_30s', shorts60s: 'video_shorts_60s', appStorePreview: 'video_app_preview',
    };
    await generateVideo({
      productId, founderId, briefId, scenes, videoType: validType,
      language, voiceCloneId, assetType: assetTypeMap[videoType] ?? (asset.asset_type as string),
      existingAssetId: assetId,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE GENERATION FROM BRIEF (Replicate Flux.1 Schnell)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates an actual AI image from a meta_image_brief or carousel_brief asset
 * using Replicate Flux.1 Schnell. Uploads the result to Supabase Storage and
 * updates the asset's media_url field.
 * @param assetId   - UUID of the content_assets row (meta_image_brief or carousel_brief)
 * @param founderId - Must match asset.founder_id
 * @throws {Error}  If asset not found, wrong type, or generation fails
 * @security founderId verified against asset.founder_id before write.
 */
export async function generateImageFromBrief(
  assetId: string,
  founderId: string,
  opts: { style?: ImageStyle } = {},
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: asset, error } = await supabase
    .from('content_assets')
    .select('*')
    .eq('id', assetId)
    .eq('founder_id', founderId)
    .single();

  if (error || !asset) throw new Error('Asset not found or access denied');

  const assetType = asset.asset_type as string;
  if (!['meta_image_brief', 'carousel_brief'].includes(assetType)) {
    throw new Error(`Image generation not supported for asset type: ${assetType}`);
  }

  // Fetch product's content_preferences + scraped_meta (for real screenshots)
  const { data: product } = await supabase
    .from('products')
    .select('content_preferences, scraped_meta')
    .eq('id', asset.product_id as string)
    .single();

  const prefs = product?.content_preferences as Record<string, Record<string, string>> | null;
  const logoUrl: string | undefined = prefs?.visual?.logoUrl ?? undefined;
  const style: ImageStyle = opts.style ?? (prefs?.visual?.imageStyle as ImageStyle | undefined) ?? 'photorealistic';

  // Real marketing images collected during intake (permanent Storage URLs)
  const scrapedMeta = product?.scraped_meta as Record<string, unknown> | null;
  const marketingImages: string[] = (scrapedMeta?.marketingImages as string[] | undefined) ?? [];

  // Mark as rendering so the frontend can show progress immediately
  await supabase
    .from('content_assets')
    .update({ render_started_at: new Date().toISOString() })
    .eq('id', assetId);

  console.log(`[contentService] generateImageFromBrief — asset ${assetId}, type ${assetType}, style ${style}, logo ${logoUrl ? 'yes' : 'none'}`);

  const briefRaw = asset.text_content as string;
  let briefFields: Record<string, string> = {};
  try {
    const parsed = JSON.parse(briefRaw) as Record<string, unknown>;
    // carousel_brief: use first slide's visual direction as the main visual
    if (assetType === 'carousel_brief') {
      const slides = (parsed.slides as Array<Record<string, string>> | undefined) ?? [];
      const s1 = slides[0] ?? {};
      briefFields = {
        mainVisual: s1.visual ?? 'clean modern professional mobile app screenshot',
        emotionToConvey: 'trust',
        backgroundColor: '#1a1a2e',
      };
    } else {
      briefFields = parsed as Record<string, string>;
    }
  } catch {
    throw new Error('Invalid brief JSON in asset text_content');
  }

  let imgBuffer: Buffer;

  // ── Real screenshot fast-path ──────────────────────────────────────────────
  // For "mockup" style, use the first real app screenshot collected during intake
  // instead of asking Flux.1 to hallucinate app UI (which always produces fake text).
  // For other styles, still use Flux.1 but mention the real UI exists in the prompt.
  const useRealScreenshot = style === 'mockup' && marketingImages.length > 0;

  if (useRealScreenshot) {
    const realImageUrl = marketingImages[0];
    console.log(`[contentService] generateImageFromBrief — using real screenshot: ${realImageUrl.slice(0, 80)}`);
    const imgResponse = await fetch(realImageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!imgResponse.ok) throw new Error(`Failed to download real screenshot: ${imgResponse.status}`);
    imgBuffer = Buffer.from(await imgResponse.arrayBuffer() as ArrayBuffer);
  } else {
    // ── Flux.1 AI generation path ────────────────────────────────────────────
    // For photorealistic/graphic styles, or when no real screenshots are available.
    // If screenshots exist, mention them in the prompt so the model understands the context.
    const mainVisual = briefFields.mainVisual ?? 'professional marketing image for a mobile app';
    const enrichedMainVisual = marketingImages.length > 0 && style === 'photorealistic'
      ? `${mainVisual} — the app has been photographed with real screenshots showing the booking interface`
      : mainVisual;

    const prompt = buildMarketingImagePrompt({
      mainVisual:      enrichedMainVisual,
      emotionToConvey: briefFields.emotionToConvey,
      backgroundColor: briefFields.backgroundColor,
      doNotInclude:    briefFields.doNotInclude,
      canvaTemplate:   briefFields.canvaTemplate,
    }, style);

    console.log(`[contentService] generateImageFromBrief — Flux.1 prompt: ${prompt.slice(0, 120)}...`);
    const imageUrl = await generateImage({ prompt });
    console.log(`[contentService] generateImageFromBrief — Replicate returned: ${imageUrl.slice(0, 80)}...`);

    const imgResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!imgResponse.ok) throw new Error(`Failed to download Replicate image: ${imgResponse.status}`);
    imgBuffer = Buffer.from(await imgResponse.arrayBuffer() as ArrayBuffer);
  }

  // Composite logo if configured — bottom-right corner at 14% image width
  if (logoUrl) {
    imgBuffer = await _compositeLogoOntoImage(imgBuffer, logoUrl);
  }

  const productId = asset.product_id as string;
  const storagePath = `${founderId}/${productId}/images/${assetType}_${assetId.slice(0, 8)}_${style}.png`;

  const { error: uploadError } = await supabase.storage
    .from('content-assets')
    .upload(storagePath, imgBuffer, { contentType: 'image/png', upsert: true });

  const modelUsed = useRealScreenshot
    ? `real-screenshot+${style}${logoUrl ? '+logo' : ''}`
    : `sonnet+replicate-flux-schnell+${style}`;

  if (uploadError) {
    console.warn(`[contentService] Storage upload failed, using direct URL: ${uploadError.message}`);
    // For real-screenshot path, imgBuffer holds the data — no fallback URL available
    // For Flux.1 path, we no longer have imageUrl in scope here, so just log and fail cleanly
    if (!useRealScreenshot) {
      await supabase.from('content_assets').update({
        media_url: '',
        media_type: 'png',
        model_used: modelUsed,
        updated_at: new Date().toISOString(),
      }).eq('id', assetId);
    }
    return;
  }

  const { data: urlData } = supabase.storage.from('content-assets').getPublicUrl(storagePath);

  await supabase.from('content_assets').update({
    media_url: urlData.publicUrl,
    media_type: 'png',
    model_used: modelUsed,
    updated_at: new Date().toISOString(),
  }).eq('id', assetId);

  console.log(`[contentService] generateImageFromBrief — done, style=${style}, source=${useRealScreenshot ? 'real-screenshot' : 'flux1'}, logo=${logoUrl ? 'composited' : 'none'}`);
}

async function _compositeLogoOntoImage(imageBuffer: Buffer, logoUrl: string): Promise<Buffer> {
  try {
    const logoRes = await fetch(logoUrl, { signal: AbortSignal.timeout(10_000) });
    if (!logoRes.ok) {
      console.warn(`[contentService] Logo fetch failed (${logoRes.status}), skipping composite`);
      return imageBuffer;
    }
    const logoRaw = Buffer.from(await logoRes.arrayBuffer());
    const { width = 1080, height = 1080 } = await sharp(imageBuffer).metadata();
    const logoSize = Math.round(width * 0.14);
    const padding  = Math.round(width * 0.04);

    const resizedLogo = await sharp(logoRaw)
      .resize(logoSize, logoSize, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const { width: logoW = logoSize, height: logoH = logoSize } = await sharp(resizedLogo).metadata();

    return sharp(imageBuffer)
      .composite([{ input: resizedLogo, left: width - logoW - padding, top: height - logoH - padding }])
      .png()
      .toBuffer();
  } catch (err) {
    console.warn('[contentService] Logo composite failed, returning original image:', err);
    return imageBuffer;
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
  briefId: string | null = null,
  force = false
): Promise<ContentOutput> {
  console.log(`[contentService] generateContentAssets starting for product ${productId} (force=${force})`);
  const supabase = getSupabaseAdmin();

  // When force=true, delete all existing assets so we start fresh
  if (force) {
    await supabase.from('content_assets').delete().eq('product_id', productId).eq('founder_id', founderId);
    console.log(`[contentService] force=true — existing assets deleted`);
  }

  // Check which sections already have assets (only relevant when force=false)
  const { data: existingAssets } = await supabase
    .from('content_assets')
    .select('asset_type')
    .eq('product_id', productId)
    .eq('founder_id', founderId);

  const existingTypes = new Set((existingAssets ?? []).map((a: { asset_type: string }) => a.asset_type));
  const hasCopy      = existingTypes.has('whatsapp_broadcast');
  const hasCommunity = existingTypes.has('community_whatsapp_group') || existingTypes.has('social_proof_case_study');
  const hasVisual    = existingTypes.has('meta_image_brief');
  const hasVideo     = existingTypes.has('video_reels_30s');

  const ctx = await assembleContext(productId, founderId);
  console.log(`[contentService] context assembled, calling Sonnet...`);

  await consumeTokens(founderId, 'content_generation_sonnet', 30);

  // Default all section prefs to true if not configured — generate everything unless explicitly disabled
  const prefs = ctx.contentPreferences as Record<string, Record<string, boolean>>;
  const _wantsVideo      = prefs?.video      ? Object.values(prefs.video).some(Boolean)      : true;
  const wantsCommunity  = prefs?.community  ? Object.values(prefs.community).some(Boolean)  : true;
  const wantsSocialProof= prefs?.socialProof? Object.values(prefs.socialProof).some(Boolean): true;
  const _wantsVisual     = prefs?.visual     ? Object.values(prefs.visual).some(Boolean)     : true;

  // Determine which sections to generate.
  // For "generate remaining" (force=false): ignore preferences — only check DB existence.
  // Preferences only gate the initial auto-generation, not user-triggered "fill missing" runs.
  const needsCopy      = force || !hasCopy;
  const needsCommunity = force || !hasCommunity;
  const needsVisual    = force || !hasVisual;
  const needsVideo     = force || !hasVideo;


  if (!needsCopy && !needsCommunity && !needsVisual && !needsVideo) {
    console.log(`[contentService] all sections already generated — nothing to do`);
    // Return a minimal stub so callers don't crash; real content is in DB
    return {} as ContentOutput;
  }

  console.log(`[contentService] sections to generate: copy=${needsCopy} community=${needsCommunity} visual=${needsVisual} video=${needsVideo}`);

  const productName = ((ctx.product as Record<string, unknown>).name as string);

  // Build prompt sections dynamically — only include what needs to be generated
  const promptSections: string[] = [];

  if (needsCopy) {
    promptSections.push(`  "whatsapp": {
    "painFirst": "REQUIRED — max 160 chars. Open with the customer's pain. Embed their exact quote.",
    "socialProof": "REQUIRED — max 160 chars. Lead with a result or number.",
    "reEngagement": "REQUIRED — max 160 chars. For lapsed users — remind them of the drop-off they'll regret.",
    "hinglish": "max 160 chars — ONLY include if founder language includes hinglish, else omit this key"
  }`);
    promptSections.push(`  "meta": {
    "headlineA": "REQUIRED — max 40 chars. Pain-first hook.",
    "headlineB": "REQUIRED — max 40 chars. Different angle — outcome-first.",
    "bodyIndia": "REQUIRED — max 125 chars. India copy — embed MOAT.",
    "bodyUSA": "REQUIRED — max 125 chars. USA copy — embed MOAT.",
    "linkDesc": "REQUIRED — max 30 chars."
  }`);
    promptSections.push(`  "googleUAC": {"v1": "REQUIRED — max 30 chars", "v2": "REQUIRED — max 30 chars", "v3": "REQUIRED — max 30 chars", "v4": "REQUIRED — max 30 chars", "v5": "REQUIRED — max 30 chars"}`);
    promptSections.push(`  "aso": {
    "subtitle": "REQUIRED — max 30 chars",
    "descriptionOpening": "REQUIRED — max 250 chars. First 2 sentences of App Store description.",
    "keywordsIndia": ["keyword1","keyword2","keyword3","keyword4","keyword5","keyword6","keyword7","keyword8","keyword9","keyword10"],
    "keywordsUSA": ["keyword1","keyword2","keyword3","keyword4","keyword5","keyword6","keyword7","keyword8","keyword9","keyword10"]
  }`);
    promptSections.push(`  "email": {
    "day1Subject": "REQUIRED — max 50 chars", "day1Body": "REQUIRED — max 800 chars. Onboarding. Warm, direct.",
    "day5Subject": "REQUIRED — max 50 chars", "day5Body": "REQUIRED — max 400 chars. Re-engagement.",
    "day14Subject": "REQUIRED — max 50 chars", "day14Body": "REQUIRED — max 300 chars. Review request."
  }`);
    promptSections.push(`  "linkedin": {
    "founderStoryHook": "REQUIRED — max 120 chars. First line that stops the scroll.",
    "founderStoryFull": "REQUIRED — max 3000 chars. Full founder story post.",
    "buildInPublicHook": "REQUIRED — max 120 chars.",
    "buildInPublicFull": "REQUIRED — max 2000 chars. Build-in-public post with data."
  }`);
    promptSections.push(`  "strategy": {
    "day30": [{"week":1,"channel":"whatsapp","action":"what to do this week","budget":"$0"},{"week":2,"channel":"meta","action":"what to do week 2","budget":"$25"},{"week":3,"channel":"email","action":"what to do week 3","budget":"$0"},{"week":4,"channel":"google","action":"what to do week 4","budget":"$50"}],
    "day60": [{"week":5,"channel":"whatsapp","action":"scale what worked","budget":"$0"},{"week":6,"channel":"meta","action":"new creative","budget":"$75"},{"week":7,"channel":"linkedin","action":"founder story post","budget":"$0"},{"week":8,"channel":"google","action":"expand UAC","budget":"$100"}],
    "day90": [{"week":9,"channel":"meta","action":"retargeting","budget":"$150"},{"week":10,"channel":"whatsapp","action":"referral campaign","budget":"$0"},{"week":11,"channel":"google","action":"scale winning channel","budget":"$200"},{"week":12,"channel":"email","action":"lifecycle automation","budget":"$0"}],
    "primaryChannel": "whatsapp",
    "weekOneFocus": "One sentence: the single most important action in week 1 and why.",
    "budgetAllocation": {"whatsapp":0,"meta":40,"google":40,"email":0,"linkedin":0,"aso":20},
    "excludedChannels": []
  }`);
  }

  if (needsVisual) {
    promptSections.push(`  "visualBriefs": {
    "metaImageBrief": {
      "backgroundColor": "#hexcolor — choose a warm or vibrant brand colour",
      "mainVisual": "SINGLE SCENE ONLY — describe ONE positive moment showing the resolved outcome (e.g. 'smiling homeowner in bright modern kitchen shaking hands with uniformed technician'). NEVER use split panels, before/after, left/right compositions, or dark moody scenes. Focus on the happy resolution: customer + service provider together, bright warm space.",
      "headline": "REQUIRED — max 40 chars",
      "subtext": "REQUIRED — max 80 chars",
      "textColors": {"headline": "#ffffff", "subtext": "#eeeeee"},
      "emotionToConvey": "single word: trust / relief / confidence / warmth",
      "doNotInclude": "split panels, dark rooms, silhouettes, anxious expressions, before-after compositions, text overlays",
      "canvaTemplate": "clean white or bold gradient — warm tones, never dark cinematic"
    },
    "carousel": {"slides": [
      {"slideNumber":1,"type":"hook","headline":"max 60 chars — stop-the-scroll opener","body":"max 120 chars","visual":"describe image"},
      {"slideNumber":2,"type":"problem","headline":"max 60 chars","body":"max 120 chars","visual":"describe image"},
      {"slideNumber":3,"type":"solution","headline":"max 60 chars","body":"max 120 chars","visual":"describe image"},
      {"slideNumber":4,"type":"feature","headline":"max 60 chars","body":"max 120 chars","visual":"describe image"},
      {"slideNumber":5,"type":"proof","headline":"max 60 chars","body":"max 120 chars","visual":"describe image"},
      {"slideNumber":6,"type":"objection","headline":"max 60 chars","body":"max 120 chars","visual":"describe image"},
      {"slideNumber":7,"type":"cta","headline":"max 60 chars","body":"max 120 chars","visual":"describe image"}
    ]}
  }`);
  }

  if (needsVideo) {
    promptSections.push(`  "videoScripts": {
    "reels30s": {"scenes": [
      {"sceneNumber":1,"durationSeconds":6,"label":"Hook","voiceScript":"opening line spoken aloud","textOverlay":"max 60 chars on screen","visualDirection":"what the camera shows","backgroundColor":"#hexcolor"},
      {"sceneNumber":2,"durationSeconds":8,"label":"Problem","voiceScript":"problem statement","textOverlay":"max 60 chars","visualDirection":"visual of the pain point","backgroundColor":"#hexcolor"},
      {"sceneNumber":3,"durationSeconds":10,"label":"Solution","voiceScript":"how the app solves it","textOverlay":"max 60 chars","visualDirection":"show the app feature","backgroundColor":"#hexcolor"},
      {"sceneNumber":4,"durationSeconds":6,"label":"CTA","voiceScript":"download now line","textOverlay":"max 60 chars","visualDirection":"app icon + store badge","backgroundColor":"#hexcolor"}
    ]},
    "shorts60s": {"scenes": [
      {"sceneNumber":1,"durationSeconds":8,"label":"Hook","voiceScript":"opening","textOverlay":"max 60 chars","visualDirection":"describe shot","backgroundColor":"#hexcolor"},
      {"sceneNumber":2,"durationSeconds":12,"label":"Problem","voiceScript":"problem","textOverlay":"max 60 chars","visualDirection":"describe shot","backgroundColor":"#hexcolor"},
      {"sceneNumber":3,"durationSeconds":15,"label":"Demo","voiceScript":"walkthrough","textOverlay":"max 60 chars","visualDirection":"screen recording style","backgroundColor":"#hexcolor"},
      {"sceneNumber":4,"durationSeconds":15,"label":"Social proof","voiceScript":"testimonial or stat","textOverlay":"max 60 chars","visualDirection":"review card or metric","backgroundColor":"#hexcolor"},
      {"sceneNumber":5,"durationSeconds":10,"label":"CTA","voiceScript":"close with urgency","textOverlay":"max 60 chars","visualDirection":"app download screen","backgroundColor":"#hexcolor"}
    ]},
    "appStorePreview": {"scenes": [
      {"sceneNumber":1,"durationSeconds":6,"voiceScript":"opening benefit","textOverlay":"max 60 chars","useScreenshot":true},
      {"sceneNumber":2,"durationSeconds":6,"voiceScript":"key feature 1","textOverlay":"max 60 chars","useScreenshot":true},
      {"sceneNumber":3,"durationSeconds":6,"voiceScript":"key feature 2","textOverlay":"max 60 chars","useScreenshot":true},
      {"sceneNumber":4,"durationSeconds":6,"voiceScript":"social proof","textOverlay":"max 60 chars","useScreenshot":false},
      {"sceneNumber":5,"durationSeconds":6,"voiceScript":"CTA","textOverlay":"max 60 chars","useScreenshot":false}
    ]},
    "whatsappVoiceNote": {"script": "max 400 chars — casual voicemail-style, sounds like a friend recommending the app", "language": "en"}
  }`);
  }

  if (needsCommunity && wantsCommunity) {
    promptSections.push(`  "community": {
    "whatsappGroupPost": "max 600 chars — sounds like a real person, not an ad",
    "facebookGroupPost": "max 1500 chars",
    "indieHackersPost": "max 3000 chars — build in public style",
    "twitterThread": ["tweet 1 max 280","tweet 2 max 280","tweet 3 max 280","tweet 4 max 280","tweet 5 max 280"],
    "productHuntComment": "max 500 chars"
  }`);
  }

  if (needsCommunity && wantsSocialProof) {
    promptSections.push(`  "socialProof": {
    "caseStudy": {"headline":"max 80 chars","situation":"max 300 chars","recommendation":"max 200 chars","whatHappened":"max 400 chars","insight":"max 200 chars","currentPosition":"max 200 chars"},
    "testimonialCardBrief": {"quoteToUse":"the exact quote to display","attribution":"name, role","backgroundColor":"#hex","quoteStyle":"large or pull"},
    "reviewResponsePositive": "max 300 chars — response to a 5-star review",
    "reviewResponseNegative": "max 300 chars — empathetic response to a 1-star review"
  }`);
  }

  const userPrompt = `Generate marketing content for ${productName}. Use the product context from the system prompt.

Return ONLY a JSON object with EXACTLY these keys (no others):

{
${promptSections.join(',\n')}
}

DO NOT wrap in markdown. Return raw JSON only. Every REQUIRED field must be present.
Creative fatigue: ${ctx.staleCampaigns.length > 0 ? `Flag for refresh in day30 plan: ${ctx.staleCampaigns.map((c) => (c as Record<string, unknown>).channel).join(', ')}` : 'None.'}`;

  const rawOutput = await callSonnet(buildSystemPrompt(ctx), userPrompt, 12000, { founderId, productId, promptId: 'content_assets_generation', action: 'content_assets_generation' });
  console.log(`[contentService] Sonnet response received (${rawOutput.length} chars)`);

  let content: ContentOutput;
  try {
    // Extract JSON from markdown code fence if Claude wraps its response
    let cleaned = rawOutput.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const parsed = JSON.parse(cleaned);

    // Use partial schema — only the sections we asked for will be present
    const PartialSchema = ContentOutputSchema.partial();
    const strictResult = PartialSchema.safeParse(parsed);
    if (strictResult.success) {
      content = strictResult.data as ContentOutput;
    } else {
      // Log which fields failed, then attempt lenient extraction
      const failedPaths = strictResult.error.errors.map((e) => e.path.join('.')).join(', ');
      console.warn(`[contentService] Validation warnings (lenient mode): ${failedPaths}`);

      // Fix common structural issues Claude sometimes returns
      if (parsed.strategy) {
        // strategy.day30/60/90 sometimes returned as object — convert to array
        for (const key of ['day30', 'day60', 'day90'] as const) {
          if (parsed.strategy[key] && !Array.isArray(parsed.strategy[key])) {
            parsed.strategy[key] = Object.values(parsed.strategy[key] as Record<string, unknown>);
          }
        }
        // weekOneFocus sometimes returned as object
        if (typeof parsed.strategy.weekOneFocus === 'object') {
          parsed.strategy.weekOneFocus = JSON.stringify(parsed.strategy.weekOneFocus);
        }
      }
      // Truncate any fields that exceed char limits
      if (parsed.whatsapp?.painFirst?.length > 160) parsed.whatsapp.painFirst = (parsed.whatsapp.painFirst as string).slice(0, 160);
      if (parsed.whatsapp?.socialProof?.length > 160) parsed.whatsapp.socialProof = (parsed.whatsapp.socialProof as string).slice(0, 160);
      if (parsed.whatsapp?.reEngagement?.length > 160) parsed.whatsapp.reEngagement = (parsed.whatsapp.reEngagement as string).slice(0, 160);
      if (parsed.meta?.headlineA?.length > 40) parsed.meta.headlineA = (parsed.meta.headlineA as string).slice(0, 40);
      if (parsed.meta?.headlineB?.length > 40) parsed.meta.headlineB = (parsed.meta.headlineB as string).slice(0, 40);
      if (parsed.meta?.bodyIndia?.length > 125) parsed.meta.bodyIndia = (parsed.meta.bodyIndia as string).slice(0, 125);
      if (parsed.meta?.bodyUSA?.length > 125) parsed.meta.bodyUSA = (parsed.meta.bodyUSA as string).slice(0, 125);
      if (parsed.meta?.linkDesc?.length > 30) parsed.meta.linkDesc = (parsed.meta.linkDesc as string).slice(0, 30);
      if (parsed.aso?.subtitle?.length > 30) parsed.aso.subtitle = (parsed.aso.subtitle as string).slice(0, 30);
      if (parsed.aso?.descriptionOpening?.length > 250) parsed.aso.descriptionOpening = (parsed.aso.descriptionOpening as string).slice(0, 250);
      // email body fields — Claude often writes more than the limit
      if (parsed.email?.day1Body?.length > 800) parsed.email.day1Body = (parsed.email.day1Body as string).slice(0, 800);
      if (parsed.email?.day5Body?.length > 400) parsed.email.day5Body = (parsed.email.day5Body as string).slice(0, 400);
      if (parsed.email?.day14Body?.length > 300) parsed.email.day14Body = (parsed.email.day14Body as string).slice(0, 300);
      if (parsed.email?.day1Subject?.length > 50) parsed.email.day1Subject = (parsed.email.day1Subject as string).slice(0, 50);
      if (parsed.email?.day5Subject?.length > 50) parsed.email.day5Subject = (parsed.email.day5Subject as string).slice(0, 50);
      if (parsed.email?.day14Subject?.length > 50) parsed.email.day14Subject = (parsed.email.day14Subject as string).slice(0, 50);
      // socialProof subfields
      if (parsed.socialProof?.caseStudy?.headline?.length > 80) parsed.socialProof.caseStudy.headline = (parsed.socialProof.caseStudy.headline as string).slice(0, 80);
      if (parsed.socialProof?.caseStudy?.situation?.length > 300) parsed.socialProof.caseStudy.situation = (parsed.socialProof.caseStudy.situation as string).slice(0, 300);
      if (parsed.socialProof?.caseStudy?.recommendation?.length > 200) parsed.socialProof.caseStudy.recommendation = (parsed.socialProof.caseStudy.recommendation as string).slice(0, 200);
      if (parsed.socialProof?.caseStudy?.whatHappened?.length > 400) parsed.socialProof.caseStudy.whatHappened = (parsed.socialProof.caseStudy.whatHappened as string).slice(0, 400);
      if (parsed.socialProof?.caseStudy?.insight?.length > 200) parsed.socialProof.caseStudy.insight = (parsed.socialProof.caseStudy.insight as string).slice(0, 200);
      if (parsed.socialProof?.caseStudy?.currentPosition?.length > 200) parsed.socialProof.caseStudy.currentPosition = (parsed.socialProof.caseStudy.currentPosition as string).slice(0, 200);
      if (parsed.socialProof?.reviewResponsePositive?.length > 300) parsed.socialProof.reviewResponsePositive = (parsed.socialProof.reviewResponsePositive as string).slice(0, 300);
      if (parsed.socialProof?.reviewResponseNegative?.length > 300) parsed.socialProof.reviewResponseNegative = (parsed.socialProof.reviewResponseNegative as string).slice(0, 300);
      // linkedin fields
      if (parsed.linkedin?.founderStoryHook?.length > 120) parsed.linkedin.founderStoryHook = (parsed.linkedin.founderStoryHook as string).slice(0, 120);
      if (parsed.linkedin?.founderStoryFull?.length > 3000) parsed.linkedin.founderStoryFull = (parsed.linkedin.founderStoryFull as string).slice(0, 3000);
      if (parsed.linkedin?.buildInPublicHook?.length > 120) parsed.linkedin.buildInPublicHook = (parsed.linkedin.buildInPublicHook as string).slice(0, 120);
      if (parsed.linkedin?.buildInPublicFull?.length > 2000) parsed.linkedin.buildInPublicFull = (parsed.linkedin.buildInPublicFull as string).slice(0, 2000);
      // aso keywords must be EXACTLY 10 items
      if (parsed.aso?.keywordsIndia && Array.isArray(parsed.aso.keywordsIndia)) {
        while (parsed.aso.keywordsIndia.length < 10) parsed.aso.keywordsIndia.push('app');
        if (parsed.aso.keywordsIndia.length > 10) parsed.aso.keywordsIndia = parsed.aso.keywordsIndia.slice(0, 10);
      }
      if (parsed.aso?.keywordsUSA && Array.isArray(parsed.aso.keywordsUSA)) {
        while (parsed.aso.keywordsUSA.length < 10) parsed.aso.keywordsUSA.push('app');
        if (parsed.aso.keywordsUSA.length > 10) parsed.aso.keywordsUSA = parsed.aso.keywordsUSA.slice(0, 10);
      }
      // twitter thread must be EXACTLY 5 tweets
      if (parsed.community?.twitterThread && Array.isArray(parsed.community.twitterThread)) {
        while (parsed.community.twitterThread.length < 5) parsed.community.twitterThread.push('Follow for more updates.');
        if (parsed.community.twitterThread.length > 5) parsed.community.twitterThread = parsed.community.twitterThread.slice(0, 5);
      }
      // carousel must be EXACTLY 7 slides
      if (parsed.visualBriefs?.carousel?.slides && Array.isArray(parsed.visualBriefs.carousel.slides)) {
        const fallbackTypes = ['hook','problem','solution','feature','proof','objection','cta'];
        while (parsed.visualBriefs.carousel.slides.length < 7) {
          const n = parsed.visualBriefs.carousel.slides.length + 1;
          parsed.visualBriefs.carousel.slides.push({ slideNumber: n, type: fallbackTypes[n-1] ?? 'feature', headline: `Slide ${n}`, body: '', visual: '' });
        }
        if (parsed.visualBriefs.carousel.slides.length > 7) parsed.visualBriefs.carousel.slides = parsed.visualBriefs.carousel.slides.slice(0, 7);
      }
      // video scene counts: reels30s=4, shorts60s=5, appStorePreview=5
      if (parsed.videoScripts?.reels30s?.scenes && Array.isArray(parsed.videoScripts.reels30s.scenes)) {
        while (parsed.videoScripts.reels30s.scenes.length < 4) parsed.videoScripts.reels30s.scenes.push({ sceneNumber: parsed.videoScripts.reels30s.scenes.length + 1, durationSeconds: 6, label: 'CTA', voiceScript: '', textOverlay: '', visualDirection: '', backgroundColor: '#000000' });
        if (parsed.videoScripts.reels30s.scenes.length > 4) parsed.videoScripts.reels30s.scenes = parsed.videoScripts.reels30s.scenes.slice(0, 4);
      }
      if (parsed.videoScripts?.shorts60s?.scenes && Array.isArray(parsed.videoScripts.shorts60s.scenes)) {
        while (parsed.videoScripts.shorts60s.scenes.length < 5) parsed.videoScripts.shorts60s.scenes.push({ sceneNumber: parsed.videoScripts.shorts60s.scenes.length + 1, durationSeconds: 8, label: 'CTA', voiceScript: '', textOverlay: '', visualDirection: '', backgroundColor: '#000000' });
        if (parsed.videoScripts.shorts60s.scenes.length > 5) parsed.videoScripts.shorts60s.scenes = parsed.videoScripts.shorts60s.scenes.slice(0, 5);
      }
      if (parsed.videoScripts?.appStorePreview?.scenes && Array.isArray(parsed.videoScripts.appStorePreview.scenes)) {
        while (parsed.videoScripts.appStorePreview.scenes.length < 5) parsed.videoScripts.appStorePreview.scenes.push({ sceneNumber: parsed.videoScripts.appStorePreview.scenes.length + 1, durationSeconds: 6, voiceScript: '', textOverlay: '', useScreenshot: false });
        if (parsed.videoScripts.appStorePreview.scenes.length > 5) parsed.videoScripts.appStorePreview.scenes = parsed.videoScripts.appStorePreview.scenes.slice(0, 5);
      }
      // textOverlay max 60 chars per scene
      for (const scriptKey of ['reels30s', 'shorts60s'] as const) {
        if (parsed.videoScripts?.[scriptKey]?.scenes) {
          for (const scene of parsed.videoScripts[scriptKey].scenes as Array<Record<string, unknown>>) {
            if (typeof scene.textOverlay === 'string' && scene.textOverlay.length > 60) scene.textOverlay = scene.textOverlay.slice(0, 60);
          }
        }
      }
      if (parsed.videoScripts?.whatsappVoiceNote?.script?.length > 400) {
        parsed.videoScripts.whatsappVoiceNote.script = (parsed.videoScripts.whatsappVoiceNote.script as string).slice(0, 400);
      }

      // Retry parse after structural fixes
      const lenientResult = ContentOutputSchema.partial().safeParse(parsed);
      if (lenientResult.success) {
        content = lenientResult.data as ContentOutput;
        console.log(`[contentService] Lenient parse succeeded after structural fixes`);
      } else {
        const remaining = lenientResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
        console.error(`[contentService] Lenient parse still failed: ${remaining}`);
        Sentry.captureException(lenientResult.error, { tags: { service: 'contentService', productId } });
        throw new Error(`Content JSON still invalid after fixes: ${remaining}`);
      }
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error(`[contentService] JSON.parse failed — raw response:`, rawOutput.slice(0, 500));
    }
    Sentry.captureException(e, { tags: { service: 'contentService', productId } });
    throw e;
  }

  console.log(`[contentService] content validated, enforcing char limits...`);
  await consumeTokens(founderId, 'content_generation_haiku', 15);
  content = await enforceCharLimits(content, founderId);

  // Quality gate on WhatsApp only when copy was generated this run
  if (needsCopy && content.whatsapp?.painFirst) {
    const { score: waScore, flags: waFlags } = await scoreAsset('whatsapp_broadcast', content.whatsapp.painFirst, ctx.founderContext);
    if (waScore < 0.7) {
      await consumeTokens(founderId, 'content_regen_quality', 5);
      const regenWa = await callHaiku(
        `Rewrite this WhatsApp broadcast to score higher on quality.\nCurrent: "${content.whatsapp.painFirst}"\nIssues: ${JSON.stringify(waFlags)}\nRules: Max 160 chars. Pain-first opening. Clear CTA. Use customer quote if available: "${ctx.founderContext.bestCustomerQuote ?? ''}"\nReturn ONLY the rewritten text, no quotes.`,
        200, { founderId, productId, promptId: 'content_wa_regen', action: 'content_wa_regen' }
      );
      content = { ...content, whatsapp: { ...content.whatsapp, painFirst: regenWa.trim().substring(0, 160) } };
    }
  }

  // Save each stage group sequentially so the frontend checklist updates progressively.
  if (needsCopy) {
    console.log(`[contentService] saving core assets...`);
    await saveCoreAssets(content, ctx, briefId);
    console.log(`[contentService] core assets saved — checklist "Ad copy" stage done`);
  }

  if (needsCommunity && (content.community || content.socialProof)) {
    await saveCommunityAssets(content, ctx, briefId);
    console.log(`[contentService] community assets saved — checklist "Community" stage done`);
  }

  if (needsVisual && content.visualBriefs) {
    await saveVisualAssets(content, ctx, briefId);
    console.log(`[contentService] visual assets saved — checklist "Visual assets" stage done`);
  }

  if (needsVideo && content.videoScripts) {
    await saveVideoConcepts(content.videoScripts, ctx, briefId);
    console.log(`[contentService] video concepts saved — checklist "Video ads" stage done`);
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
Return ONLY the new text content for this single asset. No JSON wrapper, no explanation.`,
    1024, { founderId, productId: asset.product_id as string, promptId: 'content_asset_regen', action: 'content_asset_regen' }
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
