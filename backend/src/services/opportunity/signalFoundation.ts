import {getSupabaseAdmin} from '../../lib/supabaseAdmin';
import {resolvedServiceArea} from '../content/serviceGeography';
import {resolveCatalog} from '../content/serviceCatalog';
import {deriveFreshness,freshnessReferenceDate,type SearchDemandSignal} from '../marketIntelligence/contract';
import {searchDemandReadiness,serviceDemandQueryDetails} from '../marketIntelligence/searchDemandAdapter';
import {demandWindow,loadDemandTournament,unavailableTournament} from '../marketIntelligence/demandTournament';
export async function loadSignalFoundation(workspaceId:string,productId:string){
 const db=getSupabaseAdmin();const [p,c,s]=await Promise.all([
  db.from('products').select('id,name,markets,confirmed_icp,scraped_meta').eq('workspace_id',workspaceId).eq('id',productId).single(),
  db.from('workspace_connections').select('id,provider,product_id,status,last_synced_at').eq('workspace_id',workspaceId).or(`product_id.eq.${productId},product_id.is.null`),
  db.from('intelligence_signals').select('id,provider,product_id,signal_type,period_start,period_end,synced_at').eq('workspace_id',workspaceId).or(`product_id.eq.${productId},product_id.is.null`).order('synced_at',{ascending:false}).limit(100),
 ]);
 if(p.error)throw new Error('Product catalog unavailable');
 const catalog=resolveCatalog(p.data);
 const connections=(c.data??[]).map(r=>({provider:r.provider,status:r.status,scope:r.product_id===productId?'PRODUCT':'UNMAPPED',lastSyncedAt:r.last_synced_at}));
 const ownedSignals=(s.data??[]).map(r=>({ref:r.id,provider:r.provider,type:r.signal_type,scope:r.product_id===productId?'PRODUCT':'UNMAPPED',periodStart:r.period_start,periodEnd:r.period_end,fetchedAt:r.synced_at,freshness:deriveFreshness(freshnessReferenceDate(r.period_end,null),new Date(),{current:14,aging:30}),applicability:r.product_id===productId?'Product-level only; no governed service mapping':'Unmapped; excluded from product/service decisions'}));
 const demand:SearchDemandSignal[]=[];
 const demandReadiness=searchDemandReadiness(catalog.confirmed);
 let demandUnavailable=!demandReadiness.configured?'Live demand unavailable: provider credentials are not configured; no fixture is used':demandReadiness.mode!=='ACTIVE'?'Demand source is not active under Market Intelligence mode':demandReadiness.needsClearerArea?'A supported, shared fulfillment geography is required':!demandReadiness.comparisonSupported?'The bounded two-stage comparison supports at most nine services':'';
 const request={workspaceId,productId,geography:demandReadiness.geography??'',window:demandWindow(),services:catalog.confirmed.map(e=>({id:e.id,query:serviceDemandQueryDetails(e.name).query,ownerGeography:resolvedServiceArea(e)??undefined,normalizationReason:serviceDemandQueryDetails(e.name).reason}))};
 const demandTournament=demandReadiness.ready?await loadDemandTournament(request):unavailableTournament(request,demandUnavailable);
 if(demandReadiness.ready)demandUnavailable=demandTournament.reason??'';
 // Tournament observations stay grouped. Never flatten two scales into demand[].

 return {catalog,demandReadiness,demandTournament,connections,ownedSignals,demand,demandUnavailable,readErrors:[...(c.error?['Connection mapping read unavailable']:[]),...(s.error?['Owned signal read unavailable']:[])],creativeLearning:'No performance-backed Creative Intelligence available yet.'};
}
export type SignalFoundation=Awaited<ReturnType<typeof loadSignalFoundation>>;
