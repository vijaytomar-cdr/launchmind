import {randomUUID} from 'node:crypto';
import {getSupabaseAdmin} from '../../lib/supabaseAdmin';
export type ProductionState='READY_TO_CREATE'|'CREATING'|'NEEDS_ATTENTION'|'READY_FOR_REVIEW';
export function productionOutcome(result:any,httpStatus:number){
 if(httpStatus<400&&result.ownerState==='READY_FOR_OWNER_REVIEW'&&result.assetId)return {status:'READY_FOR_REVIEW' as const,assetId:result.assetId,versionNumber:result.versionNumber,reason:'NONE'};
 const reason=result.quality?.factualSafety==='NOT_SUPPORTED'||result.disposition==='PROHIBITED'?'UNSUPPORTED_WORDING':result.structuralIssues?.some((i:any)=>i.severity==='ERROR')?'FORMAT':result.failureClass==='ARTIFACT_PERSISTENCE_FAILED'?'ARTIFACT_PERSISTENCE_FAILED':result.failureClass==='ORCHESTRATION_FAILED'?'ORCHESTRATION_FAILED':result.disposition==='REWRITE_REQUIRED'?'CONTENT_REFINEMENT_REQUIRED':httpStatus>=400||result.disposition==='DEGRADED'?'CHECK_UNAVAILABLE':'UNKNOWN';
 return {status:'NEEDS_ATTENTION' as const,reason};
}
export function productionState(data:any){return data?.generation?.status??'READY_TO_CREATE';}
/**
 * @param contextFingerprint fingerprint of the governed context this run reads.
 *   Stamped on the attempt so a later read can tell whether a FAILURE belongs to
 *   the evidence the brief currently holds. Without it, a failure recorded
 *   against superseded evidence is indistinguishable from one against current
 *   evidence, and the owner is shown "Try again" for a problem already fixed.
 */
export async function beginPlanningRun(id:string,workspaceId:string,contextFingerprint?:string){
 const db=getSupabaseAdmin();const {data:row,error}=await db.from('content_assets').select('structured_data,updated_at').eq('id',id).eq('workspace_id',workspaceId).is('archived_at',null).single();
 if(error||!row||row.structured_data?.kind!=='GROUNDED_PLANNING_WORK')throw Error('Planning item unavailable');
 if(row.structured_data.generation?.status==='CREATING')throw Error('Creation is already in progress');
 const run={attemptId:randomUUID(),status:'CREATING',startedAt:new Date().toISOString(),contextFingerprint:contextFingerprint??null};
 // PostgREST renders timestamptz as `...+00:00`, while the planning writers
 // persist canonical ISO `...Z`. Compare instants, not the transport spelling;
 // keep the same CAS guard so a concurrent state change still wins safely.
 const observedUpdatedAt=new Date(row.updated_at).toISOString();
 const {data,error:writeError}=await db.from('content_assets').update({structured_data:{...row.structured_data,generation:run},updated_at:run.startedAt}).eq('id',id).eq('workspace_id',workspaceId).eq('updated_at',observedUpdatedAt).select('id');
 if(writeError||!data?.length)throw Error('Creation state changed');return run;
}
export async function finishPlanningRun(id:string,workspaceId:string,attemptId:string,result:any,httpStatus:number){
 const db=getSupabaseAdmin();const {data:row,error}=await db.from('content_assets').select('structured_data').eq('id',id).eq('workspace_id',workspaceId).is('archived_at',null).single();
 if(error||row?.structured_data?.generation?.attemptId!==attemptId)throw Error('Creation attempt changed');
 const outcome=productionOutcome(result,httpStatus);
 const generation={...row.structured_data.generation,...outcome,finishedAt:new Date().toISOString(),copyCalls:result.copyGenerationCalls??null,repairs:result.copyRepairs??null};
 const {error:writeError}=await db.from('content_assets').update({structured_data:{...row.structured_data,generation},updated_at:generation.finishedAt}).eq('id',id).eq('workspace_id',workspaceId).eq('structured_data->generation->>attemptId',attemptId);
 if(writeError)throw Error('Could not retain creation state');return generation;
}

/** Promotes a retained authentic candidate after governed re-evaluation. This
 * never starts generation; its original attempt identity stays intact. */
export async function recoverPlanningRun(id:string,workspaceId:string,attemptId:string,result:any){
 const db=getSupabaseAdmin();const {data:row,error}=await db.from('content_assets').select('structured_data').eq('id',id).eq('workspace_id',workspaceId).is('archived_at',null).single();
 const prior=row?.structured_data?.generation;
 if(error||!prior||prior.attemptId!==attemptId||prior.status!=='NEEDS_ATTENTION')throw Error('Retained generation is not recoverable');
 const outcome=productionOutcome(result,201);
 if(outcome.status!=='READY_FOR_REVIEW')throw Error('Retained candidate is not owner-reviewable');
 const generation={...prior,...outcome,recoveredAt:new Date().toISOString(),recoveredBy:'GOVERNED_REEVALUATION'};
 const {error:writeError}=await db.from('content_assets').update({structured_data:{...row.structured_data,generation},updated_at:generation.recoveredAt}).eq('id',id).eq('workspace_id',workspaceId).eq('structured_data->generation->>attemptId',attemptId);
 if(writeError)throw Error('Could not retain recovered generation state');return generation;
}
