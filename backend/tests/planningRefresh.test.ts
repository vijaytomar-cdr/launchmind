/**
 * @file planningRefresh.test.ts
 * @description Proves a stale production brief is re-bound to current governed
 *   evidence IN PLACE when new owner evidence makes its concept executable.
 *
 *   THE DEFECT. Content Intelligence judged a concept with the CURRENT confirmed
 *   catalog (owner answers included) and said Product Demonstration was ready and
 *   recommended first. Content Studio judged the SAME concept by rebuilding the
 *   opportunity from the planning item's FROZEN stored handoff, with no owner
 *   knowledge, and said "I recommend changing direction". Same function, two
 *   inputs, two answers about one concept — and the owner could not resolve it
 *   from either page.
 *
 *   These run against MemoryDb, which HONOURS predicates and jsonb containment.
 *   That matters here: "refreshes in place rather than creating a duplicate" is
 *   only a real assertion if the row count it checks is real.
 *
 * @security The refresh must FAIL CLOSED. It re-binds only when the item's own
 *   concept re-evaluates as executable against current evidence AND the current
 *   opportunity is still the one the owner chose; production keeps its own
 *   independent fingerprint gate, which stale evidence must still fail.
 */
import {describe,it,expect,beforeEach,vi} from 'vitest';
import {MemoryDb} from './helpers/memoryDb';

const FOUNDATION={requiresCatalog:true,catalog:{requiresCatalog:true,confirmed:[]}};
const WORKSPACE='11110000-0000-0000-0000-000000000001';
const PRODUCT  ='22220000-0000-0000-0000-000000000002';
const FOUNDER  ='33330000-0000-0000-0000-000000000003';
const PLANNING ='44440000-0000-0000-0000-000000000004';
const SERVICE  ='service-plumbing';

let db:MemoryDb;

vi.mock('../src/lib/supabaseAdmin',()=>({getSupabaseAdmin:()=>db.asClient()}));
// The heavy context pipeline is not what is under test; the CATALOG is. It is
// resolved from the live products row, so an owner saving service knowledge
// genuinely changes the context this code reads — and its fingerprint.
vi.mock('../src/lib/context/contextPackageV2',()=>({buildContextPackageV2:vi.fn(async()=>({workspaceId:WORKSPACE,productId:PRODUCT}))}));
vi.mock('../src/services/content/serviceCatalog',()=>({resolveCatalog:(row:any)=>({requiresCatalog:true,confirmed:row?.confirmed_icp?.serviceCatalog?.entries??[]})}));
vi.mock('../src/services/content/productContentContext',()=>({buildProductContentContext:(_pkg:any,foundation:any)=>({
 workspaceId:WORKSPACE,productId:PRODUCT,
 application:{description:'Connect with trusted home service professionals.'},
 founderDirection:{primaryGoal:'Bookings'},brand:{fields:{}},prohibitedTerms:[],
 offerings:[{id:SERVICE}],evidence:[],signalFoundation:foundation??null})}));
vi.mock('../src/services/opportunity/groundedOpportunity',()=>({rankGroundedOpportunities:vi.fn()}));

import {rankGroundedOpportunities} from '../src/services/opportunity/groundedOpportunity';
import {refreshPlanningItem,planningFingerprint,readSnapshot,signPlanningSnapshot,validatePlanning,planningContext,storedPlanning} from '../src/services/content/groundedPlanningWork';

/** The real AllignX shape: company-level positioning, nothing plumbing-specific. */
const GENERIC='Connect with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.';

