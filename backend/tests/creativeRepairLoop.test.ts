import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { MemoryDb } from './helpers/memoryDb';
import { renderGovernedVisual, type RenderVisualInput } from '../src/services/creative/creativeRenderService';
const seams = vi.hoisted(()=>({diagnostic:vi.fn(),generate:vi.fn(),critique:vi.fn(),upload:vi.fn(),db:null as unknown,assets:[{id:'shot',assetType:'SCREENSHOT',source:'APP_STORE',externalUrl:'https://assets.test/shot.png'}]}));
vi.mock('../src/services/creative/creativeDiagnostics',()=>({createCreativeDiagnostics:async()=>({write:seams.diagnostic})}));
vi.mock('../src/lib/supabaseAdmin',()=>({getSupabaseAdmin:()=>seams.db}));
vi.mock('../src/services/brand/marketingAssetService',()=>({resolveMarketingAssets:async()=>seams.assets}));
vi.mock('../src/services/creative/creativeProviderRegistry',()=>({getCreativeProvider:()=>({generateImage:seams.generate})}));
vi.mock('../src/services/creative/visualCritique',()=>({critiqueRenderedVisual:seams.critique}));
vi.mock('../src/services/creative/replicateCreativeAdapter',()=>({downloadRenderedImage:async()=>({bytes:await sharp({create:{width:1024,height:1024,channels:3,background:'#eeeafa'}}).png().toBuffer()})}));
const input={workspaceId:'ws',productId:'prod',founderId:'founder',contentAssetId:'asset',versionNumber:2,
 channel:'META_AD',conceptLabel:'Problem recognition',useProductComposition:true,
 governedHeadline:'Still calling around?',governedContentVersion:2,
 ctx:{workspaceId:'ws',productId:'prod',application:{name:'AllignX',description:'Connect with home service professionals',markets:[]},
 founderDirection:{audienceConfirmed:'Homeowners',competitors:[]},brand:{version:1,fields:{},missing:[]},authorizedAssets:[],prohibitedTerms:[],brandProvenance:[],unavailable:[]},
 strategy:{campaignThesis:'Recognition before product',constraints:[],brandDirectives:[],proofUnavailable:[]},
 brief:{prohibitedTerminology:[],authorizedAssetRefs:[],channel:'META_AD',visualDirection:'Problem recognition',message:'Recognition',brandConstraints:[],ownerConfirmationRequired:[],proofUnavailable:[],channelConstraints:[]}
} as unknown as RenderVisualInput;
let db:MemoryDb;
beforeEach(async()=>{
 db=new MemoryDb({creative_render_jobs:[],marketing_assets:[]});
 seams.db={from:db.from.bind(db),storage:{from:()=>({upload:seams.upload,getPublicUrl:()=>({data:{publicUrl:'https://assets.test/final.png'}})})}};
 seams.upload.mockReset().mockResolvedValue({error:null});
 seams.generate.mockReset().mockResolvedValue({imageUrl:'https://provider.test/image',latencyMs:1});
 seams.critique.mockReset();
 seams.diagnostic.mockReset();
 seams.assets=[{id:'shot',assetType:'SCREENSHOT',source:'APP_STORE',externalUrl:'https://assets.test/shot.png'}];
 const bytes=await sharp({create:{width:300,height:600,channels:3,background:'#5555ee'}}).png().toBuffer();
 vi.stubGlobal('fetch',async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));
});
it('repairs internally and stores only the candidate that passes final-pixel critique',async()=>{
 seams.critique.mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'Reduce background clutter',checks:{composition:'NEEDS_ATTENTION'}})
 .mockResolvedValueOnce({outcome:'READY_FOR_OWNER_REVIEW',summary:'Clear recognition',checks:{composition:'PASS'}});
 const result=await renderGovernedVisual({...input,compositionLayout:'PRODUCT_HERO'});
 expect(result.status).toBe('SUCCEEDED');
 expect(seams.generate).toHaveBeenCalledTimes(2);
 expect(seams.generate.mock.calls[1][0].prompt).toContain('WAITING_FOR_HELP');
 expect(seams.generate.mock.calls[1][0].prompt).not.toContain('Reduce background clutter');
 expect(seams.generate.mock.calls.every(c=>c[0].referenceImageUrls.length===0)).toBe(true);
 expect(seams.upload).toHaveBeenCalledTimes(1);
 expect(db.rows('marketing_assets')).toHaveLength(1);
 const stored=db.rows('marketing_assets')[0].generation_provenance as {manifest:{layout:string}};
 expect(stored.manifest.layout).toBe('PROBLEM_FRAME');
});
it('withholds every weak candidate after the bounded attempts',async()=>{
 seams.critique.mockResolvedValue({outcome:'NEEDS_CREATIVE_REVISION',summary:'Composition is weak',checks:{composition:'NEEDS_ATTENTION'}});
 const result=await renderGovernedVisual(input);
 expect(result.status).toBe('FAILED');
 expect(seams.generate).toHaveBeenCalledTimes(1);
 expect(seams.critique).toHaveBeenCalledTimes(3);
 expect(seams.upload).not.toHaveBeenCalled();
 expect(db.rows('marketing_assets')).toHaveLength(0);
});

