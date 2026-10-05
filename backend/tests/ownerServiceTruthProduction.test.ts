/**
 * @file ownerServiceTruthProduction.test.ts
 * @description Proves owner-confirmed service knowledge reaches PRODUCTION, not
 *   just the readiness decision.
 *
 *   THE DEFECT. LaunchMind asked the owner what the product does for Plumbing,
 *   used the answer to decide Product Demonstration was executable, and then
 *   briefed generation with company-level positioning only —
 *   "Connect with trusted, vetted home service professionals" — which is true of
 *   every service and specific to none. The concept was READY on evidence the
 *   writer was never shown, so the only copy it could produce was the generic
 *   filler the creative gate then rejected.
 *
 *   One governed source: the confirmed catalog entry. ownerConfirmedServiceTruth()
 *   derives it; readiness, the handoff, the capability contract, the production
 *   contract and the generation input all read that derivation.
 *
 * @security Service-level truth stays DISTINCT from company-level truth
 *   throughout, and admissibility is unchanged — the capability vocabulary is
 *   closed, so owner wording can never become a stronger claim than the owner
 *   made. Unconfirmed catalog entries supply nothing.
 */
import {describe,it,expect} from 'vitest';
import {ownerConfirmedServiceTruth,productionServiceTruth,resolveCatalog} from '../src/services/content/serviceCatalog';
import {buildProductCapabilityContract} from '../src/services/content/productCapabilityContract';
import {availableInputs,conceptFeasibility,buildGroundedConceptHandoff} from '../src/services/content/groundedConceptPlanning';
import {composePlanningProduction} from '../src/services/content/planningProductionContract';
import {buildChannelPrompt} from '../src/services/content/b3ContentGeneration';

/** The real answers the AllignX owner typed, verbatim from the confirmed catalog. */
const OWNER_KNOWLEDGE={
 customerSituation:'when customer have plumbing problem, they go to allignx app or web and create plumbing service request',
 whatWeProvide:'allignx customer service will look for a plumbing service provider and connect him with the customer. they finalize the price and plumber will go and fix the issue and get paid in cash or CC on the app/ web.',
 customerValue:'Customers can start a Plumbing request in AllignX while customer service looks for a provider.',
 confirmedBy:'8a292044-5b22-42e5-90d0-65e6cc3d7321',confirmedAt:'2026-09-08T07:42:21.316Z'};
/** COMPANY-level. Reads identically for electricians or landscapers. */
const GENERIC='Connect with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.';

const entry={id:'svc-plumbing',name:'Plumbing',ownerKnowledge:OWNER_KNOWLEDGE};
const truth=ownerConfirmedServiceTruth(entry)!;

const ctx={workspaceId:'w',productId:'p',
 application:{name:'AllignX',description:GENERIC,markets:['usa']},
 founderDirection:{primaryGoal:'Bookings',audienceConfirmed:'Homeowners'},
 brand:{fields:{}},prohibitedTerms:[],offerings:[{id:'svc-plumbing'}],evidence:[],
 authorizedAssets:[],marketIntelligenceAvailable:false,destination:null,
 signalFoundation:{catalog:{requiresCatalog:true,confirmed:[entry]}}} as any;

const opportunity={id:'op',workspaceId:'w',productId:'p',serviceId:'svc-plumbing',
 productService:'Plumbing',audience:'Homeowners',geography:'Phoenix, Arizona',channel:'LANDING_PAGE',
 growthThesis:'Explain Plumbing',whyNow:['demand'],evidence:[{ref:'e'}],unavailable:[],
 learning:{workspace:[],patterns:[],limitation:''},
 brief:{opportunityId:'op',serviceId:'svc-plumbing',workspaceId:'w',productId:'p',
  productTruth:GENERIC,serviceTruth:truth,demandEvidence:{query:'plumber'},problem:'',
  constraints:[],memoryRefs:[],timing:'window'},
 concepts:[{key:'B',pattern:'PRODUCT_DEMONSTRATION',opportunityId:'op',direction:'Explain the supported role'}]} as any;

