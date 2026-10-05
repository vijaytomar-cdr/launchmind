export interface PlanningOpportunity {id:string;serviceId:string;productService:string;audience:string;geography:string;channel:string;whyNow:string[];growthThesis:string;brief:Record<string,any>;evidence:unknown[];unavailable:string[];learning:{workspace:string[];patterns:string[];limitation:string};concepts:Array<{key:string;pattern:string;direction:string;opportunityId:string}>}
type Opportunity=PlanningOpportunity;
export function hasPreviousWork(view:{opportunity:unknown;created:{total:number;earlierCount:number;concepts:unknown[]}|null}){return !!view.opportunity||!!(view.created&&(view.created.total>0||view.created.earlierCount>0||view.created.concepts.length>0));}
/** Deterministic presentation of existing concept families, never generated copy. */
export function conceptPresentation(g:Opportunity,key:string){
 const c=g.concepts.find(c=>c.key===key);if(!c||c.opportunityId!==g.id)throw Error('Concept must belong to the current opportunity');
 const service=g.productService;
 const signal=g.whyNow[0]??'The current opportunity provides a starting point for a test.';
 const variants:Record<string,{idea:string;job:string;approach:string;hypothesis:string;risk:string}>={
 PROBLEM_RECOGNITION:{idea:`Start with the uncertainty of needing ${service.toLowerCase()} help and deciding where to turn.`,job:'Help the audience recognize their need',approach:`Describe an illustrative customer situation, then connect that need to ${service.toLowerCase()}.`,hypothesis:'A recognizable problem may help the audience see why this service is relevant.',risk:'The emotional framing has no performance evidence yet.'},
 PRODUCT_DEMONSTRATION:{idea:`Explain how the product fits someone looking for ${service.toLowerCase()} help.`,job:'Make the product’s supported role clear',approach:'Walk through the supported service proposition using confirmed product information.',hypothesis:'A clear explanation may help people understand the product’s role before taking a next step.',risk:'Do not imply instant availability, guaranteed contact or unsupported features.'},
 CUSTOMER_EDUCATION:{idea:`Answer the questions someone may have when deciding whether ${service.toLowerCase()} fits their need.`,job:'Reduce uncertainty before action',approach:'Organize a short explanation around service-fit questions, answering only what the product information supports.',hypothesis:'Useful answers may make the next decision easier for the audience.',risk:'Which questions matter most has not been validated by performance data.'},
 };
 const v=variants[c.pattern];if(!v)throw Error('Unsupported planning family');
 return {...v,whyTest:`${signal} ${v.hypothesis}`,bestUse:g.channel==='LANDING_PAGE'?'Landing-page explanation — channel hypothesis':`${g.channel} — channel hypothesis`};
}
/** Prepared only. Future production must resolve scope, evidence and capabilities
 * again server-side; this client payload is never production authorization. */
export function buildGroundedConceptHandoff(g:Opportunity,key:string){
 const c=g.concepts.find(c=>c.key===key);const presentation=conceptPresentation(g,key);
 if(!c||g.brief.opportunityId!==g.id||g.brief.serviceId!==g.serviceId)throw Error('Grounded brief lineage mismatch');
 return {kind:'GROUNDED_CONCEPT_PLANNING' as const,status:'PREPARED_NOT_SUBMITTED' as const,workspaceId:g.brief.workspaceId,productId:g.brief.productId,opportunityId:g.id,service:{id:g.serviceId,name:g.productService},audience:g.audience,geography:g.geography,marketEvidence:{observations:g.evidence,demand:g.brief.demandEvidence,marketMoment:g.brief.marketMoment},growthThesis:g.growthThesis,concept:{key:c.key,family:c.pattern,rationale:c.direction,ownerRationale:presentation.whyTest},channel:g.channel,marketingMemory:{refs:g.brief.memoryRefs,context:g.learning.workspace},creativeIntelligence:{patterns:g.learning.patterns,limitation:g.learning.limitation},productTruth:g.brief.productTruth,serviceTruth:g.brief.serviceTruth??null,capabilityContext:{constraints:g.brief.constraints,requiresServerRevalidation:true},missingEvidence:g.unavailable,groundedBrief:g.brief,productionAuthorized:false as const};
}

