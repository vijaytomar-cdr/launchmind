import Fastify from 'fastify';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MemoryDb } from './helpers/memoryDb';
import { studioRoutes } from '../src/routes/studio.route';
const x = vi.hoisted(() => ({ db:null as any, raw:vi.fn(), render:vi.fn(), append:vi.fn(), owner:false, renders:[] as any[],
 ws:'11111111-1111-4111-8111-111111111111', product:'22222222-2222-4222-8222-222222222222',
 asset:'33333333-3333-4333-8333-333333333333', campaign:'44444444-4444-4444-8444-444444444444',
 strategy:'55555555-5555-4555-8555-555555555555', brief:'66666666-6666-4666-8666-666666666666' }));
vi.mock('../src/lib/supabaseAdmin',()=>({getSupabaseAdmin:()=>x.db}));
vi.mock('../src/lib/aiPlatform',()=>({callSonnet:vi.fn(),callHaiku:vi.fn()}));
vi.mock('../src/services/workspaceAuthService',()=>({resolveWorkspaceContext:async()=>({workspaceId:x.ws}),WorkspaceAccessError:class extends Error{}}));
vi.mock('../src/lib/context/contextPackageV2',()=>({buildContextPackageV2:async()=>({})}));
vi.mock('../src/services/content/productContentContext',()=>({buildProductContentContext:async()=>({
 workspaceId:x.ws, productId:x.product,application:{name:'AllignX',description:'Connect with vetted home service professionals nearby',markets:[]},
 founderDirection:{competitors:[],audienceConfirmed:'Homeowners'},brand:{version:1,fields:{},missing:[]},
 evidence:[{ref:'product',kind:'PRODUCT_CONTEXT',label:'Your product profile',text:'AllignX connects with vetted home service professionals nearby'}],
 prohibitedTerms:[],authorizedAssets:[],brandProvenance:[],unavailable:[]})}));
vi.mock('../src/services/content/strategyComposition',()=>({deriveContentStrategy:()=>({campaignThesis:'Home help on hold',coreNarrative:'Waiting',constraints:[]})}));
vi.mock('../src/services/content/briefComposition',()=>({deriveContentBrief:()=>({channel:'META_AD',audience:'Homeowners',proofAvailable:[],proofUnavailable:[],ownerConfirmationRequired:[],brandConstraints:[],channelConstraints:[],prohibitedTerminology:[]})}));
vi.mock('../src/services/content/brandGovernedGeneration',()=>({brandConstraints:()=>[]}));
vi.mock('../src/services/content/creativeBriefs',()=>({artifactProvenance:()=>[]}));
vi.mock('../src/services/content/b3ContentGeneration',async importOriginal=>{
 const real = await importOriginal<any>();
 return {...real,generateChannelContent:async(input:any)=> x.owner
   ? {disposition:'OWNER_CONFIRMATION_REQUIRED',rewriteAttempts:0,reasons:['Confirm required business truth']}
   : real.generateChannelContent({...input,generate:x.raw,semantic:async()=>({byField:new Map(),artifactClaims:[],unresolvedFields:[],unverifiable:false,failureReason:null})})};
});
vi.mock('../src/services/content/contentArtifactPersistence',()=>({
 appendGovernedVersion:x.append,
 ownerContentView:async()=>({}),
 rebuildGovernedLineage:async()=>({versionNumber:2,textEligibleForImage:true,disposition:'ELIGIBLE',headline:'Home projects on hold?',supporting:'Connect with vetted pros.',cta:'See AllignX',brief:{},strategy:{}}),
}));
vi.mock('../src/services/creative/creativeApprovalService',()=>({listCreativeRenders:async()=>x.renders}));
vi.mock('../src/services/creative/creativeProviderRegistry',()=>({creativeCapabilityAvailable:()=>true}));
vi.mock('../src/services/creative/creativeRenderService',()=>({renderGovernedVisual:x.render,CreativeRenderBlocked:class extends Error{}}));
let server:ReturnType<typeof Fastify>;
const good={content:{primaryText:'Still waiting?',headline:'Home projects on hold?',description:'Connect with vetted pros.',cta:'See AllignX'},declaredClaims:[]};
const body=()=>({productId:x.product,campaignId:x.campaign,strategyId:x.strategy,briefId:x.brief,assetId:x.asset,channel:'META_AD',variantLabel:'Problem recognition'});
beforeEach(async()=>{
 x.owner=false; x.raw.mockReset().mockResolvedValue(JSON.stringify(good));
 x.append.mockReset().mockResolvedValue({versionNumber:2});
 x.render.mockReset().mockResolvedValue({status:'SUCCEEDED',renderJobId:'job',publicUrl:'https://example.test/creative.png',widthPx:1024,heightPx:1024,provenance:[],notes:[]});
 x.db=new MemoryDb({products:[{id:x.product,workspace_id:x.ws}],content_campaigns:[{id:x.campaign,workspace_id:x.ws,name:'Home projects'}],content_assets:[{id:x.asset,workspace_id:x.ws,product_id:x.product,channel:'META_AD',variant_label:'Problem recognition',content_campaign_id:x.campaign,content_brief_id:x.brief}],marketing_assets:[]});
 server=Fastify(); server.decorateRequest('jwtVerify',async function(this:any){this.user={sub:'owner'};}); await server.register(studioRoutes);await server.ready();
});
afterEach(async()=>{await server.close();});
const run=()=>server.inject({method:'POST',url:'/studio/governed/artifact',headers:{authorization:'Bearer owner'},payload:body()});
it('A: eligible regeneration automatically invokes the governed visual endpoint once',async()=>{
 const response=await run();expect(response.statusCode).toBe(201);expect(response.json().ownerState).toBe('READY_FOR_OWNER_REVIEW');
 expect(x.raw).toHaveBeenCalledTimes(1);expect(x.append).toHaveBeenCalledTimes(1);expect(x.render).toHaveBeenCalledTimes(1);
 expect(x.render.mock.calls[0][0].contentAssetId).toBe(x.asset);expect(x.render.mock.calls[0][0].versionNumber).toBe(2);
});
it('B: governance rejects an internal candidate, repairs it, and renders only eligible copy',async()=>{
 x.raw.mockResolvedValueOnce(JSON.stringify({content:{...good.content,primaryText:'Cut costs by 40%.'},declaredClaims:[]})).mockResolvedValueOnce(JSON.stringify(good));
 const response=await run();expect(response.statusCode).toBe(201);expect(response.json().ownerState).toBe('READY_FOR_OWNER_REVIEW');
 expect(x.raw).toHaveBeenCalledTimes(2);expect(response.json().copyRepairs).toBe(1);expect(x.append).toHaveBeenCalledTimes(1);
 expect(x.append.mock.calls[0][0].input.result.disposition).toBe('ELIGIBLE');expect(x.render).toHaveBeenCalledTimes(1);
});
it('C: actual owner input stops without replacing the current version or generating imagery',async()=>{
 x.owner=true;const response=await run();expect(response.statusCode).toBe(200);expect(response.json().ownerState).toBe('NEEDS_OWNER_INPUT');
 expect(x.append).not.toHaveBeenCalled();expect(x.render).not.toHaveBeenCalled();
});
it('bounded copy failure stays internal instead of creating a rejected current version or HTTP 422',async()=>{
 x.raw.mockResolvedValue(JSON.stringify({content:{...good.content,primaryText:'Cut costs by 40%.'},declaredClaims:[]}));
 const response=await run();expect(response.statusCode).toBe(200);expect(response.json().ownerState).toBe('LAUNCHMIND_CAN_REPAIR');
 expect(x.raw).toHaveBeenCalledTimes(3);expect(x.append).not.toHaveBeenCalled();expect(x.render).not.toHaveBeenCalled();
});
it('missing CTA is repaired inside the same copy budget before persistence and rendering',async()=>{
 x.raw.mockResolvedValueOnce(JSON.stringify({content:{...good.content,cta:''},declaredClaims:[]}));
 const response=await run();expect(response.json().ownerState).toBe('READY_FOR_OWNER_REVIEW');expect(x.raw).toHaveBeenCalledTimes(1);expect(x.render).toHaveBeenCalledTimes(1);
});
it('D: bounded visual failure returns repairable owner state, never review readiness',async()=>{
 x.render.mockResolvedValue({status:'FAILED',renderJobId:'failed-job',ownerMessage:'Wrong scene'});
 const response=await run();expect(response.statusCode).toBe(201);expect(response.json().ownerState).toBe('LAUNCHMIND_CAN_REPAIR');expect(response.json().visual.renderJobId).toBe('failed-job');expect(x.render).toHaveBeenCalledTimes(1);
});

