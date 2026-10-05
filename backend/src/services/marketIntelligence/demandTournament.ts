/** Bounded selection protocol on the existing SerpApi adapter. Stage indices
 * never share a numeric scale. This is demand evidence, not opportunity scoring. */
import {createHash} from 'node:crypto';
import {applicableDemand,resolveMarketIntelligenceMode,type SearchDemandSignal} from './contract';
import {fetchSearchDemand,type DemandRequest} from './searchDemandAdapter';
import {loadDurableDemandTournament,persistDurableDemandTournament} from './demandTournamentEvidence';
export type TournamentRequest=DemandRequest & {window:{start:string;end:string}};
export interface DemandStage {stage:1|2;comparisonGroupId:string;serviceIds:string[];winnerId:string;signals:SearchDemandSignal[];geography:string;window:{start:string;end:string};observedWindow:{start:string;end:string};fetchedAt:string;provider:'serpapi_google_trends'}
export interface DemandTournament {status:'UNAVAILABLE'|'FAILED'|'COMPLETE';request:TournamentRequest;stages:DemandStage[];finalWinnerId:string|null;reason:string|null;limitations:string[];provenanceId:string|null}
export function demandWindow(now=new Date()) {const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-86400000);return {start:new Date(end.getTime()-89*86400000).toISOString().slice(0,10),end:end.toISOString().slice(0,10)};}
export function planDemandTournament(request:TournamentRequest){
 if(!/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(request.geography)||!/^\d{4}-\d{2}-\d{2}$/.test(request.window.start)||!/^\d{4}-\d{2}-\d{2}$/.test(request.window.end)||Date.parse(request.window.end)-Date.parse(request.window.start)!==89*86400000)throw Error('A fixed 90-day window and supported geography are required');
 const services=[...request.services].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(!services.length||services.length>9||new Set(services.map(s=>s.id)).size!==services.length||new Set(services.map(s=>s.query)).size!==services.length)throw Error('One to nine unique services and queries required');
 return {first:services.slice(0,5),remaining:services.slice(5),ordering:'Stable service identity, ascending binary order' as const};
}
const limitations=['Selection follows two shared comparisons; there is no global 0–100 scale or complete ranking of all services','Search samples and query wording can affect selection; this is a bounded evidence path, not proof of business growth','Relative search interest is not search volume, bookings, conversion or provider capacity','Within each stage: mean interest across one fixed 90-day window; trend compares its halves using the existing adapter'];
export function unavailableTournament(request:TournamentRequest,reason:string):DemandTournament{return {status:'UNAVAILABLE',request,stages:[],finalWinnerId:null,reason,limitations:[...limitations],provenanceId:null};}
function checkStage(request:TournamentRequest,signals:SearchDemandSignal[],stage:1|2,now:Date):DemandStage|null{
 if(signals.length!==request.services.length||new Set(signals.map(s=>s.serviceId)).size!==signals.length)return null;
 const first=signals[0];if(!first?.comparisonGroupId)return null;
 for(const service of request.services){const signal=signals.find(s=>s.serviceId===service.id);if(!signal||signal.provider!=='serpapi_google_trends'||signal.authority!=='VERIFIED_EXTERNAL'||signal.query!==service.query||!applicableDemand(signal,{workspaceId:request.workspaceId,productId:request.productId,serviceId:service.id,geographies:[request.geography]},now))return null;
  if(signal.comparisonGroupId!==first.comparisonGroupId||JSON.stringify(signal.requestedWindow)!==JSON.stringify(request.window)||JSON.stringify(signal.observedWindow)!==JSON.stringify(first.observedWindow))return null;
  // Numeric zeros are observed low relative interest, not missing data.
  // Only the advancing winner must satisfy the meaningful-interest gate below.
  if(!signal.samples||signal.samples.length<8)return null;
  if(signal.samples.some(p=>!Number.isFinite(p.value)||p.value<0||p.value>100||!Number.isFinite(Date.parse(p.timestamp))))return null;
  const timestamps=signal.samples.map(p=>p.timestamp);if(timestamps.some((t,i)=>i>0&&Date.parse(t)<=Date.parse(timestamps[i-1])))return null;
  if(new Set(timestamps).size!==timestamps.length||JSON.stringify(timestamps)!==JSON.stringify(first.samples?.map(p=>p.timestamp)))return null;
  if(timestamps.some(t=>Date.parse(t)<Date.parse(request.window.start)||Date.parse(t)>=Date.parse(request.window.end)+86400000))return null;
  if(timestamps[0]!==signal.observedWindow.start||timestamps.at(-1)!==signal.observedWindow.end||Date.parse(signal.observedWindow.end)-Date.parse(signal.observedWindow.start)<60*86400000)return null;
  const mean=signal.samples.reduce((sum,p)=>sum+p.value,0)/signal.samples.length;if(Math.abs(mean-signal.value)>1e-8)return null;
 }
 const sorted=[...signals].sort((a,b)=>b.value-a.value),winner=sorted[0];
 // Conservative quality gates, not statistical confidence estimates: avoid a
 // noise-floor winner, mostly-zero winner, ties and near-ties at index resolution.
 if(winner.value<5||winner.samples!.filter(p=>p.value>0).length/winner.samples!.length<0.8||(sorted[1]&&winner.value-sorted[1].value<Math.max(2,winner.value*0.05)))return null;
 return {stage,comparisonGroupId:first.comparisonGroupId,serviceIds:request.services.map(s=>s.id),winnerId:winner.serviceId,signals,geography:request.geography,window:request.window,observedWindow:first.observedWindow,fetchedAt:signals.reduce((latest,s)=>s.fetchedAt>latest?s.fetchedAt:latest,first.fetchedAt),provider:'serpapi_google_trends'};
}
export async function executeDemandTournament(request:TournamentRequest,fetchStage:(r:DemandRequest)=>Promise<{signals:SearchDemandSignal[];unavailable:string|null}>,now=new Date()):Promise<DemandTournament>{
 const result=unavailableTournament(request,'Comparison has not completed');result.status='FAILED';
 try{
  const plan=planDemandTournament(request);const firstRequest={...request,services:plan.first};
  const firstResponse=await fetchStage(firstRequest);const first=!firstResponse.unavailable&&checkStage(firstRequest,firstResponse.signals,1,now);
  if(!first){result.reason='The first comparison did not provide a complete, current and clear demand winner';return result;}result.stages.push(first);
  if(plan.remaining.length){const secondRequest={...request,services:[plan.first.find(s=>s.id===first.winnerId)!,...plan.remaining]};const secondResponse=await fetchStage(secondRequest);const second=!secondResponse.unavailable&&checkStage(secondRequest,secondResponse.signals,2,now);
   if(!second||JSON.stringify(first.observedWindow)!==JSON.stringify(second.observedWindow)||JSON.stringify(first.signals[0].samples!.map(p=>p.timestamp))!==JSON.stringify(second.signals[0].samples!.map(p=>p.timestamp))){result.reason='The final comparison failed or did not use the same observed dates; no final winner';return result;}result.stages.push(second);
  }
  result.status='COMPLETE';result.reason=null;result.finalWinnerId=result.stages.at(-1)!.winnerId;result.provenanceId=createHash('sha256').update(JSON.stringify({request,stages:result.stages})).digest('hex');return result;
 }catch{result.reason='The comparison could not be completed; no final winner';return result;}
}
/** Revalidate at consumption time, including lineage and current scope. */
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value)??'null';}
export function validDemandTournament(result:DemandTournament|undefined,request:TournamentRequest,now=new Date()):boolean{
 if(!result||result.status!=='COMPLETE'||!result.finalWinnerId)return false;
 try{const plan=planDemandTournament(request);if(canonical(result.request)!==canonical(request)||result.stages.length!==(plan.remaining.length?2:1))return false;
 const first=checkStage({...request,services:plan.first},result.stages[0].signals,1,now);if(!first||canonical(first)!==canonical(result.stages[0]))return false;
 if(plan.remaining.length){const second=checkStage({...request,services:[plan.first.find(s=>s.id===first.winnerId)!,...plan.remaining]},result.stages[1].signals,2,now);if(!second||canonical(second)!==canonical(result.stages[1])||JSON.stringify(first.signals[0].samples?.map(p=>p.timestamp))!==JSON.stringify(second.signals[0].samples?.map(p=>p.timestamp)))return false;}
 return result.finalWinnerId===result.stages.at(-1)!.winnerId&&result.provenanceId===createHash('sha256').update(JSON.stringify({request:result.request,stages:result.stages})).digest('hex');
 }catch{return false;}
}
// In-flight coalescing and a bounded six-hour result cache prevent read-model
// refreshes from launching more comparisons. Failures are cached too, no retries.
const cache=new Map<string,{until:number;value:Promise<DemandTournament>}>();
export async function loadDemandTournament(request:TournamentRequest):Promise<DemandTournament>{
 if(!process.env.SERPAPI_API_KEY||resolveMarketIntelligenceMode()!=='ACTIVE')return Promise.resolve(unavailableTournament(request,'Search-demand administrator configuration is required'));
 if(Date.parse(request.window.end)>=Date.now()||Date.parse(request.window.end)<Date.now()-14*86400000)return Promise.resolve(unavailableTournament(request,'A current, completed observation window is required'));
 if(!request.services.every(s=>s.ownerGeography?.providerGeography===request.geography))return Promise.resolve(unavailableTournament(request,'Confirmed, shared service geography is required'));
 const key=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=cache.get(key);if(existing&&existing.until>Date.now())return existing.value;
 for(const [k,v] of cache)if(v.until<=Date.now())cache.delete(k);if(cache.size>=100)cache.delete(cache.keys().next().value!);
 const value=(async()=>{
  const durable=await loadDurableDemandTournament(request);
  if(durable)return durable;
  const result=await executeDemandTournament(request,fetchSearchDemand);
  if(result.status==='COMPLETE'){
   try{await persistDurableDemandTournament(result);}catch{return unavailableTournament(request,'Current demand evidence could not be durably recorded');}
  }
  return result;
 })();cache.set(key,{until:Date.now()+6*3600000,value});return value;
}
