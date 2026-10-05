import {randomUUID} from 'node:crypto';
import type {ProductContentContext} from './productContentContext';
import {readSnapshot,validatePlanning,planningContext,signPlanningSnapshot} from './groundedPlanningWork';
import {buildGroundedConceptHandoff,CONCEPT_CONTRACTS,conceptFeasibility} from './groundedConceptPlanning';
import {buildProductCapabilityContract} from './productCapabilityContract';
import {getSupabaseAdmin} from '../../lib/supabaseAdmin';
import {persistContentOpportunity} from '../opportunity/contentOpportunityService';
import {createContentCampaign,deriveCampaignArchitecture} from '../opportunity/contentCampaignService';
import type {OpportunityCandidate} from '../opportunity/contentOpportunityPolicy';
import {deriveContentStrategy,persistContentStrategy} from './strategyComposition';
import {deriveContentBrief,persistContentBrief} from './briefComposition';
import {productionServiceTruth} from './serviceCatalog';

export function preparePlanningProduction(row:any,ctx:ProductContentContext){
 const data=row.structured_data,h=data?.handoff,d=data?.decision;
 if(row.workspace_id!==ctx.workspaceId||row.product_id!==ctx.productId||data?.kind!=='GROUNDED_PLANNING_WORK'||data.state!=='PLANNED'||!h||!d)throw Error('Planning scope mismatch');
 if(h.workspaceId!==ctx.workspaceId||h.productId!==ctx.productId||d.opportunityId!==h.opportunityId||d.ownerSelectedConceptKey!==h.concept.key)throw Error('Planning decision mismatch');
 const g=validatePlanning(readSnapshot(data),ctx,h.opportunityId,h.concept.key);
 const entry=ctx.signalFoundation?.catalog?.confirmed?.find((candidate:any)=>candidate.id===g.serviceId);
 const feasibility=conceptFeasibility(g as any,(entry as any)?.ownerKnowledge??null).find(f=>f.key===h.concept.key);
 if(!feasibility||feasibility.state==='BLOCKED')throw Error('This brief needs one more piece of customer context before creation.');
 const current=buildGroundedConceptHandoff(g as any,h.concept.key);
 if(current.service.id!==h.service.id||current.concept.family!==h.concept.family||current.channel!==h.channel)throw Error('Planning lineage changed');
 if(h.channel!=='LANDING_PAGE'&&h.channel!=='META_AD')throw Error('Production format is not supported by this handoff');
 return {planningWorkId:row.id,opportunityId:h.opportunityId,channel:'META_AD' as const,
   handoff:current,decision:d,capabilities:buildProductCapabilityContract(ctx)};
}
export type ProductionIds={opportunityId:string;campaignId:string;strategyId:string;briefId:string};
function bindingSignature(row:any,ids:ProductionIds,channel:'META_AD'='META_AD'){return signPlanningSnapshot(JSON.stringify({id:row.id,workspaceId:row.workspace_id,productId:row.product_id,channel,ids:{opportunityId:ids.opportunityId,campaignId:ids.campaignId,strategyId:ids.strategyId,briefId:ids.briefId}}));}

export async function loadPlanningProduction(id:string,workspaceId:string,founderId:string){
 const {data:row,error}=await getSupabaseAdmin().from('content_assets')
  .select('id,workspace_id,product_id,founder_id,updated_at,structured_data').eq('id',id).eq('workspace_id',workspaceId)
  .eq('governance','GOVERNED_CONTENT_INTELLIGENCE').is('archived_at',null).maybeSingle();
 if(error||!row||row.structured_data?.kind!=='GROUNDED_PLANNING_WORK')throw Error('Planning item unavailable');
 const ctx=await planningContext(workspaceId,row.product_id,founderId,readSnapshot(row.structured_data));
 return {row,ctx,contract:preparePlanningProduction(row,ctx)};
}

