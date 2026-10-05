import {getSupabaseAdmin} from '../../lib/supabaseAdmin';
import {MARKET_INTELLIGENCE_POLICY_VERSION} from './contract';
import {validDemandTournament,type DemandTournament,type TournamentRequest} from './demandTournament';

const protocol='DEMAND_TOURNAMENT_V1';
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`:JSON.stringify(v)??'null';

export async function loadDurableDemandTournament(request:TournamentRequest,now=new Date()):Promise<DemandTournament|null>{
 const db=getSupabaseAdmin();
 const {data:resolutions,error}=await db.from('market_intelligence_resolutions').select('source_record_id')
  .eq('workspace_id',request.workspaceId).eq('product_id',request.productId).eq('mode','ACTIVE').eq('applicability','APPLICABLE')
  .order('created_at',{ascending:false}).limit(20);
 if(error||!(resolutions??[]).length)return null;
 const ids=(resolutions??[]).map((r:any)=>r.source_record_id).filter(Boolean);
 const {data:records, error:recordError}=await db.from('market_intelligence_source_records').select('id,source_type,source_provider,lifecycle_state,observation_payload')
  .in('id',ids).eq('lifecycle_state','ACTIVE');
 if(recordError)return null;
 for(const record of records??[]){
  if(record.source_type!=='SEARCH_DEMAND'||record.source_provider!=='serpapi_google_trends')continue;
  const payload=record.observation_payload as any;
  if(payload?.protocol!==protocol)continue;
  const tournament=payload.tournament as DemandTournament|undefined;
  if(tournament&&canonical(tournament.request)===canonical(request)&&validDemandTournament(tournament,request,now))return tournament;
 }
 return null;
}

export async function persistDurableDemandTournament(result:DemandTournament):Promise<void>{
 if(!validDemandTournament(result,result.request))throw Error('Refusing invalid demand tournament persistence');
 const db=getSupabaseAdmin(), request=result.request;
 const sourceRef=result.stages.at(-1)?.signals.find(s=>s.serviceId===result.finalWinnerId)?.sourceRef??'https://trends.google.com/trends/explore';
 const contentHash=result.provenanceId!;
 const record={
  source_type:'SEARCH_DEMAND',source_provider:'serpapi_google_trends',source_ref:sourceRef,
  subject_type:'GEOGRAPHY',subject_key:`search-demand:${request.geography}:${canonical(request.services.map(s=>({id:s.id,query:s.query})))}`,
  subject_label:`Google Trends comparison in ${request.geography}`,entity_group_key:null,entity_link_basis:null,
  category_key:null,geography:request.geography,observation_type:'SEARCH_DEMAND_TOURNAMENT',
  claim_text:'Governed Google Trends search-demand tournament.',structured_value:null,unit:null,excerpt:null,
  observed_at:result.stages.at(-1)?.observedWindow.end,published_at:null,retrieved_at:result.stages.at(-1)?.fetchedAt??new Date().toISOString(),
  period_start:request.window.start,period_end:request.window.end,freshness_state_at_ingestion:'CURRENT',
  authority_tier:'VERIFIED_EXTERNAL',authority_policy_version:MARKET_INTELLIGENCE_POLICY_VERSION,
  provenance:{publisher_of_record:'Google Trends via SerpApi',provider:'serpapi_google_trends',protocol,provenanceId:result.provenanceId},
  independence_key:`search-demand:${result.provenanceId}`,lifecycle_state:'ACTIVE',content_hash:contentHash,ingestion_mode:'ACTIVE',
  observation_payload:{protocol,tournament:result},
 };
 const {data:source,error}=await db.from('market_intelligence_source_records').upsert(record,{onConflict:'content_hash'}).select('id').single();
 if(error||!source?.id)throw Error('Could not persist governed demand evidence');
 const resolution={source_record_id:source.id,workspace_id:request.workspaceId,product_id:request.productId,context_package_id:null,
  subject_relation:'CATEGORY_CONTEXT',applicability:'APPLICABLE',reason:'Current, complete governed search-demand tournament for the confirmed service/query set.',
  dimensions:{protocol,geography:request.geography,window:request.window,provenanceId:result.provenanceId},freshness_at_resolution:'CURRENT',evidence_handle_eligible:true,ineligible_reason:null,mode:'ACTIVE'};
 const {error:resolutionError}=await db.from('market_intelligence_resolutions').upsert(resolution,{onConflict:'source_record_id,workspace_id,product_id'});
 if(resolutionError)throw Error('Could not resolve governed demand evidence');
}
