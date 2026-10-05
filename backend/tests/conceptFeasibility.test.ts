/**
 * @file conceptFeasibility.test.ts
 * @description Concept feasibility — the fix for recommending a concept
 *   LaunchMind cannot execute.
 *
 *   MEASURED: feasibility used to be `productTruth.trim().length > 0`, so
 *   AllignX's company-level marketplace sentence selected PRODUCT_DEMONSTRATION
 *   for Plumbing while LaunchMind held nothing plumbing-specific to
 *   demonstrate. Six owner retries followed. Deterministic throughout: these
 *   tests make no provider call.
 */
import { describe, it, expect } from 'vitest';
import { conceptFeasibility, recommendGroundedConcept }
  from '../src/services/content/groundedConceptPlanning';

const CONCEPTS=[
  {key:'A',pattern:'PROBLEM_RECOGNITION',direction:'',opportunityId:'o'},
  {key:'B',pattern:'PRODUCT_DEMONSTRATION',direction:'',opportunityId:'o'},
  {key:'C',pattern:'CUSTOMER_EDUCATION',direction:'',opportunityId:'o'},
];
/** The REAL AllignX product truth, verbatim. */
const GENERIC='Connect with trusted, vetted home service professionals in your neighborhood — quickly, safely, and conveniently.';
const opp=(over:any={}):any=>({id:'o',serviceId:'s',productService:'Plumbing',audience:'Professionals and entrepreneurs seeking efficiency',
  geography:'Phoenix, Arizona',channel:'LANDING_PAGE',whyNow:['demand'],growthThesis:'t',
  brief:{productTruth:GENERIC,demandEvidence:{query:'plumber'},concepts:CONCEPTS,opportunityId:'o',serviceId:'s'},
  evidence:[{ref:'e',kind:'MARKET_INTELLIGENCE'}],unavailable:[],
  learning:{workspace:['Primary goal: custom → 20 bookings / month'],patterns:[],limitation:''},
  concepts:CONCEPTS,...over});
const state=(g:any,k:string)=>conceptFeasibility(g).find(f=>f.key===k)!.state;

describe('feasibility classification', () => {
  it('generic company truth does NOT make Product Demonstration executable', () => {
    expect(state(opp(),'B')).toBe('BLOCKED');
  });

  it('Problem Recognition is NOT ready on audience + demand alone — it needs a real problem', () => {
    // MEASURED: this was previously READY, the owner accepted it, and generation
    // failed. Audience says WHO and demand says they are looking; neither
    // supplies a situation to recognise. `brief.problem` here is the template
    // groundedOpportunity emits when it has nothing better.
    expect(state(opp({brief:{...opp().brief,problem:"Understanding how Plumbing fits a customer's need"}}),'A')).toBe('BLOCKED');
  });

  it('Problem Recognition becomes READY once a real customer problem exists', () => {
    const g=opp({brief:{...opp().brief,problem:'Reaching customers after they submit a request'}});
    expect(state(g,'A')).toBe('READY');
  });

  it('Customer Education is LIMITED on generic truth — answerable, but not specifically', () => {
    expect(state(opp(),'C')).toBe('LIMITED');
  });

  it('service-specific product truth makes Product Demonstration READY', () => {
    const g=opp({brief:{...opp().brief,
      productTruth:'AllignX connects you with licensed plumbing specialists who handle leaks, burst pipes and water-heater repair.'}});
    expect(state(g,'B')).toBe('READY');
    expect(state(g,'C')).toBe('READY');
  });

  it('search demand is never counted as product differentiation', () => {
    // Abundant demand evidence, still no product truth about the service.
    const g=opp({evidence:[{ref:'1'},{ref:'2'},{ref:'3'}]});
    expect(state(g,'B')).toBe('BLOCKED');
  });

  it('a different service with its own truth is judged on its own evidence — nothing is hardcoded', () => {
    const g=opp({productService:'Electrical',brief:{...opp().brief,
      productTruth:'AllignX connects you with certified electrical contractors for panel upgrades and rewiring.'}});
    expect(state(g,'B')).toBe('READY');
    // And the same fixture without electrical truth is blocked.
    expect(state(opp({productService:'Electrical'}),'B')).toBe('BLOCKED');
  });
});