const opportunity={
 id:'planning-f2e1386d1d688406fe81',workspaceId:WORKSPACE,productId:PRODUCT,serviceId:SERVICE,
 productService:'Plumbing',audience:'Homeowners in Phoenix',geography:'Phoenix, Arizona',
 channel:'LANDING_PAGE',growthThesis:'Convert plumbing demand into booked jobs',
 whyNow:['Search demand for plumbing is rising'],
 evidence:[{ref:'serpapi:plumber-phoenix'}],unavailable:[],
 learning:{workspace:[],patterns:[],limitation:''},
 brief:{opportunityId:'planning-f2e1386d1d688406fe81',serviceId:SERVICE,workspaceId:WORKSPACE,productId:PRODUCT,
  productTruth:GENERIC,demandEvidence:{query:'plumber phoenix'},timing:'Demand window',
  problem:'',constraints:[],memoryRefs:[]},
 concepts:[{key:'A',pattern:'PROBLEM_RECOGNITION',opportunityId:'planning-f2e1386d1d688406fe81',direction:'Recognise the situation'},
           {key:'B',pattern:'PRODUCT_DEMONSTRATION',opportunityId:'planning-f2e1386d1d688406fe81',direction:'Show the supported role'},
           {key:'C',pattern:'CUSTOMER_EDUCATION',opportunityId:'planning-f2e1386d1d688406fe81',direction:'Answer service-fit questions'}],
} as any;

/** The answers the owner gave to the questions readiness itself asked. */
const OWNER_KNOWLEDGE={
 customerProblem:'A pipe bursts or a drain backs up and they need someone the same day.',
 whatWeProvide:'AllignX matches the request to licensed plumbers nearby and confirms a visit time.',
 customerNote:'Every plumber is licence-checked before joining.'};

function productRow(ownerKnowledge:unknown){
 return {id:PRODUCT,workspace_id:WORKSPACE,name:'AllignX',markets:['usa'],archived_at:null,scraped_meta:{},
  confirmed_icp:{serviceCatalog:{entries:[{id:SERVICE,name:'Plumbing',serviceArea:{scopeDisclosure:'Phoenix metro'},
   ...(ownerKnowledge?{ownerKnowledge}:{})}]}}};
}

/** A planning item stored BEFORE the owner answered — the state on disk today. */
function planningRow(){
 const staleCtx={workspaceId:WORKSPACE,productId:PRODUCT,
  application:{description:'Connect with trusted home service professionals.'},
  founderDirection:{primaryGoal:'Bookings'},brand:{fields:{}},prohibitedTerms:[],
  offerings:[{id:SERVICE}],evidence:[],
  signalFoundation:{requiresCatalog:true,catalog:{requiresCatalog:true,
   confirmed:[{id:SERVICE,name:'Plumbing',serviceArea:{scopeDisclosure:'Phoenix metro'}}]}}} as any;
 const snapshotJson=JSON.stringify({fingerprint:planningFingerprint(staleCtx),recommendation:{selected:opportunity,foundation:FOUNDATION}});
 return {id:PLANNING,workspace_id:WORKSPACE,product_id:PRODUCT,founder_id:FOUNDER,archived_at:null,
  governance:'GOVERNED_CONTENT_INTELLIGENCE',updated_at:'2026-09-01T00:00:00.000Z',
  structured_data:{kind:'GROUNDED_PLANNING_WORK',state:'PLANNED',
   handoff:{opportunityId:opportunity.id,workspaceId:WORKSPACE,productId:PRODUCT,
    service:{id:SERVICE,name:'Plumbing'},audience:opportunity.audience,geography:opportunity.geography,
    channel:'LANDING_PAGE',growthThesis:opportunity.growthThesis,productTruth:GENERIC,
    concept:{key:'B',family:'PRODUCT_DEMONSTRATION'},groundedBrief:opportunity.brief,
    marketEvidence:{observations:opportunity.evidence},missingEvidence:[],
    marketingMemory:{context:[]},creativeIntelligence:{patterns:[],limitation:''}},
   decision:{recommendedConceptKey:'B',ownerSelectedConceptKey:'B',overridden:false,
    selectedAt:'2026-09-01T00:00:00.000Z',founderId:FOUNDER,opportunityId:opportunity.id},
   production:{ids:{opportunityId:'op-1',campaignId:'ca-1',strategyId:'st-1',briefId:'br-1'},signature:'sig'},
   snapshotJson,snapshotSignature:signPlanningSnapshot(snapshotJson)}};
}

/** Content Intelligence's answer, from the same shared function the page calls. */
async function intelligenceVerdict(ownerKnowledge:unknown){
 const {conceptFeasibility,recommendGroundedConcept}=await import('../src/services/content/groundedConceptPlanning');
 const k=ownerKnowledge as any;
 return {feasibility:conceptFeasibility(opportunity,k),recommended:recommendGroundedConcept(opportunity,k).recommendedConceptKey};
}