it('a prior-version visual cannot be current or make the new copy ready',async()=>{
 x.db.setRows('content_versions',[{asset_id:x.asset,version_number:2,disposition:'ELIGIBLE'}]);
 x.renders=[{renderJobId:'old',contentVersionNumber:1,isCurrent:true,qualityOutcome:'READY_FOR_OWNER_REVIEW'}];
 const response=await server.inject({method:'GET',url:`/studio/governed/artifact/${x.asset}/visual`,headers:{authorization:'Bearer owner'}});
 expect(response.statusCode).toBe(200);expect(response.json().renders[0].isCurrent).toBe(false);expect(response.json().ownerState).toBe('LAUNCHMIND_CAN_REPAIR');
});

it('field-limit repair receives exact measured errors and preserves eligible fields',async()=>{
 const long='Connect with vetted pros nearby';
 x.raw.mockResolvedValueOnce(JSON.stringify({content:{...good.content,description:long},declaredClaims:[]}))
 .mockResolvedValueOnce(JSON.stringify({alternatives:{description:['Connect with vetted pros.']}}));
 const response=await run();expect(response.json().ownerState).toBe('READY_FOR_OWNER_REVIEW');
 expect(x.raw).toHaveBeenCalledTimes(2);expect(JSON.parse(x.raw.mock.calls[1][1]).fields[0]).toMatchObject({measuredLength:long.length,maximum:30});
 expect(x.raw.mock.calls[1][0]).toContain('TARGETED FIELD FITTING');
 expect(x.append.mock.calls[0][0].input.result.payload).toEqual(good.content);expect(x.append).toHaveBeenCalledTimes(1);expect(x.render).toHaveBeenCalledTimes(1);
});

it('invalid mechanical alternatives exhaust once and never persist or render',async()=>{
 x.raw.mockResolvedValueOnce(JSON.stringify({content:{...good.content,description:'Connect with vetted pros nearby'},declaredClaims:[]}))
 .mockResolvedValue(JSON.stringify({alternatives:{description:Array(5).fill('x'.repeat(31))}}));
 const response=await run();expect(response.json().ownerState).toBe('LAUNCHMIND_CAN_REPAIR');
 expect(x.raw).toHaveBeenCalledTimes(2);expect(x.append).not.toHaveBeenCalled();expect(x.render).not.toHaveBeenCalled();
});
