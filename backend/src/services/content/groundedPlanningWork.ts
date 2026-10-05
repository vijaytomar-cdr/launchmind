import {createHash,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {getSupabaseAdmin} from '../../lib/supabaseAdmin';
import {buildGroundedConceptHandoff,recommendGroundedConcept} from './groundedConceptPlanning';
import {rankGroundedOpportunities} from '../opportunity/groundedOpportunity';
import type {ProductContentContext} from './productContentContext';
import {loadSignalFoundation,type SignalFoundation} from '../opportunity/signalFoundation';
export function signPlanningSnapshot(value:string){const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)throw Error('Server signing configuration unavailable');return createHmac('sha256',secret).update(value).digest('hex');}
export function readSnapshot(data:any){if(!data?.snapshotJson||typeof data.snapshotSignature!=='string')return null;const expected=signPlanningSnapshot(data.snapshotJson);if(data.snapshotSignature.length!==expected.length||!timingSafeEqual(Buffer.from(data.snapshotSignature),Buffer.from(expected)))throw Error('Invalid planning signature');return JSON.parse(data.snapshotJson);}
const snapshots=new Map<string,any>();
const key=(w:string,p:string)=>`${w}:${p}`;
function canonical(v:any):string{return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)??'null';}
// A failed run belongs to the input contract it actually read. Customer-story
// composition and quality repair changed that contract without changing owner
// evidence, so it must participate in the existing lifecycle fingerprint.
export const PLANNING_PRODUCTION_CONTRACT_VERSION='core-message-meta-v1';
export function planningFingerprint(ctx:ProductContentContext){return createHash('sha256').update(canonical({productionContractVersion:PLANNING_PRODUCTION_CONTRACT_VERSION,application:ctx.application,founderDirection:ctx.founderDirection,brand:ctx.brand,prohibitedTerms:ctx.prohibitedTerms,offerings:ctx.offerings,evidence:ctx.evidence,catalog:ctx.signalFoundation?.catalog})).digest('hex');}
export function rememberPlanning(ctx:ProductContentContext,recommendation:any){if(recommendation.selected){if(snapshots.size>100)snapshots.delete(snapshots.keys().next().value!);snapshots.set(key(ctx.workspaceId,ctx.productId),{recommendation,fingerprint:planningFingerprint(ctx)});}}
export async function storedPlanning(workspaceId:string,productId:string){const cached=snapshots.get(key(workspaceId,productId));if(cached)return cached;const {data,error}=await getSupabaseAdmin().from('content_assets').select('structured_data').eq('workspace_id',workspaceId).eq('product_id',productId).eq('governance','GOVERNED_CONTENT_INTELLIGENCE').contains('structured_data',{kind:'GROUNDED_PLANNING_WORK'}).is('archived_at',null).order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw Error('Planning work unavailable');return readSnapshot(data?.structured_data);}
export function validatePlanning(snapshot:any,ctx:ProductContentContext,opportunityId:string,conceptKey:string){
 if(!snapshot||snapshot.fingerprint!==planningFingerprint(ctx))throw Error('Planning context changed; refresh Content Intelligence');
 const g=snapshot.recommendation.selected;
 if(!g||g.id!==opportunityId||g.workspaceId!==ctx.workspaceId||g.productId!==ctx.productId)throw Error('Opportunity scope mismatch');
 // Existing ranker revalidates demand provenance, freshness, catalog and scope.
 const current=rankGroundedOpportunities(ctx,g.learning.patterns).selected;
 if(!current||current.id!==g.id)throw Error('Opportunity evidence is stale or changed');
 buildGroundedConceptHandoff(current as any,conceptKey);return current;
}
export async function persistPlanningWork(snapshot:any,ctx:ProductContentContext,founderId:string,opportunityId:string,conceptKey:string){
 const g=validatePlanning(snapshot,ctx,opportunityId,conceptKey),selection=recommendGroundedConcept(g as any);
 const handoff=buildGroundedConceptHandoff(g as any,conceptKey),decision={...selection,ownerSelectedConceptKey:conceptKey,overridden:conceptKey!==selection.recommendedConceptKey,selectedAt:new Date().toISOString(),founderId,opportunityId};
 const db=getSupabaseAdmin();const {data:existing,error:readError}=await db.from('content_assets').select('id').eq('workspace_id',ctx.workspaceId).eq('product_id',ctx.productId).eq('founder_id',founderId).contains('structured_data',{kind:'GROUNDED_PLANNING_WORK',handoff:{opportunityId,concept:{key:conceptKey}}}).is('archived_at',null).limit(1).maybeSingle();if(readError)throw Error('Could not read planning work');if(existing)return {id:existing.id};
 const id=randomUUID();const {error}=await db.from('content_assets').insert({id,workspace_id:ctx.workspaceId,product_id:ctx.productId,founder_id:founderId,asset_type:'landing_page_copy',channel:'Web',language:'english',status:'held',content_status:'DRAFT',governance:'GOVERNED_CONTENT_INTELLIGENCE',text_content:null,structured_data:{kind:'GROUNDED_PLANNING_WORK',state:'PLANNED',handoff,decision,snapshotJson:JSON.stringify(snapshot),snapshotSignature:signPlanningSnapshot(JSON.stringify(snapshot))},tokens_consumed:0});if(error)throw Error('Could not save planning work');return {id};
}
export async function planningContext(workspaceId:string,productId:string,founderId:string,snapshot:any,currentFoundation?:SignalFoundation){
 const {data,error}=await getSupabaseAdmin().from('products').select('id,name,markets,confirmed_icp,scraped_meta').eq('workspace_id',workspaceId).eq('id',productId).is('archived_at',null).maybeSingle();if(error||!data)throw Error('Product unavailable');
 const {resolveCatalog}=await import('./serviceCatalog');const {buildContextPackageV2}=await import('../../lib/context/contextPackageV2');const {buildProductContentContext}=await import('./productContentContext');
 const foundation=currentFoundation??snapshot?.recommendation?.foundation;const pkg=await buildContextPackageV2({workspaceId,productId,founderId,intent:'CONTENT_GENERATION',query:'what is worth marketing right now',persist:false});
 return buildProductContentContext(pkg,foundation?{...foundation,catalog:resolveCatalog(data)}:undefined);
}