// ── CONCEPT FEASIBILITY ──────────────────────────────────────────────────────
//
// THE DEFECT THIS CLOSES, measured on the real AllignX Plumbing opportunity.
// Feasibility used to be one expression: `productTruth.trim().length > 0`. Any
// non-empty description selected PRODUCT_DEMONSTRATION for every landing page.
// AllignX's description — "Connect with trusted, vetted home service
// professionals in your neighborhood — quickly, safely, and conveniently" — is
// COMPANY-level marketplace positioning that reads identically for electricians
// or landscapers. It contains nothing about plumbing. So LaunchMind recommended
// "demonstrate the product for Plumbing" while holding nothing plumbing-specific
// to demonstrate. Downstream, governance correctly refused invented specificity
// and the creative-quality gate correctly refused generic filler — and the owner
// absorbed the contradiction as six identical retries.
//
// An AI CMO decides BEFORE production whether it can execute a concept well.
// Deterministic and explainable on purpose: evidence sufficiency is a counting
// question, not a judgment call, so it needs no model.

export type ConceptFeasibility='READY'|'LIMITED'|'BLOCKED';
export interface ConceptFeasibilityVerdict{
 key:string;family:string;state:ConceptFeasibility;
 /** Owner-facing. Names the gap, never the mechanism. */
 ownerSummary:string;
 /** The smallest useful things that would change the verdict. Empty when READY. */
 missing:string[];
}

/** The named inputs a concept can require. Checked identically on both sides. */
export type ConceptInput='PRODUCT_TRUTH'|'SERVICE_PRODUCT_TRUTH'|'AUDIENCE'|'MARKET_DEMAND'|'CUSTOMER_PROBLEM'|'CUSTOMER_VALUE';

/**
 * ONE contract per concept family, consumed by BOTH readiness and production.
 *
 * THE DEFECT THIS CLOSES. Readiness judged Problem Recognition on Problem
 * Recognition's inputs (audience + demand) and called it READY. Production then
 * executed it as a Product Demonstration: `composePlanningProduction` hardcoded
 * `contentOpportunityType:'PRODUCT_BENEFIT'`, carried the opportunity-level
 * objective ("Test whether a clear EXPLANATION of Plumbing helps…"), and the
 * prompt told the model "LANDING-PAGE EXECUTION: Explain the supported product
 * role" — keyed on CHANNEL, never on concept. The model received "frame a
 * question about the customer's need, do not imply a feature fixes it" AND
 * "explain the supported product role" in the same call, resolved the
 * contradiction toward the product, and produced Product Demonstration copy —
 * which needs the service-specific product truth AllignX does not have. So the
 * concept LaunchMind recommended failed for exactly the reason it had just
 * blocked a different one.
 *
 * `requires` is what readiness checks AND what production needs. They cannot
 * drift apart because there is only one list.
 */
export interface ConceptContract{
 family:string;
 /** Without these, the concept cannot be produced well. */
 requires:ConceptInput[];
 /** At least one gives a service process a grounded reason to matter. */
 requiresOneOf?:ConceptInput[];
 /** Present → specific; absent → LIMITED, never blocked. */
 strengthens:ConceptInput[];
 /** The execution line the GENERATOR receives. Concept-shaped, not channel-shaped. */
 execution:string;
 /** How this family phrases its objective. */
 objective:(service:string)=>string;
 opportunityType:'PRODUCT_BENEFIT'|'PROBLEM_AWARENESS'|'CUSTOMER_EDUCATION';
}

export const CONCEPT_CONTRACTS:Record<string,ConceptContract>={
 PROBLEM_RECOGNITION:{family:'PROBLEM_RECOGNITION',
  // A recognisable problem is the WHOLE concept. Audience and demand say who
  // and that they are looking; neither supplies a situation to recognise.
  requires:['AUDIENCE','CUSTOMER_PROBLEM'],strengthens:['MARKET_DEMAND'],
  execution:'Open on the customer situation, not the product. Describe a moment the reader may recognise, then say plainly where the product fits at the end. Do not explain the product’s role or its supported description.',
  objective:s=>`Test whether naming the ${s.toLowerCase()} situation the audience recognises earns their attention.`,
  opportunityType:'PROBLEM_AWARENESS'},
PRODUCT_DEMONSTRATION:{family:'PRODUCT_DEMONSTRATION',
  requires:['SERVICE_PRODUCT_TRUTH'],requiresOneOf:['CUSTOMER_PROBLEM','CUSTOMER_VALUE'],strengthens:['PRODUCT_TRUTH'],
  execution:'Explain the supported product role. Do not turn benefits into outcome promises.',
  objective:s=>`Test whether a clear explanation of ${s} helps the confirmed audience understand its relevance.`,
  opportunityType:'PRODUCT_BENEFIT'},
CUSTOMER_EDUCATION:{family:'CUSTOMER_EDUCATION',
  requires:['PRODUCT_TRUTH'],requiresOneOf:['CUSTOMER_PROBLEM','CUSTOMER_VALUE'],strengthens:['SERVICE_PRODUCT_TRUTH'],
  execution:'Answer the questions a reader would actually ask, using only confirmed information. Where an answer is not available, leave the question out rather than answering it vaguely.',
  objective:s=>`Test whether answering ${s.toLowerCase()} fit questions reduces hesitation.`,
  opportunityType:'CUSTOMER_EDUCATION'},
};

