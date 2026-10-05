/**
 * @file studio.route.ts
 * @description Content Studio — unified AI content generation, asset library, versioning,
 *   editor transforms, publishing targets, and archive/restore.
 *   All endpoints require JWT. Asset ownership enforced on every write.
 * @security JWT required. Ownership check: founder_id = auth.uid() enforced in every handler.
 *   Approval gate: assets must be approved before publish records are created.
 *   Versions are append-only — no UPDATE/DELETE allowed on content_versions.
 * @dependencies aiPlatform, contextEngine, supabaseAdmin, Sentry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import { callSonnet, callHaiku } from '../lib/aiPlatform';

function getFounderId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const VALID_ASSET_TYPES = [
  'whatsapp_broadcast', 'whatsapp_voice_note',
  'meta_headline', 'meta_body', 'meta_image_brief',
  'google_uac_variants', 'aso_subtitle', 'aso_description', 'aso_keywords',
  'email_day1', 'email_day5', 'email_day14',
  'linkedin_founder_story', 'linkedin_data_post',
  'video_reels_30s', 'video_shorts_60s', 'video_app_preview',
  'carousel_brief', 'community_whatsapp_group', 'community_facebook',
  'community_indiehackers', 'community_twitter_thread',
  'social_proof_case_study', 'social_proof_testimonial',
  'social_proof_review_response', 'social_proof_producthunt',
  'blog_post', 'landing_page_copy', 'push_notification', 'release_notes', 'press_release',
] as const;

/**
 * Why this destination cannot be used, in owner language. Null when it is fine.
 *
 * @security Refuses schemes that execute or embed rather than navigate
 *   (javascript:, data:, file:), credential-bearing URLs, and private network
 *   targets. A destination is where a real customer is sent; the browser cannot
 *   be the gate on that.
 */
/** Two strings that say the same thing, ignoring punctuation and case. */
function sameSentence(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (x: string | null | undefined) =>
    String(x ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const na = norm(a), nb = norm(b);
  return na.length > 0 && na === nb;
}

/** Strips the store-listing tail a scraped product title carries. */
function displayName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\s*[-\u2013\u2014|]\s*(App Store|Apps on Google Play|Google Play)\s*$/i, '')
    .replace(/\s+on the App Store\s*$/i, '')
    .replace(/\s*[-\u2013\u2014|]\s*$/, '')
    .trim();
}

/** The stored product role, with the store suffix removed for display. */
function cleanProductRole(role: string | null): string | null {
  if (!role) return null;
  return role.replace(
    /([^\s].*?)\s*[-\u2013\u2014|]\s*(App Store|Apps on Google Play|Google Play)\b/i,
    (_m, name: string) => displayName(name)) || role;
}

/**
 * What the READER should do, for a campaign row whose `cta_intent` is really
 * the business objective.
 *
 * Returns null rather than guessing when the stored value looks like a genuine
 * call to action already — a wrong CTA is worse than a missing one.
 */
function viewerCtaIntent(
  stored: string | null, primaryBenefit: string | null,
  objective: string | null, productName: string,
): string | null {
  const looksLikeObjective =
    sameSentence(stored, objective) || sameSentence(stored, primaryBenefit)
    || /\b(generate|drive|increase|grow)\b.*\b(awareness|installs|bookings|reach|engagement)\b/i
         .test(String(stored ?? ''));
  if (!stored || !looksLikeObjective) return stored;
  const named = displayName(productName) || 'the app';
  const src = `${objective ?? ''} ${stored}`.toLowerCase();
  if (/install|download|sign ?up|trial|register/.test(src)) return 'Get started';
  if (/book|schedule|appointment|request|quote/.test(src)) return `Book through ${named}`;
  return `See how ${named} works`;
}

function destinationRejectionReason(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); }
  catch { return 'That does not look like a web address. It should start with https://'; }

  if (!/^https?:$/.test(u.protocol)) {
    return 'LaunchMind can only send people to a web address starting with https://';
  }
  if (u.username || u.password) {
    return 'That link contains a username or password. Use a plain web address.';
  }
  const host = u.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' || host.endsWith('.local') || host === '::1' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) {
    return 'That address is only reachable on a private network, so customers could not open it.';
  }
  if (!host.includes('.')) {
    return 'That does not look like a public web address.';
  }
  return null;
}

const GenerateBodySchema = z.object({
  productId:   z.string().uuid(),
  assetType:   z.enum(VALID_ASSET_TYPES),
  channel:     z.string().min(1).max(50),
  market:      z.enum(['usa', 'india', 'both']).default('usa'),
  language:    z.string().optional().default('english'),
  missionId:   z.string().uuid().optional(),
  tone:        z.string().optional(),
  keywords:    z.array(z.string()).optional(),
  context:     z.string().max(2000).optional(),
});

const RecommendedPackageBodySchema = z.object({
  productId:     z.string().uuid(),
  campaignId:    z.string().uuid(),
  strategyId:    z.string().uuid(),
  /** Server-derived brief ids, one per channel the owner wants. */
  briefIds:      z.record(z.string().uuid()),
  mode:          z.enum(['AI_CMO_RECOMMENDED', 'OWNER_DIRECTED']).default('AI_CMO_RECOMMENDED'),
  /** Owner has chosen a presenter and voice. Product config, never env. */
  avatarVoiceChosen: z.boolean().optional(),
  /** Plan only, generate nothing. The default for a first look. */
  planOnly:      z.boolean().optional(),
}).strict();
// .strict() rejects workspaceId, evidenceRefs, authority, approvalState and
// executionApproval. The client supplies INTENT; scope and authority are derived.

const GovernedArtifactBodySchema = z.object({
  planningWorkId:z.string().uuid().optional(),
  planningAttemptId:z.string().uuid().optional(),
  productId:    z.string().uuid(),
  campaignId:   z.string().uuid(),
  strategyId:   z.string().uuid(),
  briefId:      z.string().uuid(),
  channel:      z.enum(['GOOGLE_RSA', 'META_AD', 'LANDING_PAGE',
                        'LINKEDIN_POST', 'SHORT_FORM_VIDEO_SCRIPT']),
  variantGroupId: z.string().uuid().optional(),
  variantLabel:   z.string().max(60).optional(),
  mode:         z.enum(['AI_CMO_RECOMMENDED', 'OWNER_DIRECTED']).default('OWNER_DIRECTED'),
  // Regenerate an EXISTING artifact instead of creating one.
  assetId:      z.string().uuid().optional(),
  // Owner edit: the corrected payload, re-governed before it becomes a version.
  editedContent: z.record(z.unknown()).optional(),
  // Gate 1 persists the core message. Gate 2 owns visual rendering.
  deferVisual: z.boolean().optional(),
}).strict();
// DELIBERATELY ABSENT and rejected by .strict(): workspaceId, evidenceRefs,
// evidenceHandles, authority, approvalState, executionApproval. A client
// supplies INTENT; scope and authority are derived server-side.

const GovernedGenerateBodySchema = z.object({
  productId:   z.string().uuid(),
  // Context, never authorization: membership is checked server-side regardless.
  workspaceId: z.string().uuid().optional(),
  channel:     z.enum(['google_ads_rsa', 'meta_ads', 'landing_page']),
  brief: z.object({
    objective:   z.string().min(1).max(500),
    audience:    z.string().min(1).max(500),
    keyMessage:  z.string().min(1).max(1000),
    tone:        z.string().max(120).optional(),
    ctaText:     z.string().max(120).optional(),
    offer:       z.string().max(300).optional(),
    constraints: z.array(z.string().max(200)).max(20).optional(),
  }),
  /** Claim categories the owner asserted and owns. Never inferred. */
  ownerConfirmed: z.array(z.string().max(60)).max(10).optional(),
});

const UpdateBodySchema = z.object({
  textContent:    z.string().optional(),
  structuredData: z.record(z.unknown()).optional(),
  tags:           z.array(z.string().max(50)).max(20).optional(),
  changeSummary:  z.string().max(500).optional(),
});

const TransformBodySchema = z.object({
  transformType: z.enum(['rewrite', 'expand', 'shorten', 'tone', 'translate', 'seo', 'aso']),
  targetTone:    z.enum(['professional', 'casual', 'urgent', 'friendly', 'authoritative']).optional(),
  targetLanguage: z.string().optional(),
  targetLength:  z.number().int().positive().optional(),
  instructions:  z.string().max(500).optional(),
});

const PublishBodySchema = z.object({
  channel:     z.enum(['meta', 'google', 'whatsapp', 'email', 'linkedin', 'web', 'app_store', 'play_store']),
  platformUrl: z.string().url().optional(),
  externalId:  z.string().optional(),
  metadata:    z.record(z.unknown()).optional(),
});

