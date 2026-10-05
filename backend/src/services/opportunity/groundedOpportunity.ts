/** Evidence-first planning on the existing content context. Read-only; no memory,
 * product truth, performance claim or execution authority is created here. */
import {createHash} from 'node:crypto';
import {ownerConfirmedServiceTruth} from '../content/serviceCatalog';
import type {ProductContentContext} from '../content/productContentContext';
import {resolvedServiceArea} from '../content/serviceGeography';
import {applicableDemand} from '../marketIntelligence/contract';
import {validDemandTournament} from '../marketIntelligence/demandTournament';
import {serviceDemandQueryDetails} from '../marketIntelligence/searchDemandAdapter';
import {CONCEPTS} from '../content/creativeConcepts';
export function rankGroundedOpportunities(ctx:ProductContentContext, patterns:readonly string[] = []) {
 const foundation=ctx.signalFoundation;
 if(foundation?.catalog.requiresCatalog&&!foundation.catalog.confirmed.length)return {
  selected:null,alternatives:[],state:'NEEDS_OWNER_INPUT' as const,confidence:'LIMITED' as const,
  reason:'LaunchMind needs service confirmation before it can responsibly choose among service categories.',
  requiredConfirmation:['Confirm which discovered services you actually offer','Confirm actual fulfillment areas for each service; national positioning is not coverage'],
  foundation,scoreExplanation:'No eligible confirmed service candidates; no generic-app substitute.',catalogLimitation:'Discovered services are not confirmed marketable truth.',
 };
 const evidence=ctx.evidence.filter(e=>e.kind!=='ONBOARDING_STRATEGY');
 const currentMarket=evidence.filter(e=>e.kind==='MARKET_INTELLIGENCE'&&e.freshness==='CURRENT');
 const memories=evidence.filter(e=>e.kind==='MARKETING_MEMORY');
 const goal=ctx.founderDirection.primaryGoal;
 const direction=ctx.founderDirection.contextDelta;
 const reachability=!!direction && /not reachable|unreachable|reach.{0,45}request|request.{0,65}reach/i.test(direction);
 const offerings=foundation?foundation.catalog.confirmed.map(e=>({id:e.id,name:e.name,source:'OWNER_CONFIRMED' as const})):ctx.offerings?.length?ctx.offerings:[{id:ctx.productId,name:ctx.application.name??'Current product',source:'PRODUCT_CONTEXT' as const}];
 const tournament=foundation?.demandTournament;
 const tournamentRequest=tournament&&{...tournament.request,workspaceId:ctx.workspaceId,productId:ctx.productId,services:foundation!.catalog.confirmed.map(e=>({id:e.id,query:serviceDemandQueryDetails(e.name).query,ownerGeography:resolvedServiceArea(e)??undefined,normalizationReason:serviceDemandQueryDetails(e.name).reason})),geography:foundation!.catalog.confirmed.map(e=>resolvedServiceArea(e)?.providerGeography).every(g=>g===tournament.request.geography)?tournament.request.geography:''};
 const tournamentValid=!!tournamentRequest&&validDemandTournament(tournament,tournamentRequest);
 const tournamentWinner=tournamentValid?tournament!.finalWinnerId:null;
 const validDemand=foundation?.demand.filter(d=>{const service=foundation.catalog.confirmed.find(e=>e.id===d.serviceId);const geography=service&&resolvedServiceArea(service)?.providerGeography;return !!geography&&applicableDemand(d,{workspaceId:ctx.workspaceId,productId:ctx.productId,serviceId:service!.id,geographies:[geography]});})??[];
 const completeDemand=offerings.every(o=>validDemand.some(d=>d.serviceId===o.id))&&validDemand.length===offerings.length&&!!validDemand[0]?.comparisonGroupId&&validDemand.every(d=>d.comparisonGroupId===validDemand[0].comparisonGroupId)?validDemand:[];
 const candidates=offerings.flatMap(offering=>{
  const base={offering,problem:`Understanding how ${offering.name} fits a customer's need`,kind:'PRODUCT_EDUCATION',priority:0};
  return reachability && (offering.source==='PRODUCT_CONTEXT'||direction!.toLowerCase().includes(offering.name.toLowerCase()))?[{...base,problem:'Reaching customers after they submit a request',kind:'FOLLOW_UP_EDUCATION',priority:2},...(!foundation?[base]:[])]:[base];
 });
 const ranked=candidates.map(c=>{
  // Product-wide evidence cannot choose between service categories. Only exact
  // named-service relevance can add a service-specific decision contribution.
  const relevant=evidence.filter(e=>c.offering.source==='PRODUCT_CONTEXT'||e.text.toLowerCase().includes(c.offering.name.toLowerCase()));
  const refs=(kind:string)=>relevant.filter(e=>e.kind===kind).map(e=>e.ref);
  const service=foundation?.catalog.confirmed.find(e=>e.id===c.offering.id);
  const stage=tournamentValid?[...tournament!.stages].reverse().find(s=>s.serviceIds.includes(c.offering.id)):undefined;
  const demand=stage?.signals.find(s=>s.serviceId===c.offering.id)??(!tournament?completeDemand:[]).find(d=>applicableDemand(d,{workspaceId:ctx.workspaceId,productId:ctx.productId,serviceId:c.offering.id,geographies:service&&resolvedServiceArea(service)?.providerGeography?[resolvedServiceArea(service)!.providerGeography!]:[]}));
  const dimensions=[
   {name:'Demand',points:demand?(tournamentValid?(c.offering.id===tournamentWinner?1:0):1):null as number|null,basis:demand?'MARKET_EVIDENCE':'UNAVAILABLE',refs:demand?[demand.provenanceId]:[] as string[],reason:stage?(c.offering.id===tournamentWinner?'Final comparison winner; strongest relative search interest in that comparison':stage.winnerId===c.offering.id?'Advanced from the first comparison':'Compared within its own group; did not win that comparison'):demand?`${demand.value.toFixed(1)} relative search-interest index (${demand.query}, ${demand.geography}); not search volume`:'No applicable live demand measurement available'},
   {name:'Business value',points:goal?1:null,basis:goal?'OWNER_DIRECTION':'UNAVAILABLE',refs:refs('BUSINESS_GOAL'),reason:goal?`Planning goal: ${goal}; not observed results`:'No confirmed goal'},
   {name:'Conversion/performance',points:null,basis:'UNAVAILABLE',refs:refs('CAMPAIGN_PERFORMANCE'),reason:refs('CAMPAIGN_PERFORMANCE').length?'Product metrics exist but do not establish a winning service/use case':'No applicable conversion evidence'},
   {name:'Capacity/readiness',points:null,basis:'UNAVAILABLE',refs:[],reason:'Service fulfillment/readiness is not verified'},
   {name:'Market momentum',points:demand?(demand.direction==='RISING'?1:demand.direction==='FALLING'?-1:0):null,basis:demand?'DERIVED':'UNAVAILABLE',refs:demand?[demand.provenanceId]:[],reason:demand?`Measured search-interest direction: ${demand.direction}`:'A listing observation is not a demand trend'},
   {name:'Competitive opportunity',points:null,basis:'UNAVAILABLE',refs:[],reason:'Named competitors alone do not establish a competitive gap'},
   {name:'Creative opportunity',points:patterns.length?1:null,basis:patterns.length?'DERIVED':'UNAVAILABLE',refs:[],reason:patterns.length?'Applicable abstract structures available; no performance uplift inferred':'No applicable creative pattern supplied'},
   {name:'Strategic priority',points:c.priority||null,basis:c.priority?'OWNER_DIRECTION':'UNAVAILABLE',refs:c.priority?refs('FOUNDER_DIRECTION'):[],reason:c.priority?'Addresses the contact problem the owner reported':'No specific use-case priority recorded'},
   {name:'Saturation/fatigue penalty',points:null,basis:'UNAVAILABLE',refs:[],reason:'No qualified opportunity-level performance/fatigue attribution'},
  ];
  const score=dimensions.reduce((sum,d)=>sum+(d.points??0),0);
  // SERVICE-LEVEL truth, from the SAME confirmed catalog entry readiness reads.
  // Deliberately placed on `brief` and NOT on `identity`: the opportunity id is
  // a hash of identity, so putting it there would mint a NEW opportunity the
  // moment an owner answered a question — orphaning the planning item they
  // created from the old one. Confirming knowledge must enrich the opportunity,
  // not replace it.
  const serviceTruth=ownerConfirmedServiceTruth(service);
  const identity={workspaceId:ctx.workspaceId,productId:ctx.productId,serviceId:c.offering.id,problem:c.problem,
   audience:ctx.founderDirection.audienceConfirmed??'Audience not confirmed',geography:service?(resolvedServiceArea(service)?.displayLabel??'Service area needs confirmation'):ctx.application.markets.join(', ')||'Geography not confirmed',channel:'LANDING_PAGE',timing:demand?`Current demand window: ${demand.observedWindow.start.slice(0,10)} to ${demand.observedWindow.end.slice(0,10)}`:'Evergreen — no verified external timing trigger'};
  const id='planning-'+createHash('sha256').update(JSON.stringify({identity, evidence:relevant.map(e=>[e.ref,e.text,e.freshness]),demand:demand?.provenanceId,tournament:tournamentValid?tournament?.provenanceId:null,patterns})).digest('hex').slice(0,20);
  const whyNow=[...(c.offering.id===tournamentWinner?['Strongest relative search interest in the final comparison, following the first-group selection.']:[]),...(demand?[`Observed relative search interest for ${demand.query} in ${demand.ownerGeography?.state??demand.geography}: ${demand.direction.toLowerCase()} across ${demand.observedWindow.start.slice(0,10)} to ${demand.observedWindow.end.slice(0,10)}. This is not bookings or absolute volume.`]:[]),...(c.priority?[`You reported a current follow-up problem: ${direction}`]:[]),...(goal?[`Your confirmed goal is ${goal}.`]:[]),`The product profile supports: ${ctx.application.description??'description unavailable'}`].slice(0,3);
  const growthThesis=c.priority?'Test whether clearer customer education around submitting a request supports engagement and follow-up. This is a hypothesis, not a conversion promise.':`Test whether a clear explanation of ${c.offering.name} helps the confirmed audience understand its relevance.`;
  const concepts=[
   {key:'A',pattern:CONCEPTS.PROBLEM_RECOGNITION.key,name:CONCEPTS.PROBLEM_RECOGNITION.name,direction:c.priority?`Frame a question about what ${identity.audience} needs to know after submitting a request. Use an illustrative situation, not a claimed customer experience.`:`Frame a question around ${c.problem.toLowerCase()} for ${identity.audience}. Do not imply a feature fixes it.`},
   {key:'B',pattern:CONCEPTS.PRODUCT_DEMONSTRATION.key,name:CONCEPTS.PRODUCT_DEMONSTRATION.name,// DELIBERATELY STABLE, even when service truth arrives. This string becomes
   // concept.rationale -> candidate.messageAngle -> campaign.thesis, and
   // validateProductionRows compares the persisted thesis byte-for-byte against
   // a recomposition. Rewording it here would invalidate the reserved
   // production lineage of every planning item already created from this
   // concept — the owner's brief would 409 rather than refresh. The
   // service-specific instruction is applied in composePlanningProduction,
   // which is re-derived on every open and is not lineage-checked.
   direction:`Explain ${c.offering.name} using only the supported product description: ${ctx.application.description??'description requires confirmation'}. Do not demonstrate an unshipped availability field.`},
   {key:'C',pattern:'CUSTOMER_EDUCATION',name:'Customer education',direction:c.priority?'Explain why being reachable matters after making a request. Do not claim the product captures availability or guarantees contact.':'Answer the audience’s basic fit questions using confirmed product truth; mark missing answers for confirmation.'},
  ].map(concept=>({...concept,opportunityId:id,productId:ctx.productId,serviceId:c.offering.id,channel:identity.channel}));
  return {id,...identity,productService:c.offering.name,serviceBasis:c.offering.source,score,dimensions,confidence:'LIMITED' as const,
   confidenceExplanation:stage?`Current ${demand?.ownerGeography?.state??demand?.geography}-level search-interest evidence supports this planning decision; service-level conversion, capacity and performance learning are unavailable. The comparison path is not a global demand index.`:'Limited market evidence. This is a first content test from available business context, not a measured winning service or channel.',
   whyNow,growthThesis,evidence:[...relevant.map(e=>({ref:e.ref,kind:e.kind,label:e.label,detail:e.detail??null,freshness:e.freshness??null})),...(demand?[{ref:demand.provenanceId,kind:'MARKET_INTELLIGENCE',label:`Search interest: ${demand.query}`,detail:demand.sourceRef,freshness:demand.freshness}]:[])],
   learning:{workspace:memories.map(m=>m.label),patterns:[...patterns],limitation:'Retrieved memory may record owner direction; it does not establish which creative performed best.'},concepts,
   brief:{...identity,opportunityId:id,growthThesis,demandEvidence:stage?{comparisonGroupId:stage.comparisonGroupId,stage:stage.stage,finalWinner:tournamentWinner,query:demand?.query,geography:demand?.geography,window:demand?.observedWindow,provenance:demand?.provenanceId}:null,productTruth:ctx.application.description,serviceTruth,evidenceRefs:[...relevant.map(e=>e.ref),...(demand?[demand.provenanceId]:[])],
    marketMoment:[...(demand?[{ref:demand.provenanceId,label:`Current relative search interest for ${demand.query}`,freshness:demand.freshness}]:[]),...currentMarket.map(e=>({ref:e.ref,label:e.label,freshness:e.freshness}))],memoryRefs:memories.map(e=>e.ref),creativePatterns:[...patterns],
    constraints:['No unsupported capabilities, outcomes or availability','No testimonials without governed proof','No execution authorization'],concepts},
   unavailable:dimensions.filter(d=>d.points===null).map(d=>`${d.name}: ${d.reason}`),
  };
 });
 ranked.sort((a,b)=>b.score-a.score||(tournamentWinner?(Number(b.serviceId===tournamentWinner)-Number(a.serviceId===tournamentWinner)):0)||a.id.localeCompare(b.id));
 const insufficient=!!foundation && ((!!tournament&&!tournamentValid) || !ranked.length || (ranked.length>1 && ranked[0].score===ranked[1].score&&ranked[0].serviceId!==tournamentWinner) || !ranked[0].dimensions.some(d=>d.points!==null && ['Demand','Strategic priority'].includes(d.name)));
 if(insufficient)return {selected:null,alternatives:ranked.map(c=>({...c,concepts:[],brief:{...c.brief,concepts:[]}})),foundation,state:foundation?.catalog.confirmed.some(e=>!resolvedServiceArea(e))?'NEEDS_OWNER_INPUT' as const:'INSUFFICIENT_EVIDENCE' as const,confidence:'LIMITED' as const,reason:'Your services are confirmed, but current evidence does not yet distinguish the strongest service opportunity.',scoreExplanation:'Shared goals and structural suggestions do not distinguish services. Missing evidence is unavailable, not zero performance.',catalogLimitation:'Only confirmed services are eligible. No A/B/C briefs until a responsible opportunity can be selected.'};
 return {selected:ranked[0]??null,alternatives:ranked.slice(1),foundation,state:'PLANNING_READY' as const,confidence:'LIMITED' as const,scoreExplanation:'Equal scores mean insufficient evidence to prefer one candidate; ties use stable identity order. Decision-support points from available direction and structural fit only. Missing factors are null, excluded from the sum; score is not confidence or observed performance.',
  catalogLimitation:ctx.offerings?.length?'Only explicitly recorded offerings considered. Product-wide signals do not prove service-level demand.':'No explicit service catalog is recorded; selected the known product instead of inventing service categories.'};
}
