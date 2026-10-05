import {resolvedServiceArea,type ServiceArea} from '../content/serviceGeography';
import {createHash} from 'node:crypto';
import {deriveFreshness,freshnessReferenceDate,resolveMarketIntelligenceMode,type SearchDemandSignal} from './contract';
export interface DemandRequest {workspaceId:string;productId:string;services:Array<{id:string;query:string;ownerGeography?:ServiceArea;normalizationReason?:string}>;geography:string;window?:{start:string;end:string};}
/** SerpApi TIMESERIES; all queries share one comparison request. Index is relative
 * interest, never searches, bookings, market size or conversion. */
export function normalizeDemand(raw:unknown,request:DemandRequest,fetchedAt:string,fixture=false):SearchDemandSignal[]{
 const r=raw as any;const rows=r?.interest_over_time?.timeline_data;
 if(request.window&&(r?.search_parameters?.geo!==request.geography||r?.search_parameters?.date!==`${request.window.start} ${request.window.end}`||r?.search_parameters?.data_type!=='TIMESERIES'))return [];
 if(!Array.isArray(rows)||rows.length<2||request.services.length>5||!request.geography) return [];
 if(request.window&&rows.some((p:any)=>!p.partial_data&&!p.is_partial&&(!Number.isFinite(Number(p.timestamp))||Number(p.timestamp)<=0||Number(p.timestamp)*1000>Date.parse(fetchedAt)||!Array.isArray(p.values)||p.values.length!==request.services.length||request.services.some(s=>p.values.filter((v:any)=>v.query===s.query).length!==1))))return [];
 const points=rows.filter((x:any)=>!x.partial_data&&!x.is_partial&&Number.isFinite(Number(x.timestamp))&&Number(x.timestamp)>0&&Number(x.timestamp)*1000<=Date.parse(fetchedAt)).sort((a:any,b:any)=>Number(a.timestamp)-Number(b.timestamp));
 if(points.length<2||new Set(points.map((p:any)=>String(p.timestamp))).size!==points.length)return [];
 if(request.window&&points.some((p:any)=>Number(p.timestamp)*1000<Date.parse(request.window!.start)||Number(p.timestamp)*1000>=Date.parse(request.window!.end)+86400000))return [];
 const start=new Date(Number(points[0].timestamp)*1000).toISOString(),end=new Date(Number(points.at(-1).timestamp)*1000).toISOString();
 if(Date.parse(end)>Date.parse(fetchedAt))return [];
 return request.services.flatMap(service=>{
  const values=points.map((p:any)=>p.values?.find((v:any)=>v.query===service.query)?.extracted_value);
  if(values.some((v:any)=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>100))return [];
  const n=Math.max(1,Math.floor(values.length/2));const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
  const prior=mean(values.slice(0,n)),recent=mean(values.slice(n));const value=request.window?mean(values):recent;const delta=recent-prior;
  const sourceRef='https://trends.google.com/trends/explore?'+new URLSearchParams({q:request.services.map(s=>s.query).join(','),geo:request.geography,date:request.window?`${request.window.start} ${request.window.end}`:'today 1-m'});
  return [{sourceType:'SEARCH_DEMAND',provider:'serpapi_google_trends',authority:'VERIFIED_EXTERNAL',workspaceId:request.workspaceId,productId:request.productId,serviceId:service.id,query:service.query,normalizationReason:service.normalizationReason??'Explicit comparison query',ownerGeography:service.ownerGeography??null,requestedWindow:request.window,samples:points.map((p:any,i:number)=>({timestamp:new Date(Number(p.timestamp)*1000).toISOString(),value:values[i]})),comparisonGroupId:createHash('sha256').update(JSON.stringify({request,points})).digest('hex'),geography:request.geography,observedWindow:{start,end},fetchedAt,freshness:deriveFreshness(freshnessReferenceDate(end,null),new Date(fetchedAt),{current:14,aging:30}),sourceRef,provenanceId:createHash('sha256').update(JSON.stringify({request,service,points})).digest('hex'),value,unit:'RELATIVE_SEARCH_INTEREST',direction:delta>5?'RISING':delta< -5?'FALLING':'STABLE',fixture,limitations:['Relative search interest, not search volume or bookings','Only comparable within this shared query/geography/window request','No service fulfillment or conversion inferred',...(service.ownerGeography?[service.ownerGeography.scopeDisclosure]:[])]} as SearchDemandSignal];
 });
}
export async function fetchSearchDemand(request:DemandRequest):Promise<{signals:SearchDemandSignal[];unavailable:string|null}>{
 if(resolveMarketIntelligenceMode()!=='ACTIVE')return {signals:[],unavailable:'Demand source is not active under Market Intelligence mode'};
 const key=process.env.SERPAPI_API_KEY;if(!key)return {signals:[],unavailable:'Live search-demand access is unavailable: SERPAPI_API_KEY is not configured'};
 if(!request.services.length||request.services.length>5||request.services.some(s=>!s.query.trim()||s.query.length>100||s.query.includes(','))||!/^([A-Z]{2})(-[A-Z0-9]{1,3})?$/.test(request.geography))return {signals:[],unavailable:'Confirmed services and a supported fulfillment geography code are required'};
 const url=new URL('https://serpapi.com/search.json');url.search=new URLSearchParams({engine:'google_trends',data_type:'TIMESERIES',q:request.services.map(s=>s.query).join(','),geo:request.geography,date:request.window?`${request.window.start} ${request.window.end}`:'today 1-m',api_key:key}).toString();
 try{const r=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)return {signals:[],unavailable:'Live demand provider is unavailable'};
  const signals=normalizeDemand(await r.json(),request,new Date().toISOString());return signals.length===request.services.length?{signals,unavailable:null}:{signals:[],unavailable:'The complete service comparison was not returned; no partial demand result is eligible'};
 }catch{return {signals:[],unavailable:'Live demand provider is unavailable'};}
}

