import {it,expect,vi} from 'vitest';
vi.mock('../src/services/opportunity/groundedOpportunity',()=>({rankGroundedOpportunities:vi.fn()}));
import {rankGroundedOpportunities} from '../src/services/opportunity/groundedOpportunity';
import {planningFingerprint,validatePlanning,signPlanningSnapshot,readSnapshot} from '../src/services/content/groundedPlanningWork';
import {recommendGroundedConcept,buildGroundedConceptHandoff} from '../../lib/groundedConceptPlanning';
const ctx={workspaceId:'w',productId:'p',application:{description:'Supported product role'},founderDirection:{primaryGoal:'Bookings'},brand:{fields:{}},offerings:[{id:'s'}],evidence:[],signalFoundation:{catalog:{confirmed:[]}}} as any;
const g={id:'op',workspaceId:'w',productId:'p',serviceId:'s',productService:'Service',channel:'LANDING_PAGE',brief:{opportunityId:'op',serviceId:'s',workspaceId:'w',productId:'p',productTruth:'Supported role'},whyNow:['Demand is strong'],learning:{patterns:[],workspace:[]},concepts:['PROBLEM_RECOGNITION','PRODUCT_DEMONSTRATION','CUSTOMER_EDUCATION'].map((pattern,i)=>({key:['A','B','C'][i],pattern,opportunityId:'op'}))} as any;
// Feasibility now gates the strategic mapping, so the fixture carries the
// evidence a Product Demonstration actually needs: service-specific truth, a
// confirmed audience and a demand signal. The intent under test is unchanged —
// the recommendation must not move with demand score.
// Carries every input the shared contract requires: service-specific truth (B),
// audience + a real customer problem (A), demand (strengthens A).
const executable={...g,productService:'Plumbing',audience:'Owners',evidence:[{ref:'e'}],
 brief:{...g.brief,productTruth:'AllignX connects you with licensed plumbing specialists for leaks and burst pipes.',
  problem:'Reaching customers after they submit a request',demandEvidence:{query:'plumber'}}} as any;
it('selects product demonstration for explanation with truth, independent of demand',()=>{const a=recommendGroundedConcept(executable),b=recommendGroundedConcept({...executable,whyNow:['No demand value'],score:999});expect(a).toEqual(b);expect(a.recommendedConceptKey).toBe('B');expect(a.performanceBacked).toBe(false);});
it('changes with truth and channel rather than hardcoding B — and refuses to recommend what it cannot execute',()=>{
 // Same opportunity, service truth removed: B is no longer executable, so it
 // is no longer recommended. Problem Recognition still is.
 const noServiceTruth={...executable,brief:{...executable.brief,productTruth:'Connect with trusted home service professionals.'}} as any;
 expect(recommendGroundedConcept(noServiceTruth).recommendedConceptKey).toBe('A');
 expect(recommendGroundedConcept({...executable,channel:'META_AD'}).recommendedConceptKey).toBe('A');
 // Nothing to build on at all: ask the owner rather than recommend production.
 const nothing={...g,audience:'',evidence:[],brief:{...g.brief,productTruth:'',demandEvidence:null}} as any;
 expect(recommendGroundedConcept(nothing).needsOwnerInput).toBe(true);
 expect(recommendGroundedConcept(nothing).recommendedConceptKey).toBeNull();});
it('validates matching current scope and carries selected lineage',()=>{vi.mocked(rankGroundedOpportunities).mockReturnValue({selected:g} as any);const snapshot={fingerprint:planningFingerprint(ctx),recommendation:{selected:g}};expect(validatePlanning(snapshot,ctx,'op','C')).toBe(g);const handoff=buildGroundedConceptHandoff(g,'C');expect(handoff.opportunityId).toBe('op');expect(handoff.concept.family).toBe('CUSTOMER_EDUCATION');expect(handoff.productionAuthorized).toBe(false);});
it('rejects stale context, wrong workspace/product/opportunity/concept and expired evidence',()=>{vi.mocked(rankGroundedOpportunities).mockReturnValue({selected:g} as any);const snapshot={fingerprint:planningFingerprint(ctx),recommendation:{selected:g}};expect(()=>validatePlanning(snapshot,{...ctx,application:{description:'Changed'}},'op','B')).toThrow();expect(()=>validatePlanning(snapshot,{...ctx,workspaceId:'other'},'op','B')).toThrow();expect(()=>validatePlanning(snapshot,{...ctx,productId:'other'},'op','B')).toThrow();expect(()=>validatePlanning(snapshot,ctx,'old','B')).toThrow();expect(()=>validatePlanning(snapshot,ctx,'op','Z')).toThrow();vi.mocked(rankGroundedOpportunities).mockReturnValue({selected:null} as any);expect(()=>validatePlanning(snapshot,ctx,'op','B')).toThrow();});

it('preserves provenance serialization and rejects a tampered stored snapshot',()=>{vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-signing-secret');try{const snapshotJson=JSON.stringify({z:{b:2,a:1},recommendation:{selected:g}}),snapshotSignature=signPlanningSnapshot(snapshotJson);expect(JSON.stringify(readSnapshot({snapshotJson,snapshotSignature}))).toBe(snapshotJson);expect(()=>readSnapshot({snapshotJson:snapshotJson.replace('test-signing-secret','x')+' ',snapshotSignature})).toThrow();}finally{vi.unstubAllEnvs();}});