beforeEach(()=>{
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-signing-secret');
 vi.mocked(rankGroundedOpportunities).mockReturnValue({selected:opportunity,foundation:FOUNDATION} as any);
 db=new MemoryDb({products:[productRow(OWNER_KNOWLEDGE)],content_assets:[planningRow()]});
});

describe('a stale production brief and new owner evidence',()=>{

 it('1. reads the CURRENT catalog, not the frozen handoff — so both surfaces agree',async()=>{
  // The handoff on disk was written before the owner answered and still carries
  // only the generic company positioning. If Content Studio judged from it, B is
  // BLOCKED. It must judge from the catalog Content Intelligence reads.
  const stored=db.rows('content_assets')[0] as any;
  expect(stored.structured_data.handoff.productTruth).toBe(GENERIC);

  const intelligence=await intelligenceVerdict(OWNER_KNOWLEDGE);
  const studio=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);

  expect(intelligence.feasibility.find(f=>f.key==='B')!.state).toBe('READY');
  expect(studio!.selected!.state).toBe('READY');
  expect(studio!.selected).toEqual(intelligence.feasibility.find(f=>f.key==='B'));
  expect(intelligence.recommended).toBe('B');
 });

 it('2. a concept that was BLOCKED becomes READY, and the change-direction notice stops',async()=>{
  db.setRows('products',[productRow(null)]);
  const before=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  expect(before!.selected!.state).toBe('BLOCKED');
  expect(before!.shouldChangeDirection).toBe(true);
  expect(before).not.toHaveProperty('refreshed');

  db.setRows('products',[productRow(OWNER_KNOWLEDGE)]);
  const after=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  expect(after!.selected!.state).toBe('READY');
  expect(after!.shouldChangeDirection).toBe(false);
  expect(after!.state).toBe('CURRENT');
 });

 it('3. refreshes the EXISTING item in place — no duplicate, same id, decision and lineage kept',async()=>{
  const before=db.rows('content_assets');
  const result=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  const after=db.rows('content_assets');

  expect((result as any).refreshed).toBe(true);
  expect(after).toHaveLength(1);
  expect(after).toHaveLength(before.length);
  expect(after[0].id).toBe(PLANNING);

  const sd=(after[0] as any).structured_data;
  // The owner's choice, the recorded override and the allocated production
  // lineage are the things a "just make a new one" fix would silently destroy.
  expect(sd.decision).toEqual((before[0] as any).structured_data.decision);
  expect(sd.production).toEqual((before[0] as any).structured_data.production);
  expect(sd.kind).toBe('GROUNDED_PLANNING_WORK');
  expect(sd.state).toBe('PLANNED');
  expect(sd.handoff.concept.key).toBe('B');
 });

 it('4. the refreshed item carries current evidence and a signed current fingerprint',async()=>{
  const stale=readSnapshot((db.rows('content_assets')[0] as any).structured_data);
  await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  const sd=(db.rows('content_assets')[0] as any).structured_data;

  const ctx=await planningContext(WORKSPACE,PRODUCT,FOUNDER,await storedPlanning(WORKSPACE,PRODUCT));
  const current=planningFingerprint(ctx);
  expect(stale.fingerprint).not.toBe(current);
  // readSnapshot throws on a bad signature, so this also proves it was re-signed.
  expect(readSnapshot(sd).fingerprint).toBe(current);
  expect(()=>validatePlanning(readSnapshot(sd),ctx,opportunity.id,'B')).not.toThrow();
 });

 it('5. before the refresh, production still fails closed on the stale fingerprint',async()=>{
  const sd=(db.rows('content_assets')[0] as any).structured_data;
  const ctx=await planningContext(WORKSPACE,PRODUCT,FOUNDER,await storedPlanning(WORKSPACE,PRODUCT));
  // The gate that stops generation from running on evidence nobody confirmed.
  expect(()=>validatePlanning(readSnapshot(sd),ctx,opportunity.id,'B'))
   .toThrow(/Planning context changed/);
 });

 it('6. a concept that is STILL blocked is not re-bound and keeps recommending a change',async()=>{
  db.setRows('products',[productRow(null)]);
  const stored=(db.rows('content_assets')[0] as any).structured_data;
  const result=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);

  expect(result!.shouldChangeDirection).toBe(true);
  expect(result).not.toHaveProperty('refreshed');
  // Untouched: a blocked brief must not be silently rebound to evidence that
  // still cannot execute it.
  expect((db.rows('content_assets')[0] as any).structured_data).toEqual(stored);
 });
});