describe('recommendation = strategic fit + feasibility', () => {
  const withProblem=()=>opp({brief:{...opp().brief,problem:'Reaching customers after they submit a request'}});

  it('does not recommend the best-fitting concept it cannot execute', () => {
    const r=recommendGroundedConcept(withProblem());
    expect(r.recommendedConceptKey).toBe('A');          // not B — B has no service truth
    expect(r.policyVersion).toBe('concept-fit-v2');
    expect(r.needsOwnerInput).toBe(false);
  });

  it('with the REAL current evidence, nothing is ready and it asks instead of recommending', () => {
    // The honest state of the actual AllignX Plumbing opportunity.
    const r=recommendGroundedConcept(opp({brief:{...opp().brief,problem:"Understanding how Plumbing fits a customer's need"}}));
    expect(r.needsOwnerInput).toBe(true);
    expect(r.recommendedConceptKey).toBeNull();
  });

  it('explains itself in owner language, without governance vocabulary', () => {
    const basis=recommendGroundedConcept(withProblem()).recommendationBasis.join(' ');
    expect(basis).toMatch(/service-specific product detail/i);
    for(const jargon of ['UNSUPPORTED','capability','evidence handle','validator','governance','CONCEPT_CONTRACTS'])
      expect(basis).not.toContain(jargon);
  });

  it('a well-grounded Product Demonstration is still recommended first', () => {
    const g=opp({brief:{...opp().brief,
      productTruth:'AllignX connects you with licensed plumbing specialists who handle leaks and burst pipes.'}});
    expect(recommendGroundedConcept(g).recommendedConceptKey).toBe('B');
  });

  it('when nothing is executable it asks the owner instead of recommending production', () => {
    // No product truth, no audience, no demand — nothing to build on.
    const g=opp({audience:'',evidence:[],brief:{...opp().brief,productTruth:'',demandEvidence:null},
      learning:{workspace:[],patterns:[],limitation:''}});
    const r=recommendGroundedConcept(g);
    expect(r.needsOwnerInput).toBe(true);
    expect(r.recommendedConceptKey).toBeNull();
    expect(r.recommendationBasis.join(' ')).toMatch(/don’t yet have enough confirmed information/i);
  });
});

// The four tests that lived here evaluated a PERSISTED planning item through
// planningFeasibility(handoff) — the frozen stored handoff, with no owner
// knowledge. That input was the defect: Content Intelligence answered the same
// question from the CURRENT confirmed catalog, so one concept could be READY on
// one page and BLOCKED on the other. The evaluator is gone; a persisted item is
// now re-evaluated (and re-bound) by refreshPlanningItem against current
// evidence, and is covered by tests/planningRefresh.test.ts. These tests are not
// preserved here because they encoded the wrong input, not because they failed.