describe('owner-confirmed service truth reaches production',()=>{

 it('1. is present in the server-side production contract for the concept that requires it',()=>{
  const handoff=buildGroundedConceptHandoff(opportunity,'B');
  const contract={planningWorkId:'pl',opportunityId:'op',channel:'LANDING_PAGE' as const,
   handoff,decision:{},capabilities:buildProductCapabilityContract(ctx)};
  const composed=composePlanningProduction(contract as any,ctx);
  // The sentence the owner actually wrote, in the brief generation is built from.
  expect(composed.architecture.productRole).toContain('look for a plumbing service provider');
  expect(composed.architecture.productRole).not.toContain('finalize the price');
  // The confirmed customer value becomes the primary customer-facing angle.
  expect(composed.architecture.primaryBenefit).toContain('Customers can start a Plumbing request');
 });

 it('2. SERVICE_PRODUCT_TRUTH stays distinct from generic PRODUCT_TRUTH',()=>{
  const handoff=buildGroundedConceptHandoff(opportunity,'B');
  // Two fields, two provenances — never merged into one blob.
  expect(handoff.productTruth).toBe(GENERIC);
  expect(handoff.serviceTruth!.provenance).toBe('OWNER_CONFIRMED');
  expect(handoff.serviceTruth!.serviceName).toBe('Plumbing');
  expect(handoff.serviceTruth!.statements.map(s=>s.text).join(' ')).not.toContain('home service professionals');

  const composed=composePlanningProduction({handoff,capabilities:null} as any,ctx);
  // Company-level truth survives the service-level truth taking the lead.
  expect(composed.architecture.productRole).toContain('Company-level:');
  expect(composed.architecture.productRole).toContain(GENERIC);

  // And in the capability contract the two sources stay attributable.
  const capabilities=buildProductCapabilityContract(ctx).capabilities;
  const provenances=new Set(capabilities.map(c=>c.provenance));
  expect(provenances.has('PRODUCT_DESCRIPTION')).toBe(true);
  expect(capabilities.some(c=>c.provenance==='OWNER_CONFIRMED_SERVICE_KNOWLEDGE'
   &&c.sourceService==='Plumbing')).toBe(true);
 });

 it('3. the generation input receives the current service-specific truth',()=>{
  const handoff=buildGroundedConceptHandoff(opportunity,'B');
  // Exactly the object the studio route hands b3 as groundedContext.
  const groundedContext={service:handoff.service.name,concept:handoff.concept.family,
   geography:handoff.geography,demandScope:'x',growthThesis:handoff.growthThesis,
   productTruth:handoff.productTruth,serviceTruth:handoff.serviceTruth,missingEvidence:[]};
  const statements=(groundedContext.serviceTruth?.statements??[]).map(s=>s.text);
  expect(statements.some(t=>t.includes('plumbing service provider'))).toBe(true);
  expect(groundedContext.productTruth).toBe(GENERIC);
  // Changing the owner's answer changes what generation is given.
  const revised=ownerConfirmedServiceTruth({...entry,
   ownerKnowledge:{...OWNER_KNOWLEDGE,whatWeProvide:'we dispatch a licensed plumber within two hours'}})!;
  expect(revised.statements.map(s=>s.text).join(' ')).toContain('within two hours');
  expect(revised.statements.map(s=>s.text).join(' ')).not.toContain('finalize the price');
 });

 it('4. the final model input uses the same admissible projection as capability revalidation',()=>{
  const handoff=buildGroundedConceptHandoff(opportunity,'B');
  const composed=composePlanningProduction({handoff,capabilities:null} as any,ctx);
  const prompt=buildChannelPrompt({ctx,founderId:'f',brief:composed.brief,strategy:composed.strategy,
    groundedContext:{service:handoff.service.name,concept:handoff.concept.family,geography:handoff.geography,
      demandScope:'US-AZ',growthThesis:handoff.growthThesis,productTruth:handoff.productTruth,
      serviceTruth:handoff.serviceTruth,missingEvidence:[]}} as any);
  expect(prompt.system).toContain('look for a plumbing service provider');
  expect(prompt.system).toContain('PRIMARY CUSTOMER VALUE');
  expect(prompt.system).toContain(OWNER_KNOWLEDGE.customerValue);
  expect(prompt.user).toContain('create plumbing service request');
  for(const forbidden of ['finalize the price','get paid','cash','fix the issue']){
   expect(prompt.system).not.toContain(forbidden);
   expect(prompt.user).not.toContain(forbidden);
  }
 });

 it('makes the confirmed customer value the Product Demonstration target without exposing withheld mechanics',()=>{
  const handoff=buildGroundedConceptHandoff(opportunity,'B');
  const composed=composePlanningProduction({handoff,capabilities:null} as any,ctx);
  const prompt=buildChannelPrompt({ctx,founderId:'f',brief:composed.brief,strategy:composed.strategy,
   groundedContext:{service:'Plumbing',concept:'PRODUCT_DEMONSTRATION',geography:handoff.geography,demandScope:'US-AZ',growthThesis:handoff.growthThesis,productTruth:handoff.productTruth,serviceTruth:handoff.serviceTruth,missingEvidence:[]}} as any);
  expect(prompt.system).toContain('Lead the H1 or subhead with it');
  for(const forbidden of ['finalize the price','get paid','cash','fix the issue'])expect(`${prompt.system}\n${prompt.user}`).not.toContain(forbidden);
 });

 it('7. stale or unconfirmed owner data cannot silently enter production',()=>{
  // An entry the owner has not answered supplies nothing — not an empty string.
  expect(ownerConfirmedServiceTruth({id:'s',name:'Electrical'})).toBeNull();
  expect(ownerConfirmedServiceTruth({id:'s',name:'HVAC',ownerKnowledge:{}})).toBeNull();
  expect(ownerConfirmedServiceTruth({id:'s',name:'Handyman',ownerKnowledge:{whatWeProvide:'   '}})).toBeNull();

  // A DISCOVERED_UNCONFIRMED entry never reaches the confirmed catalog at all,
  // so knowledge attached to one cannot become production truth.
  const catalog=resolveCatalog({id:'p',confirmed_icp:{serviceCatalog:{confirmedBy:'f',confirmedAt:'t',
   entries:[{name:'Plumbing',status:'DISCOVERED_UNCONFIRMED',ownerKnowledge:OWNER_KNOWLEDGE}]}}});
  expect(catalog.confirmed).toHaveLength(0);
  const noTruth=buildProductCapabilityContract({...ctx,signalFoundation:{catalog}} as any);
  expect(noTruth.capabilities.some(c=>c.provenance==='OWNER_CONFIRMED_SERVICE_KNOWLEDGE')).toBe(false);

  // Owner wording is admissible, not unbounded: only the CLOSED vocabulary is
  // extracted, so "finalize the price" and "get paid" grant no such capability.
 const verbs=buildProductCapabilityContract(ctx).capabilities.map(c=>c.verb);
  expect(verbs).not.toContain('finalize');
  expect(verbs).not.toContain('pay');
 });

 it('projects only admissible Plumbing facts for production while retaining the raw catalog truth',()=>{
  const projected=productionServiceTruth(truth);
  expect(projected.truth?.statements.map(s=>s.text).join(' ')).toContain('look for a plumbing service provider');
  expect(projected.truth?.statements.map(s=>s.text).join(' ')).toContain('create plumbing service request');
  expect(projected.truth?.statements.map(s=>s.text).join(' ')).not.toMatch(/price|paid|cash|fix the issue/i);
  expect(projected.withheld.map(f=>f.text).join(' ')).toMatch(/finalize the price|fix the issue|get paid/i);
  expect(truth.statements.map(s=>s.text).join(' ')).toMatch(/finalize the price/);
  const contract=buildProductCapabilityContract(ctx);
  expect(contract.capabilities.map(c=>c.verb)).not.toContain('price');
  expect(contract.capabilities.map(c=>c.sourceText).join(' ')).not.toMatch(/price|paid|cash|fix the issue/i);
 });

 it('feeds readiness through the governed object, not only a side channel',()=>{
  // No `knowledge` argument at all — the same fact arrives on the brief, which
  // is what a persisted planning item and production actually hold.
  const inputs=availableInputs(opportunity);
  expect(inputs.has('SERVICE_PRODUCT_TRUTH')).toBe(true);
  expect(inputs.has('CUSTOMER_VALUE')).toBe(true);
  expect(conceptFeasibility(opportunity).find(f=>f.key==='B')!.state).toBe('READY');

  // Strip it and B is blocked again — the truth is doing the work, not a default.
  const without={...opportunity,brief:{...opportunity.brief,serviceTruth:null}};
  expect(conceptFeasibility(without).find(f=>f.key==='B')!.state).toBe('BLOCKED');
 });
});