export async function existingPlanningWork(ctx:ProductContentContext){
 const {data,error}=await getSupabaseAdmin().from('content_assets').select('id,structured_data').eq('workspace_id',ctx.workspaceId).eq('product_id',ctx.productId).eq('governance','GOVERNED_CONTENT_INTELLIGENCE').contains('structured_data',{kind:'GROUNDED_PLANNING_WORK'}).is('archived_at',null);
 if(error)throw Error('Planning work unavailable');
 return (data??[]).flatMap((row:any)=>{try{
  const h=row.structured_data.handoff;
  validatePlanning(readSnapshot(row.structured_data),ctx,h.opportunityId,h.concept.key);
  return [{id:row.id,conceptKey:h.concept.key,opportunityId:h.opportunityId,selectedAt:row.structured_data.decision.selectedAt,productionOpportunityId:row.structured_data.production?.ids?.opportunityId}];
 }catch{return []}}).sort((a:any,b:any)=>b.selectedAt.localeCompare(a.selectedAt));
}

/**
 * Re-binds an EXISTING planning item to today's governed evidence.
 *
 * THE DEFECT THIS CLOSES. A planning item stores a point-in-time `handoff` and
 * a signed snapshot. Content Studio judged feasibility by rebuilding the
 * opportunity from that FROZEN handoff — `conceptFeasibility(g)` with no owner
 * knowledge — while Content Intelligence judged the SAME concept from the
 * CURRENT catalog, knowledge included. So after the owner supplied exactly the
 * plumbing detail LaunchMind asked for, Intelligence said "Product
 * Demonstration, recommended first" and Studio still said "I recommend
 * changing direction" about the same concept. Two surfaces, one function,
 * different inputs.
 *
 * Both now read the same thing: this function evaluates the item's own concept
 * against the CURRENT opportunity and the CURRENT confirmed catalog, and when
 * that concept has become executable it rewrites the item's handoff and
 * snapshot IN PLACE — same row, same id, same owner decision, same production
 * lineage — so generation runs on the evidence the owner just supplied.
 *
 * @security Refreshes only when the item's own concept is READY or LIMITED
 *   against current evidence, and only when the current opportunity is still
 *   the same one the owner chose. A changed opportunity, a missing concept or
 *   an unbuildable handoff FAILS CLOSED and leaves the stored snapshot
 *   untouched, so stale evidence is never silently reused. Production keeps its
 *   own independent fingerprint check — this does not weaken that gate, it
 *   makes the item legitimately pass it.
 */
