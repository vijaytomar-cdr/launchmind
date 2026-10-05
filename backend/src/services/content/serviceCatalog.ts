import {createHash} from 'node:crypto';
import * as cheerio from 'cheerio';
import {z} from 'zod';
import {OwnerServiceArea,normalizeServiceArea,resolvedServiceArea,type ServiceArea} from './serviceGeography';
export const CatalogConfirmation = z.object({entries:z.array(z.object({name:z.string().trim().min(2).max(100),kind:z.enum(['PRODUCT','SERVICE','CATEGORY']),category:z.string().max(100).optional(),serviceArea:OwnerServiceArea.nullable().optional(),fulfillmentGeographies:z.array(z.string().trim().min(2).max(80)).max(30).default([]),audiences:z.array(z.string().max(150)).max(10).default([])}).strict()).max(30)}).strict();

/**
 * Owner-stated knowledge about ONE service, in the owner's own words.
 *
 * Stored on the SAME governed catalog entry as everything else the owner has
 * confirmed — not a parallel knowledge store. It is OWNER_CONFIRMED by
 * construction: it exists only because the owner typed it.
 *
 * These three questions are not arbitrary. They are the inputs concept
 * readiness found missing for the real AllignX Plumbing opportunity: a
 * customer problem to recognise, and service-specific product truth to
 * demonstrate or explain.
 */
export const ServiceKnowledge=z.object({
 /** → SERVICE_PRODUCT_TRUTH. Workflow context; it is not automatically a customer benefit. */
 customerSituation:z.string().trim().max(600).optional(),
 /** → SERVICE_PRODUCT_TRUTH. What the product actually does for this service. */
 whatWeProvide:z.string().trim().max(600).optional(),
 /** → SERVICE_PRODUCT_TRUTH. Anything a customer should know. */
 customerNote:z.string().trim().max(600).optional(),
 /** → CUSTOMER_PROBLEM. Confirmed friction that makes this service matter. */
 customerProblem:z.string().trim().max(600).optional(),
 /** → CUSTOMER_VALUE. Confirmed reason this flow is useful to the customer. */
 customerValue:z.string().trim().max(600).optional(),
 /** Lineage of a LaunchMind proposal the owner explicitly confirmed. */
 hypothesisConfirmations:z.array(z.object({id:z.string().max(180),type:z.enum(['CUSTOMER_PROBLEM','CUSTOMER_VALUE']),evidenceTypes:z.array(z.string().max(80)).max(8),confirmedAt:z.string().datetime()}).strict()).max(6).optional(),
}).strict();
export type ServiceKnowledgeInput=z.infer<typeof ServiceKnowledge>;
/** Owner service knowledge as STORED: the answers plus who confirmed them and when. */
export type OwnerServiceKnowledge=ServiceKnowledgeInput&{confirmedBy?:string;confirmedAt?:string};

/**
 * Service-level product truth, in the owner's own words.
 *
 * THE ONE derivation. Concept readiness, the production brief, the capability
 * contract and the generation prompt all read service truth through this
 * function, so none of them can hold a different version of what the owner
 * confirmed. It is deliberately NOT merged into `productTruth`: that is
 * COMPANY-level positioning ("connect with trusted home service
 * professionals"), true of every service and specific to none. Keeping the two
 * separate is what lets a Product Demonstration be judged, briefed and written
 * on the truth that is actually about this service.
 *
 * @returns null when the owner has confirmed nothing for this service — never a
 *   placeholder, so "no service truth" stays distinguishable from empty text.
 * @security Returns owner-typed statements verbatim. It grants no capability on
 *   its own; the capability contract still admits only its closed vocabulary,
 *   so owner wording can never become a stronger claim than the owner made.
 */
export function ownerConfirmedServiceTruth(entry?:{id?:string;name?:string;ownerKnowledge?:OwnerServiceKnowledge|null}|null){
 const k=entry?.ownerKnowledge;if(!k)return null;
 const statements=([['whatWeProvide','SERVICE_PRODUCT_TRUTH'],['customerNote','SERVICE_PRODUCT_TRUTH'],['customerSituation','SERVICE_PRODUCT_TRUTH'],['customerProblem','CUSTOMER_PROBLEM'],['customerValue','CUSTOMER_VALUE']] as const)
  .map(([key,supplies])=>({key,supplies,text:String((k as Record<string,unknown>)[key]??'').trim()}))
  .filter(s=>s.text.length>0);
 if(!statements.length)return null;
 return {provenance:'OWNER_CONFIRMED' as const,serviceId:entry?.id??null,serviceName:entry?.name??null,
  confirmedBy:k.confirmedBy??null,confirmedAt:k.confirmedAt??null,statements};
}
export type OwnerConfirmedServiceTruth=NonNullable<ReturnType<typeof ownerConfirmedServiceTruth>>;

export interface WithheldProductionFact {key:string;text:string;reason:'PRICING_PAYMENT_OR_FULFILLMENT_NOT_ADMISSIBLE'}

/**
 * The one production projection of owner-confirmed service knowledge. Raw
 * catalog input remains unchanged for history and governance; production sees
 * only facts that can survive the current capability/evidence boundary.
 */