/** Crude, deliberate stem: "plumbing"→"plumb", "cleaners"→"cleaner". */
const stem=(s:string)=>s.toLowerCase().trim().replace(/(ing|ers|er|s)$/,'');
/** Does this text say anything about THIS service specifically? */
function mentionsService(text:string,service:string){
 const t=String(text??'').toLowerCase(),s=String(service??'').trim().toLowerCase();
 if(!s||s.length<3)return false;
 const root=stem(s);
 return t.includes(s)||(root.length>=4&&t.includes(root));
}

/**
 * A problem TEMPLATED from the service name is not a customer problem.
 *
 * `groundedOpportunity` fills `brief.problem` with
 * "Understanding how <Service> fits a customer's need" whenever it has nothing
 * better. That restates the concept; it reports nothing anyone experienced. A
 * real one — "Reaching customers after they submit a request" — comes from
 * owner-reported direction.
 */
const TEMPLATED_PROBLEM=/^\s*understanding how .+ fits a customer.s need\s*$/i;

/** Owner-stated knowledge for THIS service, from the governed catalog entry. */
export interface ServiceKnowledge{customerSituation?:string;whatWeProvide?:string;customerNote?:string;customerProblem?:string;customerValue?:string}

/**
 * What LaunchMind actually holds, named. Both sides read this.
 *
 * `knowledge` is what the owner answered when readiness told them what was
 * missing — the loop that closes the gap. It is owner-stated text on the
 * confirmed catalog entry, so it supplies the two inputs that were absent
 * without inventing anything or granting any capability.
 */
export function availableInputs(g:Opportunity,knowledge?:ServiceKnowledge|null):Set<ConceptInput>{
 const truth=String(g.brief?.productTruth??'').trim();
 const service=String(g.productService??'').trim();
 const ownerContext=(g.learning?.workspace??[]).join(' ');
 const problem=String(g.brief?.problem??'').trim();
 const out=new Set<ConceptInput>();
 if(truth.length>0)out.add('PRODUCT_TRUTH');
 if((truth.length>0&&mentionsService(truth,service))||mentionsService(ownerContext,service))out.add('SERVICE_PRODUCT_TRUTH');
 if(String(g.audience??'').trim().length>0)out.add('AUDIENCE');
 // Demand evidence — that people are searching. Never product differentiation.
 if((g.evidence?.length??0)>0||!!g.brief?.demandEvidence)out.add('MARKET_DEMAND');
 if(problem.length>0&&!TEMPLATED_PROBLEM.test(problem))out.add('CUSTOMER_PROBLEM');
 // The owner answering the question readiness asked.
 //
 // TWO ROUTES, ONE FACT. `knowledge` is the caller-supplied catalog entry (the
 // Content Intelligence page reads it directly); `g.brief.serviceTruth` is the
 // SAME owner-confirmed statements carried on the governed opportunity, which
 // is what a persisted planning item and production hold. Both derive from the
 // one confirmed catalog entry, so they cannot disagree — and reading both is
 // what stops readiness from depending on which surface asked.
 const owner=[...(g.brief?.serviceTruth?.statements??[]),
  ...(String(knowledge?.customerProblem??'').trim()?[{supplies:'CUSTOMER_PROBLEM' as const}]:[]),
  ...(String(knowledge?.customerValue??'').trim()?[{supplies:'CUSTOMER_VALUE' as const}]:[]),
  ...(String(knowledge?.whatWeProvide??'').trim()||String(knowledge?.customerNote??'').trim()
    ?[{supplies:'SERVICE_PRODUCT_TRUTH' as const}]:[])];
 for(const statement of owner){
  if(statement.supplies==='CUSTOMER_PROBLEM')out.add('CUSTOMER_PROBLEM');
  if(statement.supplies==='CUSTOMER_VALUE')out.add('CUSTOMER_VALUE');
  if(statement.supplies==='SERVICE_PRODUCT_TRUTH'){out.add('SERVICE_PRODUCT_TRUTH');out.add('PRODUCT_TRUTH');}
 }
 return out;
}