export async function refreshPlanningItem(planningId:string,workspaceId:string,founderId:string){
 const db=getSupabaseAdmin();
 const {data:row}=await db.from('content_assets')
  .select('id,product_id,structured_data,updated_at').eq('id',planningId).eq('workspace_id',workspaceId)
  .eq('governance','GOVERNED_CONTENT_INTELLIGENCE').is('archived_at',null).maybeSingle();
 const sd=(row as any)?.structured_data;
 if(!row||sd?.kind!=='GROUNDED_PLANNING_WORK'||!sd?.handoff?.concept?.key)return null;
 const conceptKey=sd.handoff.concept.key as string;
 const patterns=sd.handoff?.creativeIntelligence?.patterns??[];
 const {conceptFeasibility,recommendGroundedConcept,buildGroundedConceptHandoff}=await import('./groundedConceptPlanning');

 let ctx:ProductContentContext,ranking:any;
 try{
  const productId=String((row as any).product_id);
  const currentFoundation=await loadSignalFoundation(workspaceId,productId);
  ctx=await planningContext(workspaceId,productId,founderId,await storedPlanning(workspaceId,productId),currentFoundation);
  ranking=rankGroundedOpportunities(ctx,patterns);
 }catch{
  return {state:'CANNOT_REFRESH' as const,selected:null,alternative:null,alternativeName:null,shouldChangeDirection:false,
   ownerAction:'I could not re-check this brief against your current information. Open Content Intelligence and confirm the opportunity again.'};
 }
 // Fail closed: the opportunity the owner chose must still be the current one.
 const current=ranking.selected;
 // A fresh demand tournament produces a new evidence provenance and therefore
 // a new derived opportunity id. That alone is not a new owner decision: keep
 // the existing brief when its confirmed service and selected concept remain
 // current. A service change still fails closed.
 if(!current||current.serviceId!==sd.handoff.service.id||!current.concepts?.some((c:any)=>c.key===conceptKey)){
  return {state:'CANNOT_REFRESH' as const,selected:null,alternative:null,alternativeName:null,shouldChangeDirection:true,
   ownerAction:'Your services or market evidence changed since this brief was created. Choose a direction again in Content Intelligence.'};
 }

 // THE SAME current evidence Content Intelligence reads: the confirmed catalog
 // entry for this service, owner answers included.
 const entry=ctx.signalFoundation?.catalog?.confirmed?.find((e:any)=>e.id===current.serviceId);
 const knowledge=(entry as any)?.ownerKnowledge??null;
 const all=conceptFeasibility(current,knowledge);
 const selected=all.find(f=>f.key===conceptKey);
 if(!selected)return null;
 const rec=recommendGroundedConcept(current,knowledge);
 const alternative=rec.recommendedConceptKey&&rec.recommendedConceptKey!==conceptKey
  ? all.find(f=>f.key===rec.recommendedConceptKey)??null : null;
 const result={state:'CURRENT' as const,selected,alternative,
  alternativeName:alternative?current.concepts.find((c:any)=>c.key===alternative.key)?.pattern??null:null,
  shouldChangeDirection:selected.state==='BLOCKED'};
 // Still blocked — nothing to rebind. The stored brief stays exactly as it is,
 // and Content Studio keeps telling the owner to change direction.
 if(selected.state==='BLOCKED')return result;

 // A run in flight was started against the stored handoff. Swapping the handoff
 // underneath it would finish one attempt against a brief it never read.
 if(sd.generation?.status==='CREATING')return result;

 const fingerprint=planningFingerprint(ctx);

 // A FAILED attempt belongs to the context it ran against. Once the brief holds
 // different evidence, "I couldn't finish this draft" is a statement about work
 // nobody is being offered any more — and leaving it up parks the owner on
 // "Try again" for a problem their own answers already fixed. It is RETIRED to
 // history, never deleted, and only when it cannot be shown to belong to the
 // current context. An attempt stamped with the current fingerprint failed on
 // today's evidence and stays exactly where it is; so does anything holding a
 // real draft.
 const staleFailure=sd.generation?.status==='NEEDS_ATTENTION'
  &&sd.generation.contextFingerprint!==fingerprint;
 const retired=staleFailure
  ? {generation:null,supersededGenerations:[...(sd.supersededGenerations??[]),
     {...sd.generation,supersededAt:new Date().toISOString(),
      supersededBecause:'GENERATED_AGAINST_SUPERSEDED_EVIDENCE'}]}
  : {};

 let stored=null;try{stored=readSnapshot(sd);}catch{/* unreadable — rebind below */}
 // Already bound to current evidence. Nothing to rebind — but a failure left
 // over from an earlier context still has to be retired, which is why this is
 // not simply an early return.
 const evidenceChanged=current.id!==sd.handoff.opportunityId||sd.decision?.opportunityId!==current.id;
 if(stored?.fingerprint===fingerprint&&!evidenceChanged){
  if(!staleFailure)return result;
  const {error}=await db.from('content_assets')
   .update({structured_data:{...sd,...retired},updated_at:new Date().toISOString()})
   .eq('id',planningId).eq('workspace_id',workspaceId).eq('updated_at',(row as any).updated_at)
   .is('archived_at',null).select('id');
  return error?result:{...result,supersededFailedGeneration:true as const};
 }

 let handoff;
 try{handoff=buildGroundedConceptHandoff(current as any,conceptKey);}
 catch{
  return {...result,state:'CANNOT_REFRESH' as const,shouldChangeDirection:true,
   ownerAction:'This brief no longer matches your confirmed services. Choose a direction again in Content Intelligence.'};
 }
 const snapshotJson=JSON.stringify({fingerprint,recommendation:ranking});
 // IN PLACE, by id. `decision`, `production` and `generation` are carried forward
 // untouched: the owner's choice, the recorded override and any allocated
 // production lineage all survive the rebind. CAS on updated_at so a concurrent
 // writer cannot be silently overwritten.
 const {data:updated,error}=await db.from('content_assets')
  .update({structured_data:{...sd,...retired,handoff,decision:{...sd.decision,opportunityId:current.id},snapshotJson,snapshotSignature:signPlanningSnapshot(snapshotJson)},updated_at:new Date().toISOString()})
  .eq('id',planningId).eq('workspace_id',workspaceId).eq('updated_at',(row as any).updated_at).is('archived_at',null).select('id');
 if(error||!updated?.length)return {...result,state:'CANNOT_REFRESH' as const,
  ownerAction:'I could not update this brief just now. Reload the page and try again.'};
 return {...result,refreshed:true as const,...(staleFailure?{supersededFailedGeneration:true as const}:{})};
}