it('omits unsuitable artwork before the first attempt, preserving confirmed branding', async () => {
  seams.critique.mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'Promotional artwork distracts from recognition',checks:{composition:'NEEDS_ATTENTION'}})
    .mockResolvedValueOnce({outcome:'READY_FOR_OWNER_REVIEW',summary:'Clear branded recognition',checks:{composition:'PASS'}});
  const result = await renderGovernedVisual({...input, ctx: {...input.ctx, brand: {...input.ctx.brand,
    fields: {logo: {ownerConfirmed: true, value: 'https://assets.test/logo.png'}}}}} as RenderVisualInput);
  expect(result.status).toBe('SUCCEEDED');
  expect(seams.critique.mock.calls[0][0].sourceScreenshot).toBeNull();
  expect(seams.critique.mock.calls[1][0].sourceScreenshot).toBeNull();
  expect(seams.generate.mock.calls.every(c => c[0].referenceImageUrls.length === 0)).toBe(true);
  expect(seams.upload).toHaveBeenCalledTimes(1);
});

it('recomposes layout-only feedback with the same background and persists repaired controls', async () => {
  seams.critique.mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'CTA covers the face; supporting copy is unreadable. No generated pseudo-text.',checks:{visualHierarchy:'NEEDS_ATTENTION',composition:'NEEDS_ATTENTION',semanticContext:'NEEDS_ATTENTION',backgroundText:'PASS',authenticity:'PASS'}})
    .mockResolvedValueOnce({outcome:'READY_FOR_OWNER_REVIEW',summary:'Ready',checks:{composition:'PASS'}});
  const result=await renderGovernedVisual({...input,governedSupporting:'Connect with vetted pros.',governedCta:'See AllignX'});
  expect(result.status).toBe('SUCCEEDED');
  expect(seams.generate).toHaveBeenCalledTimes(1);
  expect(seams.critique).toHaveBeenCalledTimes(2);
  const p=db.rows('marketing_assets')[0].generation_provenance as any;
  expect(p.providerCalls).toBe(1);
  expect(p.refinementAttempts[1].backgroundReused).toBe(true);
  expect(p.manifest.compositionIntent.typography.supportScale).toBeGreaterThan(p.refinementAttempts[0].intent.typography.supportScale);
  expect(p.visualExecution.compositionIntent).toEqual(p.manifest.compositionIntent);
  expect(p.scenePlan.compositionIntent).toEqual(p.manifest.compositionIntent);
});