const INPUT_ASK:Record<ConceptInput,(s:string)=>string>={
 PRODUCT_TRUTH:()=>'A description of what the product does.',
 SERVICE_PRODUCT_TRUTH:s=>`What AllignX actually does for ${s} — how the service is delivered, what a customer gets, or anything specific to ${s} rather than home services in general.`,
 AUDIENCE:()=>'Who the customer is.',
 MARKET_DEMAND:()=>'Evidence that people are actually looking for this service.',
 CUSTOMER_PROBLEM:s=>`The situation a customer is in when they need ${s} — what goes wrong, what they try first, or what makes it urgent. Without this there is no problem to help them recognise.`,
 CUSTOMER_VALUE:s=>`Why the ${s} flow is useful to the customer. What does it make easier or better, without claiming an unverified outcome?`,
};
const INPUT_SHORT:Record<ConceptInput,string>={
 PRODUCT_TRUTH:'a product description',SERVICE_PRODUCT_TRUTH:'service-specific product detail',
 AUDIENCE:'a confirmed audience',MARKET_DEMAND:'a demand signal',CUSTOMER_PROBLEM:'a real customer problem',CUSTOMER_VALUE:'a customer reason to care',
};

/**
 * The questions the owner is asked, derived from the inputs readiness checks.
 *
 * Defined HERE, beside `ConceptInput`, so the form cannot ask for something
 * feasibility does not read — or omit something it requires. Each question
 * maps to exactly one named input.
 */
export const SERVICE_KNOWLEDGE_QUESTIONS:Array<{key:'customerSituation'|'whatWeProvide'|'customerNote'|'customerProblem'|'customerValue';
 supplies:ConceptInput;label:(service:string)=>string;help:string}>=[
 {key:'customerSituation',supplies:'SERVICE_PRODUCT_TRUTH',
  label:s=>`What is happening for a customer when they need ${s}?`,
  help:'What goes wrong, what they try first, or what makes it urgent.'},
 {key:'whatWeProvide',supplies:'SERVICE_PRODUCT_TRUTH',
  label:s=>`What does the product specifically provide or coordinate for ${s}?`,
  help:'What happens after a customer requests help.'},
 {key:'customerNote',supplies:'SERVICE_PRODUCT_TRUTH',
  label:s=>`Is there anything customers should know about ${s} providers or the service?`,
  help:'Optional.'},
 {key:'customerProblem',supplies:'CUSTOMER_PROBLEM',
  label:s=>`Besides the ${s} issue itself, what makes getting help difficult for the customer?`,
  help:'Describe a real frustration, uncertainty, or use case you have confirmed.'},
 {key:'customerValue',supplies:'CUSTOMER_VALUE',
  label:s=>`What does using AllignX make easier or better for that ${s} customer?`,
  help:'State the value you can stand behind; do not promise a guaranteed result.'},
];

/**
 * Can LaunchMind execute each concept WELL with the evidence it holds?
 *
 * Judged against CONCEPT_CONTRACTS — the same list production consumes — so
 * readiness cannot claim a concept is executable that generation then cannot
 * build. Each family is judged on the inputs IT needs, deliberately not the
 * same bar for all three.
 *
 * @security Search demand establishes that people are looking, never what the
 *   product does; it appears only where a family genuinely uses it. Company-
 *   level truth is never counted as service-level truth.
 */