/** Uses existing strategy/brief composition; demand is context, never a product claim. */
export function composePlanningProduction(contract:ReturnType<typeof preparePlanningProduction>,ctx:ProductContentContext){
 const h=contract.handoff;
 const productionTruth=productionServiceTruth(h.serviceTruth).truth;
 // CONCEPT-SHAPED, not hardcoded. `contentOpportunityType` was fixed at
 // 'PRODUCT_BENEFIT' and the objective was the opportunity-level thesis, so a
 // Problem Recognition brief arrived at generation asking for a product
 // explanation. Both now come from the shared CONCEPT_CONTRACTS entry that
 // readiness is judged against, so the two cannot disagree.
 const conceptContract=CONCEPT_CONTRACTS[h.concept.family];
 const candidate:OpportunityCandidate={contentOpportunityType:(conceptContract?.opportunityType??'PRODUCT_BENEFIT') as OpportunityCandidate['contentOpportunityType'],title:`${h.service.name} — ${h.concept.family.toLowerCase().replaceAll('_',' ')}`,
  objective:conceptContract?conceptContract.objective(h.service.name):h.growthThesis,audienceHypothesis:h.audience,messageAngle:h.concept.rationale,
  whyNow:h.groundedBrief.timing,whyNowKind:'INTELLIGENCE_TRIGGERED',recommendedChannels:['META_AD'],
  evidenceRefs:h.marketEvidence.observations.map((e:any)=>e.ref)};
 // SERVICE-LEVEL truth leads where the concept requires it. PRODUCT_DEMONSTRATION
 // declares SERVICE_PRODUCT_TRUTH as its required input, so briefing it with
 // company-level positioning alone asks the writer to demonstrate a service it
 // has been told nothing about — which is exactly what produced generic copy
 // for a concept readiness had already passed. Company-level truth is appended,
 // not replaced, so the two remain distinguishable to everything downstream.
 const serviceStatements=(productionTruth?.statements??[])
  .filter((t:any)=>t.supplies==='SERVICE_PRODUCT_TRUTH').map((t:any)=>t.text);
 const customerValue=(productionTruth?.statements??[])
  .find((t:any)=>t.supplies==='CUSTOMER_VALUE')?.text ?? null;
 const productRole=serviceStatements.length
  ? `${serviceStatements.join(' ')} (Company-level: ${h.productTruth})`
  : h.productTruth;
 const architecture={...deriveCampaignArchitecture(candidate,ctx),recommendedChannels:['META_AD'],contentPackage:[],
  productRole,coreProblem:(productionTruth?.statements??[]).find((t:any)=>t.supplies==='CUSTOMER_PROBLEM')?.text
   ??h.groundedBrief.problem,
  // This remains an owner-confirmed customer value, never a product capability
  // inferred from demand. It gives strategy and the final prompt the same
  // positive hierarchy that readiness used to permit this concept.
  primaryBenefit:customerValue ?? deriveCampaignArchitecture(candidate,ctx).primaryBenefit,
  proofUnavailable:[...h.missingEvidence,...h.capabilityContext.constraints,h.creativeIntelligence.limitation],
  // Search interest explains timing; it cannot substantiate a product capability.
  proofAvailable:ctx.evidence.filter(e=>e.kind!=='MARKET_INTELLIGENCE').map(e=>e.label)};
 const strategy=deriveContentStrategy({ctx,architecture});
 strategy.constraints=[...strategy.constraints,...h.capabilityContext.constraints,...h.missingEvidence];
 const brief=deriveContentBrief('META_AD',strategy,ctx);
 // The hook direction is the instruction generation actually reads. When the
 // owner has confirmed service truth, saying "use only the supported product
 // description" would contradict the truth the same prompt now supplies — so
 // the instruction names the specific source instead. Unlike the concept
 // rationale this is recomposed on every open and carries no lineage.
 brief.hookDirection=serviceStatements.length
  ? `${h.concept.rationale}${customerValue?` Lead with the owner-confirmed customer value: ${customerValue}`:''} Prefer the owner-confirmed truth for ${h.service.name}: ${serviceStatements.join(' ')} Restate it; do not extend it into a stronger claim than the owner made.`
  : h.concept.rationale;
 return {candidate,architecture,strategy,brief};
}

/** Durable reservation + resumable existing writers. CAS prevents concurrent opens
 * allocating two lineages; each writer inserts its reserved real UUID once.
 * A crash after any insert resumes that same ID, never creating another record.
 */