/** Preflight the complete confirmed set. Never broaden a narrative area or compare
 * a convenient subset while implying that all services were compared. */
export function searchDemandReadiness(services:Array<{id:string;name:string;fulfillmentGeographies:string[];serviceArea?:ServiceArea|null}>,configured=!!process.env.SERPAPI_API_KEY,mode=resolveMarketIntelligenceMode()){
 const normalized=services.map(service=>{
  return {serviceId:service.id,geography:resolvedServiceArea(service)?.providerGeography??null};
 });
 const eligibleCount=normalized.filter(s=>s.geography).length;
 const geography=normalized.length&&normalized.every(s=>s.geography&&s.geography===normalized[0].geography)?normalized[0].geography:null;
 const comparisonSupported=services.length>0&&services.length<=9;
 return {configured,mode,confirmedCount:services.length,eligibleCount,geography,needsClearerArea:!geography,comparisonSupported,maxComparedServices:9,maxQueriesPerRequest:5,
  ready:configured&&mode==='ACTIVE'&&!!geography&&comparisonSupported};
}

/** Transparent consumer-service query: retain the entire label, normalize spacing
 * and conjunctions, and add intent only when the label lacks it. No model mapping. */
export function serviceDemandQueryDetails(name:string){
 const label=name.trim().toLowerCase().replace(/&/g,' and ').replace(/\s+/g,' ');
 // Exact generic trade/service synonyms, never product-specific names or inferred features.
 const terms:Record<string,string>={'electrical':'electrician','electrical services':'electrician','plumbing':'plumber','plumbing services':'plumber','handyman':'handyman','makeup artist':'makeup artist','hvac and ac repair':'air conditioning repair','pool cleaning and maintenance':'pool cleaning service','house cleaning':'house cleaning service'};
 const mapped=terms[label];
 return {query:mapped??(/\b(service|services|repair|cleaning|maintenance|installation)\b/.test(label)?label:`${label} services`),reason:mapped?`${label==='hvac and ac repair'?'Uses the explicitly named AC-repair intent; heating/ventilation demand is not measured. ':label==='pool cleaning and maintenance'?'Uses pool-cleaning intent; other maintenance demand is not measured. ':''}Generic consumer-service synonym: “${label}” → “${mapped}”; query contract v2`:'Full label retained; spacing/case normalized and service intent added only when absent; query contract v2'};
}
export function serviceDemandQuery(name:string){return serviceDemandQueryDetails(name).query;}