const ListQuerySchema = z.object({
  search:    z.string().optional(),
  type:      z.string().optional(),
  status:    z.string().optional(),
  channel:   z.string().optional(),
  market:    z.string().optional(),
  language:  z.string().optional(),
  missionId: z.string().uuid().optional(),
  tags:      z.string().optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
  limit:     z.coerce.number().min(1).max(100).optional().default(50),
  offset:    z.coerce.number().min(0).optional().default(0),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a type-specific system prompt for on-demand generation.
 * Uses product context (name, ICP, brand voice) to ground the output.
 */
function buildGeneratePrompt(assetType: string, product: Record<string, unknown>, options: {
  market: string;
  language: string;
  tone?: string;
  keywords?: string[];
  context?: string;
}): { system: string; user: string } {
  const icp = (product.confirmed_icp as Record<string, unknown>) ?? {};
  const brandVoice = (product.brand_voice_profile as Record<string, unknown>) ?? {};
  const productName = String(product.name ?? 'the app');

  const baseContext = `Product: ${productName}
Market: ${options.market.toUpperCase()}
Language: ${options.language}
Target user: ${JSON.stringify(icp)}
Brand voice: ${JSON.stringify(brandVoice)}
${options.context ? `Additional context: ${options.context}` : ''}
${options.tone ? `Tone: ${options.tone}` : ''}
${options.keywords?.length ? `Keywords to include: ${options.keywords.join(', ')}` : ''}`;

  const typePrompts: Record<string, { system: string; user: string }> = {
    blog_post: {
      system: 'You are an expert SEO content writer for mobile apps. Return JSON with keys: title (string), metaDescription (string, max 160 chars), body (string, 600-900 words, markdown), estimatedReadTime (number in minutes).',
      user: `${baseContext}\n\nWrite a high-quality blog post that helps ${productName} acquire organic users through search.`,
    },
    landing_page_copy: {
      system: 'You are a conversion copywriter. Return JSON with keys: headline (string), subheadline (string), heroCtaText (string), features (array of {title, description}), socialProof (string), faqItems (array of {question, answer}), finalCta (string).',
      user: `${baseContext}\n\nWrite high-converting landing page copy for ${productName}.`,
    },
    push_notification: {
      system: 'You are a mobile push notification specialist. Return JSON with keys: title (string, max 50 chars), body (string, max 100 chars), actionLabel (string, max 20 chars), deepLink (string placeholder). Write 3 variants.',
      user: `${baseContext}\n\nWrite re-engagement push notifications for ${productName} users who haven't opened the app in 7 days.`,
    },
    release_notes: {
      system: 'You are an app store release notes writer. Return JSON with keys: version (string placeholder), headline (string, max 60 chars), body (string, max 500 chars, bullet points), highlights (array of strings).',
      user: `${baseContext}\n\nWrite compelling release notes that increase update adoption rates for ${productName}.`,
    },
    press_release: {
      system: 'You are a PR professional. Return JSON with keys: headline (string), subheadline (string), dateline (string), body (string, 3-4 paragraphs), quote (string), boilerplate (string), contactInfo (string placeholder).',
      user: `${baseContext}\n\nWrite a press release announcing a major milestone for ${productName}.`,
    },
    whatsapp_broadcast: {
      system: 'You are a WhatsApp marketing specialist. Return JSON with keys: message (string, max 1000 chars), ctaButton (string, max 25 chars), previewText (string). No markdown — plain text only.',
      user: `${baseContext}\n\nWrite a WhatsApp broadcast for ${productName} targeting ${options.market === 'india' ? 'Indian' : 'US'} users.`,
    },
    meta_headline: {
      system: 'You are a Meta Ads specialist. Return JSON with keys: primary (string, max 40 chars), headlines (array of 5 strings, max 30 chars each), descriptions (array of 3 strings, max 125 chars each).',
      user: `${baseContext}\n\nWrite Meta ad copy for ${productName}.`,
    },
    email_day1: {
      system: 'You are an email marketing specialist. Return JSON with keys: subject (string, max 60 chars), preheader (string, max 90 chars), body (string, markdown), cta (string).',
      user: `${baseContext}\n\nWrite a Day 1 welcome email for new ${productName} users that drives first key action.`,
    },
    linkedin_founder_story: {
      system: 'You are a LinkedIn ghostwriter. Return JSON with keys: hook (string, max 150 chars), body (string, 800-1200 chars, line-spaced), cta (string), hashtags (array of strings).',
      user: `${baseContext}\n\nWrite a founder story post about building ${productName} for the ${options.market === 'india' ? 'Indian' : 'US'} market.`,
    },
    community_twitter_thread: {
      system: 'You are a Twitter/X content strategist. Return JSON with keys: tweets (array of strings, max 280 chars each, 5-7 tweets), threadSummary (string).',
      user: `${baseContext}\n\nWrite a Twitter thread that builds authority for ${productName}.`,
    },
    aso_description: {
      system: 'You are an ASO specialist. Return JSON with keys: shortDescription (string, max 80 chars), fullDescription (string, max 4000 chars, includes keywords naturally), keywordsUsed (array of strings).',
      user: `${baseContext}\n\nWrite ASO-optimised app store description for ${productName}.`,
    },
    social_proof_case_study: {
      system: 'You are a case study writer. Return JSON with keys: headline (string), challenge (string), solution (string), result (string), quote (string), metrics (array of {label, value}).',
      user: `${baseContext}\n\nWrite a customer case study template for ${productName}.`,
    },
  };

  // Default fallback for types without custom prompts
  const defaultPrompt = {
    system: `You are an expert marketing copywriter. Generate high-quality ${assetType} content. Return valid JSON with a "content" key containing the generated text and a "notes" key with any usage guidance.`,
    user: `${baseContext}\n\nGenerate ${assetType} content for ${productName}.`,
  };

  return typePrompts[assetType] ?? defaultPrompt;
}

/**
 * Build transform prompt for AI editor transforms.
 */
function buildTransformPrompt(
  currentText: string,
  transformType: string,
  options: {
    targetTone?: string;
    targetLanguage?: string;
    targetLength?: number;
    instructions?: string;
  }
): string {
  const transforms: Record<string, string> = {
    rewrite: `Rewrite the following content while preserving the core message and key information. Make it cleaner, clearer, and more compelling:\n\n${currentText}`,
    expand: `Expand the following content with more detail, examples, and supporting points${options.targetLength ? ` to approximately ${options.targetLength} characters` : '. Add depth without losing focus'}:\n\n${currentText}`,
    shorten: `Shorten the following content${options.targetLength ? ` to approximately ${options.targetLength} characters` : ' by removing unnecessary words and condensing ideas'}. Preserve the key message:\n\n${currentText}`,
    tone: `Rewrite the following content in a ${options.targetTone ?? 'professional'} tone. Keep the same information but adjust the voice:\n\n${currentText}`,
    translate: `Translate the following content to ${options.targetLanguage ?? 'Hindi'}. Keep marketing punch and cultural relevance for the target audience:\n\n${currentText}`,
    seo: `Optimise the following content for SEO. Improve keyword density, headings, and meta-readability without keyword stuffing:\n\n${currentText}`,
    aso: `Optimise the following content for App Store Optimisation (ASO). Improve keyword placement, natural language, and discoverability within Apple/Google store character limits:\n\n${currentText}`,
  };

  const base = transforms[transformType] ?? `Transform (${transformType}) the following:\n\n${currentText}`;
  return options.instructions ? `${base}\n\nAdditional instructions: ${options.instructions}` : base;
}

// ── Route plugin ──────────────────────────────────────────────────────────────

async function studioPlugin(server: FastifyInstance): Promise<void> {
  server.post('/studio/governed/planning',async(request,reply)=>{
    await request.jwtVerify();const body=z.object({productId:z.string().uuid(),opportunityId:z.string(),conceptKey:z.enum(['A','B','C'])}).strict().safeParse(request.body);if(!body.success)return reply.code(400).send({error:'Invalid planning selection'});
    try{const founderId=getFounderId(request);const {resolveWorkspaceContext}=await import('../services/workspaceAuthService');const auth=await resolveWorkspaceContext(founderId,null);const {storedPlanning,planningContext,persistPlanningWork}=await import('../services/content/groundedPlanningWork');const snapshot=await storedPlanning(auth.workspaceId,body.data.productId);if(!snapshot)return reply.code(409).send({error:'Refresh Content Intelligence before creating this concept'});const ctx=await planningContext(auth.workspaceId,body.data.productId,founderId,snapshot);const result=await persistPlanningWork(snapshot,ctx,founderId,body.data.opportunityId,body.data.conceptKey);return reply.code(201).send({id:result.id,route:`/dashboard/content?planning=${result.id}`,state:'PLANNED'});}catch{return reply.code(409).send({error:'The grounded plan changed or could not be saved. Refresh Content Intelligence and try again.'});}
  });
  // Deterministic preparation only: never executes or authorizes production.
  server.post('/studio/governed/planning/:id/production-contract',async(request,reply)=>{
    await request.jwtVerify();
    const id=(request.params as {id:string}).id;
    if(!z.string().uuid().safeParse(id).success||!z.object({}).strict().safeParse(request.body??{}).success)return reply.code(400).send({error:'Invalid request'});
    try{
      const founderId=getFounderId(request);
      const {resolveWorkspaceContext}=await import('../services/workspaceAuthService');
      const auth=await resolveWorkspaceContext(founderId,null);
      const {resolvePlanningProduction}=await import('../services/content/planningProductionContract');
      const contract=await resolvePlanningProduction(id,auth.workspaceId,founderId);
      return reply.send({planningWorkId:contract.planningWorkId,canGenerate:contract.canGenerate,format:'Core marketing message',message:'Ready to create'});
    }catch(err){request.log.warn({err},'Planning preparation failed');return reply.code(409).send({error:'This brief needs to be refreshed before creation.'});}
  });

  server.post('/studio/governed/planning/:id/generate',async(request,reply)=>{
    await request.jwtVerify();const id=(request.params as {id:string}).id;
    if(!z.string().uuid().safeParse(id).success||!z.object({}).strict().safeParse(request.body??{}).success)return reply.code(400).send({error:'Invalid request'});
    const {resolveWorkspaceContext}=await import('../services/workspaceAuthService');
    const founderId=getFounderId(request),auth=await resolveWorkspaceContext(founderId,null);
    const {beginPlanningRun,finishPlanningRun}=await import('../services/content/planningProductionState');
    let attemptId:string|undefined;
    try{
      const {ensurePlanningProduction}=await import('../services/content/planningProductionContract');
      const p=await ensurePlanningProduction(id,auth.workspaceId,founderId);
      const {planningFingerprint}=await import('../services/content/groundedPlanningWork');
      const run=await beginPlanningRun(id,auth.workspaceId,planningFingerprint(p.ctx));attemptId=run.attemptId;
      const {persistedPlanningArtifact}=await import('../services/content/contentArtifactPersistence');
      const recovered=await persistedPlanningArtifact({planningWorkId:id,workspaceId:auth.workspaceId});
      if(recovered){
        const generation=await finishPlanningRun(id,auth.workspaceId,attemptId,{assetId:recovered.assetId,versionNumber:recovered.versionNumber,ownerState:'READY_FOR_OWNER_REVIEW',copyGenerationCalls:0,copyRepairs:0},201);
        return reply.code(200).send({generation,route:`/dashboard/content?planning=${id}`});
      }
      const result=await server.inject({method:'POST',url:'/studio/governed/artifact',headers:{authorization:request.headers.authorization??''},payload:{planningWorkId:id,planningAttemptId:attemptId,productId:p.ctx.productId,campaignId:p.ids.campaignId,strategyId:p.ids.strategyId,briefId:p.ids.briefId,channel:p.channel,mode:'OWNER_DIRECTED',deferVisual:true}});
      const {createCreativeDiagnostics}=await import('../services/creative/creativeDiagnostics');
      const artifactResult=result.json();
      const diagnostics=await createCreativeDiagnostics(attemptId,auth.workspaceId);await diagnostics?.finish({planningId:id,ids:p.ids,httpStatus:result.statusCode,result:artifactResult});
      const generation=await finishPlanningRun(id,auth.workspaceId,attemptId,artifactResult,result.statusCode);
      return reply.code(200).send({generation,route:`/dashboard/content?planning=${id}`});
    }catch(err){
      request.log.error({err,planningId:id,attemptId},'Planning generation orchestration failed');
      if(attemptId){const generation=await finishPlanningRun(id,auth.workspaceId,attemptId,{failureClass:'ORCHESTRATION_FAILED'},500);return reply.send({generation});}
      return reply.code(409).send({error:'This brief needs to be refreshed before creation.'});
    }
  });

  /**
   * POST /studio/governed/planning/:id/edit
   *
   * Owner edit of the ALREADY-GENERATED draft for this planning item — a thin
   * wrapper, not a second persistence path. It resolves this planning item's
   * campaign/strategy/brief lineage (the same `ensurePlanningProduction` the
   * generate route uses) and the existing draft's assetId, then delegates to
   * the SAME `/studio/governed/artifact` route the generate route already
   * calls, with `editedContent` set — which is the existing owner-edit path:
   * `regovernOwnerEdit` (full re-governance: discovery, grounding, structure,
   * terminology — an edit is authorship, never a wider authority than
   * generation had) followed by `appendGovernedVersion` (one more immutable
   * version on the SAME artifact).
   *
   * @security Never authorizes publish/spend/execution — those columns do not
   *   exist on this lane. An edit that fails governance returns the same
   *   LAUNCHMIND_CAN_REPAIR / NEEDS_OWNER_INPUT shape generation does; the
   *   prior version is left standing exactly as an owner-facing edit failure
   *   must not silently overwrite what the owner already had.
   */
  server.post('/studio/governed/planning/:id/edit',async(request,reply)=>{
    await request.jwtVerify();const id=(request.params as {id:string}).id;
    const body=z.object({content:z.record(z.unknown())}).strict().safeParse(request.body);
    if(!z.string().uuid().safeParse(id).success||!body.success)return reply.code(400).send({error:'Invalid request'});
    try{
      const founderId=getFounderId(request);
      const {resolveWorkspaceContext}=await import('../services/workspaceAuthService');
      const auth=await resolveWorkspaceContext(founderId,null);
      const {ensurePlanningProduction}=await import('../services/content/planningProductionContract');
      const p=await ensurePlanningProduction(id,auth.workspaceId,founderId);
      const {data:planningRow}=await getSupabaseAdmin().from('content_assets')
        .select('structured_data').eq('id',id).eq('workspace_id',auth.workspaceId).maybeSingle();
      const assetId=(planningRow?.structured_data as {generation?:{assetId?:string}}|undefined)?.generation?.assetId;
      if(!assetId)return reply.code(409).send({error:'There is no draft to edit yet.'});
      const result=await server.inject({method:'POST',url:'/studio/governed/artifact',headers:{authorization:request.headers.authorization??''},payload:{assetId,productId:p.ctx.productId,campaignId:p.ids.campaignId,strategyId:p.ids.strategyId,briefId:p.ids.briefId,channel:p.channel,mode:'OWNER_DIRECTED',editedContent:body.data.content}});
      return reply.code(result.statusCode).send(result.json());
    }catch{
      return reply.code(409).send({error:'This brief needs to be refreshed before editing.'});
    }
  });

  server.get('/studio/governed/planning/:id',async(request,reply)=>{
    await request.jwtVerify();const founderId=getFounderId(request);const {resolveWorkspaceContext}=await import('../services/workspaceAuthService');const auth=await resolveWorkspaceContext(founderId,null);const id=(request.params as {id:string}).id;if(!z.string().uuid().safeParse(id).success)return reply.code(404).send({error:'Not found'});
    // FIRST, before anything reads the stored brief. Content Intelligence and
    // Content Studio must answer from the same current governed evidence; this
    // re-evaluates the item's own concept against it and, when that concept has
    // become executable, re-binds THIS item in place. A refresh that cannot be
    // completed returns an owner action and leaves the stored brief untouched --
    // it never fails the page, and it never silently generates from stale evidence.
    let feasibility=null;
    try{const {refreshPlanningItem}=await import('../services/content/groundedPlanningWork');feasibility=await refreshPlanningItem(id,auth.workspaceId,founderId);}
    catch{feasibility={state:'CANNOT_REFRESH' as const,selected:null,alternative:null,alternativeName:null,shouldChangeDirection:false,
      ownerAction:'I could not re-check this brief against your current information. Open Content Intelligence and confirm the opportunity again.'};}
    const {data}=await getSupabaseAdmin().from('content_assets').select('id,structured_data').eq('id',id).eq('workspace_id',auth.workspaceId).eq('governance','GOVERNED_CONTENT_INTELLIGENCE').is('archived_at',null).maybeSingle();if(data?.structured_data?.kind!=='GROUNDED_PLANNING_WORK')return reply.code(404).send({error:'Not found'});let content=null;let generation=data.structured_data.generation??null;
    if(generation?.status==='READY_FOR_REVIEW'&&generation.assetId){
      // A stored ELIGIBLE status was written at generation time; it must not be
      // presented as safely ready-for-review forever after governance tightens.
      const {revalidateEligibleArtifact,ownerContentView}=await import('../services/content/contentArtifactPersistence');
      const revalidated=await revalidateEligibleArtifact({assetId:generation.assetId,workspaceId:auth.workspaceId});
      if(revalidated.violations.length>0){
        generation={...generation,status:'NEEDS_ATTENTION',reason:'UNSUPPORTED_WORDING'};
        await getSupabaseAdmin().from('content_assets').update({structured_data:{...data.structured_data,generation}}).eq('id',id).eq('workspace_id',auth.workspaceId);
      } else {
        content=await ownerContentView(generation.assetId,auth.workspaceId);
      }
    }
    let visual=null,history:unknown[]=[];
    if(generation?.assetId&&content){
      const {listCreativeRenders}=await import('../services/creative/creativeApprovalService');
      const renders=await listCreativeRenders({contentAssetId:generation.assetId,workspaceId:auth.workspaceId});
      visual=renders.find(r=>r.isCurrent&&r.contentVersionNumber===content.versionNumber&&r.qualityOutcome==='READY_FOR_OWNER_REVIEW')??null;
      const {data:versions}=await getSupabaseAdmin().from('content_versions')
        .select('version_number,change_type,change_summary,created_at').eq('asset_id',generation.assetId)
        .order('version_number',{ascending:false});
      history=(versions??[]).map((v:any)=>({...v,current:v.version_number===content.versionNumber,
        approved:content.status==='CONTENT_APPROVED'&&v.version_number===content.versionNumber,
        visual:visual?.contentVersionNumber===v.version_number}));
    }
    return reply.send({id:data.id,state:'PLANNED',handoff:data.structured_data.handoff,decision:data.structured_data.decision,generation,content,visual,history,campaignId:data.structured_data.production?.ids?.campaignId??null,feasibility});
  });


  /**
   * POST /studio/generate
   * Generate a single content asset on demand.
   * @security JWT required. Product ownership verified.
   */
  server.post('/studio/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = GenerateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const { productId, assetType, channel, market, language, missionId, tone, keywords, context } = parsed.data;
    const supabase = getSupabaseAdmin();

    try {
      // Ownership check
      const { data: product } = await supabase
        .from('products')
        .select('id, name, confirmed_icp, brand_voice_profile')
        .eq('id', productId)
        .eq('founder_id', founderId)
        .single();

      if (!product) return reply.status(404).send({ error: 'Product not found' });

      const { system, user } = buildGeneratePrompt(assetType, product as Record<string, unknown>, {
        market, language, tone, keywords, context,
      });

      // Use Sonnet for long-form types, Haiku for short copy
      const longFormTypes = ['blog_post', 'landing_page_copy', 'press_release', 'social_proof_case_study'];
      const isLongForm = longFormTypes.includes(assetType);
      const maxTokens = isLongForm ? 2048 : 512;

      let rawOutput: string;
      if (isLongForm) {
        rawOutput = await callSonnet(system, user, maxTokens, {
          founderId,
          promptId: `studio_generate_${assetType}`,
          action: 'studio_generate',
        });
      } else {
        rawOutput = await callHaiku(`${system}\n\n${user}`, maxTokens, {
          founderId,
          promptId: `studio_generate_${assetType}`,
          action: 'studio_generate',
        });
      }

      // Parse JSON output; fall back to raw text
      // P1-24. The legacy Studio lane has no evidence set, so it may not emit
      // factual marketing claims. Screened before persistence — refusing after
      // the row exists would mean the owner had already seen it.
      const { screenLegacyContent } = await import('../services/content/legacyContentSafety');
      let textContent: string | null = null;
      let structuredData: Record<string, unknown> | null = null;
      try {
        const cleaned = rawOutput.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        structuredData = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        textContent = rawOutput;
      }

      // P1-24 GATE. Screens BOTH free text and structured output — a Google RSA
      // arrives as JSON, so screening only `text_content` would leave the
      // headline field, which is exactly where a claim lives.
      const screened = screenLegacyContent(
        [textContent ?? '', structuredData ? JSON.stringify(Object.values(structuredData)) : '']
          .filter(Boolean).join('. '));
      if (!screened.allowed) {
        return reply.status(422).send({
          error: 'Unsupported factual claim in generated content',
          code: 'LEGACY_CONTENT_UNSUPPORTED_CLAIM',
          reason: screened.reason,
          blocked: screened.blockedUnits.map(b => ({ text: b.text, category: b.category })),
        });
      }

      const { data: asset, error: insertErr } = await supabase
        .from('content_assets')
        .insert({
          product_id:           productId,
          founder_id:           founderId,
          asset_type:           assetType,
          channel,
          market,
          language,
          text_content:         textContent,
          structured_data:      structuredData,
          model_used:           isLongForm ? 'claude-sonnet-4-6' : 'claude-haiku-4-5',
          status:               'pending',
          growth_brain_version: 1,
          mission_id:           missionId ?? null,
          tokens_consumed:      maxTokens,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      return reply.status(201).send({ asset });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Generation failed' });
    }
  });

  /**
   * POST /studio/governed/generate
   *
   * THE governed Content Intelligence generation path — ADR-070, Phase 3.5B.
   *
   * Distinct from POST /studio/generate, which is the frozen LEGACY_STUDIO lane
   * and is screened by legacyContentSafety because it has no evidence set at
   * all. This lane builds a real ContextPackageV2, issues real evidence handles,
   * runs three-signal claim discovery over the generated copy, and grounds every
   * claim found against evidence LaunchMind actually holds.
   *
   * SHADOW: returns the governed verdict and persists NOTHING. No content_assets
   * row, no version, no approval, no publish. Migration 114's trigger is the
   * structural half of that boundary; this handler is the procedural half.
   *
   * @security JWT required. Workspace membership resolved server-side; a
   *   client-supplied workspace is context, never authorization. Product
   *   ownership verified inside the resolved workspace, so a product id from
   *   another business cannot widen the package.
   */
  server.post('/studio/governed/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = GovernedGenerateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }
    const body = parsed.data;

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctx;
      try {
        ctx = await resolveWorkspaceContext(founderId, body.workspaceId ?? null);
      } catch (e) {
        // 404-shaped: a non-member must not be able to tell "forbidden" from
        // "does not exist", or workspace structure leaks through the difference.
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: product } = await supabase
        .from('products').select('id')
        .eq('id', body.productId)
        .eq('workspace_id', ctx.workspaceId)
        .is('archived_at', null)
        .maybeSingle();
      if (!product) return reply.status(404).send({ error: 'Not found' });

      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { issueEvidenceHandles } = await import('../services/growthBrainOutputGrounding');
      const pkg = await buildContextPackageV2({
        workspaceId: ctx.workspaceId,
        founderId,
        productId: body.productId,
        intent: 'CONTENT_GENERATION',
        query: body.brief.keyMessage,
        persist: false,
      });
      const handles = issueEvidenceHandles(pkg);

      const { generateGovernedContent } = await import('../services/content/governedContentGeneration');
      const result = await generateGovernedContent({
        channel: body.channel,
        brief: body.brief,
        handles,
        ownerConfirmed: body.ownerConfirmed ?? [],
        competitorNames: (pkg.founderContext.competitors ?? []).map(c => c.name),
        // External evidence bodies are compared AGAINST the output. They are
        // never sent to the generator, so this is a check, not a temptation.
        externalSources: (pkg.marketEvidence ?? []).map(m => m.claim),
        founderId,
        productId: body.productId,
      });

      // Owner-safe projection. Evidence handle refs, internal ids and the raw
      // per-signal audit stay server-side: P1-20 established that a handle
      // reaching an owner surface is a leak even when it looks like noise.
      return reply.status(200).send({
        channel:      result.channel,
        mode:         result.mode,
        content:      result.payload,
        eligible:     result.eligible,
        blockedReasons: result.blockedReasons,
        degraded:     result.discovery.degraded || result.generationDegraded,
        claims: result.grounding.results.map(r => ({
          field:    r.claim.field,
          text:     r.claim.textSpan,
          category: r.claim.category,
          verdict:  r.verdict,
          support:  r.support,
          reason:   r.reason,
        })),
        structuralIssues: result.validation.issues,
        constraintVersion: result.constraintVersion,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Generation failed' });
    }
  });

  /**
   * POST /studio/governed/artifact
   *
   * Generates, governs and PERSISTS one channel artifact — Phase 3.5B3.1.
   *
   * Three modes on one route, because they share one governance pipeline and
   * splitting them would invite a path that skips it:
   *   no assetId               → new artifact + immutable version 1
   *   assetId                  → regenerate → next version
   *   assetId + editedContent  → owner edit re-governed → next version
   *
   * @security JWT required. Workspace and actor are derived from the verified
   *   session; product ownership is checked inside that workspace. The body
   *   schema is `.strict()`, so a client cannot smuggle a workspace override,
   *   an evidence handle, an authority claim or an approval state.
   */
  server.post('/studio/governed/artifact', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = GovernedArtifactBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }
    const body = parsed.data;

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try {
        ctxAuth = await resolveWorkspaceContext(founderId, null);
      } catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: product } = await supabase.from('products').select('id')
        .eq('id', body.productId).eq('workspace_id', ctxAuth.workspaceId)
        .is('archived_at', null).maybeSingle();
      if (!product) return reply.status(404).send({ error: 'Not found' });

      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { buildProductContentContext } = await import('../services/content/productContentContext');
      const {data:boundPlan}=await supabase.from('content_assets').select('id').eq('content_campaign_id',body.campaignId).eq('workspace_id',ctxAuth.workspaceId).contains('structured_data',{kind:'GROUNDED_PLANNING_WORK'}).is('archived_at',null).maybeSingle();
      if(boundPlan&&body.planningWorkId!==boundPlan.id)return reply.code(409).send({error:'Open the current production brief to create this content.'});
      const planning=body.planningWorkId ? await (await import('../services/content/planningProductionContract')).ensurePlanningProduction(body.planningWorkId,ctxAuth.workspaceId,founderId) : null;
      if(planning){const {data:active}=await supabase.from('content_assets').select('structured_data').eq('id',body.planningWorkId!).eq('workspace_id',ctxAuth.workspaceId).single();if(!body.planningAttemptId||active?.structured_data?.generation?.attemptId!==body.planningAttemptId||active.structured_data.generation.status!=='CREATING')return reply.code(409).send({error:'Open the current production brief to create this content.'});}
      if(planning&&(planning.ctx.productId!==body.productId||planning.ids.campaignId!==body.campaignId||planning.ids.strategyId!==body.strategyId||planning.ids.briefId!==body.briefId||planning.channel!==body.channel))return reply.code(409).send({error:'Production lineage mismatch'});
      const pkg = planning ? null : await buildContextPackageV2({
        workspaceId: ctxAuth.workspaceId, founderId, productId: body.productId,
        intent: 'CONTENT_GENERATION', query: 'governed channel content', persist: false,
      });
      const ctx = planning?.ctx ?? await buildProductContentContext(pkg!);

      // Strategy and brief are re-derived server-side from persisted lineage,
      // so a client cannot describe a strategy it did not earn.
      const { data: campaign } = await supabase.from('content_campaigns')
        .select('id, name, thesis, audience, core_problem, message_angle, product_role, ' +
                'primary_benefit, objections, cta_intent, proof_available, proof_unavailable, ' +
                'recommended_channels, content_package')
        .eq('id', body.campaignId).eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
      if (!campaign) return reply.status(404).send({ error: 'Not found' });
      const c = campaign as unknown as Record<string, unknown>;

      const { deriveContentStrategy } = await import('../services/content/strategyComposition');
      const { deriveContentBrief } = await import('../services/content/briefComposition');
      const { brandConstraints } = await import('../services/content/brandGovernedGeneration');
      const architecture = {
        name: String(c.name), thesis: String(c.thesis), audience: String(c.audience),
        campaignObjective: (c.objective as string | null) ?? null,
        coreProblem: (c.core_problem as string | null) ?? null,
        messageAngle: String(c.message_angle),
        productRole: (c.product_role as string | null) ?? null,
        primaryBenefit: (c.primary_benefit as string | null) ?? null,
        objections: (c.objections as string[]) ?? [],
        ctaIntent: (c.cta_intent as string | null) ?? null,
        proofAvailable: (c.proof_available as string[]) ?? [],
        proofUnavailable: (c.proof_unavailable as string[]) ?? [],
        recommendedChannels: (c.recommended_channels as string[]) ?? [],
        contentPackage: [], packageNotes: [],
        brandDirectives: brandConstraints(ctx),
        prohibitedTerms: ctx.prohibitedTerms,
      };
      const strategy = planning?.strategy ?? deriveContentStrategy({ ctx, architecture });
      const brief = planning?.brief ?? deriveContentBrief(body.channel, strategy, ctx);

      const gen = await import('../services/content/b3ContentGeneration');
      const persist = await import('../services/content/contentArtifactPersistence');
      const { artifactProvenance } = await import('../services/content/creativeBriefs');
      const provenance = artifactProvenance({
        ctx, strategy, opportunityTitle: String(c.name), campaignName: String(c.name),
      });

      // Owner edits and regenerations both re-run the FULL pipeline. Neither
      // path can persist text that has not been governed.
      const result = body.editedContent
        ? { ...(await gen.regovernOwnerEdit({
              channel: body.channel, payload: body.editedContent, brief, ctx, founderId,
            })), rewriteAttempts: 0 }
        : await gen.generateChannelContent({ brief, strategy, ctx, founderId,
            variantLabel: body.variantLabel ?? null, requireVisualCopy: body.channel === 'META_AD',
            diagnosticId:body.planningAttemptId,groundedContext:planning?{service:planning.handoff.service.name,concept:planning.handoff.concept.family,geography:planning.handoff.geography,demandScope:planning.handoff.marketEvidence.demand?.geography??'Unavailable',growthThesis:planning.handoff.growthThesis,productTruth:planning.handoff.productTruth,serviceTruth:planning.handoff.serviceTruth??null,missingEvidence:planning.handoff.missingEvidence}:undefined });

      // Failed AI candidates are internal work, never replacement owner versions.
      if (!body.editedContent && result.disposition !== 'ELIGIBLE') {
        return reply.status(200).send({ assetId: body.assetId ?? null, versionNumber: null,
          ownerState: result.disposition === 'OWNER_CONFIRMATION_REQUIRED' ? 'NEEDS_OWNER_INPUT' : 'LAUNCHMIND_CAN_REPAIR',
          message: result.disposition === 'OWNER_CONFIRMATION_REQUIRED'
            ? 'LaunchMind needs your confirmation before completing this creative.'
            : 'LaunchMind could not finish the wording within its internal repair limit. The previous version is unchanged.',
          copyRepairs: result.rewriteAttempts, reasons: result.reasons,disposition:result.disposition,structuralIssues:result.structuralIssues,quality:result.quality,diagnosticId:result.diagnosticId,copyGenerationCalls:result.copyGenerationCalls });
      }

      const input = {
        identity: {
          workspaceId: ctxAuth.workspaceId, productId: body.productId,
          campaignId: body.campaignId, strategyId: body.strategyId, briefId: body.briefId,
          channel: body.channel,
          variantGroupId: body.variantGroupId ?? null,
          variantLabel: body.variantLabel ?? null,
        },
        result, brief, ctx, founderId, provenance, mode: body.mode,
        planningWorkId: body.planningWorkId,
      };

      let assetId: string; let versionNumber: number;
      if (body.assetId) {
        assetId = body.assetId;
        ({ versionNumber } = await persist.appendGovernedVersion({
          assetId: body.assetId, workspaceId: ctxAuth.workspaceId, input,
          changeType: body.editedContent ? 'editor_save' : 'ai_regen',
          changeSummary: body.editedContent ? 'Owner edit, re-governed' : 'Regenerated',
        }));
      } else {
        ({ assetId, versionNumber } = await persist.persistGovernedArtifact(input));
      }

      const view = await persist.ownerContentView(assetId, ctxAuth.workspaceId);
      // Reuse the authenticated visual endpoint, including its lineage, budget,
      // governance and bounded pixel-repair gates. One owner action owns both stages.
      if (result.disposition === 'ELIGIBLE' && body.channel === 'META_AD' && !body.deferVisual) {
        const rendered = await server.inject({ method: 'POST',
          url: `/studio/governed/artifact/${assetId}/visual`,
          headers: { authorization: request.headers.authorization ?? '' },
          payload: { qualityTier: 'DRAFT' } });
        const visual = rendered.json();
        const ready = rendered.statusCode === 201 && !!visual.imageUrl;
        return reply.status(201).send({ assetId, versionNumber, artifact: view,
          ownerState: ready ? 'READY_FOR_OWNER_REVIEW' : visual.ownerState ?? 'LAUNCHMIND_CAN_REPAIR',
          message: ready ? 'Ready for your review' : visual.message ?? visual.error ?? 'LaunchMind could not finish this creative within its internal repair limit.',
          copyRepairs: result.rewriteAttempts, visual });
      }
      return reply.status(201).send({ assetId, versionNumber, artifact: view,
        ownerState: result.disposition === 'OWNER_CONFIRMATION_REQUIRED' ? 'NEEDS_OWNER_INPUT'
          : result.disposition === 'ELIGIBLE' ? 'READY_FOR_OWNER_REVIEW' : 'LAUNCHMIND_CAN_REPAIR',
        copyRepairs: result.rewriteAttempts,copyGenerationCalls:result.copyGenerationCalls });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      if (/Not found/.test(msg)) return reply.status(404).send({ error: 'Not found' });
      if (/no artifact to save|not eligible/i.test(msg)) {
        return reply.status(422).send({ error: msg });
      }
      if (err instanceof Error && err.name === 'ArtifactPersistenceError') {
        Sentry.captureException(err);
        return reply.status(500).send({ error: 'Generation failed', failureClass: 'ARTIFACT_PERSISTENCE_FAILED' });
      }
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Generation failed' });
    }
  });

  /**
   * POST /studio/governed/package
   *
   * The backend behind "Create recommended content" — Phase 3.5B4.
   *
   * Plans the content package from the campaign's own strategy and produces
   * each ready item through the SAME governed B3 pipeline. Blocked items are
   * reported with a reason and skipped; one unmet dependency never fails the
   * package.
   *
   * @security JWT required. Workspace, actor, brand, evidence and authorised
   *   assets are all derived server-side. `planOnly` returns the plan without
   *   generating, so an owner can see what LaunchMind would make before it does.
   */
  server.post('/studio/governed/package', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestStartedAt = Date.now();
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = RecommendedPackageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }
    const body = parsed.data;

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: product } = await supabase.from('products').select('id')
        .eq('id', body.productId).eq('workspace_id', ctxAuth.workspaceId)
        .is('archived_at', null).maybeSingle();
      if (!product) return reply.status(404).send({ error: 'Not found' });

      const { data: campaign } = await supabase.from('content_campaigns')
        .select('id, name, thesis, audience, core_problem, message_angle, product_role, ' +
                'primary_benefit, objections, cta_intent, proof_available, proof_unavailable, ' +
                'recommended_channels, opportunity_id')
        .eq('id', body.campaignId).eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
      if (!campaign) return reply.status(404).send({ error: 'Not found' });
      const c = campaign as unknown as Record<string, unknown>;

      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { buildProductContentContext } = await import('../services/content/productContentContext');
      const { brandConstraints } = await import('../services/content/brandGovernedGeneration');
      const { deriveContentStrategy } = await import('../services/content/strategyComposition');
      const orchestration = await import('../services/content/contentPackageOrchestrator');

      const pkgCtx = await buildProductContentContext(await buildContextPackageV2({
        workspaceId: ctxAuth.workspaceId, founderId, productId: body.productId,
        intent: 'CONTENT_GENERATION', query: String(c.thesis ?? 'content package'), persist: false,
      }));
      const contextReadyAt = Date.now();

      const strategy = deriveContentStrategy({ ctx: pkgCtx, architecture: {
        name: String(c.name), thesis: String(c.thesis), audience: String(c.audience),
        campaignObjective: (c.objective as string | null) ?? null,
        coreProblem: (c.core_problem as string | null) ?? null,
        messageAngle: String(c.message_angle),
        productRole: (c.product_role as string | null) ?? null,
        primaryBenefit: (c.primary_benefit as string | null) ?? null,
        objections: (c.objections as string[]) ?? [],
        ctaIntent: (c.cta_intent as string | null) ?? null,
        proofAvailable: (c.proof_available as string[]) ?? [],
        proofUnavailable: (c.proof_unavailable as string[]) ?? [],
        recommendedChannels: (c.recommended_channels as string[]) ?? [],
        contentPackage: [], packageNotes: [],
        brandDirectives: brandConstraints(pkgCtx),
        prohibitedTerms: pkgCtx.prohibitedTerms,
      } });

      // Creative Intelligence may shape execution, never truth. Only active,
      // workspace-scoped structural observations reach the creative brief.
      const { activePatterns } = await import('../services/creativeIntelligence/creativeIntelligenceService');
      const { buildCreativeDirection, summariseDirection } =
        await import('../services/creativeIntelligence/creativeInfluence');
      const active = await activePatterns(ctxAuth.workspaceId, null);
      const direction = buildCreativeDirection({
        patterns: active, messageAngle: String(c.message_angle ?? ''), channel: 'meta_ad',
        founderBoundaries: pkgCtx.founderDirection.contextDelta
          ? [pkgCtx.founderDirection.contextDelta] : [],
        brandDirectives: Object.values(pkgCtx.brand.fields)
          .filter(f => f.ownerConfirmed).map(f => String(f.value)),
      });
      const selectedPatterns = summariseDirection(direction).recommends;
      const patternsReadyAt = Date.now();

      const result = await orchestration.orchestrateContentPackage({
        ctx: pkgCtx, strategy,
        campaignId: body.campaignId, strategyId: body.strategyId,
        opportunityTitle: String(c.name), campaignName: String(c.name),
        founderId, mode: body.mode,
        briefIds: body.briefIds as never,
        avatarVoiceChosen: body.avatarVoiceChosen === true,
        persist: body.planOnly !== true,
        useCreativeSetForMeta: body.planOnly !== true,
        creativePatterns: selectedPatterns,
        // No product-specific learning is supplied until observed performance
        // exists. An empty list is safer than converting memory into evidence.
        firstPartyLearning: [],
        parallelVariants: true,
        // Eligible Meta concepts render and pass final-image critique internally
        // before this request completes. Failed candidates remain withheld.
      });
      const generationFinishedAt = Date.now();
      const timingParts = [
        `context;dur=${contextReadyAt - requestStartedAt}`,
        `creative_intelligence;dur=${patternsReadyAt - contextReadyAt}`,
        `package;dur=${generationFinishedAt - patternsReadyAt}`,
        ...Object.entries(result.timingsMs).map(([name, duration]) =>
          `${name.replace(/[^a-zA-Z0-9_.-]/g, '_')};dur=${duration}`),
      ];
      reply.header('Server-Timing', timingParts.join(', '));
      request.log.info({ code: 'CONTENT_PACKAGE_TIMINGS',
        totalMs: generationFinishedAt - requestStartedAt,
        stagesMs: { contextAndTruth: contextReadyAt - requestStartedAt,
          creativeIntelligence: patternsReadyAt - contextReadyAt,
          generationGovernanceAndPersistence: generationFinishedAt - patternsReadyAt,
          ...result.timingsMs } }, 'recommended content package completed');

      if (result.generationUnavailable) {
        request.log.warn({
          code: 'CREATIVE_GENERATION_UNAVAILABLE',
          stagesMs: { context: contextReadyAt - requestStartedAt,
            patterns: patternsReadyAt - contextReadyAt,
            concepts: generationFinishedAt - patternsReadyAt, visuals: 0 },
        }, 'recommended creative generation stopped after the first unavailable result');
        return reply.status(503).send({
          code: 'CREATIVE_GENERATION_UNAVAILABLE',
          error: 'Creative generation is temporarily unavailable. Your strategy and existing content are saved.',
          stages: [
            { name: 'BUSINESS_CONTEXT', state: 'COMPLETE', durationMs: contextReadyAt - requestStartedAt },
            { name: 'PRODUCT_TRUTH', state: 'COMPLETE', durationMs: 0 },
            { name: 'CREATIVE_PATTERNS', state: 'COMPLETE', durationMs: patternsReadyAt - contextReadyAt },
            { name: 'CONCEPTS', state: 'FAILED', durationMs: generationFinishedAt - patternsReadyAt },
            { name: 'VISUALS', state: 'SKIPPED', durationMs: 0 },
          ],
        });
      }

      // Persist the plan onto the campaign it belongs to — no package table.
      await supabase.from('content_campaigns')
        .update({ content_package: result.package.items })
        .eq('id', body.campaignId).eq('workspace_id', ctxAuth.workspaceId);

      return reply.status(201).send({
        package: orchestration.ownerPackageView(
          result.package, String(c.name), result.narrativeThesis),
        generated: body.planOnly ? [] : result.generated.map(g => ({
          channel: g.channel, variant: g.variantLabel, assetId: g.assetId,
          version: g.versionNumber, status: g.disposition, needsAttention: g.reasons,
        })),
        skipped: result.skipped,
        whyCreated: result.provenance,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      if (/Not found/.test(msg)) return reply.status(404).send({ error: 'Not found' });
      if (/exceeds its limits/.test(msg)) return reply.status(422).send({ error: msg });
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Package generation failed' });
    }
  });

  /**
   * GET /studio/governed/intelligence?productId=...
   *
   * THE owner-safe read model behind the Content Intelligence surface — B5.
   *
   * One request answers the whole decision: is there something worth marketing,
   * why now, who for, what to say, what LaunchMind would create, what it can
   * create today, and what it needs from the owner.
   *
   * @security JWT required; workspace derived from the verified session and the
   *   product checked inside it. Owner-safe by construction: evidence handles,
   *   authority tiers, policy versions, classifier internals, prompts and
   *   reasoning never enter the response — only plain language the owner can act on.
   */
  server.post('/studio/governed/catalog/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const body = z.object({productId:z.string().uuid(),expectedVersion:z.number().int().min(0),catalog:z.unknown()}).strict().safeParse(request.body);
    if(!body.success)return reply.status(400).send({error:'Refresh the service context before confirming.',code:'CATALOG_CONTEXT_REQUIRED'});
    const {resolveWorkspaceContext}=await import('../services/workspaceAuthService');
    const auth=await resolveWorkspaceContext(founderId,null);
    const {confirmedCatalog,reviseCatalogContext}=await import('../services/content/serviceCatalog');
    const entries=(body.data.catalog as {entries?:Array<Record<string,unknown>>})?.entries;
    if(!Array.isArray(entries)||entries.some(e=>!e||!Object.prototype.hasOwnProperty.call(e,'serviceArea')||Object.prototype.hasOwnProperty.call(e,'fulfillmentGeographies')))return reply.status(400).send({error:'Confirm your city or metro, state and country, or indicate that the area is not confirmed yet.',code:'CATALOG_VALIDATION',fields:{serviceArea:'Use the structured service-area fields.'}});
    let catalog;
    try{catalog=confirmedCatalog(body.data.catalog,body.data.productId,founderId,new Date().toISOString());}
    catch(e){
      const fields:Record<string,string>={};
      if(e instanceof z.ZodError)for(const issue of e.issues){const path=issue.path.join('.');fields[path]=path.includes('fulfillmentGeographies')?'Each area must contain 2–80 characters, with no more than 30 areas. Leave unknown if needed.':issue.message;}
      return reply.status(400).send({error:Object.values(fields)[0]??'Select unique services with valid names.',code:'CATALOG_VALIDATION',fields});
    }
    const db=getSupabaseAdmin();
    const {data:product,error}=await db.from('products').select('confirmed_icp,scraped_meta').eq('workspace_id',auth.workspaceId).eq('id',body.data.productId).is('archived_at',null).single();
    if(error||!product)return reply.status(404).send({error:'Not found'});
    const previous=product.confirmed_icp;
    if(body.data.expectedVersion!==(previous?.serviceCatalog?.version??0))return reply.status(409).send({error:'Your services changed in another session. Refresh the page, then review your selections.',code:'CATALOG_CONTEXT_CHANGED'});
    if(!catalog.entries.length)return reply.status(400).send({error:'Select at least one service.',code:'CATALOG_VALIDATION',fields:{entries:'Select at least one service.'}});
    catalog=confirmedCatalog(body.data.catalog,body.data.productId,founderId,catalog.confirmedAt,product.scraped_meta?.catalogDiscovery?.entries??[]);
    const confirmedContext=reviseCatalogContext(previous,catalog);
    let update=db.from('products').update({confirmed_icp:confirmedContext}).eq('workspace_id',auth.workspaceId).eq('id',body.data.productId);
    update=previous===null?update.is('confirmed_icp',null):update.eq('confirmed_icp',JSON.stringify(previous));
    const {data:saved,error:saveError}=await update.select('id');
    if(saveError){request.log.error({code:saveError.code,productId:body.data.productId},'Catalog confirmation persistence failed');return reply.status(500).send({error:"I couldn't save this yet. Try again.",code:'CATALOG_SAVE_FAILED'});}
    if(!saved?.length)return reply.status(409).send({error:'Your product context changed while saving. Refresh the page, then review your selections.',code:'CATALOG_CONTEXT_CHANGED'});
    return reply.send({confirmed:catalog.entries.length});
  });

  /**
   * POST /studio/governed/service-knowledge
   *
   * The owner answering the specific questions concept readiness found missing
   * for ONE service. Saved onto the SAME governed catalog entry the owner
   * already confirms services through — `products.confirmed_icp.serviceCatalog`
   * — so there is no parallel knowledge store and provenance stays
   * OWNER_CONFIRMED.
   *
   * @security JWT; workspace from the verified session; the product checked
   *   inside it. Writes owner-stated text only — it grants no capability and
   *   creates no evidence of results. Readiness re-reads it on the next load.
   */
  server.post('/studio/governed/service-knowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId=getFounderId(request);
    const {ServiceKnowledge}=await import('../services/content/serviceCatalog');
    const body=z.object({productId:z.string().uuid(),serviceId:z.string().min(1),
      knowledge:ServiceKnowledge.optional(),confirmHypothesisIds:z.array(z.string().min(1).max(180)).max(3).optional()}).strict().safeParse(request.body);
    if(!body.success)return reply.status(400).send({error:'Add at least one answer before saving.',code:'SERVICE_KNOWLEDGE_INVALID'});
    const answers=Object.values(body.data.knowledge??{}).filter(v=>typeof v==='string'&&v.trim().length>0);
    if(answers.length===0&&!(body.data.confirmHypothesisIds?.length))return reply.status(400).send({error:'Add at least one answer before saving.',code:'SERVICE_KNOWLEDGE_INVALID'});
    try{
      const {resolveWorkspaceContext}=await import('../services/workspaceAuthService');
      const auth=await resolveWorkspaceContext(founderId,null);
      const db=getSupabaseAdmin();
      const {data:product,error}=await db.from('products').select('confirmed_icp')
        .eq('workspace_id',auth.workspaceId).eq('id',body.data.productId).is('archived_at',null).single();
      if(error||!product)return reply.status(404).send({error:'Not found'});
      const icp=(product.confirmed_icp??{}) as Record<string,any>;
      const catalog=icp.serviceCatalog;
      const entries=Array.isArray(catalog?.entries)?catalog.entries:[];
      const {catalogId}=await import('../services/content/serviceCatalog');
      const idx=entries.findIndex((e:any)=>e?.id===body.data.serviceId
        ||catalogId(body.data.productId,String(e?.name??''))===body.data.serviceId);
      if(idx<0)return reply.status(404).send({error:'That service is not in your confirmed list.',code:'SERVICE_NOT_CONFIRMED'});
      const target=entries[idx];
      const {confirmedHypothesisKnowledge}=await import('../services/content/customerIntelligence');
      const promoted=confirmedHypothesisKnowledge({...target,id:body.data.serviceId},body.data.confirmHypothesisIds??[]);
      if((body.data.confirmHypothesisIds?.length??0)!==promoted.hypotheses.length)return reply.status(400).send({error:'That proposal is no longer available. Refresh and review it again.',code:'HYPOTHESIS_STALE'});
      const now=new Date().toISOString();
      const next={...icp,serviceCatalog:{...catalog,entries:entries.map((e:any,i:number)=>i===idx
        ? {...e,ownerKnowledge:{...(e.ownerKnowledge??{}),...(body.data.knowledge??{}),...promoted.knowledge,
            hypothesisConfirmations:[...((e.ownerKnowledge?.hypothesisConfirmations??[]).filter((h:any)=>!promoted.hypotheses.some(p=>p.id===h.id))),...promoted.hypotheses.map(h=>({id:h.id,type:h.type,evidenceTypes:h.evidenceTypes,confirmedAt:now}))],
            confirmedBy:founderId,confirmedAt:now}}
        : e)}};
      const {error:saveError}=await db.from('products').update({confirmed_icp:next})
        .eq('workspace_id',auth.workspaceId).eq('id',body.data.productId);
      if(saveError){request.log.error({code:saveError.code},'Service knowledge save failed');
        return reply.status(500).send({error:"I couldn't save this yet. Try again.",code:'SERVICE_KNOWLEDGE_SAVE_FAILED'});}
      return reply.send({saved:answers.length+promoted.hypotheses.length});
    }catch{return reply.status(500).send({error:"I couldn't save this yet. Try again.",code:'SERVICE_KNOWLEDGE_SAVE_FAILED'});}
  });

  server.get('/studio/governed/intelligence', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const q = (request.query ?? {}) as { productId?: string };

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      // Product resolved INSIDE the workspace. An id from another business
      // resolves to nothing rather than to another owner's strategy.
      let productQuery = supabase.from('products')
        .select('id, name, category')
        .eq('workspace_id', ctxAuth.workspaceId)
        .is('archived_at', null);
      if (q.productId) productQuery = productQuery.eq('id', q.productId);
      const { data: product } = await productQuery
        .order('created_at', { ascending: true }).limit(1).maybeSingle();

      if (!product) {
        return reply.status(200).send({ state: 'NO_PRODUCT', product: null, opportunity: null,
          campaign: null, brand: null, needsFromYou: [], whyThis: [], creativePatterns: [] });
      }
      const p = product as unknown as Record<string, unknown>;
      const productId = String(p.id);

      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { buildProductContentContext } = await import('../services/content/productContentContext');
      const {storedPlanning,planningContext,rememberPlanning,validatePlanning}=await import('../services/content/groundedPlanningWork');
      // A STALE CACHED PLAN IS A NORMAL OUTCOME ON THIS PATH, NOT A FAILURE.
      //
      // MEASURED: the owner answered the questions readiness asked, which wrote
      // `ownerKnowledge` onto the confirmed catalog entry. `planningFingerprint`
      // hashes that catalog, so the cached snapshot's fingerprint stopped
      // matching, `validatePlanning` threw, and the whole page returned 500 —
      // "Couldn't load this" — permanently, because reloading re-ran the same
      // check. The throw's own message ("refresh Content Intelligence") named a
      // recovery that could never work here.
      //
      // Staleness must still BLOCK PRODUCTION — persistPlanningWork and
      // preparePlanningProduction call validatePlanning and keep throwing, so
      // content is never built from an out-of-date plan. But this route only
      // READS, and it already recomputes the recommendation below
      // (rankGroundedOpportunities + rememberPlanning), which re-caches with the
      // current fingerprint. Discarding the stale snapshot is the whole repair.
      let planningSnapshot=await storedPlanning(ctxAuth.workspaceId,productId);
      let ctx=await planningContext(ctxAuth.workspaceId,productId,founderId,planningSnapshot);
      if(planningSnapshot){
        try{
          validatePlanning(planningSnapshot,ctx,planningSnapshot.recommendation.selected.id,planningSnapshot.recommendation.selected.concepts[0].key);
        }catch{
          // Drop the stale PLAN, keep the foundation. The foundation carries the
          // search-demand tournament that selected this service — real, already
          // paid-for evidence, and `planningContext` has already replaced its
          // catalog with the current one, so nothing stale about the owner's
          // services is carried forward. MEASURED: discarding the foundation too
          // dropped the ranked opportunity to INSUFFICIENT_EVIDENCE and lost the
          // Plumbing winner, which would have traded one broken page for a
          // silently emptier one.
          planningSnapshot=null;
        }
      }

      const {existingPlanningWork}=await import('../services/content/groundedPlanningWork');
      const planningWork=await existingPlanningWork(ctx);
      // The most recent CONTENT opportunity. Read, never generated here.
      let priorOpportunityQuery = supabase.from('saved_opportunities')
        .select('id, title, message_angle, why_now, why_now_kind, origin, objective, ' +
                'audience_hypothesis, content_opportunity_type, created_at')
        .eq('workspace_id', ctxAuth.workspaceId).eq('product_id', productId)
        .not('content_opportunity_type', 'is', null)
        .eq('state', 'active')
        .order('created_at', { ascending: false });
      for(const work of planningWork){if(work.productionOpportunityId)priorOpportunityQuery=priorOpportunityQuery.neq('id',work.productionOpportunityId);}
      const {data:oppRow}=await priorOpportunityQuery.limit(1).maybeSingle();
      const o = oppRow as unknown as Record<string, unknown> | null;

      let campaign: Record<string, unknown> | null = null;
      if (o) {
        const { data: campRow } = await supabase.from('content_campaigns')
          .select('id, name, thesis, audience, core_problem, message_angle, product_role, ' +
                  'primary_benefit, objections, cta_intent, proof_available, proof_unavailable, ' +
                  'recommended_channels, content_package, brand_kit_version')
          .eq('workspace_id', ctxAuth.workspaceId).eq('opportunity_id', String(o.id))
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        campaign = campRow as unknown as Record<string, unknown> | null;
      }

      // Server-owned lineage the "create recommended content" action must echo
      // back. Identifiers, never authority — the route re-verifies everything.
      let strategyId: string | null = null;
      const briefIds: Record<string, string> = {};
      if (campaign) {
        // ORDERED. A campaign whose direction was adjusted has more than one
        // strategy; without an order the newest is not the one returned, and
        // the owner would create content under a direction they replaced.
        const { data: st } = await supabase.from('content_strategies')
          .select('id').eq('content_campaign_id', String(campaign.id))
          .eq('workspace_id', ctxAuth.workspaceId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        strategyId = (st as { id?: string } | null)?.id ?? null;
        const { data: brs } = await supabase.from('content_briefs')
          .select('id, content_channel, strategy_id').eq('content_campaign_id', String(campaign.id))
          .eq('workspace_id', ctxAuth.workspaceId)
          .order('created_at', { ascending: false });
        const MAP: Record<string, string> = {
          google_ads_rsa: 'GOOGLE_RSA', google_rsa: 'GOOGLE_RSA',
          meta_ads: 'META_AD', meta_ad: 'META_AD', landing_page: 'LANDING_PAGE',
          linkedin_post: 'LINKEDIN_POST', short_form_video_script: 'SHORT_FORM_VIDEO_SCRIPT',
        };
        // Newest brief per channel, and only from the CURRENT strategy — a brief
        // left behind by a replaced direction must not be handed to generation.
        for (const b of (brs ?? []) as Array<{ id: string; content_channel: string; strategy_id: string | null }>) {
          if (strategyId && b.strategy_id && b.strategy_id !== strategyId) continue;
          const key = MAP[b.content_channel];
          if (key && !briefIds[key]) briefIds[key] = b.id;
        }
      }

      // Brand in the owner's language. Provenance is a sentence, never the enum.
      const { brandProvenanceLabel } = await import('../services/brand/brandFieldPolicy');
      const brand = {
        fields: Object.values(ctx.brand.fields).map(f => ({
          name: f.fieldKey.replace(/_/g, ' '),
          value: typeof f.value === 'string' ? f.value : null,
          confirmed: f.ownerConfirmed,
          note: brandProvenanceLabel(f),
        })),
        missing: ctx.brand.missing.map(m => m.replace(/_/g, ' ')),
      };

      const needsFromYou: string[] = [];
      if (!ctx.brand.fields.tone?.ownerConfirmed && !ctx.brand.fields.brand_voice?.ownerConfirmed) {
        needsFromYou.push('Confirm your brand tone');
      }
      if (!ctx.brand.fields.logo?.ownerConfirmed) needsFromYou.push('Confirm your logo');
      if (ctx.authorizedAssets.length === 0) needsFromYou.push('Authorise product imagery LaunchMind may use');
      if (!ctx.founderDirection.audienceConfirmed) needsFromYou.push('Confirm your primary audience');
      if (!ctx.brand.fields.cta_destination?.ownerConfirmed) needsFromYou.push('Confirm where your ads should send people');

      const state = o ? 'HAS_OPPORTUNITY'
        : (needsFromYou.length >= 4 ? 'NEEDS_CONTEXT' : 'NO_OPPORTUNITY');

      // Whether this is the FIRST story for this application, measured rather
      // than assumed: an owner who already has content should not be told
      // LaunchMind is starting over.
      const { count: existingContent } = await supabase.from('content_assets')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ctxAuth.workspaceId).eq('product_id', productId)
        .eq('governance', 'GOVERNED_CONTENT_INTELLIGENCE');
      const isFirstStory = (existingContent ?? 0) === 0;

      // ── §14 CREATED STATE ────────────────────────────────────────────────
      //
      // Content Intelligence kept presenting "what I would create" long after
      // it had created it, because nothing told it otherwise. The owner had no
      // way to tell from this page whether the button had ever worked.
      //
      // Read from the ARTIFACTS, per concept, so the summary cannot drift from
      // what actually exists. Scoped to the current campaign — content from a
      // superseded direction is history, not this recommendation's output.
      let created: {
        total: number; ready: number; needsAttention: number; launchMindRepairing: number;
        earlierCount: number;
        concepts: Array<{ name: string; status: 'READY' | 'NEEDS_ATTENTION' | 'REFINING';
          artifactId: string; attentionReason: string | null; updatedAt: string | null }>;
        campaignId: string | null;
      } | null = null;
      if (campaign) {
        const { data: made } = await supabase.from('content_assets')
          .select('id, variant_label, content_status, channel, updated_at')
          .eq('workspace_id', ctxAuth.workspaceId)
          .eq('content_campaign_id', String(campaign.id))
          .is('archived_at', null);
        const rows = (made ?? []) as Array<{ id: string; variant_label: string | null; channel: string;
          content_status: string | null; updated_at: string | null }>;
        if (rows.length > 0) {
          const OWNER_INPUT = ['OWNER_CONFIRMATION_REQUIRED', 'NEEDS_OWNER_CONFIRMATION'];
          const REPAIRABLE = ['REWRITE_REQUIRED', 'PROHIBITED', 'DEGRADED', 'BLOCKED'];
          const ATTENTION_REASON: Record<string, string> = {
            REWRITE_REQUIRED: 'LaunchMind is refining wording against the available evidence',
            OWNER_CONFIRMATION_REQUIRED: 'Confirm a statement LaunchMind cannot verify',
            NEEDS_OWNER_CONFIRMATION: 'Confirm a statement LaunchMind cannot verify',
            PROHIBITED: 'LaunchMind is removing wording it cannot safely use',
            DEGRADED: 'LaunchMind is completing its safety checks',
            BLOCKED: 'LaunchMind is resolving what prevented safe completion',
          };
          const currentByRole = new Map<string, typeof rows[number]>();
          for (const row of rows.sort((a, b) => String(b.updated_at ?? '')
            .localeCompare(String(a.updated_at ?? '')))) {
            const key = `${row.channel}:${row.variant_label ?? 'default'}`;
            if (!currentByRole.has(key)) currentByRole.set(key, row);
          }
          const currentRows = [...currentByRole.values()];
          const concepts = currentRows.map(a => ({
            artifactId: a.id,
            name: a.variant_label ?? 'Concept',
            status: OWNER_INPUT.includes(String(a.content_status ?? ''))
              ? 'NEEDS_ATTENTION' as const
              : REPAIRABLE.includes(String(a.content_status ?? ''))
                ? 'REFINING' as const : 'READY' as const,
            attentionReason: ATTENTION_REASON[String(a.content_status ?? '')] ?? null,
            updatedAt: a.updated_at,
          }));
          created = {
            total: concepts.length,
            ready: concepts.filter(c => c.status === 'READY').length,
            needsAttention: concepts.filter(c => c.status === 'NEEDS_ATTENTION').length,
            launchMindRepairing: concepts.filter(c => c.status === 'REFINING').length,
            earlierCount: rows.length - currentRows.length,
            concepts,
            campaignId: String(campaign.id),
          };
        }
      }

      // ── Creative direction — §19/§20 ──────────────────────────────────
      //
      // Read, scored and summarised here so the owner surface receives three
      // words and a sentence. Patterns, sources, publishers, keys and
      // confidence bands never leave the server: an owner asked to evaluate a
      // pattern key is being shown machinery, and a list of the companies
      // LaunchMind looked at is one click from "use that one".
      //
      // NON-FATAL BY CONSTRUCTION. Creative Intelligence being empty, stale,
      // switched off or unavailable all resolve to the same thing here — no
      // direction, and a sentence saying so. Content creation is unaffected.
      const { rankGroundedOpportunities } = await import('../services/opportunity/groundedOpportunity');
      const preliminaryOpportunity = rankGroundedOpportunities(ctx).selected;
      let creativeDirection: { recommends: string[]; why: string | null;
        limitation: string | null; notImitated: string[] } =
        { recommends: [], why: null, limitation: null, notImitated: [] };
      try {
        const { activePatterns } = await import('../services/creativeIntelligence/creativeIntelligenceService');
        const { buildCreativeDirection, summariseDirection } =
          await import('../services/creativeIntelligence/creativeInfluence');
        // WORKSPACE-SCOPED, NOT CATEGORY-KEYED, and this was working by luck.
        //
        // The observations in a workspace were gathered FOR that workspace's
        // product, so the workspace is already the right scope. Keying on
        // `products.category` additionally matched a MARKETING category
        // ("home_services") against an APP STORE SHELF ("Productivity") — two
        // vocabularies that agree only by coincidence. It returned the right
        // answer here solely because this product's category column is empty,
        // so the filter was skipped; setting the category would have silently
        // emptied Creative Intelligence with no error anywhere.
        const patterns = await activePatterns(ctxAuth.workspaceId, null);
        const d = buildCreativeDirection({
          patterns,
          messageAngle: preliminaryOpportunity?.problem ?? ctx.application.description ?? '',
          channel: 'meta_ad',
          founderBoundaries: ctx.founderDirection.contextDelta
            ? [ctx.founderDirection.contextDelta] : [],
          brandDirectives: Object.values(ctx.brand.fields)
            .filter(f => f.ownerConfirmed).map(f => String(f.value)),
        });
        const sum = summariseDirection(d);
        creativeDirection = { ...sum, notImitated: d.notImitated };
      } catch { /* absent is a legitimate state, not an error */ }

      const groundedRecommendation = rankGroundedOpportunities(ctx, creativeDirection.recommends);
      rememberPlanning(ctx,groundedRecommendation);

      // Current readiness for the stored plan. Shape from the snapshot,
      // verdict from today — see refreshPackageReadiness for why.
      let freshPackage: unknown[] = (campaign?.content_package as unknown[]) ?? [];
      if (campaign && Array.isArray(campaign.content_package)) {
        try {
          const { refreshPackageReadiness } =
            await import('../services/content/contentPackagePolicy');
          const unresolved: string[] = [];
          if (!ctx.brand.fields.cta_destination?.ownerConfirmed) unresolved.push('ctaDestination');
          if (!ctx.brand.fields.pricing?.ownerConfirmed) unresolved.push('pricing');
          freshPackage = refreshPackageReadiness(
            campaign.content_package as never,
            {
              authorizedAssetCount: ctx.authorizedAssets.length,
              hasEvidence: ((campaign.proof_available as string[]) ?? []).length > 0,
              ownerConfirmationRequired: unresolved,
              // Nothing has chosen a presenter, and PRODUCT_MOTION does not
              // need one. Reading this as "not ready" was the §8 defect.
              avatarVoiceChosen: false,
              videoMode: 'PRODUCT_MOTION',
              opportunityType: 'PRODUCT_BENEFIT',
            },
          ) as unknown[];
          // §7 — each row carries the action that would unblock it.
          const { ownerActionFor } = await import('../services/content/contentPackagePolicy');
          freshPackage = (freshPackage as never[]).map(it =>
            ({ ...(it as object), ownerAction: ownerActionFor(it) }));
        } catch { /* keep the snapshot rather than showing nothing */ }
      }

      return reply.status(200).send({
        state,
        product: { id: productId, name: String(p.name ?? ''), category: (p.category as string | null) ?? null },
        groundedRecommendation,
        planningWork,
        opportunity: o ? {
          id: String(o.id),
          title: String(o.title ?? ''),
          origin: o.origin === 'OWNER_DIRECTED' ? 'You asked for this' : 'LaunchMind found this',
          whyNow: String(o.why_now ?? ''),
          whyNowKind: o.why_now_kind === 'INTELLIGENCE_TRIGGERED'
            ? 'Something changed in your market'
            : 'A durable truth about your product',
          who: String(o.audience_hypothesis ?? ''),
          message: String(o.message_angle ?? ''),
          objective: String(o.objective ?? ''),
          isShareabilityPlay: o.content_opportunity_type === 'VIRAL_GROWTH',
          isFirstStory,
        } : null,
        campaign: campaign ? {
          id: String(campaign.id), name: String(campaign.name ?? ''),
          thesis: String(campaign.thesis ?? ''), audience: String(campaign.audience ?? ''),
          coreProblem: (campaign.core_problem as string | null) ?? null,
          messageAngle: String(campaign.message_angle ?? ''),
          // Read-time repair of two fields that were written wrong and are
          // immutable snapshots, so they cannot be corrected in place.
          //
          //   productRole carried the raw scraped store title, so it read
          //   "AllignX・Home Services App - App Store is how this gets solved".
          //   ctaIntent and primaryBenefit were BOTH assigned the campaign
          //   OBJECTIVE, so the owner's call to action read "Generate organic
          //   awareness among professional homeowners" — a sentence addressed
          //   to the business, printed where the sentence addressed to the
          //   reader belongs.
          //
          // Composition no longer produces either (see deriveViewerCtaIntent
          // and displayProductName). These lines only stop the historical rows
          // from being rendered as if they were right.
          productRole: cleanProductRole(campaign.product_role as string | null),
          // Suppressed rather than shown when it is a copy of the objective:
          // the owner learns nothing from reading the same sentence twice, and
          // an empty field is more honest than a mislabelled one.
          primaryBenefit: sameSentence(campaign.primary_benefit as string | null,
            (o?.objective as string | null) ?? null)
            ? null : ((campaign.primary_benefit as string | null) ?? null),
          objections: (campaign.objections as string[]) ?? [],
          ctaIntent: viewerCtaIntent(
            campaign.cta_intent as string | null,
            campaign.primary_benefit as string | null,
            (o?.objective as string | null) ?? null,
            String(p.name ?? '')),
          proofAvailable: (campaign.proof_available as string[]) ?? [],
          proofUnavailable: (campaign.proof_unavailable as string[]) ?? [],
          // READINESS IS RECOMPUTED, THE PLAN IS NOT. The stored package is a
          // snapshot of what LaunchMind proposed; its `state` and
          // `blockedReason` were true when it was written and are not
          // necessarily true now. The owner confirmed their destination and
          // this surface kept saying "confirm where this should send people",
          // because it was reading a photograph rather than the room.
          package: freshPackage,
          // Owner-safe brand sentence, built from CONFIRMED fields only.
          brandDirection: [
            ctx.brand.fields.tone?.ownerConfirmed ? String(ctx.brand.fields.tone.value) : null,
            ctx.brand.fields.brand_voice?.ownerConfirmed ? String(ctx.brand.fields.brand_voice.value) : null,
          ].filter(Boolean).join(' · ') || 'Not confirmed yet',
          strategyId: strategyId,
          briefIds: briefIds,
        } : null,
        brand,
        needsFromYou,
        whyThis: ctx.brandProvenance,
        created,
        creativePatterns: creativeDirection.recommends,
        // §20 — a compact creative direction, never a competitor gallery.
        creativeDirection,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not load content intelligence' });
    }
  });

  /**
   * GET /studio/governed/campaign/:id
   *
   * Owner-safe workbench read model — Phase 3.5B5.
   *
   * Everything Content Studio needs for ONE campaign: its artifacts grouped by
   * channel, variants beside each other, the current version, the governance
   * verdict in plain language, and what still needs the owner.
   *
   * @security JWT; workspace from the verified session; the campaign is read
   *   inside it. Evidence handles, authority tiers, policy versions, prompts and
   *   model reasoning are translated or dropped before the response is built.
   */
  server.get('/studio/governed/campaign/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { id } = request.params as { id: string };

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: campaign } = await supabase.from('content_campaigns')
        .select('id, name, thesis, audience, product_id, content_package')
        .eq('id', id).eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
      if (!campaign) return reply.status(404).send({ error: 'Not found' });
      const c = campaign as unknown as Record<string, unknown>;

      const { data: assetRows } = await supabase.from('content_assets')
        .select('id, channel, variant_label, variant_group_id, content_status, ' +
                'structured_data, brand_kit_version, content_approved_version, ' +
                'strategy_id, content_brief_id, product_id, created_at')
        .eq('workspace_id', ctxAuth.workspaceId)
        .eq('content_campaign_id', id)
        .eq('governance', 'GOVERNED_CONTENT_INTELLIGENCE')
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      const assets = (assetRows ?? []) as unknown as Array<Record<string, unknown>>;

      const artifacts = [];
      for (const a of assets) {
        const { data: versionRows } = await supabase.from('content_versions')
          .select('version_number, disposition, governance_summary, change_type, ' +
                  'brand_kit_version, created_at')
          .eq('asset_id', String(a.id));
        const versions = ((versionRows ?? []) as unknown as Array<Record<string, unknown>>)
          .sort((x, y) => Number(y.version_number) - Number(x.version_number));
        const latest = versions[0] ?? {};
        const summary = (latest.governance_summary ?? {}) as Record<string, unknown>;
        const claims = (summary.claims ?? []) as Array<Record<string, unknown>>;
        const quality = (summary.quality ?? {}) as Record<string, string>;

        artifacts.push({
          id: String(a.id),
          // Lineage ids the workbench must echo back to regenerate or edit.
          // They identify WHICH artifact, and grant nothing.
          strategyId: (a.strategy_id as string | null) ?? null,
          briefId: (a.content_brief_id as string | null) ?? null,
          productId: (a.product_id as string | null) ?? null,
          channel: String(a.channel ?? ''),
          variantLabel: (a.variant_label as string | null) ?? null,
          variantGroupId: (a.variant_group_id as string | null) ?? null,
          status: (a.content_status as string | null) ?? 'DRAFT',
          content: (a.structured_data ?? {}) as Record<string, unknown>,
          currentVersion: Number(latest.version_number ?? 1),
          approvedVersion: (a.content_approved_version as number | null) ?? null,
          brandVersion: (a.brand_kit_version as number | null) ?? null,
          createdAt: (a.created_at as string | null) ?? null,
          // Plain language only. The disposition enum stays on the server.
          factualSafety: quality.factualSafety === 'CERTIFIED_SUPPORTED'
            ? 'No unsupported claims detected'
            : quality.factualSafety === 'NOT_SUPPORTED'
              ? 'Contains a statement LaunchMind cannot verify'
              : 'Not verified',
          brandFit: quality.brandAlignment === 'ASSESSED_CONSISTENT'
            ? 'Uses your confirmed direction'
            : quality.brandAlignment === 'ASSESSED_INCONSISTENT'
              ? 'Uses wording you asked LaunchMind to avoid'
              : 'Not assessed',
          needsAttention: (summary.reasons ?? []) as string[],
          whyCreated: (summary.provenance ?? []) as string[],
          proof: [...new Set(claims.flatMap(k => (k.support ?? []) as string[]))],
          confirmationGaps: claims
            .filter(k => k.verdict === 'NEEDS_OWNER_CONFIRMATION')
            .map(k => String(k.text ?? '')),
          versions: versions.map(v => ({
            number: Number(v.version_number),
            origin: v.change_type === 'editor_save' ? 'You edited this' : 'LaunchMind generated this',
            brandVersion: (v.brand_kit_version as number | null) ?? null,
            createdAt: (v.created_at as string | null) ?? null,
          })),
        });
      }

      return reply.status(200).send({
        campaign: { id: String(c.id), name: String(c.name ?? ''),
          thesis: String(c.thesis ?? ''), audience: String(c.audience ?? ''),
          productId: String(c.product_id ?? '') },
        artifacts,
        package: (c.content_package as unknown[]) ?? [],
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not load campaign content' });
    }
  });

  /**
   * POST /studio/governed/artifact/:id/approve
   *
   * Owner approval of ONE immutable content version — Phase 3.5B5.
   *
   * @security JWT; workspace from the verified session. Grants NO publish,
   *   launch, schedule, send, budget or provider permission — the governed lane
   *   has no column in which any of those could be recorded. Refuses any version
   *   that is not ELIGIBLE_FOR_CONTENT_APPROVAL, so approval cannot be used to
   *   wave through content the pipeline rejected.
   */
  server.post('/studio/governed/artifact/:id/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ versionNumber: z.number().int().positive(), note: z.string().max(500).optional(), renderJobId:z.string().uuid().optional() })
      .strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }
      const persist = await import('../services/content/contentArtifactPersistence');
      if(parsed.data.renderJobId){
        const {approveCreative}=await import('../services/creative/creativeApprovalService');
        const visual=await approveCreative({renderJobId:parsed.data.renderJobId,workspaceId:ctxAuth.workspaceId,actorId:founderId,note:parsed.data.note});
        if(visual.contentVersionNumber!==parsed.data.versionNumber) return reply.status(422).send({error:'That visual does not belong to the version being approved.'});
      }
      await persist.approveContentVersion({
        assetId: id, workspaceId: ctxAuth.workspaceId,
        versionNumber: parsed.data.versionNumber, actorId: founderId, note: parsed.data.note,
      });
      const view = await persist.ownerContentView(id, ctxAuth.workspaceId);
      return reply.status(200).send({ approvedVersion: parsed.data.versionNumber, artifact: view });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      if (/Not found/.test(msg)) return reply.status(404).send({ error: 'Not found' });
      if (/not eligible|does not exist/i.test(msg)) return reply.status(422).send({ error: msg });
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not approve this version' });
    }
  });

  /**
   * POST /studio/governed/campaign/:id/direction
   *
   * Owner adjustment of a campaign's DIRECTION — Phase 3.5B5.
   *
   * Two modes on one route because they must agree: `preview` computes what
   * would change and writes nothing; `apply` performs exactly that change. A
   * separate preview endpoint could drift from the apply it describes.
   *
   * @security JWT; workspace derived from the verified session; the campaign and
   *   product resolved inside it. Owner direction can change WHO, WHAT, HOW and
   *   WHICH CHANNELS — it has no path to the evidence set, because the applied
   *   strategy recomputes `proofAvailable` from context evidence and never reads
   *   the direction object. Applying APPENDS a strategy and briefs; existing
   *   artifacts, versions and approvals are not touched.
   */
  server.post('/studio/governed/campaign/:id/direction', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { id } = request.params as { id: string };

    const parsed = z.object({
      productId: z.string().uuid(),
      mode: z.enum(['preview', 'apply']),
      direction: z.object({
        audience:        z.string().max(300).nullish(),
        messageEmphasis: z.string().max(500).nullish(),
        tone:            z.string().max(200).nullish(),
        ctaIntent:       z.string().max(200).nullish(),
        channels:        z.array(z.string().max(60)).max(8).nullish(),
        note:            z.string().max(800).nullish(),
      }).strict(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: product } = await supabase.from('products').select('id')
        .eq('id', parsed.data.productId).eq('workspace_id', ctxAuth.workspaceId)
        .is('archived_at', null).maybeSingle();
      if (!product) return reply.status(404).send({ error: 'Not found' });

      const dir = await import('../services/content/directionAdjustment');
      const current = await dir.readCampaignDirection(id, ctxAuth.workspaceId);

      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { buildProductContentContext } = await import('../services/content/productContentContext');
      const ctx = await buildProductContentContext(await buildContextPackageV2({
        workspaceId: ctxAuth.workspaceId, founderId, productId: parsed.data.productId,
        intent: 'CONTENT_GENERATION', query: current.messageAngle || current.name, persist: false,
      }));

      if (parsed.data.mode === 'preview') {
        return reply.status(200).send({
          current: {
            audience: current.audience, message: current.messageAngle,
            ctaIntent: current.ctaIntent, channels: current.channels,
            tone: ctx.brand.fields.tone?.ownerConfirmed ? String(ctx.brand.fields.tone.value) : null,
          },
          preview: dir.previewDirection(current, parsed.data.direction, ctx),
        });
      }

      const applied = await dir.applyDirection({
        ctx, founderId, campaignId: id, current, direction: parsed.data.direction,
      });
      return reply.status(200).send({
        applied: applied.applied,
        strategyId: applied.strategyId, briefIds: applied.briefIds, channels: applied.channels,
        lineage: applied.supersededStrategyId
          ? 'Content you already have was created under the previous direction and is unchanged.'
          : 'Nothing had been created under the previous direction.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      if (/Not found/.test(msg)) return reply.status(404).send({ error: 'Not found' });
      if (err instanceof Error && err.name === 'DirectionError') {
        return reply.status(422).send({ error: msg });
      }
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not adjust the direction' });
    }
  });

  /**
   * POST /studio/governed/owner-directed
   *
   * "Create something else" — the owner-directed content path, Phase 3.5B5.
   *
   * `interpret` reads the owner's request into a marketing interpretation and
   * writes NOTHING. `apply` commits an interpretation the owner accepted as
   * opportunity → campaign → strategy → briefs, and generates no content.
   *
   * @security JWT; workspace from the verified session. The echoed candidate is
   *   NOT trusted: it is revalidated against the evidence refs actually issued
   *   for THIS product, the supported channels and the opportunity policy, so a
   *   client cannot cite evidence it was never given or smuggle a rejected
   *   candidate back in. Owner text is direction, never evidence.
   */
  server.post('/studio/governed/owner-directed', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = z.object({
      productId: z.string().uuid(),
      mode: z.enum(['interpret', 'apply']),
      request: z.string().min(1).max(1000),
      candidate: z.record(z.unknown()).optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: product } = await supabase.from('products').select('id, name')
        .eq('id', parsed.data.productId).eq('workspace_id', ctxAuth.workspaceId)
        .is('archived_at', null).maybeSingle();
      if (!product) return reply.status(404).send({ error: 'Not found' });

      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { buildProductContentContext } = await import('../services/content/productContentContext');
      const ctx = await buildProductContentContext(await buildContextPackageV2({
        workspaceId: ctxAuth.workspaceId, founderId, productId: parsed.data.productId,
        intent: 'CONTENT_GENERATION', query: parsed.data.request, persist: false,
      }));

      const owner = await import('../services/content/ownerDirectedIntent');

      if (parsed.data.mode === 'interpret') {
        const interp = await owner.interpretOwnerRequest({
          ctx, founderId, ownerRequest: parsed.data.request,
        });
        return reply.status(200).send({ interpretation: interp });
      }

      if (!parsed.data.candidate) return reply.status(400).send({ error: 'Invalid request' });

      // The echoed candidate is revalidated against THIS product's issued refs.
      // Without this, a client could hand back a candidate citing evidence that
      // was never issued to it and the campaign would inherit the citation.
      const { validateOpportunityCandidates } = await import('../services/opportunity/contentOpportunityPolicy');
      const { RECOMMENDABLE_CHANNELS } = await import('../services/opportunity/channelRecommendation');
      const revalidated = validateOpportunityCandidates([parsed.data.candidate], {
        issuedRefs: ctx.evidence.map(h => h.ref),
        allowedChannels: RECOMMENDABLE_CHANNELS,
        intelligenceAvailable: ctx.marketIntelligenceAvailable,
      });
      const candidate = revalidated.accepted[0];
      if (!candidate) {
        return reply.status(422).send({ error: 'I cannot create that as written. Try adjusting the request.' });
      }

      const result = await owner.applyOwnerDirected({ ctx, founderId, candidate });
      return reply.status(201).send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      if (err instanceof Error && err.name === 'OwnerDirectedError') {
        return reply.status(422).send({ error: msg });
      }
      if (/Not found/.test(msg)) return reply.status(404).send({ error: 'Not found' });
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not work that out' });
    }
  });

  /**
   * POST /studio/governed/artifact/:id/visual
   *
   * Renders ONE governed visual for a content artifact — Phase 3.5B6A.
   *
   * Rendering is NOT execution and NOT publishing. A successful render produces
   * a stored image and a render job; it changes no campaign, schedules nothing,
   * spends nothing and writes no Marketing Memory.
   *
   * @security JWT; workspace derived from the verified session and the artifact
   *   resolved inside it. Reference imagery comes only from the authorisation
   *   resolver, so a scraped or competitor image cannot become creative however
   *   the request is shaped. The provider is reached only through the creative
   *   abstraction and never receives authority, approval state or credentials.
   */
  server.post('/studio/governed/artifact/:id/visual', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { id } = request.params as { id: string };

    const parsed = z.object({
      qualityTier: z.enum(['DRAFT', 'PRODUCTION']).optional(),
      conceptLabel: z.string().max(80).optional(),
      refinement: z.string().max(500).optional(),
      /**
       * Deterministic product composition. The owner's screenshot and logo are
       * composited by LaunchMind and never sent to the image provider.
       */
      useProductImages: z.boolean().optional(),
      /**
       * Which composition geometry — §22.
       *
       * A strict enum, not free text. The layout decides where the owner's own
       * screenshot lands, so an unrecognised value must be a 400 rather than a
       * silent fall-through to whatever the default happens to be.
       */
      layout: z.enum(['PROBLEM_FRAME', 'PRODUCT_HERO', 'RELIEF_FRAME']).optional(),
    }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: assetRow } = await supabase.from('content_assets')
        .select('id, product_id, channel, content_campaign_id, content_brief_id, ' +
                'variant_label, text_content, structured_data')
        .eq('id', id).eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
      const art = assetRow as Record<string, unknown> | null;
      if (!art) return reply.status(404).send({ error: 'Not found' });

      const productId = String(art.product_id);

      // Visual history is lineage, not a random seed. Select a different
      // art-directed execution before rendering, while preserving the same
      // marketing concept and current authorised product pixels.
      const { data: recentVisualRows } = await supabase.from('marketing_assets')
        .select('generation_provenance').eq('workspace_id', ctxAuth.workspaceId)
        .eq('content_asset_id', id).eq('source', 'GENERATED')
        .is('archived_at', null).order('created_at', { ascending: false }).limit(8);
      const recentExecutions = ((recentVisualRows ?? []) as Array<{
        generation_provenance?: { creativeCritique?: { outcome?: string };
          manifest?: { overlayLines?: unknown[] };
          visualExecution?: { id?: string; structuralSignature?: string } } | null }>)
        .filter(row => row.generation_provenance?.creativeCritique?.outcome === 'READY_FOR_OWNER_REVIEW'
          && (row.generation_provenance.manifest?.overlayLines?.length ?? 0) > 0)
        .map(row => row.generation_provenance?.visualExecution).filter(Boolean);
      const recentVisualExecutionIds = recentExecutions
        .map(execution => execution?.id)
        .filter((value): value is string => !!value);
      const recentVisualExecutionSignatures = recentExecutions
        .map(execution => execution?.structuralSignature)
        .filter((value): value is string => !!value);


      // Rebuild the governed context. The visual brief is DERIVED, never taken
      // from the client — a caller-supplied brief would bypass brand and asset
      // governance entirely.
      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { buildProductContentContext } = await import('../services/content/productContentContext');
      const ctx = await buildProductContentContext(await buildContextPackageV2({
        workspaceId: ctxAuth.workspaceId, founderId, productId,
        intent: 'CONTENT_GENERATION', query: 'visual creative', persist: false,
      }));

      const { rebuildGovernedLineage } = await import('../services/content/contentArtifactPersistence');
      let lineage = await rebuildGovernedLineage({
        workspaceId: ctxAuth.workspaceId, founderId, productId,
        contentAssetId: id, ctx,
      });
      if (!lineage) {
        return reply.status(422).send({
          error: 'LaunchMind needs the campaign this content belongs to before it can create a visual.' });
      }

      // A message-led visual cannot preserve its concept when governance has
      // withheld the message. Repair system-fixable copy first, re-govern it,
      // persist that server truth, and only then spend a visual provider call.
      // generateChannelContent has an explicit two-rewrite bound; owner-only
      // confirmation states are never rewritten here.
      const supportingWords = (lineage.supporting ?? '').toLowerCase().split(/[.,!\s]+/).filter(Boolean);
      const danglingSupporting = supportingWords.length > 1 && supportingWords.every(word =>
        ['trusted', 'vetted', 'local', 'neighborhood', 'safe', 'convenient'].includes(word));
      if (!lineage.textEligibleForImage || !lineage.cta || danglingSupporting) {
        if (lineage.disposition === 'OWNER_CONFIRMATION_REQUIRED') {
          return reply.status(200).send({ ownerState: 'NEEDS_OWNER_INPUT', message: 'LaunchMind needs one confirmation from you before it can finish this visual.' });
        }
        const { data: campaignForRepair } = await supabase.from('content_campaigns')
          .select('name').eq('id', String(art.content_campaign_id ?? ''))
          .eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
        const gen = await import('../services/content/b3ContentGeneration');
        const { buildScenePlan } = await import('../services/creative/scenePlan');
        const { conceptContractDirective } = await import('../services/content/creativeConceptContract');
        const repairPlan = buildScenePlan({ conceptLabel: (art.variant_label as string | null) ?? null,
          channel: String(art.channel) });
        const repair = await gen.generateChannelContent({
          brief: { ...lineage.brief, channelConstraints: [...lineage.brief.channelConstraints,
            ...(repairPlan ? [conceptContractDirective(repairPlan.conceptRole)] : [])] },
          strategy: lineage.strategy, ctx, founderId,
          variantLabel: (art.variant_label as string | null) ?? null,
          repairNote: lineage.textEligibleForImage
            ? `The current copy is governance-eligible but needs a visual-quality repair: ${danglingSupporting ? "the supporting line is an incomplete list of qualifiers; replace it with a complete supported action and object within 30 characters" : "its visual has no CTA"}. Preserve the recognition concept. Keep already-safe wording, but replace any headline or wording rejected by current governance. Supply a short, governed CTA matching the brief intent; do not invent a feature. Current wording (data): ${JSON.stringify(art.structured_data)}`
            : undefined,
          maxRewrites: 2, requireVisualCopy: true,
        });
        if (repair.disposition !== 'ELIGIBLE') {
          return reply.status(200).send({
            ownerState: repair.disposition === 'OWNER_CONFIRMATION_REQUIRED' ? 'NEEDS_OWNER_INPUT' : 'LAUNCHMIND_CAN_REPAIR',
            copyRepairs: repair.rewriteAttempts,
            message: repair.disposition === 'OWNER_CONFIRMATION_REQUIRED'
              ? 'LaunchMind needs one confirmation from you before it can finish this visual.'
              : 'LaunchMind is still refining the wording. Your current visual is unchanged.',
          });
        }
        const persist = await import('../services/content/contentArtifactPersistence');
        const { artifactProvenance } = await import('../services/content/creativeBriefs');
        await persist.appendGovernedVersion({
          assetId: id, workspaceId: ctxAuth.workspaceId,
          input: {
            identity: {
              workspaceId: ctxAuth.workspaceId, productId,
              campaignId: String(art.content_campaign_id),
              strategyId: String(lineage.strategyId),
              briefId: String(art.content_brief_id),
              channel: String(art.channel), variantGroupId: null,
              variantLabel: (art.variant_label as string | null) ?? null,
            },
            result: repair, brief: lineage.brief, ctx, founderId,
            provenance: artifactProvenance({
              ctx, strategy: lineage.strategy,
              opportunityTitle: String((campaignForRepair as { name?: string } | null)?.name ?? 'Current direction'),
              campaignName: String((campaignForRepair as { name?: string } | null)?.name ?? 'Current campaign'),
            }),
            mode: 'AI_CMO_RECOMMENDED',
          },
          changeType: 'ai_regen',
          changeSummary: `LaunchMind repaired copy before visual creation (${repair.rewriteAttempts} rewrite attempts)`,
        });
        lineage = await rebuildGovernedLineage({
          workspaceId: ctxAuth.workspaceId, founderId, productId,
          contentAssetId: id, ctx,
        });
        if (!lineage?.textEligibleForImage) {
          return reply.status(422).send({
            error: 'LaunchMind is still refining the wording. Your current visual is unchanged.',
          });
        }
      }

      const { renderGovernedVisual, CreativeRenderBlocked } =
        await import('../services/creative/creativeRenderService');
      const result = await renderGovernedVisual({
        workspaceId: ctxAuth.workspaceId, productId, founderId,
        contentAssetId: id, versionNumber: lineage.versionNumber,
        ctx, strategy: lineage.strategy, brief: lineage.brief,
        channel: String(art.channel ?? '').toUpperCase(),
        qualityTier: parsed.data.qualityTier ?? 'DRAFT',
        conceptLabel: parsed.data.conceptLabel ?? (art.variant_label as string | null) ?? null,
        // The generated visual direction was persisted with the artifact but
        // previously stopped here. Carry it into the server-derived scene plan
        // so a render cannot silently collapse to the generic default layout.
        visualBrief: typeof (art.structured_data as Record<string, unknown> | null)?.visualBrief === 'string'
          ? String((art.structured_data as Record<string, unknown>).visualBrief) : null,
        ownerRefinement: parsed.data.refinement ?? null,
        governedHeadline: lineage.headline,
        governedCta: lineage.cta,
        governedSupporting: lineage.supporting,
        governedContentVersion: lineage.versionNumber,
        // A new render resolves CURRENT authorization above. When usable
        // product media exists, product composition is the safe default; an
        // old render's historical asset state never controls this request.
        useProductComposition: parsed.data.useProductImages
          ?? ctx.authorizedAssets.length > 0,
        compositionLayout: parsed.data.layout,
        recentVisualExecutionIds,
        recentVisualExecutionSignatures,
        lineage: {
          campaignId: (art.content_campaign_id as string | null) ?? null,
          strategyId: lineage.strategyId, briefId: (art.content_brief_id as string | null) ?? null,
          variantLabel: (art.variant_label as string | null) ?? null,
        },
      }).catch((e: unknown) => {
        if (e instanceof CreativeRenderBlocked) return e;
        throw e;
      });

      if (result instanceof Error) {
        return reply.status(200).send({ ownerState: 'LAUNCHMIND_CAN_REPAIR', message: result.ownerMessage });
      }
      if (result.status === 'FAILED') {
        // Honest failure. The artifact is unchanged and no image was invented.
        return reply.status(200).send({ ownerState: 'LAUNCHMIND_CAN_REPAIR', message: result.ownerMessage, renderJobId: result.renderJobId });
      }
      return reply.status(201).send({
        ownerState: 'READY_FOR_OWNER_REVIEW',
        renderJobId: result.renderJobId,
        imageUrl: result.publicUrl,
        width: result.widthPx, height: result.heightPx,
        provenance: result.provenance,
        notes: lineage.textEligibleForImage ? result.notes : [
          ...result.notes,
          'This copy still needs work, so LaunchMind left the wording off the image.',
        ],
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not create the visual' });
    }
  });

  /**
   * GET /studio/governed/artifact/:id/visual
   *
   * Every render for one artifact, newest first — Phase 3.5B6A.
   *
   * @security JWT; workspace-scoped. Owner-safe by construction: provider ids,
   *   model refs, prompts, seeds and policy versions are not selected at all.
   */
  server.get('/studio/governed/artifact/:id/visual', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { id } = request.params as { id: string };

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }
      const supabase = getSupabaseAdmin();
      const { data: art } = await supabase.from('content_assets')
        .select('id, product_id, channel').eq('id', id)
        .eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
      if (!art) return reply.status(404).send({ error: 'Not found' });

      const { data: kit } = await supabase.from('brand_kits')
        .select('version').eq('workspace_id', ctxAuth.workspaceId)
        .eq('product_id', String((art as { product_id: string }).product_id)).maybeSingle();

      const { listCreativeRenders } = await import('../services/creative/creativeApprovalService');
      const { creativeCapabilityAvailable } = await import('../services/creative/creativeProviderRegistry');
      const { creativeKindForChannel } = await import('../services/creative/creativeModelRouting');

      const renders = await listCreativeRenders({
        contentAssetId: id, workspaceId: ctxAuth.workspaceId,
        currentBrandKitVersion: (kit as { version?: number } | null)?.version,
      });
      const { data: copy } = await supabase.from('content_versions')
        .select('version_number, disposition').eq('asset_id', id)
        .order('version_number', { ascending: false }).limit(1).maybeSingle();
      const currentCopy = copy as { version_number?: number; disposition?: string } | null;
      const currentRenders = renders.map(r => ({ ...r, isCurrent: r.isCurrent
        && r.contentVersionNumber === currentCopy?.version_number && currentCopy.disposition === 'ELIGIBLE' }));
      const ownerState = currentCopy?.disposition === 'OWNER_CONFIRMATION_REQUIRED' ? 'NEEDS_OWNER_INPUT'
        : currentRenders.some(r => r.isCurrent && r.qualityOutcome === 'READY_FOR_OWNER_REVIEW')
          ? 'READY_FOR_OWNER_REVIEW' : 'LAUNCHMIND_CAN_REPAIR';
      return reply.status(200).send({
        renders: currentRenders, ownerState,
        // Whether the ACTION may be offered. Strategy never consults this.
        canRender: creativeCapabilityAvailable('IMAGE_GENERATION')
          && creativeKindForChannel(String((art as { channel?: string }).channel ?? '').toUpperCase()) !== null,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not load creative' });
    }
  });

  /**
   * POST /studio/governed/visual/:renderJobId/approve
   *
   * Owner approval of ONE rendered image — Phase 3.5B6A §30.
   *
   * @security Approving a visual grants NO publish, launch, schedule, send or
   *   spend. It does not approve the copy, and a later render of the same
   *   artifact does not inherit it.
   */
  server.post('/studio/governed/visual/:renderJobId/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { renderJobId } = request.params as { renderJobId: string };
    const parsed = z.object({ note: z.string().max(500).optional() })
      .strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }
      const { approveCreative } = await import('../services/creative/creativeApprovalService');
      const res = await approveCreative({
        renderJobId, workspaceId: ctxAuth.workspaceId,
        actorId: founderId, note: parsed.data.note,
      });
      return reply.status(201).send({
        approvedRenderJobId: res.renderJobId,
        contentVersionNumber: res.contentVersionNumber,
        // Said explicitly so no caller can read approval as permission.
        grants: 'This approves the visual only. It does not publish, schedule or spend.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      if (/Not found/.test(msg)) return reply.status(404).send({ error: 'Not found' });
      if (err instanceof Error && err.name === 'CreativeApprovalError') {
        return reply.status(422).send({ error: msg });
      }
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not approve this visual' });
    }
  });

  /**
   * GET /studio/governed/presenters
   *
   * Presenters the owner may choose from — Phase 3.5B6B §9.
   *
   * @security JWT. Provider id, display name and preview only. No demographic
   *   field is carried: LaunchMind must never rank or recommend a presenter by
   *   gender, age or ethnicity, and the surest way is not to hold the data.
   *   A presenter is a SYNTHETIC_PRESENTER and never has a role.
   */
  server.get('/studio/governed/presenters', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const { HeyGenCreativeAdapter } = await import('../services/creative/heygenCreativeAdapter');
      const adapter = new HeyGenCreativeAdapter();
      if (!adapter.isConfigured()) {
        return reply.status(200).send({ presenters: [], available: false,
          note: 'Presenter videos are not available yet.' });
      }
      const presenters = await adapter.listAvatars(60);
      const { PRESENTER_DISCLOSURE } = await import('../services/creative/videoModePolicy');
      return reply.status(200).send({
        presenters, available: true, disclosure: PRESENTER_DISCLOSURE,
      });
    } catch (err) {
      const msg = err instanceof Error && 'ownerMessage' in err
        ? String((err as { ownerMessage: string }).ownerMessage)
        : 'LaunchMind could not load the list of presenters.';
      return reply.status(200).send({ presenters: [], available: false, note: msg });
    }
  });

  /**
   * GET /studio/governed/voices
   *
   * Stock voices the owner may choose from — Phase 3.5B6B §11.
   *
   * @security Provider stock categories only. A cloned voice on the account is
   *   EXCLUDED, not offered: LaunchMind holds no record of whose voice it is or
   *   whether they agreed, and possession is not permission.
   */
  server.get('/studio/governed/voices', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    try {
      const { ElevenLabsCreativeAdapter } = await import('../services/creative/elevenLabsCreativeAdapter');
      const adapter = new ElevenLabsCreativeAdapter();
      if (!adapter.isConfigured()) {
        return reply.status(200).send({ voices: [], available: false,
          note: 'Voice is not available yet.' });
      }
      const voices = await adapter.listVoices();
      return reply.status(200).send({ voices, available: voices.length > 0 });
    } catch (err) {
      const msg = err instanceof Error && 'ownerMessage' in err
        ? String((err as { ownerMessage: string }).ownerMessage)
        : 'LaunchMind could not load the list of voices.';
      return reply.status(200).send({ voices: [], available: false, note: msg });
    }
  });

  /**
   * POST /studio/governed/artifact/:id/video
   *
   * Renders ONE governed short-form video — Phase 3.5B6B.
   *
   * @security JWT; workspace derived from the verified session. The presenter
   *   and voice are the OWNER's explicit choices, echoed here and revalidated:
   *   a role attached to a presenter is refused, and a non-stock voice is
   *   refused. A synthetic presenter may not speak lines that claim they are a
   *   customer, employee or founder. Rendering publishes nothing.
   */
  server.post('/studio/governed/artifact/:id/video', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { id } = request.params as { id: string };

    const parsed = z.object({
      mode: z.enum(['PRODUCT_MOTION', 'AVATAR_SPOKESPERSON', 'VOICEOVER_CREATIVE']),
      avatar: z.object({
        providerAvatarId: z.string().min(1).max(120),
        displayName: z.string().min(1).max(120),
        previewUrl: z.string().url().nullish(),
      }).strict().optional(),
      voice: z.object({
        providerVoiceId: z.string().min(1).max(120),
        displayName: z.string().min(1).max(120),
        language: z.string().max(40).nullish(),
      }).strict().optional(),
    }).strict().safeParse(request.body ?? {});
    // `.strict()` rejects a client-supplied `role`, `kind` or `presenterKind`:
    // those are decided here, never accepted from a browser.
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: assetRow } = await supabase.from('content_assets')
        .select('id, product_id, channel, content_campaign_id, content_brief_id, ' +
                'variant_label, structured_data')
        .eq('id', id).eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
      const art = assetRow as Record<string, unknown> | null;
      if (!art) return reply.status(404).send({ error: 'Not found' });
      if (String(art.channel ?? '').toUpperCase() !== 'SHORT_FORM_VIDEO_SCRIPT') {
        return reply.status(422).send({
          error: 'LaunchMind only creates video for a short video script.' });
      }
      const productId = String(art.product_id);

      const { buildContextPackageV2 } = await import('../lib/context/contextPackageV2');
      const { buildProductContentContext } = await import('../services/content/productContentContext');
      const ctx = await buildProductContentContext(await buildContextPackageV2({
        workspaceId: ctxAuth.workspaceId, founderId, productId,
        intent: 'CONTENT_GENERATION', query: 'short video creative', persist: false,
      }));

      const { rebuildGovernedLineage } = await import('../services/content/contentArtifactPersistence');
      const lineage = await rebuildGovernedLineage({
        workspaceId: ctxAuth.workspaceId, founderId, productId, contentAssetId: id, ctx });
      if (!lineage) {
        return reply.status(422).send({
          error: 'LaunchMind needs the campaign this script belongs to before it can create a video.' });
      }

      const { renderGovernedVideo } = await import('../services/creative/videoRenderService');
      const { CreativeRenderBlocked } = await import('../services/creative/creativeRenderService');
      const { PRESENTER_KIND } = await import('../services/creative/videoModePolicy');

      const result = await renderGovernedVideo({
        workspaceId: ctxAuth.workspaceId, productId, founderId,
        contentAssetId: id, versionNumber: lineage.versionNumber,
        ctx, brief: lineage.brief,
        scriptPayload: (art.structured_data ?? {}) as Record<string, unknown>,
        mode: parsed.data.mode,
        // presenterKind is SET here, never accepted from the client.
        avatar: parsed.data.avatar
          ? { ...parsed.data.avatar, presenterKind: PRESENTER_KIND,
              previewUrl: parsed.data.avatar.previewUrl ?? null }
          : null,
        // kind is SET here. A browser cannot declare a voice authorised.
        voice: parsed.data.voice
          ? { ...parsed.data.voice, kind: 'PROVIDER_STOCK' as const,
              language: parsed.data.voice.language ?? null }
          : null,
        textEligible: lineage.textEligibleForImage,
        lineage: {
          campaignId: (art.content_campaign_id as string | null) ?? null,
          strategyId: lineage.strategyId,
          briefId: (art.content_brief_id as string | null) ?? null,
          variantLabel: (art.variant_label as string | null) ?? null,
        },
      }).catch((e: unknown) => {
        if (e instanceof CreativeRenderBlocked) return e;
        throw e;
      });

      if (result instanceof Error) {
        return reply.status(422).send({ error: result.ownerMessage });
      }
      if (result.status === 'FAILED') {
        return reply.status(502).send({ error: result.ownerMessage, renderJobId: result.renderJobId });
      }
      return reply.status(201).send({
        renderJobId: result.renderJobId,
        videoUrl: result.publicUrl,
        durationMs: result.durationMs,
        provenance: result.provenance,
        notes: result.notes,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not create the video' });
    }
  });

  /**
   * GET /studio/governed/studio
   *
   * The Content Studio HOME read model — everything LaunchMind has created for
   * one application, without the owner knowing a campaign id.
   *
   * This exists because the journey was backwards: governed content was
   * reachable only at /dashboard/content?campaign=<uuid>, so an owner clicking
   * "Content Studio" in the sidebar landed on the legacy 31-type surface and saw
   * none of their own work. A query parameter the owner cannot guess is not a
   * navigation path.
   *
   * @security JWT; workspace derived from the verified session and the product
   *   resolved inside it. Owner-safe by construction — no evidence handle,
   *   authority tier, policy version, prompt or provider reference is selected.
   */
  server.get('/studio/governed/studio', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const q = (request.query ?? {}) as { productId?: string };

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      let productQuery = supabase.from('products').select('id, name')
        .eq('workspace_id', ctxAuth.workspaceId).is('archived_at', null);
      if (q.productId) productQuery = productQuery.eq('id', q.productId);
      const { data: product } = await productQuery
        .order('created_at', { ascending: true }).limit(1).maybeSingle();

      if (!product) {
        return reply.status(200).send({
          product: null, campaigns: [], needsAttention: [], launchMindCanRepair: [],
          readyForReview: [], inProgress: [], approved: [], earlierArtifacts: [],
          recentCreative: [], counts: { campaigns: 0, artifacts: 0,
            currentArtifacts: 0, earlierArtifacts: 0, creative: 0 },
        });
      }
      const p = product as { id: string; name: string };

      const { data: campRows } = await supabase.from('content_campaigns')
        .select('id, name, thesis, audience, recommended_channels, created_at')
        .eq('workspace_id', ctxAuth.workspaceId).eq('product_id', p.id)
        .order('created_at', { ascending: false });
      const campaigns = (campRows ?? []) as Array<{
        id: string; name: string; thesis: string | null; audience: string | null;
        recommended_channels: string[] | null; created_at: string }>;

      const { data: artRows } = await supabase.from('content_assets')
        .select('id, channel, content_status, variant_label, content_campaign_id, ' +
                'approved_at, brand_kit_version, updated_at, structured_data')
        .eq('workspace_id', ctxAuth.workspaceId).eq('product_id', p.id)
        .eq('governance', 'GOVERNED_CONTENT_INTELLIGENCE')
        .is('archived_at', null)
        .order('updated_at', { ascending: false });
      const planningWork = (artRows ?? []).filter((r:any)=>r.structured_data?.kind==='GROUNDED_PLANNING_WORK').map((r:any)=>({
        id:r.id,service:r.structured_data.handoff.service.name,
        concept:r.structured_data.handoff.groundedBrief.concepts.find((c:any)=>c.key===r.structured_data.handoff.concept.key)?.name??'Selected approach',
        recommended:!r.structured_data.decision.overridden,
        state:'Brief prepared',
      }));
      const {planningProductionStatus,loadPlanningProduction}=await import('../services/content/planningProductionContract');
      const validPlans=[];
      for(const w of planningWork){try{const loaded=await loadPlanningProduction(w.id,ctxAuth.workspaceId,founderId);const status=await planningProductionStatus(w.id,ctxAuth.workspaceId,founderId);validPlans.push({...w,state:({CREATING:'Creating',NEEDS_ATTENTION:'Needs attention',READY_FOR_REVIEW:'Ready for review'} as Record<string,string>)[loaded.row.structured_data.generation?.status]??(status.canGenerate?'Ready to create':'Brief prepared'),campaignId:loaded.row.structured_data.production?.ids?.campaignId,selectedAt:loaded.contract.decision.selectedAt});}catch{/* stale plans are not current */}}
      validPlans.sort((a,b)=>b.selectedAt.localeCompare(a.selectedAt));
      const artifacts = (artRows ?? []).filter((r:any)=>r.structured_data?.kind!=='GROUNDED_PLANNING_WORK') as unknown as Array<{
        id: string; channel: string; content_status: string; variant_label: string | null;
        content_campaign_id: string | null; approved_at: string | null;
        brand_kit_version: number | null; updated_at: string }>;

      // Recent creative, read through the same rows the workbench uses so the
      // two surfaces cannot disagree about what exists.
      const { data: creativeRows } = await supabase.from('marketing_assets')
        .select('id, asset_type, storage_path, content_asset_id, content_version_number, ' +
                'brand_kit_version, created_at, generation_provenance')
        .eq('workspace_id', ctxAuth.workspaceId).eq('product_id', p.id)
        .eq('source', 'GENERATED').is('archived_at', null)
        .order('created_at', { ascending: false }).limit(12);

      const campaignName = new Map(campaigns.map(c => [c.id, c.name]));
      const CHANNEL_LABEL: Record<string, string> = {
        meta_ad: 'Meta ad', google_rsa: 'Google search ad', landing_page: 'Landing page',
        linkedin_post: 'LinkedIn post', short_form_video_script: 'Short video',
      };
      const label = (ch: string) => CHANNEL_LABEL[ch] ?? ch.replace(/_/g, ' ');

      // Owner language for each governance state, and what it asks of them.
      const OWNER_INPUT: Record<string, string> = {
        NEEDS_OWNER_CONFIRMATION: 'Needs something confirmed before it can be used',
        OWNER_CONFIRMATION_REQUIRED: 'Needs something confirmed before it can be used',
      };
      const REPAIRABLE: Record<string, string> = {
        REWRITE_REQUIRED: 'LaunchMind is holding wording that needs a safer rewrite',
        BLOCKED: 'LaunchMind could not finish this safely',
      };

      const toItem = (a: typeof artifacts[number]) => ({
        artifactId: a.id,
        campaignId: a.content_campaign_id,
        campaignName: a.content_campaign_id ? (campaignName.get(a.content_campaign_id) ?? null) : null,
        channel: label(a.channel),
        variantLabel: a.variant_label,
        approved: !!a.approved_at,
        brandVersion: a.brand_kit_version,
        reason: OWNER_INPUT[a.content_status] ?? REPAIRABLE[a.content_status] ?? null,
        updatedAt: a.updated_at,
      });

      // In-flight renders. QUEUED/RUNNING only — a FAILED job is not progress
      // and a SUCCEEDED one is output, and both have their own homes.
      const { data: inFlight } = await supabase.from('creative_render_jobs')
        .select('id, creative_kind, concept_label, content_asset_id, started_at, created_at')
        .eq('workspace_id', ctxAuth.workspaceId)
        .in('status', ['QUEUED', 'RUNNING', 'RENDERING'])
        .order('created_at', { ascending: false }).limit(20);

      const currentByRole = new Map<string, typeof artifacts[number]>();
      const earlierArtifacts: typeof artifacts = [];
      for (const artifact of artifacts) {
        const role = [artifact.content_campaign_id ?? 'none', artifact.channel,
          artifact.variant_label ?? 'default'].join(':');
        if (!currentByRole.has(role)) currentByRole.set(role, artifact);
        else earlierArtifacts.push(artifact);
      }
      const currentArtifacts = [...currentByRole.values()];
      // Copy eligibility alone is not a completed Meta creative. Resolve the
      // latest copy version and its actual final-image critique before routing
      // the owner into review; a historical passing visual cannot qualify new copy.
      const metaArtifacts = currentArtifacts.filter(a => a.channel.toLowerCase() === 'meta_ad');
      const { listCreativeRenders } = await import('../services/creative/creativeApprovalService');
      const visualReady = new Set<string>();
      await Promise.all(metaArtifacts.map(async a => {
        const { data: latest } = await supabase.from('content_versions')
          .select('version_number').eq('asset_id', a.id)
          .order('version_number', { ascending: false }).limit(1).maybeSingle();
        const renders = await listCreativeRenders({ contentAssetId: a.id,
          workspaceId: ctxAuth.workspaceId });
        if (renders.some(r => r.isCurrent && r.status === 'SUCCEEDED'
          && r.contentVersionNumber === (latest as { version_number?: number } | null)?.version_number
          && r.qualityOutcome === 'READY_FOR_OWNER_REVIEW')) visualReady.add(a.id);
      }));
      const visualPending = (a: typeof artifacts[number]) =>
        a.channel.toLowerCase() === 'meta_ad' && !visualReady.has(a.id);
      const needsAttention = currentArtifacts
        .filter(a => a.content_status in OWNER_INPUT).map(toItem);
      const launchMindCanRepair = currentArtifacts
        .filter(a => !(a.content_status in OWNER_INPUT)
          && (a.content_status in REPAIRABLE || visualPending(a))).map(a => ({
          ...toItem(a), reason: REPAIRABLE[a.content_status]
            ?? 'LaunchMind has not completed a visual that passes creative review',
        }));
      const approved = currentArtifacts.filter(a => a.approved_at).map(toItem);
      const readyForReview = currentArtifacts
        .filter(a => !a.approved_at && !(a.content_status in OWNER_INPUT)
          && !(a.content_status in REPAIRABLE) && !visualPending(a)).map(toItem);

      const byCampaign = new Map<string, typeof artifacts>();
      for (const a of artifacts) {
        if (!a.content_campaign_id) continue;
        const list = byCampaign.get(a.content_campaign_id) ?? [];
        list.push(a);
        byCampaign.set(a.content_campaign_id, list);
      }

      return reply.status(200).send({
        product: { id: p.id, name: p.name },
        planningWork:validPlans,
        campaigns: campaigns.map(c => {
          const arts = (byCampaign.get(c.id) ?? []).filter(a => currentArtifacts.includes(a));
          return {
            id: c.id, name: c.name,
            why: c.thesis ?? '', audience: c.audience ?? '',
            channels: (c.recommended_channels ?? []).map(label),
            artifactCount: arts.length,
            needsAttentionCount: arts.filter(a => a.content_status in OWNER_INPUT).length,
            approvedCount: arts.filter(a => a.approved_at).length,
            // Honest: a campaign LaunchMind planned but has not written yet.
            readiness: arts.length === 0 ? 'Nothing created yet'
              : arts.some(a => a.content_status in OWNER_INPUT) ? 'Needs your decision'
              : arts.some(a => a.content_status in REPAIRABLE || visualPending(a)) ? 'Creative review is not complete'
              : arts.every(a => a.approved_at) ? 'Approved' : 'Ready for your review',
            createdAt: c.created_at,
          };
        }),
        needsAttention, launchMindCanRepair, readyForReview, approved,
        earlierArtifacts: earlierArtifacts.map(toItem),
        // §16 — GENUINELY in flight, read from the render-job table rather than
        // inferred. A section that shows "in progress" for anything not
        // actually running teaches the owner to ignore it; an empty one is the
        // honest answer most of the time and costs nothing.
        inProgress: ((inFlight ?? []) as unknown as Array<{
          id: string; creative_kind: string | null; concept_label: string | null;
          content_asset_id: string | null; started_at: string | null; created_at: string;
        }>).map(j => ({
          renderJobId: j.id,
          what: j.creative_kind === 'META_AD_VISUAL' ? 'Meta visual' : 'Creative',
          concept: j.concept_label,
          artifactId: j.content_asset_id,
          startedAt: j.started_at ?? j.created_at,
        })),
        recentCreative: ((creativeRows ?? []) as unknown as Array<{
          id: string; asset_type: string; storage_path: string | null;
          content_asset_id: string | null; content_version_number: number | null;
          brand_kit_version: number | null; created_at: string;
          generation_provenance: { lines?: string[] } | null }>).map(m => ({
            kind: m.asset_type === 'VIDEO' ? 'Video' : m.asset_type === 'AUDIO' ? 'Voice' : 'Image',
            // Read from the provenance the render itself wrote, so the label
            // cannot drift from what actually happened.
            usedProductImagery: (m.generation_provenance?.lines ?? [])
              .some(l => /^Product imagery: uses/i.test(l)),
            imageUrl: m.storage_path
              ? supabase.storage.from('content-assets').getPublicUrl(m.storage_path).data.publicUrl
              : null,
            artifactId: m.content_asset_id,
            contentVersion: m.content_version_number,
            brandVersion: m.brand_kit_version,
            createdAt: m.created_at,
          })),
        counts: {
          campaigns: campaigns.length,
          artifacts: artifacts.length,
          currentArtifacts: currentArtifacts.length,
          earlierArtifacts: earlierArtifacts.length,
          creative: (creativeRows ?? []).length,
        },
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not load your content' });
    }
  });

  /**
   * GET /studio/governed/product-assets
   *
   * Product imagery LaunchMind has observed, and what the owner may do with it.
   *
   * Registers anything already visible in the product's own store listing and
   * website on first read — that intake step existed but was never called, so an
   * owner could be told "no authorised imagery" while ten of their own
   * screenshots sat unregistered.
   *
   * @security Registration writes OBSERVED_EXTERNAL only and can never
   *   authorize. Web-search imagery is not produced as a candidate at all.
   */
  server.get('/studio/governed/product-assets', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const q = (request.query ?? {}) as { productId?: string };

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }
      const supabase = getSupabaseAdmin();
      let pq = supabase.from('products').select('id, name')
        .eq('workspace_id', ctxAuth.workspaceId).is('archived_at', null);
      if (q.productId) pq = pq.eq('id', q.productId);
      const { data: product } = await pq.order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!product) return reply.status(200).send({ product: null, assets: [] });
      const p = product as { id: string; name: string };

      const { registerObservedProductAssets } = await import('../services/brand/productAssetIntake');
      const intake = await registerObservedProductAssets({
        workspaceId: ctxAuth.workspaceId, productId: p.id, founderId });

      const { data: rows } = await supabase.from('marketing_assets')
        .select('id, asset_type, source, subject_relation, authorization_state, ' +
                'external_url, storage_path, may_contain_pii, rights_basis, created_at, ' +
                'width_px, height_px, byte_size')
        .eq('workspace_id', ctxAuth.workspaceId).eq('product_id', p.id)
        .is('archived_at', null)
        .neq('source', 'GENERATED')
        .order('created_at', { ascending: true });

      const LABEL: Record<string, string> = {
        APP_STORE: 'App Store listing', PLAY_STORE: 'Play Store listing',
        WEBSITE: 'Your website', OWNER_UPLOAD: 'You uploaded this',
        OWNER_URL: 'You provided this link', WEB_SEARCH: 'Found by web search',
      };
      const KIND: Record<string, string> = {
        SCREENSHOT: 'Product screenshot', APP_ICON: 'App icon', LOGO: 'Logo',
        HERO_IMAGE: 'Website image', PRODUCT_IMAGE: 'Product image',
      };

      const rawRows = (rows ?? []) as unknown as Array<{
        id: string; asset_type: string; source: string; subject_relation: string;
        authorization_state: string; external_url: string | null; storage_path: string | null;
        may_contain_pii: boolean; rights_basis: string | null; width_px: number | null;
        height_px: number | null; byte_size: number | null;
      }>;

      // ONE REVIEW PER UNIQUE PICTURE. Apple serves each screenshot as both
      // `/300x650bb.webp` and `/300x650bb-60.jpg`; intake stored both, so the
      // owner was asked the same rights question twice about the same image.
      // Every source row is preserved — only the review list is collapsed.
      const { canonicalizeAssets } = await import('../services/brand/assetCanonicalization');
      const groups = canonicalizeAssets(rawRows.map(r => ({
        id: r.id, workspaceId: ctxAuth.workspaceId, productId: p.id,
        assetType: r.asset_type, source: r.source as never,
        subjectRelation: r.subject_relation as never,
        authorizationState: r.authorization_state as never,
        storagePath: r.storage_path, externalUrl: r.external_url,
        mayContainPii: r.may_contain_pii,
        widthPx: r.width_px, heightPx: r.height_px, byteSize: r.byte_size,
        raw: r,
      })));

      const assets = groups.map(g => {
        const a = (g.canonical as unknown as { raw: typeof rawRows[number] }).raw;
        const duplicateCount = g.members.length - 1;
        void duplicateCount;
        // WHY an asset cannot be allowed, in owner language. Stated up front so
        // a disabled control is never unexplained.
        const blocked = a.source === 'WEB_SEARCH'
          ? 'Found by a web search, so LaunchMind can never use it in your marketing.'
          : a.subject_relation !== 'OWN_PRODUCT'
            ? 'This is not an image of your product.'
            : null;
        return {
          assetId: a.id,
          kind: KIND[a.asset_type] ?? 'Image',
          sourceLabel: LABEL[a.source] ?? 'Observed',
          previewUrl: a.external_url
            ?? (a.storage_path
              ? supabase.storage.from('content-assets').getPublicUrl(a.storage_path).data.publicUrl
              : null),
          // UNIONED across the group: allowing one rendition allowed the picture.
          allowed: g.anyAuthorized,
          canAllow: blocked === null,
          blockedReason: blocked,
          // B1 default is TRUE for anything nobody has examined. Surfaced, not hidden.
          needsSafetyConfirmation: a.may_contain_pii !== false,
        };
      });

      // §9 — the exact contradiction: "4 of 11 images allowed" beside "no
      // authorised product imagery". Both were true and neither explained the
      // other. VISUAL_RENDERING additionally requires may_contain_pii === false,
      // so an allowed-but-unexamined image is authorised and still unrenderable.
      const { resolveMarketingAssets } = await import('../services/brand/marketingAssetService');
      const renderable = await resolveMarketingAssets(ctxAuth.workspaceId, p.id, 'VISUAL_RENDERING');
      const allowedCount = assets.filter(a => a.allowed).length;
      const readinessNote = allowedCount === 0
        ? null
        : renderable.length === 0
          ? `${allowedCount} image${allowedCount === 1 ? '' : 's'} allowed, but none are cleared for use in creative yet.`
          : null;

      return reply.status(200).send({
        product: { id: p.id, name: p.name },
        assets,
        newlyFound: intake.registered,
        renderableCount: renderable.length,
        readinessNote,
        // How many source rows were collapsed, so the count is explicable.
        sourceRowCount: rawRows.length,
        note: assets.length === 0
          ? 'LaunchMind has not observed any imagery of your product yet.' : null,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not load your product images' });
    }
  });

  /**
   * POST /studio/governed/product-assets/:id/allow
   *
   * The owner allows ONE observed asset to be used in marketing — §6.
   *
   * @security The client sends an asset id and nothing else. Workspace, product,
   *   subject relation, source and rights basis are all derived or asserted
   *   server-side; a browser cannot declare an asset own-product, cannot supply
   *   an authorization state, and cannot authorize web-search imagery — the
   *   service and a database CHECK refuse it independently.
   */
  server.post('/studio/governed/product-assets/:id/allow', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({
      /** The owner's confirmation that the image shows no customer data. */
      confirmedNoPersonalData: z.boolean().optional(),
    }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }

      const supabase = getSupabaseAdmin();
      const { data: asset } = await supabase.from('marketing_assets')
        .select('id, source, subject_relation, product_id, external_url')
        .eq('id', id).eq('workspace_id', ctxAuth.workspaceId).maybeSingle();
      const a = asset as { source: string; subject_relation: string;
        product_id: string; external_url: string | null } | null;
      if (!a) return reply.status(404).send({ error: 'Not found' });

      // The rights basis is COMPOSED from the observed source, not typed by the
      // owner. Asking a founder to write a legal sentence produces either an
      // empty box or a guess; the source is the honest basis and we know it.
      const BASIS: Record<string, string> = {
        APP_STORE: 'Our own App Store listing',
        PLAY_STORE: 'Our own Play Store listing',
        WEBSITE: 'Our own website',
        OWNER_UPLOAD: 'Supplied by the owner',
        OWNER_URL: 'Supplied by the owner',
      };
      const basis = BASIS[a.source];
      if (!basis) {
        return reply.status(422).send({
          error: 'LaunchMind cannot use an image from this source in your marketing.' });
      }

      const { authorizeAsset, AssetAuthorizationError } =
        await import('../services/brand/marketingAssetService');

      // The owner allowed a PICTURE, not a file encoding. Apple serves each
      // screenshot as two renditions; authorising only the row that happened to
      // be shown leaves its twin sitting in the list as an unmade decision, and
      // the resolver would still refuse it. Siblings are found by PROVEN
      // identity — same source image — never by resemblance.
      const { sourceIdentity } = await import('../services/brand/assetCanonicalization');
      const identity = sourceIdentity(a.external_url);
      const siblingIds: string[] = [id];
      if (identity) {
        const { data: family } = await supabase.from('marketing_assets')
          .select('id, external_url')
          .eq('workspace_id', ctxAuth.workspaceId).eq('product_id', a.product_id)
          .neq('source', 'GENERATED').is('archived_at', null);
        for (const f of (family ?? []) as Array<{ id: string; external_url: string | null }>) {
          if (f.id !== id && sourceIdentity(f.external_url) === identity) siblingIds.push(f.id);
        }
      }

      try {
        for (const assetId of siblingIds) {
          await authorizeAsset({
            assetId, workspaceId: ctxAuth.workspaceId, actorId: founderId,
            rightsBasis: basis,
            // NOT client-supplied. The stored subject relation decides.
            subjectRelation: a.subject_relation as never,
            // Only the owner can clear the conservative PII default, and only by
            // saying so explicitly. Absent means it stays blocked for rendering.
            piiChecked: parsed.data.confirmedNoPersonalData === true,
          });
        }
      } catch (e) {
        if (e instanceof AssetAuthorizationError) {
          return reply.status(422).send({ error: e.message });
        }
        throw e;
      }
      return reply.status(200).send({
        allowed: true,
        // Reported so the count the owner sees is explicable.
        renditionsAllowed: siblingIds.length,
        grants: 'LaunchMind may now use this image in content it creates for you. It does not publish anything.',
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not update this image' });
    }
  });

  /**
   * GET /studio/governed/destination
   *
   * Where content should send people — §5, §6, §7.
   *
   * NO NEW COLUMN. Destination already has a governed home: it is the
   * `cta_destination` brand field, read everywhere as
   * `ctx.brand.fields.cta_destination?.ownerConfirmed`, and snapshotted per brief
   * as `content_briefs.cta_destination`. Adding a second destination field would
   * create two answers to one question.
   *
   * @security Options are derived from OWN-PRODUCT context only — the site
   *   observed at intake and the owner's own store listing. Nothing is
   *   pre-confirmed; LaunchMind may mark one recommended, the owner chooses.
   */
  server.get('/studio/governed/destination', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const q = (request.query ?? {}) as { productId?: string };

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }
      const supabase = getSupabaseAdmin();
      let pq = supabase.from('products').select('id, name, scraped_meta, website_meta')
        .eq('workspace_id', ctxAuth.workspaceId).is('archived_at', null);
      if (q.productId) pq = pq.eq('id', q.productId);
      const { data: product } = await pq.order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!product) return reply.status(200).send({ product: null, options: [], confirmed: null });
      const p = product as Record<string, unknown>;

      const sm = (p.scraped_meta ?? {}) as Record<string, unknown>;
      const wm = { ...((p.website_meta ?? {}) as object),
                   ...((sm.websiteMeta ?? {}) as object) } as Record<string, unknown>;

      const options: Array<{ id: string; label: string; url: string | null;
        detail: string; recommended: boolean }> = [];

      // The owner's own site, derived from the logo/og host observed at intake.
      const siteHost = (() => {
        for (const v of [wm.logoUrl, wm.ogImage, wm.url, sm.storeUrl]) {
          if (typeof v !== 'string') continue;
          try {
            const h = new URL(v).host;
            if (!/mzstatic|apple\.com|play\.google|googleusercontent/i.test(h)) return h;
          } catch { /* not a url */ }
        }
        return null;
      })();
      if (siteHost) {
        options.push({ id: 'website', label: 'Your website', url: `https://${siteHost}`,
          detail: 'Observed from your own site', recommended: true });
      }
      if (typeof sm.storeUrl === 'string' && sm.storeUrl) {
        options.push({ id: 'store', label: 'Your app store listing', url: sm.storeUrl,
          detail: 'Observed from your listing', recommended: !siteHost });
      }
      options.push({ id: 'custom', label: 'Somewhere else', url: null,
        detail: 'Give LaunchMind a link', recommended: false });
      options.push({ id: 'none', label: 'No link — awareness only', url: null,
        detail: 'Content will not ask people to go anywhere', recommended: false });

      const { resolveBrandKit } = await import('../services/brand/brandKitService');
      const kit = await resolveBrandKit(ctxAuth.workspaceId, String(p.id));
      const confirmedField = kit.fields.cta_destination;

      return reply.status(200).send({
        product: { id: String(p.id), name: String(p.name ?? '') },
        options,
        confirmed: confirmedField?.ownerConfirmed
          ? String(confirmedField.value ?? '') : null,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not load destinations' });
    }
  });

  /**
   * GET /studio/governed/brand
   *
   * What LaunchMind currently believes about the brand, and where each belief
   * came from — §9. Observed values are shown as observed; nothing here is
   * confirmed by being displayed.
   */
  server.get('/studio/governed/brand', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const q = (request.query ?? {}) as { productId?: string };

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }
      const supabase = getSupabaseAdmin();
      let pq = supabase.from('products')
        .select('id, name, category, scraped_meta, website_meta, content_preferences, brand_voice_profile')
        .eq('workspace_id', ctxAuth.workspaceId).is('archived_at', null);
      if (q.productId) pq = pq.eq('id', q.productId);
      const { data: product } = await pq.order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!product) return reply.status(200).send({ product: null, fields: [] });
      const p = product as Record<string, unknown>;

      const { resolveBrandKit, deriveBrandCandidates } =
        await import('../services/brand/brandKitService');
      const kit = await resolveBrandKit(ctxAuth.workspaceId, String(p.id));

      // The site's own metadata lives nested under scraped_meta at intake; the
      // top-level column is usually empty. Merged so candidates actually appear.
      const sm = (p.scraped_meta ?? {}) as Record<string, unknown>;
      const candidates = deriveBrandCandidates({
        brand_voice_profile: p.brand_voice_profile,
        website_meta: { ...((p.website_meta ?? {}) as object),
                        ...((sm.websiteMeta ?? {}) as object) },
        scraped_meta: sm,
        content_preferences: p.content_preferences,
      });

      const PROVENANCE: Record<string, string> = {
        OWNER_CONFIRMED: 'You confirmed this',
        SCRAPED: 'Observed from your own materials',
        INFERRED: 'Inferred from your current materials',
      };
      const NAME: Record<string, string> = {
        logo: 'Logo', app_icon: 'App icon', primary_color: 'Primary colour',
        secondary_color: 'Secondary colour', tone: 'Tone', visual_style: 'Visual style',
        tagline: 'Tagline', brand_voice: 'Brand voice', font_family: 'Font',
      };

      const byKey = new Map<string, { value: unknown; provenance: string;
        sourceLabel: string | null }>();
      for (const c of candidates) {
        // First candidate wins: deriveBrandCandidates emits in precedence order.
        if (!byKey.has(c.fieldKey)) {
          byKey.set(c.fieldKey, { value: c.value, provenance: c.provenance,
            sourceLabel: c.sourceLabel ?? null });
        }
      }

      const keys = ['logo', 'app_icon', 'primary_color', 'secondary_color',
                    'tone', 'visual_style', 'tagline'];
      const fields = keys.map(k => {
        const confirmed = kit.fields[k];
        const cand = byKey.get(k);
        const value = confirmed?.value ?? cand?.value ?? null;
        const provenance: string | null = confirmed?.ownerConfirmed
          ? 'OWNER_CONFIRMED' : (cand?.provenance ?? null);
        return {
          fieldKey: k,
          label: NAME[k] ?? k.replace(/_/g, ' '),
          value: typeof value === 'string' ? value : (value == null ? null : String(value)),
          confirmed: confirmed?.ownerConfirmed === true,
          // Displaying an observed value never makes it confirmed.
          provenanceLabel: provenance ? (PROVENANCE[provenance] ?? provenance) : null,
          sourceLabel: cand?.sourceLabel ?? null,
          observed: value != null,
        };
      });

      return reply.status(200).send({
        product: { id: String(p.id), name: String(p.name ?? ''), category: (p.category as string | null) ?? null },
        brandVersion: kit.version,
        fields,
        confirmedCount: fields.filter(f => f.confirmed).length,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not load your brand' });
    }
  });

  /**
   * POST /studio/governed/brand/confirm
   *
   * Confirms ONE brand field — §10.
   *
   * @security One field per call, by design. A single "confirm my brand" button
   *   would turn every scraped guess into owner-asserted truth at once, which is
   *   the failure this shape prevents. Brand is representation, never evidence:
   *   confirming a tagline does not make any claim provable.
   */
  server.post('/studio/governed/brand/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const parsed = z.object({
      productId: z.string().uuid(),
      // cta_destination is confirmed through this SAME path. It is owner
      // configuration, not evidence: confirming where people go makes no claim
      // provable and authorises no publishing.
      fieldKey: z.enum(['logo', 'app_icon', 'primary_color', 'secondary_color',
                        'tone', 'visual_style', 'tagline', 'cta_destination']),
      value: z.string().min(1).max(400),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    // §6 — a destination is a URL a real customer will be sent to, so it is
    // validated server-side. The browser cannot be the gate on where traffic goes.
    if (parsed.data.fieldKey === 'cta_destination' && parsed.data.value !== 'NONE') {
      const bad = destinationRejectionReason(parsed.data.value);
      if (bad) return reply.status(422).send({ error: bad });
    }

    try {
      const { resolveWorkspaceContext, WorkspaceAccessError } =
        await import('../services/workspaceAuthService');
      let ctxAuth;
      try { ctxAuth = await resolveWorkspaceContext(founderId, null); }
      catch (e) {
        if (e instanceof WorkspaceAccessError) return reply.status(404).send({ error: 'Not found' });
        throw e;
      }
      const supabase = getSupabaseAdmin();
      const { data: product } = await supabase.from('products').select('id')
        .eq('id', parsed.data.productId).eq('workspace_id', ctxAuth.workspaceId)
        .is('archived_at', null).maybeSingle();
      if (!product) return reply.status(404).send({ error: 'Not found' });

      const { confirmBrandField, BrandConfirmationError } =
        await import('../services/brand/brandKitService');
      try {
        await confirmBrandField({
          workspaceId: ctxAuth.workspaceId, productId: parsed.data.productId,
          founderId, actorId: founderId,
          fieldKey: parsed.data.fieldKey, value: parsed.data.value,
        });
      } catch (e) {
        if (e instanceof BrandConfirmationError) {
          return reply.status(422).send({ error: e.message });
        }
        throw e;
      }
      return reply.status(200).send({
        confirmed: parsed.data.fieldKey,
        grants: 'LaunchMind will use this in content it creates. It is how your marketing looks and sounds, not proof of anything.',
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Could not confirm this' });
    }
  });

  /**
   * GET /studio/assets
   * List and search the asset library with filters.
   * @security JWT required. Returns only current founder's assets.
   */
  server.get('/studio/assets', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);

    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.errors });
    }

    const { search, type, status, channel, market, language, missionId, tags, includeArchived, limit, offset } = parsed.data;
    const supabase = getSupabaseAdmin();

    try {
      // BUSINESS SCOPE. Was founder-only, so one founder's second business saw
      // the first's content. An unselected business yields an EMPTY list of the
      // same shape — never an unfiltered one.
      const { activeProductId } = await import('../services/activeBusinessService');
      const scopedProductId = await activeProductId(founderId);
      if (!scopedProductId) return reply.send({ assets: [], total: 0, limit, offset });

      let query = supabase
        .from('content_assets')
        .select(`
          id, asset_type, channel, market, language, status,
          text_content, structured_data, media_url, media_type,
          model_used, quality_score, hook_angle, tokens_consumed,
          tags, mission_id, growth_brain_version, archived_at, published_at,
          approved_at, regen_count, installs, impressions, cpi,
          created_at, updated_at
        `, { count: 'exact' })
        .eq('founder_id', founderId)
        .eq('product_id', scopedProductId);

      if (!includeArchived) {
        query = query.is('archived_at', null);
      }
      if (type) query = query.eq('asset_type', type);
      if (status) query = query.eq('status', status);
      if (channel) query = query.eq('channel', channel);
      if (market) query = query.eq('market', market);
      if (language) query = query.eq('language', language);
      if (missionId) query = query.eq('mission_id', missionId);
      if (tags) {
        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        if (tagList.length > 0) {
          query = query.overlaps('tags', tagList);
        }
      }
      if (search) {
        query = query.ilike('text_content', `%${search}%`);
      }

      const { data: assets, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return reply.send({ assets: assets ?? [], total: count ?? 0, limit, offset });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to list assets' });
    }
  });

  /**
   * GET /studio/assets/:id
   * Get a single asset with its version count and publishing targets.
   * @security JWT required. Ownership enforced.
   */
  server.get('/studio/assets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data: asset, error } = await supabase
        .from('content_assets')
        .select('*')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (error || !asset) return reply.status(404).send({ error: 'Asset not found' });

      // Count versions
      const { count: versionCount } = await supabase
        .from('content_versions')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', assetId);

      // Get latest publishing target
      const { data: publishTargets } = await supabase
        .from('publishing_targets')
        .select('id, channel, status, platform_url, published_at')
        .eq('asset_id', assetId)
        .eq('founder_id', founderId)
        .order('created_at', { ascending: false })
        .limit(5);

      return reply.send({ asset, versionCount: versionCount ?? 0, publishTargets: publishTargets ?? [] });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to get asset' });
    }
  });

  /**
   * PUT /studio/assets/:id
   * Update asset content. Creates a version record before overwriting.
   * @security JWT required. Ownership enforced.
   */
  server.put('/studio/assets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    const parsed = UpdateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const supabase = getSupabaseAdmin();

    try {
      // Get current asset (ownership check)
      const { data: asset, error: fetchErr } = await supabase
        .from('content_assets')
        .select('id, founder_id, text_content, structured_data, media_url, growth_brain_version')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !asset) return reply.status(404).send({ error: 'Asset not found' });

      // Get next version number
      const { data: maxVer } = await supabase
        .from('content_versions')
        .select('version_number')
        .eq('asset_id', assetId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (maxVer?.version_number ?? 0) + 1;

      // Snapshot current state
      await supabase.from('content_versions').insert({
        asset_id:             assetId,
        version_number:       nextVersion,
        text_content:         asset.text_content,
        structured_data:      asset.structured_data,
        media_url:            asset.media_url,
        growth_brain_version: asset.growth_brain_version,
        change_type:          'editor_save',
        change_summary:       parsed.data.changeSummary ?? 'Editor save',
        changed_by:           founderId,
      });

      // Build update payload (only include provided fields)
      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.textContent !== undefined) updatePayload.text_content = parsed.data.textContent;
      if (parsed.data.structuredData !== undefined) updatePayload.structured_data = parsed.data.structuredData;
      if (parsed.data.tags !== undefined) updatePayload.tags = parsed.data.tags;

      const { data: updated, error: updateErr } = await supabase
        .from('content_assets')
        .update(updatePayload)
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return reply.send({ asset: updated, versionCreated: nextVersion });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to update asset' });
    }
  });

  /**
   * POST /studio/assets/:id/transform
   * AI transform: rewrite, expand, shorten, tone, translate, seo, aso.
   * Saves current version before overwriting.
   * @security JWT required. Ownership enforced. callHaiku for short transforms.
   */
  server.post('/studio/assets/:id/transform', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    const parsed = TransformBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const supabase = getSupabaseAdmin();

    try {
      const { data: asset, error: fetchErr } = await supabase
        .from('content_assets')
        .select('id, founder_id, text_content, structured_data, growth_brain_version')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !asset) return reply.status(404).send({ error: 'Asset not found' });

      const currentText = asset.text_content
        ?? (asset.structured_data ? JSON.stringify(asset.structured_data, null, 2) : null);

      if (!currentText) {
        return reply.status(400).send({ error: 'Asset has no text content to transform' });
      }

      // Get next version number
      const { data: maxVer } = await supabase
        .from('content_versions')
        .select('version_number')
        .eq('asset_id', assetId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (maxVer?.version_number ?? 0) + 1;

      // Snapshot current state before transform
      await supabase.from('content_versions').insert({
        asset_id:             assetId,
        version_number:       nextVersion,
        text_content:         asset.text_content,
        structured_data:      asset.structured_data,
        growth_brain_version: asset.growth_brain_version,
        change_type:          'ai_transform',
        change_summary:       `${parsed.data.transformType} transform`,
        changed_by:           founderId,
      });

      const transformPrompt = buildTransformPrompt(currentText, parsed.data.transformType, {
        targetTone:     parsed.data.targetTone,
        targetLanguage: parsed.data.targetLanguage,
        targetLength:   parsed.data.targetLength,
        instructions:   parsed.data.instructions,
      });

      // Transforms are always short → Haiku
      const newText = await callHaiku(
        `${transformPrompt}\n\nReturn only the transformed content. No explanation, no preamble.`,
        512,
        { founderId, promptId: `studio_transform_${parsed.data.transformType}`, action: 'studio_transform' },
      );

      const { data: updated, error: updateErr } = await supabase
        .from('content_assets')
        .update({ text_content: newText, updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .select('id, text_content, updated_at')
        .single();

      if (updateErr) throw updateErr;

      return reply.send({
        asset:          updated,
        transformType:  parsed.data.transformType,
        versionCreated: nextVersion,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Transform failed' });
    }
  });

  /**
   * GET /studio/assets/:id/versions
   * List version history for an asset, newest first.
   * @security JWT required. Ownership enforced via changed_by.
   */
  server.get('/studio/assets/:id/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      // Verify asset ownership
      const { data: asset } = await supabase
        .from('content_assets')
        .select('id')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (!asset) return reply.status(404).send({ error: 'Asset not found' });

      const { data: versions, error } = await supabase
        .from('content_versions')
        .select('id, version_number, text_content, structured_data, change_type, change_summary, growth_brain_version, created_at')
        .eq('asset_id', assetId)
        .eq('changed_by', founderId)
        .order('version_number', { ascending: false });

      if (error) throw error;

      return reply.send({ versions: versions ?? [] });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to list versions' });
    }
  });

  /**
   * POST /studio/assets/:id/archive
   * Soft-delete an asset. Sets archived_at timestamp.
   * @security JWT required. Ownership enforced.
   */
  server.post('/studio/assets/:id/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data, error } = await supabase
        .from('content_assets')
        .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .is('archived_at', null)
        .select('id, archived_at')
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Asset not found or already archived' });

      return reply.send({ id: data.id, archivedAt: data.archived_at });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to archive asset' });
    }
  });

  /**
   * POST /studio/assets/:id/restore
   * Restore a soft-deleted asset. Clears archived_at.
   * @security JWT required. Ownership enforced.
   */
  server.post('/studio/assets/:id/restore', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;
    const supabase = getSupabaseAdmin();

    try {
      const { data, error } = await supabase
        .from('content_assets')
        .update({ archived_at: null, updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .not('archived_at', 'is', null)
        .select('id, archived_at')
        .single();

      if (error || !data) return reply.status(404).send({ error: 'Asset not found or not archived' });

      return reply.send({ id: data.id, restored: true });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to restore asset' });
    }
  });

  /**
   * POST /studio/assets/:id/publish
   * Record a publishing target for a live channel.
   * Asset must be approved before publishing.
   * @security JWT required. Ownership enforced. Approval gate enforced (§1.5 CLAUDE.md).
   */
  server.post('/studio/assets/:id/publish', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const assetId = (request.params as { id: string }).id;

    const parsed = PublishBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.errors });
    }

    const supabase = getSupabaseAdmin();

    try {
      // Ownership + approval gate
      const { data: asset, error: fetchErr } = await supabase
        .from('content_assets')
        .select('id, founder_id, status, approved_at')
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .single();

      if (fetchErr || !asset) return reply.status(404).send({ error: 'Asset not found' });

      // §1.5 Approve-Before-Post — hard server-side constraint
      if (!asset.approved_at) {
        return reply.status(422).send({ error: 'Asset must be approved before publishing' });
      }

      const { data: target, error: insertErr } = await supabase
        .from('publishing_targets')
        .insert({
          asset_id:     assetId,
          founder_id:   founderId,
          channel:      parsed.data.channel,
          platform_url: parsed.data.platformUrl ?? null,
          external_id:  parsed.data.externalId ?? null,
          published_by: founderId,
          status:       'live',
          metadata:     parsed.data.metadata ?? null,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Set published_at on the asset (first publish only)
      await supabase
        .from('content_assets')
        .update({ published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .eq('founder_id', founderId)
        .is('published_at', null);

      return reply.status(201).send({ publishTarget: target });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to publish asset' });
    }
  });

  /**
   * GET /studio/stats
   * Generation stats: assets by type, status breakdown, token spend.
   * @security JWT required. Returns only current founder's stats.
   */
  server.get('/studio/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
    const founderId = getFounderId(request);
    const supabase = getSupabaseAdmin();

    try {
      const [assetsRes, versionsRes, publishRes] = await Promise.all([
        supabase
          .from('content_assets')
          .select('asset_type, status, tokens_consumed, market, channel, archived_at')
          .eq('founder_id', founderId),
        supabase
          .from('content_versions')
          .select('id', { count: 'exact', head: true })
          .eq('changed_by', founderId),
        supabase
          .from('publishing_targets')
          .select('id, channel, status')
          .eq('founder_id', founderId),
      ]);

      const assets = assetsRes.data ?? [];
      const active = assets.filter(a => !a.archived_at);

      const byType = active.reduce<Record<string, number>>((acc, a) => {
        acc[a.asset_type] = (acc[a.asset_type] ?? 0) + 1;
        return acc;
      }, {});

      const byStatus = active.reduce<Record<string, number>>((acc, a) => {
        acc[a.status] = (acc[a.status] ?? 0) + 1;
        return acc;
      }, {});

      const totalTokens = active.reduce((sum, a) => sum + (a.tokens_consumed ?? 0), 0);

      return reply.send({
        totalAssets:       active.length,
        archivedAssets:    assets.filter(a => a.archived_at).length,
        totalVersions:     versionsRes.count ?? 0,
        publishedCount:    (publishRes.data ?? []).filter(p => p.status === 'live').length,
        totalTokens,
        byType,
        byStatus,
      });
    } catch (err) {
      Sentry.captureException(err);
      return reply.status(500).send({ error: 'Failed to get stats' });
    }
  });
}

export const studioRoutes = fp(studioPlugin);