it('switches persistent structural failure to the other usable grammar and records the actual execution', async () => {
  seams.assets=[{id:'hero',assetType:'SCREENSHOT',source:'OWNER_UPLOAD',externalUrl:'https://assets.test/hero.png'}];
  const bytes=await sharp({create:{width:800,height:1400,channels:3,background:'#4455ee'}}).png().toBuffer();
  vi.stubGlobal('fetch',async()=>new Response(bytes,{headers:{'content-type':'image/png'}}));
  seams.critique.mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'The product is too small',checks:{composition:'NEEDS_ATTENTION'}})
    .mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'The composition still fails structurally',checks:{composition:'NEEDS_ATTENTION'}})
    .mockResolvedValueOnce({outcome:'READY_FOR_OWNER_REVIEW',summary:'Clear message and scene',checks:{composition:'PASS'}});
  const result=await renderGovernedVisual(input);
  expect(result.status).toBe('SUCCEEDED');
  expect(seams.generate).toHaveBeenCalledTimes(2);
  const p=db.rows('marketing_assets')[0].generation_provenance as any;
  expect(p.refinementAttempts[1].intent.visualWeight).toBeGreaterThan(p.refinementAttempts[0].intent.visualWeight);
  expect(seams.critique.mock.calls[0][0].plan.visualThesis).toBeUndefined();
  expect(seams.critique.mock.calls[0][0].plan.problemRepresentation).not.toContain('doorway');
  expect(seams.critique.mock.calls[2][0].plan.visualThesis.type).toBe('WAITING_FOR_HELP');
  expect(p.visualExecution.id).not.toBe('problem-product-split');
  expect(p.visualExecution.compositionIntent.grammar).toBe('PROBLEM_VISUAL_MESSAGE');
  expect(p.manifest.compositionIntent).toEqual(p.visualExecution.compositionIntent);
  expect(p.manifest.screenshotComposited).toBe(false);
  expect(p.refinementAttempts[2].repairReason).toContain('untried composition grammar');
});

it('records semantic regeneration separately from layout recomposition, even when all candidates fail',async()=>{
 seams.critique.mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'Wrong industry: cooking-like imagery',checks:{conceptClarity:'NEEDS_ATTENTION'}})
 .mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'Headline too small and CTA isolated',checks:{visualHierarchy:'NEEDS_ATTENTION'}})
 .mockResolvedValueOnce({outcome:'NEEDS_CREATIVE_REVISION',summary:'Composition is weak',checks:{composition:'NEEDS_ATTENTION'}});
 const result=await renderGovernedVisual(input);
 expect(result.status).toBe('FAILED');
 expect(seams.generate).toHaveBeenCalledTimes(2);
 expect(seams.generate.mock.calls[0][0].prompt).toContain('WAITING_FOR_HELP');
 expect(seams.generate.mock.calls[1][0].prompt).toContain('WAITING_FOR_HELP');
 const final=seams.diagnostic.mock.calls.at(-1)!;
 expect(final[1].status).toBe('REJECTED');
 expect(final[2]).toEqual({providerCalls:2,pixelCritiqueCalls:3,layoutOnlyRecompositions:1,semanticRegenerations:1});
 expect(Buffer.isBuffer(final[3])).toBe(true);
 expect(seams.upload).not.toHaveBeenCalled();
 expect(db.rows('marketing_assets')).toHaveLength(0);
});
it('accounts for an image invocation even when the provider fails before returning pixels',async()=>{
 seams.generate.mockRejectedValueOnce(new Error('provider failed'));
 const result=await renderGovernedVisual(input);
 expect(result.status).toBe('FAILED');
 expect(seams.diagnostic.mock.calls.at(-1)![2].providerCalls).toBe(1);
 expect(seams.critique).not.toHaveBeenCalled();
 expect(seams.upload).not.toHaveBeenCalled();
});

it('starts with the human direction and stops immediately when its first pixels qualify', async()=>{
 seams.critique.mockResolvedValue({outcome:'READY_FOR_OWNER_REVIEW',summary:'Strong human frustration ad',checks:{semanticContext:'PASS',composition:'PASS'}});
 const result=await renderGovernedVisual(input);
 expect(result.status).toBe('SUCCEEDED');expect(seams.generate).toHaveBeenCalledTimes(1);expect(seams.critique).toHaveBeenCalledTimes(1);
 expect(seams.generate.mock.calls[0][0].prompt).toContain('WAITING_FOR_HELP');
 expect(seams.generate.mock.calls[0][0].prompt).not.toMatch(/drywall|wall patch|hinge|broken door|paint patch|unfinished repair/i);
});