describe('carrying service truth must not invalidate reserved production lineage',()=>{
 it('the concept rationale — and therefore the campaign thesis — is identical with and without owner truth',()=>{
  // MEASURED, not theoretical: routing service truth through concept.rationale
  // changed candidate.messageAngle, which IS campaign.thesis, which
  // validateProductionRows compares byte-for-byte against the persisted row.
  // Every planning item with an allocated lineage answered 409 instead of
  // refreshing. Service truth therefore travels on recomposed fields only.
  const withTruth=buildGroundedConceptHandoff(opportunity,'B');
  const without=buildGroundedConceptHandoff(
   {...opportunity,brief:{...opportunity.brief,serviceTruth:null}} as any,'B');
  expect(withTruth.concept.rationale).toBe(without.concept.rationale);

  const thesisOf=(h:any)=>composePlanningProduction({handoff:h} as any,ctx).architecture.thesis;
  expect(thesisOf(withTruth)).toBe(thesisOf(without));
  expect(composePlanningProduction({handoff:withTruth} as any,ctx).candidate.title)
   .toBe(composePlanningProduction({handoff:without} as any,ctx).candidate.title);

  // It reaches generation on the recomposed brief instead.
  const brief=composePlanningProduction({handoff:withTruth} as any,ctx).brief;
  expect(brief.hookDirection).toContain('plumbing service provider');
  expect(brief.hookDirection).not.toMatch(/price|paid|cash|fix the issue/i);
  expect(composePlanningProduction({handoff:without} as any,ctx).brief.hookDirection)
   .not.toContain('plumbing service provider');
 });
});
