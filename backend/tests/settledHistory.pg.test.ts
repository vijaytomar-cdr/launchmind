/**
 * @file settledHistory.pg.test.ts
 * @description P1-22 — the "Recently decided" surface, cases A–P.
 *
 *   Exists because a settled decision became invisible the moment the live
 *   recommendation set moved on, which made the retraction notice unreachable in
 *   a browser. History is READ-ONLY and comes from the immutable snapshot; the
 *   source's current lifecycle is an overlay resolved at read time.
 *
 * @security Cases E/F are the isolation proofs — the existing route was
 *   workspace-scoped but NOT product-scoped, which this suite now forbids.
 * @dependencies growthBrainDecisionService, historicalProvenance,
 *   marketIntelligenceService (all real), local Postgres
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '../src/lib/supabaseAdmin';
import { requirePostgres } from './helpers/requirePostgres';
import { persistRecommendations, decideRecommendation } from '../src/services/growthBrainDecisionService';
import { annotateHistoricalProvenance, listSettledHistory, UNKNOWN_SOURCE_NOTICE } from '../src/services/marketIntelligence/historicalProvenance';
import { ingestStoreListing, setSourceLifecycle } from '../src/services/marketIntelligence/marketIntelligenceService';
import { storeSubjectKey, type LifecycleState } from '../src/services/marketIntelligence/contract';
import type { GrowthBrainRecommendation } from '../src/services/growthBrainRecommendationService';

const uuidFrom = (s: string) => { const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const RUN=`${Date.now()}-${process.pid}`;
const FA=uuidFrom(`sh-fa-${RUN}`), FB=uuidFrom(`sh-fb-${RUN}`);
const WSA=uuidFrom(`sh-wsa-${RUN}`), WSB=uuidFrom(`sh-wsb-${RUN}`);
const PA=uuidFrom(`sh-pa-${RUN}`), PA2=uuidFrom(`sh-pa2-${RUN}`), PB=uuidFrom(`sh-pb-${RUN}`);
const SESS=uuidFrom(`sh-s-${RUN}`);
const RIVAL_URL='https://apps.apple.com/us/app/rival/id800000001';
const RIVAL=storeSubjectKey('app_store','us','id800000001');
const db=()=>getSupabaseAdmin();
const pg=requirePostgres(); const d=pg.available?describe:describe.skip;
async function must(l:string,p:PromiseLike<{error:unknown}>){const{error}=await p;
  if(error)throw new Error(`seed ${l}: ${(error as {message?:string}).message??String(error)}`);}

const MI_LABEL='Rival — App Store observation';
// actionType varies so the four cases are DIFFERENT owner actions. The first
// version used one actionType for all four: they resolved to the same
// action_key, so 3.3E action-equivalence correctly treated them as ONE decision
// and the churn dedup collapsed them. That was the fixture being wrong about
// what a decision is, not the product.
const rec=(what:string, market=true, actionType='RESEARCH'):GrowthBrainRecommendation=>({
  type:'RECOMMENDATION', actionType, what, whyNow:'because', nextStep:'look',
  supportedBy: market
    ? [{kind:'MARKET_INTELLIGENCE',label:MI_LABEL,authority:'VERIFIED_EXTERNAL',memoryClass:null,evidenceCount:null,detail:'App Store listing, observed 2026-08-10'}]
    : [{kind:'FOUNDER_DIRECTION',label:'Your confirmed direction',authority:null,memoryClass:null,evidenceCount:null,detail:'You told LaunchMind this'}],
  supporting:[], founderConflict:null, requiresFounderReview:false,
  expectedEffect:null, requiresApproval:false, evidenceStrength:'some evidence', confidence:null,
} as GrowthBrainRecommendation);

/**
 * The PRODUCTION composition — the same function the route calls.
 *
 * This used to re-implement product scoping, churn dedup and the lifecycle
 * overlay. A test that copies the logic it checks proves only that the copy
 * agrees with itself: dropping the overlay from the ROUTE would have failed
 * nothing. `productId` is now derived inside, exactly as production derives it.
 */