export function conceptFeasibility(g:Opportunity,knowledge?:ServiceKnowledge|null):ConceptFeasibilityVerdict[]{
 const have=availableInputs(g,knowledge);
 const service=String(g.productService??'').trim();
 const lower=service.toLowerCase();
 return g.concepts.map(c=>{
  const contract=CONCEPT_CONTRACTS[c.pattern];
  if(!contract)return{key:c.key,family:c.pattern,state:'BLOCKED' as const,
   missing:[],ownerSummary:'This approach is not available.'};
  const missingRequired=contract.requires.filter(i=>!have.has(i));
  const missingOneOf=contract.requiresOneOf?.every(i=>!have.has(i))?contract.requiresOneOf:[];
  const missingStrength=contract.strengthens.filter(i=>!have.has(i));
  if(missingRequired.length>0||missingOneOf.length>0){const missing=[...missingRequired,...missingOneOf];return{key:c.key,family:c.pattern,state:'BLOCKED' as const,
   missing:missing.map(i=>INPUT_ASK[i](lower)),
   ownerSummary:`I understand how ${lower} works, but I need ${missing.map(i=>INPUT_SHORT[i]).join(' or ')} before I can make customer-facing content strong.`};}
  if(missingStrength.length>0)return{key:c.key,family:c.pattern,state:'LIMITED' as const,
   missing:missingStrength.map(i=>INPUT_ASK[i](lower)),
   ownerSummary:`I can do this, but without ${missingStrength.map(i=>INPUT_SHORT[i]).join(' or ')} it will stay general rather than specific to ${lower}.`};
  return{key:c.key,family:c.pattern,state:'READY' as const,missing:[],
   ownerSummary:`I have what this needs for ${lower}: ${contract.requires.map(i=>INPUT_SHORT[i]).join(' and ')}.`};
 });
}

const FEASIBILITY_RANK:Record<ConceptFeasibility,number>={READY:2,LIMITED:1,BLOCKED:0};

/**
 * Strategic fit AND evidence feasibility.
 *
 * The strategic preference below is unchanged — it is the same channel/job
 * mapping as before. What changed is that it now runs INSIDE feasibility:
 * LaunchMind no longer recommends the best-fitting concept it cannot execute.
 * Demand and historical performance remain non-inputs.
 */
export function recommendGroundedConcept(g:Opportunity,knowledge?:ServiceKnowledge|null){
 const feasibility=conceptFeasibility(g,knowledge);
 const by=(k:string)=>feasibility.find(f=>f.key===k)?.state??'BLOCKED';
 const hasTruth=typeof g.brief.productTruth==='string'&&g.brief.productTruth.trim().length>0;
 // Unchanged strategic order — consulted only to break ties within a tier.
 const preferred=g.channel==='LANDING_PAGE'?(hasTruth?'PRODUCT_DEMONSTRATION':'CUSTOMER_EDUCATION'):'PROBLEM_RECOGNITION';
 const ranked=[...g.concepts].sort((a,b)=>{
  const d=FEASIBILITY_RANK[by(b.key)]-FEASIBILITY_RANK[by(a.key)];
  if(d!==0)return d;
  return (a.pattern===preferred?-1:0)-(b.pattern===preferred?-1:0);
 });
 const selected=ranked[0];
 if(!selected)throw Error('No grounded concepts');
 const chosen=feasibility.find(f=>f.key===selected.key)!;
 const blockedPreferred=feasibility.find(f=>f.family===preferred&&f.state==='BLOCKED');
 // Every concept blocked: production is not the responsible next step.
 // READY means production can actually build it. A LIMITED concept is
 // offerable if the owner chooses it, but recommending one — and rendering a
 // Generate button — would be promising work LaunchMind expects to be generic.
 // Measured: the only LIMITED-quality output this pipeline produced was
 // rejected as "generic boilerplate that could describe any home service".
 const noneExecutable=!feasibility.some(f=>f.state==='READY');
 return {
  recommendedConceptKey:noneExecutable?null:selected.key,
  recommendationBasis:noneExecutable
   ?['I don’t yet have enough confirmed information to produce strong content for this opportunity.',
     ...new Set(feasibility.flatMap(f=>f.missing))].slice(0,4)
   :[...(blockedPreferred&&blockedPreferred.key!==selected.key?[blockedPreferred.ownerSummary]:[]),
     chosen.ownerSummary,
     'This is a strategic first-test hypothesis; no performance winner is established.'],
  feasibility,
  needsOwnerInput:noneExecutable,
  performanceBacked:false as const,policyVersion:'concept-fit-v2'};
}

/**
 * NOTE: feasibility for a PERSISTED planning item is NOT computed here.
 *
 * A version of this file exported `planningFeasibility(handoff)`, which rebuilt
 * the opportunity from the item's FROZEN stored handoff and called
 * conceptFeasibility() with no owner knowledge. Content Intelligence called
 * conceptFeasibility() with the CURRENT catalog instead, so the same concept
 * could be READY on one page and BLOCKED on the other -- and it was.
 *
 * The single answer now comes from refreshPlanningItem() in
 * groundedPlanningWork.ts, which evaluates the item's concept against the
 * current opportunity and current confirmed catalog and re-binds the item when
 * that concept has become executable. Do not reintroduce a handoff-only
 * evaluator here; two evaluators is the defect, not the fix.
 */