describe('fail-closed refresh',()=>{
 it('a changed opportunity is not rebound; the owner is sent back to choose',async()=>{
  vi.mocked(rankGroundedOpportunities).mockReturnValue({selected:{...opportunity,id:'a-different-opportunity'},foundation:FOUNDATION} as any);
  const stored=(db.rows('content_assets')[0] as any).structured_data;
  const result=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  expect(result!.state).toBe('CANNOT_REFRESH');
  expect(result!.selected).toBeNull();
  expect(result!.ownerAction).toMatch(/Content Intelligence/);
  expect((db.rows('content_assets')[0] as any).structured_data).toEqual(stored);
 });

 it('an unavailable context reports an owner action instead of throwing',async()=>{
  db.setRows('products',[]);
  const result=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  expect(result!.state).toBe('CANNOT_REFRESH');
  expect(result!.ownerAction).toBeTruthy();
 });

 it('another workspace cannot refresh this item',async()=>{
  expect(await refreshPlanningItem(PLANNING,'99990000-0000-0000-0000-000000000099',FOUNDER)).toBeNull();
 });
});

describe('what the rebind carries forward',()=>{
 it('retires a FAILED attempt rather than telling the owner it failed on the new brief',async()=>{
  const row=planningRow();
  (row.structured_data as any).generation={attemptId:'a1',status:'NEEDS_ATTENTION',reason:'UNSUPPORTED_WORDING',finishedAt:'2026-09-01T01:00:00.000Z'};
  db.setRows('content_assets',[row]);
  await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  const sd=(db.rows('content_assets')[0] as any).structured_data;
  // Cleared from the surface, kept on the record.
  expect(sd.generation).toBeNull();
  expect(sd.supersededGenerations).toHaveLength(1);
  expect(sd.supersededGenerations[0].attemptId).toBe('a1');
  expect(sd.supersededGenerations[0].supersededBecause).toBe('GENERATED_AGAINST_SUPERSEDED_EVIDENCE');
 });

 it('never discards a real draft',async()=>{
  const row=planningRow();
  const generation={attemptId:'a2',status:'READY_FOR_REVIEW',assetId:'asset-1',versionNumber:1};
  (row.structured_data as any).generation=generation;
  db.setRows('content_assets',[row]);
  const result=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  expect((result as any).refreshed).toBe(true);
  expect((db.rows('content_assets')[0] as any).structured_data.generation).toEqual(generation);
 });

 it('does not rebind underneath a run that is in flight',async()=>{
  const row=planningRow();
  (row.structured_data as any).generation={attemptId:'a3',status:'CREATING',startedAt:'2026-09-08T00:00:00.000Z'};
  db.setRows('content_assets',[row]);
  const stored=(db.rows('content_assets')[0] as any).structured_data;
  const result=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  expect(result!.selected!.state).toBe('READY');   // still reports the truth
  expect(result).not.toHaveProperty('refreshed');  // but changes nothing under the run
  expect((db.rows('content_assets')[0] as any).structured_data).toEqual(stored);
 });
});