describe('one shared contract — readiness and production cannot disagree', () => {
  it('every concept family declares its required inputs AND its execution instruction', async () => {
    const {CONCEPT_CONTRACTS}=await import('../src/services/content/groundedConceptPlanning');
    for(const family of ['PROBLEM_RECOGNITION','PRODUCT_DEMONSTRATION','CUSTOMER_EDUCATION']){
      const c=CONCEPT_CONTRACTS[family];
      expect(c,`${family} has no contract`).toBeTruthy();
      expect(c.requires.length,`${family} requires nothing`).toBeGreaterThan(0);
      expect(c.execution.length,`${family} has no execution instruction`).toBeGreaterThan(20);
      expect(typeof c.objective('Plumbing')).toBe('string');
    }
  });

  it('Problem Recognition is told to open on the situation, never to explain the product', async () => {
    // THE MEASURED MISMATCH: the prompt said "Explain the supported product
    // role" for every landing page, so this concept produced Product
    // Demonstration copy and failed for want of service truth it never needed.
    const {CONCEPT_CONTRACTS}=await import('../src/services/content/groundedConceptPlanning');
    const pr=CONCEPT_CONTRACTS.PROBLEM_RECOGNITION.execution;
    expect(pr).toMatch(/customer situation/i);
    expect(pr).toMatch(/not the product/i);
    expect(CONCEPT_CONTRACTS.PRODUCT_DEMONSTRATION.execution).toMatch(/supported product role/i);
    expect(pr).not.toBe(CONCEPT_CONTRACTS.PRODUCT_DEMONSTRATION.execution);
  });

  it('the generation prompt carries the CONCEPT execution line, not a fixed channel one', async () => {
    const {buildChannelPrompt}=await import('../src/services/content/b3ContentGeneration');
    const base:any={ctx:{workspaceId:'w',productId:'p',application:{name:'AllignX',description:'Connect with vetted professionals.'},
      brand:{fields:{}},founderDirection:{competitors:[]},evidence:[],prohibitedTerms:[]},
      founderId:'f',strategy:{campaignThesis:'t',coreNarrative:'n'},
      brief:{channel:'LANDING_PAGE',audience:'a',proofAvailable:[],proofUnavailable:[],ownerConfirmationRequired:[],
        brandConstraints:[],channelConstraints:[],prohibitedTerminology:[],objective:'o',message:'m',hookDirection:'h'}};
    const problem=buildChannelPrompt({...base,groundedContext:{service:'Plumbing',concept:'PROBLEM_RECOGNITION'}}).system;
    const demo=buildChannelPrompt({...base,groundedContext:{service:'Plumbing',concept:'PRODUCT_DEMONSTRATION'}}).system;
    expect(problem).toMatch(/Open on the customer situation/i);
    expect(problem).not.toMatch(/LANDING-PAGE EXECUTION: Explain the supported product role/i);
    expect(demo).toMatch(/Explain the supported product role/i);
  });

  it('production preparation takes its opportunity type and objective from the same contract', async () => {
    const {CONCEPT_CONTRACTS}=await import('../src/services/content/groundedConceptPlanning');
    // Distinct per family — a Problem Recognition brief must not be prepared as
    // a PRODUCT_BENEFIT opportunity, which is what produced the mismatch.
    expect(CONCEPT_CONTRACTS.PROBLEM_RECOGNITION.opportunityType).toBe('PROBLEM_AWARENESS');
    expect(CONCEPT_CONTRACTS.PRODUCT_DEMONSTRATION.opportunityType).toBe('PRODUCT_BENEFIT');
    expect(CONCEPT_CONTRACTS.PROBLEM_RECOGNITION.objective('Plumbing'))
      .not.toBe(CONCEPT_CONTRACTS.PRODUCT_DEMONSTRATION.objective('Plumbing'));
  });
});

describe('the owner answering closes the loop', () => {
  const templated=()=>opp({brief:{...opp().brief,problem:"Understanding how Plumbing fits a customer's need"}});

  it('owner-stated situation supplies the missing CUSTOMER_PROBLEM', async () => {
    const {availableInputs}=await import('../src/services/content/groundedConceptPlanning');
    expect(availableInputs(templated()).has('CUSTOMER_PROBLEM')).toBe(false);
    expect(availableInputs(templated(),{customerSituation:'A pipe bursts on a Sunday and no one answers the phone.'})
      .has('CUSTOMER_PROBLEM')).toBe(true);
  });

  it('owner-stated service detail supplies the missing SERVICE_PRODUCT_TRUTH', async () => {
    const {availableInputs}=await import('../src/services/content/groundedConceptPlanning');
    expect(availableInputs(templated()).has('SERVICE_PRODUCT_TRUTH')).toBe(false);
    expect(availableInputs(templated(),{whatWeProvide:'We match the request to two nearby licensed plumbers and share their quotes.'})
      .has('SERVICE_PRODUCT_TRUTH')).toBe(true);
  });

  it('answering flips the whole opportunity from "ask the owner" to a real recommendation', async () => {
    // Before: nothing executable. After: LaunchMind can recommend and produce.
    expect(recommendGroundedConcept(templated()).needsOwnerInput).toBe(true);
    const after=recommendGroundedConcept(templated(),{
      customerSituation:'A pipe bursts on a Sunday and no one answers the phone.',
      whatWeProvide:'We match the request to two nearby licensed plumbers and share their quotes.'});
    expect(after.needsOwnerInput).toBe(false);
    expect(after.recommendedConceptKey).not.toBeNull();
    expect(conceptFeasibility(templated(),{customerSituation:'A pipe bursts on a Sunday.'})
      .find(f=>f.key==='A')!.state).toBe('READY');
  });

  it('empty answers change nothing — blank input is not evidence', async () => {
    const {availableInputs}=await import('../src/services/content/groundedConceptPlanning');
    const blank=availableInputs(templated(),{customerSituation:'   ',whatWeProvide:''});
    expect(blank.has('CUSTOMER_PROBLEM')).toBe(false);
    expect(blank.has('SERVICE_PRODUCT_TRUTH')).toBe(false);
  });

  it('the owner is asked the questions readiness actually found missing', async () => {
    const {SERVICE_KNOWLEDGE_QUESTIONS}=await import('../src/services/content/groundedConceptPlanning');
    const keys=SERVICE_KNOWLEDGE_QUESTIONS.map(q=>q.key);
    expect(keys).toContain('customerSituation');   // → CUSTOMER_PROBLEM
    expect(keys).toContain('whatWeProvide');       // → SERVICE_PRODUCT_TRUTH
    // Asked about the selected service by name, not as a generic settings form.
    expect(SERVICE_KNOWLEDGE_QUESTIONS[0].label('plumbing')).toMatch(/plumbing/);
    // Every question maps to an input feasibility actually reads.
    const {CONCEPT_CONTRACTS}=await import('../src/services/content/groundedConceptPlanning');
    const required=new Set(Object.values(CONCEPT_CONTRACTS).flatMap(c=>[...c.requires,...c.strengthens]));
    for(const q of SERVICE_KNOWLEDGE_QUESTIONS)
      expect(required.has(q.supplies),`nothing reads ${q.supplies}`).toBe(true);
  });
});