const PRODUCTION_WITHHELD_FACT=/\b(?:finali[sz]e|price|pricing|cost|fee|pay(?:ment|ing|s|ed)?|cash|card|fix|repair|plumber\s+(?:will|goes|comes))\b/i;
function sentences(text:string){return text.match(/[^.!?]+[.!?]?/g)?.map(s=>s.trim()).filter(Boolean)??[];}
/** Accepts the persisted handoff's older, narrower service-truth shape too. */
export function productionServiceTruth(raw:{provenance?:string;serviceId?:string|null;serviceName?:string|null;confirmedBy?:string|null;confirmedAt?:string|null;statements?:Array<{key:string;supplies:string;text:string}>}|null|undefined){
 if(!raw)return {truth:null,withheld:[] as WithheldProductionFact[]};
 const withheld:WithheldProductionFact[]=[];
 const statements=(raw.statements??[]).flatMap(statement=>sentences(statement.text).flatMap(text=>{
  if(PRODUCTION_WITHHELD_FACT.test(text)){
   withheld.push({key:statement.key,text,reason:'PRICING_PAYMENT_OR_FULFILLMENT_NOT_ADMISSIBLE'});
   return [];
  }
  return [{...statement,text}];
 }));
 return {truth:statements.length?{...raw,statements}:null,withheld};
}

export type CatalogEntry={serviceArea?:ServiceArea|null;ownerKnowledge?:OwnerServiceKnowledge|null;geographyStatus?:'CONFIRMED'|'NEEDS_RECONFIRMATION'|'UNKNOWN';id:string;name:string;kind:'PRODUCT'|'SERVICE'|'CATEGORY';status:'CONFIRMED'|'DISCOVERED_UNCONFIRMED';fulfillmentGeographies:string[];source:string;observedAt:string|null;confirmedAt?:string;confirmedBy?:string;category?:string;audiences?:string[]};
export function catalogId(productId:string,name:string){return productId+':'+createHash('sha256').update(name.trim().toLowerCase()).digest('hex').slice(0,12);}
/** Discovery is restricted to headings/links in an explicitly labeled offerings
 * section. No capabilities, counts, testimonials or geography claims are promoted. */
export function discoverCatalog(html:string,source:string,productId:string,observedAt:string):CatalogEntry[]{
 const $=cheerio.load(html);const names=new Map<string,CatalogEntry['kind']>();
 $('section').each((_,section)=>{const el=$(section);const title=el.find('h1,h2').first().text().trim();
  if(!/\b(services|products|offerings)\b/i.test(title))return;
  el.find('h3,h4').each((_,h)=>{const text=$(h).text().replace(/\s+/g,' ').trim();if(text.length>=2&&text.length<=100)names.set(text,/\bservices\b/i.test(title)?'SERVICE':/\bproducts\b/i.test(title)?'PRODUCT':'CATEGORY');});
 });
 return [...names].slice(0,30).map(([name,kind])=>({id:catalogId(productId,name),name,kind,status:'DISCOVERED_UNCONFIRMED',fulfillmentGeographies:[],source,observedAt}));
}
export function resolveCatalog(product:Record<string,any>){
 const stored=product.confirmed_icp?.serviceCatalog;const confirmed:CatalogEntry[]=Array.isArray(stored?.entries)&&stored.confirmedBy&&stored.confirmedAt
  ? stored.entries.filter((e:any)=>e.status==='CONFIRMED'&&typeof e.name==='string').map((e:any)=>({...e,id:catalogId(product.id,e.name),source:'OWNER_CONFIRMED',serviceArea:resolvedServiceArea(e),geographyStatus:resolvedServiceArea(e)?'CONFIRMED':e.fulfillmentGeographies?.length?'NEEDS_RECONFIRMATION':'UNKNOWN',confirmedAt:stored.confirmedAt,confirmedBy:stored.confirmedBy})) : [];
 const discovered:CatalogEntry[]=Array.isArray(product.scraped_meta?.catalogDiscovery?.entries)?product.scraped_meta.catalogDiscovery.entries.map((e:any)=>({...e,status:'DISCOVERED_UNCONFIRMED',fulfillmentGeographies:[]})):[];
 const requiresCatalog=discovered.length>0||confirmed.some(e=>e.kind!=='PRODUCT')||/home.services|service professionals|services marketplace/i.test(JSON.stringify([product.name,product.scraped_meta?.websiteMeta?.description]));
 return {version:stored?.version??0,confirmed,discovered:discovered.filter(e=>!confirmed.some(c=>c.id===e.id)),requiresCatalog,positioningGeographies:product.markets??[],geographyLimitation:'Product positioning is not service fulfillment coverage. Confirm areas for each offering.'};
}
export function confirmedCatalog(value:unknown,productId:string,actor:string,now:string,provenance:CatalogEntry[]=[]){const input=CatalogConfirmation.parse(value); if(new Set(input.entries.map(e=>catalogId(productId,e.name))).size!==input.entries.length)throw new Error("Duplicate offerings");return {version:1,confirmedBy:actor,confirmedAt:now,entries:input.entries.map(e=>({...e,id:catalogId(productId,e.name),status:'CONFIRMED',source:'OWNER_CONFIRMED',observedAt:now,serviceArea:e.serviceArea?normalizeServiceArea(e.serviceArea):null,geographyStatus:e.serviceArea?'CONFIRMED':e.fulfillmentGeographies.length?'NEEDS_RECONFIRMATION':'UNKNOWN',fulfillmentGeographies:e.serviceArea?[normalizeServiceArea(e.serviceArea).displayLabel]:e.fulfillmentGeographies,discoveryProvenance:provenance.find(p=>p.id===catalogId(productId,e.name))??null}))};}

export function reviseCatalogContext(previous:Record<string,any>|null,catalog:ReturnType<typeof confirmedCatalog>){
 catalog.version=(previous?.serviceCatalog?.version??0)+1;
 return {...(previous??{}),serviceCatalog:catalog,serviceCatalogHistory:[...(previous?.serviceCatalogHistory??[]),...(previous?.serviceCatalog?[previous.serviceCatalog]:[])].slice(-10)};
}