describe('a failure that belongs to an older context',()=>{
 /** Reads the item the way the studio route does: refresh, then read state. */
 async function stateAfterRefresh(){
  const r=await refreshPlanningItem(PLANNING,WORKSPACE,FOUNDER);
  const {productionState}=await import('../src/services/content/planningProductionState');
  return {result:r,sd:(db.rows('content_assets')[0] as any).structured_data,
   state:productionState((db.rows('content_assets')[0] as any).structured_data)};
 }

 it('4. is superseded even when the brief was already rebound, and is kept as history',async()=>{
  // The live shape: an item rebound to current evidence still carrying a
  // failure recorded before that evidence existed. The fingerprint no longer
  // changes, so this must not depend on a rebind happening now.
  const row=planningRow();
  const sd=row.structured_data as any;
  const ctx=await planningContext(WORKSPACE,PRODUCT,FOUNDER,await storedPlanning(WORKSPACE,PRODUCT));
  const current=planningFingerprint(ctx);
  const snapshotJson=JSON.stringify({fingerprint:current,recommendation:{selected:opportunity,foundation:FOUNDATION}});
  sd.snapshotJson=snapshotJson;sd.snapshotSignature=signPlanningSnapshot(snapshotJson);
  sd.generation={attemptId:'old',status:'NEEDS_ATTENTION',reason:'UNSUPPORTED_WORDING',
   finishedAt:'2026-09-07T23:43:41.605Z'};   // no contextFingerprint: predates the stamp
  db.setRows('content_assets',[row]);

  const {result,sd:after}=await stateAfterRefresh();
  expect((result as any).supersededFailedGeneration).toBe(true);
  expect((result as any).refreshed).toBeUndefined();          // nothing to rebind
  expect(after.supersededGenerations).toHaveLength(1);
  expect(after.supersededGenerations[0].attemptId).toBe('old');
  expect(after.supersededGenerations[0].supersededBecause).toBe('GENERATED_AGAINST_SUPERSEDED_EVIDENCE');
  expect(after.decision).toEqual((planningRow().structured_data as any).decision);
 });

 it('5. leaves the item in READY_TO_CREATE',async()=>{
  const row=planningRow();
  (row.structured_data as any).generation={attemptId:'old',status:'NEEDS_ATTENTION',reason:'FORMAT'};
  db.setRows('content_assets',[row]);
  const {state,result}=await stateAfterRefresh();
  expect(state).toBe('READY_TO_CREATE');
  expect(result!.shouldChangeDirection).toBe(false);
 });

 it('6. a valid current generated artifact is never discarded',async()=>{
  const row=planningRow();
  const generation={attemptId:'good',status:'READY_FOR_REVIEW',assetId:'asset-1',versionNumber:2};
  (row.structured_data as any).generation=generation;
  db.setRows('content_assets',[row]);
  const {sd,state}=await stateAfterRefresh();
  expect(sd.generation).toEqual(generation);
  expect(sd.supersededGenerations).toBeUndefined();
  expect(state).toBe('READY_FOR_REVIEW');
 });

 it('a failure recorded against CURRENT evidence stays visible',async()=>{
  const row=planningRow();
  const sd=row.structured_data as any;
  const ctx=await planningContext(WORKSPACE,PRODUCT,FOUNDER,await storedPlanning(WORKSPACE,PRODUCT));
  const current=planningFingerprint(ctx);
  const snapshotJson=JSON.stringify({fingerprint:current,recommendation:{selected:opportunity,foundation:FOUNDATION}});
  sd.snapshotJson=snapshotJson;sd.snapshotSignature=signPlanningSnapshot(snapshotJson);
  // Stamped with the fingerprint it actually ran against: it failed on today's
  // evidence, so "Try again" is the honest state and must not be cleared.
  sd.generation={attemptId:'today',status:'NEEDS_ATTENTION',reason:'FORMAT',contextFingerprint:current};
  db.setRows('content_assets',[row]);
  const {sd:after,state}=await stateAfterRefresh();
  expect(after.generation.attemptId).toBe('today');
  expect(after.supersededGenerations).toBeUndefined();
  expect(state).toBe('NEEDS_ATTENTION');
 });

 it('retires a refinement failure when the production contract version changes',async()=>{
  const row=planningRow();
  const sd=row.structured_data as any;
  const ctx=await planningContext(WORKSPACE,PRODUCT,FOUNDER,await storedPlanning(WORKSPACE,PRODUCT));
  sd.generation={attemptId:'old-contract',status:'NEEDS_ATTENTION',reason:'CONTENT_REFINEMENT_REQUIRED',contextFingerprint:'pre-customer-story-contract'};
  db.setRows('content_assets',[row]);
  const {sd:after,state}=await stateAfterRefresh();
  expect(state).toBe('READY_TO_CREATE');
  expect(after.supersededGenerations[0]).toMatchObject({attemptId:'old-contract',reason:'CONTENT_REFINEMENT_REQUIRED'});
 });
});