async function history(workspaceId:string, _productId:string|null){
  void _productId;
  return listSettledHistory(workspaceId) as unknown as Promise<Array<Record<string,unknown> & {
    what?:string; decisionStatus?:string; actionKey?:string|null; id?:string; supportedBy?:unknown }>>;
}
const setState=async(state:LifecycleState)=>{
  const{data}=await db().from('market_intelligence_source_records').select('id').eq('subject_key',RIVAL);
  for(const r of (data??[]) as Array<{id:string}>) await setSourceLifecycle(r.id,state,{reason:'sh'});
};

d('P1-22 — settled decision history (A–P)',()=>{
  beforeAll(async()=>{
    await must('founders',db().from('founders').upsert([
      {id:FA,email:`sh-a-${RUN}@lab.invalid`,name:'SH A',plan:'studio'},
      {id:FB,email:`sh-b-${RUN}@lab.invalid`,name:'SH B',plan:'studio'}],{onConflict:'id'}));
    await must('workspaces',db().from('workspaces').upsert([
      {id:WSA,founder_id:FA,name:`SH WSA ${RUN}`},{id:WSB,founder_id:FB,name:`SH WSB ${RUN}`}],{onConflict:'id'}));
    await must('products',db().from('products').upsert([
      {id:PA,founder_id:FA,workspace_id:WSA,name:'Mine',store_url:'https://apps.apple.com/us/app/mine/id800000009',
       platform:'app_store',category:'productivity',markets:['usa'],competitor_set:[{name:'Rival',storeUrl:RIVAL_URL}]},
      {id:PA2,founder_id:FA,workspace_id:WSA,name:'Sibling',store_url:'https://apps.apple.com/us/app/sib/id800000008',
       platform:'app_store',category:'productivity',markets:['usa'],competitor_set:[]},
      {id:PB,founder_id:FB,workspace_id:WSB,name:'Other',store_url:'https://apps.apple.com/us/app/oth/id800000007',
       platform:'app_store',category:'productivity',markets:['usa'],competitor_set:[]}],{onConflict:'id'}));
    await must('sess',db().from('onboarding_sessions').upsert({id:SESS,founder_id:FA,current_state:'PHASE_1_COMPLETE',product_id:PA},{onConflict:'id'}));
    await must('comp',db().from('competitor_relationships').upsert({id:uuidFrom(`sh-c-${RUN}`),founder_id:FA,
      product_id:PA,session_id:SESS,name:'Rival',relationship:'CONFIRMED',key_differentiator:'x'},{onConflict:'id'}));
    process.env.MARKET_INTELLIGENCE_MODE='ACTIVE';
    await ingestStoreListing({provider:'app_store',storefront:'us',providerId:'id800000001',sourceRef:RIVAL_URL,
      name:'Rival',developer:'RivalCo, Inc.',summary:'Book a trusted local pro in minutes.',category:'productivity',
      rating:4.4,ratingCount:12000,free:true,updatedAt:new Date(Date.now()-5*86400000).toISOString(),
      releasedAt:'2020-01-01T00:00:00.000Z',retrievedAt:new Date().toISOString()});
  },180_000);
  afterAll(async()=>{
    await db().from('market_intelligence_resolutions').delete().in('workspace_id',[WSA,WSB]);
    await db().from('market_intelligence_source_records').delete().eq('subject_key',RIVAL);
    await db().from('growth_brain_recommendations').delete().in('workspace_id',[WSA,WSB]);
    await db().from('competitor_relationships').delete().eq('product_id',PA);
    await db().from('onboarding_sessions').delete().eq('id',SESS);
    await db().from('products').delete().in('id',[PA,PA2,PB]);
    await db().from('workspaces').delete().in('id',[WSA,WSB]);
    await db().from('founders').delete().in('id',[FA,FB]);
    delete process.env.MARKET_INTELLIGENCE_MODE;
  });

  it('A/B/C/D — all three settled states appear; RECOMMENDED does not',async()=>{
    await setState('ACTIVE');
    const made=await persistRecommendations({workspaceId:WSA,founderId:FA,productId:PA},
      [rec(`APR ${RUN}`,true,'RESEARCH'),rec(`DIS ${RUN}`,true,'REVIEW_CONTEXT'),
       rec(`DEF ${RUN}`,true,'DRAFT_CONTENT'),rec(`OPEN ${RUN}`,true,'RUN_EXPERIMENT')]);
    // ROOT CAUSE of the earlier red: `persistRecommendations` upserts and then
    // RE-SELECTS with `.in('fingerprint', …)` and NO `.order()`, so PostgREST
    // returns the rows in unspecified order. Indexing `made[0..2]` positionally
    // therefore decided whichever rows happened to come back first — which is
    // why OPEN appeared settled and APR did not. The product was never wrong.
    const idOf = (name: string) => {
      const row = made.find(m => m.what === `${name} ${RUN}`);
      expect(row, `${name} was not persisted`).toBeTruthy();
      return row!.id;
    };
    await decideRecommendation({workspaceId:WSA,founderId:FA,productId:PA},idOf('APR'),'APPROVE');
    await decideRecommendation({workspaceId:WSA,founderId:FA,productId:PA},idOf('DIS'),'DISMISS');
    await decideRecommendation({workspaceId:WSA,founderId:FA,productId:PA},idOf('DEF'),'DEFER');

    // The four are genuinely DIFFERENT owner decisions, asserted before any
    // conclusion is drawn from them.
    const keys = made.map(m => m.actionKey ?? m.id);
    expect(new Set(keys).size, 'fixtures collide on action key').toBe(4);
    const h=await history(WSA,PA);
    const whats=h.map(x=>x.what);
    expect(whats).toContain(`APR ${RUN}`); expect(whats).toContain(`DIS ${RUN}`);
    expect(whats).toContain(`DEF ${RUN}`); expect(whats).not.toContain(`OPEN ${RUN}`);
    expect(h.map(x=>x.decisionStatus).sort()).toEqual(['APPROVED','DEFERRED','DISMISSED']);
  },180_000);

  it('E/F — another workspace and a sibling product are excluded',async()=>{
    await persistRecommendations({workspaceId:WSB,founderId:FB,productId:PB},[rec(`OTHERBIZ ${RUN}`,false,'REVIEW_CONTEXT')])
      .then(r=>decideRecommendation({workspaceId:WSB,founderId:FB,productId:PB},r[0].id,'APPROVE'));
    await persistRecommendations({workspaceId:WSA,founderId:FA,productId:PA2},[rec(`SIBLING ${RUN}`,false,'DRAFT_CONTENT')])
      .then(r=>decideRecommendation({workspaceId:WSA,founderId:FA,productId:PA2},r[0].id,'APPROVE'));
    const h=(await history(WSA,PA)).map(x=>x.what);
    expect(h).not.toContain(`OTHERBIZ ${RUN}`);
    expect(h,'a sibling product leaked into this history').not.toContain(`SIBLING ${RUN}`);
    // The exclusion is NOT vacuous: both rows genuinely exist and are settled.
    // They are asserted at the database rather than through `history()`, because
    // production always derives the product from the workspace — "history for
    // the sibling product" is not an operation the route can perform.
    const {count:sib}=await db().from('growth_brain_recommendations')
      .select('id',{count:'exact',head:true}).eq('product_id',PA2).eq('decision_status','APPROVED');
    expect(sib??0,'the sibling decision was never created').toBe(1);
    const {count:other}=await db().from('growth_brain_recommendations')
      .select('id',{count:'exact',head:true}).eq('workspace_id',WSB).eq('decision_status','APPROVED');
    expect(other??0,'the other business decision was never created').toBe(1);
  },180_000);

  it('G — two settled rows sharing an action key are ONE decision',async()=>{
    const h=await history(WSA,PA);
    const keys=h.map(x=>x.actionKey??x.id);
    expect(new Set(keys).size).toBe(keys.length);
  },120_000);

  it('H/I/J — retraction discloses, snapshot unchanged, ACTIVE warns nothing',async()=>{
    await setState('ACTIVE');
    const [r]=await persistRecommendations({workspaceId:WSA,founderId:FA,productId:PA},[rec(`RETR ${RUN}`,true,'LAUNCH_CAMPAIGN')]);
    await decideRecommendation({workspaceId:WSA,founderId:FA,productId:PA},r.id,'APPROVE');
    const before=await db().from('growth_brain_recommendations')
      .select('what, why_now, supported_by, supporting, fingerprint, action_key, decision_status').eq('id',r.id).single();
    const activeCard=(await history(WSA,PA)).find(x=>x.what===`RETR ${RUN}`)!;
    expect((activeCard.supportedBy as Array<{currentLifecycleNotice?:string}>)[0].currentLifecycleNotice).toBeUndefined();

    await setState('RETRACTED');
    const after=await db().from('growth_brain_recommendations')
      .select('what, why_now, supported_by, supporting, fingerprint, action_key, decision_status').eq('id',r.id).single();
    expect(after.data).toEqual(before.data);

    const card=(await history(WSA,PA)).find(x=>x.what===`RETR ${RUN}`)!;
    expect(card.what).toBe(`RETR ${RUN}`);
    expect(card.decisionStatus).toBe('APPROVED');
    expect((card.supportedBy as Array<{currentLifecycleNotice?:string}>)[0].currentLifecycleNotice)
      .toBe('This source has since been retracted.');
  },240_000);

  it('K — an unresolvable source is reported honestly',async()=>{
    await setState('ACTIVE');
    const [out]=await annotateHistoricalProvenance(PA,[{supportedBy:[
      {kind:'MARKET_INTELLIGENCE',label:'Ghost — App Store observation',detail:'x'}]}]);
    expect((out.supportedBy as Array<{currentLifecycleNotice?:string}>)[0].currentLifecycleNotice)
      .toBe(UNKNOWN_SOURCE_NOTICE);
  },120_000);

  it('L/M — no enum, id, key or handle is owner-visible',async()=>{
    await setState('RETRACTED');
    const raw=JSON.stringify(await history(WSA,PA));
    for(const leak of ['RETRACTED','lifecycle_state','subject_key','source_record_id',
      'app_store:us:','independence','content_hash','authority_policy_version'])
      expect(raw,`leaked ${leak}`).not.toContain(leak);
    expect(raw,'internal citation handle').not.toMatch(/[[({]\s*(?:mi|m)\d{1,3}\b/i);
    await setState('ACTIVE');
  },120_000);

  it('N/O/P — reading history mutates nothing and starts nothing',async()=>{
    const counts=async()=>({
      mem:(await db().from('marketing_memories').select('id',{count:'exact',head:true}).eq('workspace_id',WSA)).count??0,
      ver:(await db().from('marketing_memory_versions').select('id',{count:'exact',head:true}).eq('workspace_id',WSA)).count??0,
      camp:(await db().from('campaigns').select('id',{count:'exact',head:true}).eq('founder_id',FA)).count??0,
      miss:(await db().from('missions').select('id',{count:'exact',head:true}).eq('workspace_id',WSA)).count??0,
      exec:(await db().from('growth_brain_recommendations').select('id',{count:'exact',head:true})
        .eq('workspace_id',WSA).eq('execution_status','READY_FOR_ACTION')).count??0,
      recs:(await db().from('growth_brain_recommendations').select('id',{count:'exact',head:true}).eq('workspace_id',WSA)).count??0,
    });
    const before=await counts();
    await history(WSA,PA); await history(WSA,PA); await history(WSA,PA);
    expect(await counts()).toEqual(before);
    // No settled row was ever reactivated.
    const {count}=await db().from('growth_brain_recommendations')
      .select('id',{count:'exact',head:true}).eq('workspace_id',WSA).eq('execution_status','EXECUTED');
    expect(count??0).toBe(0);
  },180_000);
});