describe('saved owner knowledge can never break the read model', () => {
  /**
   * The EXACT shape "Save and re-check" persisted onto the confirmed catalog
   * entry, including the confirmedBy/confirmedAt stamps the route adds — those
   * extra keys are the ones a strict re-parse would reject.
   */
  const PERSISTED={
    confirmedAt:'2026-09-08T06:55:45.771Z',
    confirmedBy:'8a292044-5b22-42e5-90d0-65e6cc3d7321',
    whatWeProvide:'yes, product will reach out to plumbing providers with 30 miles where service request is created and find providers for the customers and connect provider with customer, then they finalize pricing and provider will go to customers house to fix there issue and get paid by customer either via cash or CC which they will pay on Allignx App or Web.',
    customerSituation:'this is generic issue, when people have plumbing issue in there home, then they create plumbing service request on Allignx and allignx will find providers for them',
  } as any;

  const templated=()=>opp({brief:{...opp().brief,problem:"Understanding how Plumbing fits a customer's need"}});

  it('the persisted shape is read without throwing, extra stamps and all', async () => {
    const {availableInputs}=await import('../src/services/content/groundedConceptPlanning');
    expect(()=>availableInputs(templated(),PERSISTED)).not.toThrow();
    expect(()=>conceptFeasibility(templated(),PERSISTED)).not.toThrow();
    expect(()=>recommendGroundedConcept(templated(),PERSISTED)).not.toThrow();
  });

  it('the owner’s real answers actually change readiness', () => {
    // Before answering: nothing executable, LaunchMind asks.
    expect(recommendGroundedConcept(templated()).needsOwnerInput).toBe(true);
    // After: both missing inputs are supplied by what the owner wrote.
    const after=conceptFeasibility(templated(),PERSISTED);
    expect(after.find(f=>f.key==='A')!.state).toBe('READY');   // customerSituation → CUSTOMER_PROBLEM
    expect(after.find(f=>f.key==='B')!.state).toBe('READY');   // whatWeProvide → SERVICE_PRODUCT_TRUTH
    const rec=recommendGroundedConcept(templated(),PERSISTED);
    expect(rec.needsOwnerInput).toBe(false);
    expect(rec.recommendedConceptKey).not.toBeNull();
  });

  it('entries saved BEFORE this feature — no ownerKnowledge at all — still work', () => {
    // Six of the seven confirmed services have no ownerKnowledge key.
    for(const legacy of [undefined,null,{}] as any[]){
      expect(()=>conceptFeasibility(templated(),legacy)).not.toThrow();
      expect(conceptFeasibility(templated(),legacy).find(f=>f.key==='A')!.state).toBe('BLOCKED');
    }
  });

  it('a malformed ownerKnowledge value degrades to "not provided", never an exception', () => {
    // Defence in depth: readiness is a read model and must not be the thing
    // that takes Content Intelligence down.
    for(const junk of ['a string',42,[],{customerSituation:null},{whatWeProvide:{nested:true}}] as any[]){
      expect(()=>conceptFeasibility(templated(),junk),`threw on ${JSON.stringify(junk)}`).not.toThrow();
    }
  });
});