export async function ensurePlanningProduction(id:string,workspaceId:string,founderId:string){
 let loaded=await loadPlanningProduction(id,workspaceId,founderId);
 let row=loaded.row,ids=row.structured_data.production?.ids as ProductionIds|undefined;
 const channel='META_AD' as const;
 const db=getSupabaseAdmin();
 if(!ids||row.structured_data.production?.channel!==channel){
  const allocated:ProductionIds={opportunityId:randomUUID(),campaignId:randomUUID(),strategyId:randomUUID(),briefId:randomUUID()};
  const next={...row.structured_data,production:{ids:allocated,channel,signature:bindingSignature(row,allocated,channel)}};
  const {data,error}=await db.from('content_assets').update({structured_data:next,updated_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',workspaceId)
   .eq('updated_at',row.updated_at).is('archived_at',null).select('id');
  if(error)throw Error('Could not reserve production lineage');
  if(data?.length){row={...row,structured_data:next};ids=allocated;}
  else {loaded=await loadPlanningProduction(id,workspaceId,founderId);row=loaded.row;ids=row.structured_data.production?.ids;}
 }
 if(!ids||row.structured_data.production.signature!==bindingSignature(row,ids,channel))throw Error('Invalid production binding');
 const {ctx,contract}=loaded;
 const composed=composePlanningProduction(contract,ctx);
 // Owner acceptance is the persistence action. The AI recommendation and override
 // remain explicit in the original signed plan/decision; no Growth Brain row invented.
 await persistContentOpportunity({ctx,founderId:row.founder_id,origin:'OWNER_DIRECTED',candidate:composed.candidate,persistId:ids.opportunityId});
 await createContentCampaign({ctx,founderId:row.founder_id,opportunityId:ids.opportunityId,candidate:composed.candidate,architecture:composed.architecture,persistId:ids.campaignId});
 await persistContentStrategy(composed.strategy,{founderId:row.founder_id,campaignId:ids.campaignId,persistId:ids.strategyId});
 await persistContentBrief(composed.brief,{founderId:row.founder_id,campaignId:ids.campaignId,strategyId:ids.strategyId,persistId:ids.briefId});
 await validateProductionRows(ids,ctx,composed);
 // Link back through the existing artifact identity fields. Full handoff remains
 // in structured_data, never replaced by generated payload.
 const {error}=await db.from('content_assets').update({content_campaign_id:ids.campaignId,strategy_id:ids.strategyId,content_brief_id:ids.briefId})
  .eq('id',id).eq('workspace_id',workspaceId).is('archived_at',null);
 if(error)throw Error('Could not bind production lineage');
 return {...contract,...composed,ctx,ids,canGenerate:true as const};
}

async function validateProductionRows(ids:ProductionIds,ctx:ProductContentContext,composed:ReturnType<typeof composePlanningProduction>){
 const db=getSupabaseAdmin();
 const results=await Promise.all([
  db.from('saved_opportunities').select('id,workspace_id,product_id,title,message_angle').eq('id',ids.opportunityId).maybeSingle(),
  db.from('content_campaigns').select('id,workspace_id,product_id,opportunity_id,thesis').eq('id',ids.campaignId).maybeSingle(),
  db.from('content_strategies').select('id,workspace_id,product_id,content_campaign_id').eq('id',ids.strategyId).maybeSingle(),
  db.from('content_briefs').select('id,workspace_id,product_id,content_campaign_id,strategy_id,content_channel').eq('id',ids.briefId).maybeSingle(),
 ]);
 if(results.some(r=>r.error||!r.data||r.data.workspace_id!==ctx.workspaceId||r.data.product_id!==ctx.productId))throw Error('Production scope mismatch');
 const o=results[0].data!,c=results[1].data!,s=results[2].data!,b=results[3].data!;
 if(o.title!==composed.candidate.title||o.message_angle!==composed.candidate.messageAngle||c.opportunity_id!==ids.opportunityId||c.thesis!==composed.architecture.thesis||s.content_campaign_id!==ids.campaignId||b.content_campaign_id!==ids.campaignId||b.strategy_id!==ids.strategyId||b.content_channel!=='meta_ad')throw Error('Production lineage mismatch');
}

export async function resolvePlanningProduction(id:string,workspaceId:string,founderId:string){return ensurePlanningProduction(id,workspaceId,founderId);}

/** Read-only availability check; never creates production records from an index read. */
export async function planningProductionStatus(id:string,workspaceId:string,founderId:string){
 const {row,ctx,contract}=await loadPlanningProduction(id,workspaceId,founderId);
 const ids=row.structured_data.production?.ids as ProductionIds|undefined;
 if(!ids)return {canGenerate:false};
 if(row.structured_data.production.channel!=='META_AD'||row.structured_data.production.signature!==bindingSignature(row,ids,'META_AD'))throw Error('Invalid production binding');
 await validateProductionRows(ids,ctx,composePlanningProduction(contract,ctx));
 return {canGenerate:true};
}
