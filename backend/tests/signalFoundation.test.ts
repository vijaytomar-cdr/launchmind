import {normalizeServiceArea} from '../src/services/content/serviceGeography';
import {it,expect} from 'vitest';
import {discoverCatalog,resolveCatalog,confirmedCatalog,reviseCatalogContext} from '../src/services/content/serviceCatalog';
import {normalizeDemand} from '../src/services/marketIntelligence/searchDemandAdapter';
import {applicableDemand} from '../src/services/marketIntelligence/contract';
import {rankGroundedOpportunities} from '../src/services/opportunity/groundedOpportunity';
const now='2026-09-06T12:00:00Z',productId='p',workspaceId='w';
const request={workspaceId,productId,services:[{id:'s',query:'Recorded service'}],geography:'US-AZ'};
const raw={interest_over_time:{timeline_data:[{timestamp:String(Date.parse('2026-09-01')/1000),values:[{query:'Recorded service',extracted_value:20}]},{timestamp:String(Date.parse('2026-09-05')/1000),values:[{query:'Recorded service',extracted_value:70}]}]}};
const scope={workspaceId,productId,serviceId:'s',geographies:['US-AZ']};
it('discovers only explicit offerings, without promoting claims or geography',()=>{
 const entries=discoverCatalog('<section><h2>Our services</h2><h3>Recorded service</h3></section><section><h2>Testimonials</h2><h3>Best ever</h3></section>','https://example.com',productId,now);
 expect(entries).toHaveLength(1);expect(entries[0].status).toBe('DISCOVERED_UNCONFIRMED');expect(entries[0].fulfillmentGeographies).toEqual([]);
});
it('requires explicit owner confirmation and separates national positioning from coverage',()=>{
 const c=resolveCatalog({id:productId,name:'Home Services',markets:['US'],scraped_meta:{catalogDiscovery:{entries:[{name:'Service',status:'CONFIRMED',fulfillmentGeographies:['US']}]}}});
 expect(c.confirmed).toEqual([]);expect(c.discovered[0].status).toBe('DISCOVERED_UNCONFIRMED');expect(c.discovered[0].fulfillmentGeographies).toEqual([]);
});
it('confirmation records actor/time and permits explicitly unknown fulfillment areas',()=>{
 const stored=confirmedCatalog({entries:[{name:'Recorded service',kind:'SERVICE',fulfillmentGeographies:[]}]},productId,'owner',now);
 const c=resolveCatalog({id:productId,confirmed_icp:{serviceCatalog:stored}});expect(c.confirmed[0].confirmedBy).toBe('owner');expect(c.confirmed[0].fulfillmentGeographies).toEqual([]);
 expect(()=>confirmedCatalog({entries:[{name:'Fake',kind:'SERVICE',status:'CONFIRMED',fulfillmentGeographies:[]}]},productId,'owner',now)).toThrow();
});
it('normalizes one demand source with complete provenance and relative-index limitations',()=>{
 const [s]=normalizeDemand(raw,request,now);expect(s.value).toBe(70);expect(s.direction).toBe('RISING');expect(s.freshness).toBe('CURRENT');expect(s.sourceRef).toContain('trends.google.com');expect(s.provenanceId).toHaveLength(64);expect(s.limitations.join(' ')).toContain('not search volume');expect(applicableDemand(s,scope,new Date(now))).toBe(true);
});
it('development fixtures can never influence real ranking',()=>{
 const [s]=normalizeDemand(raw,request,now,true);expect(s.fixture).toBe(true);expect(applicableDemand(s,scope,new Date(now))).toBe(false);
});
it('rejects wrong workspace, service, fulfillment area, old observations and future timestamps',()=>{
 const [s]=normalizeDemand(raw,request,now);for(const other of [{...scope,workspaceId:'other'},{...scope,serviceId:'other'},{...scope,geographies:['US']}])expect(applicableDemand(s,other,new Date(now))).toBe(false);
 expect(applicableDemand(s,scope,new Date('2026-12-01'))).toBe(false);expect(normalizeDemand(raw,request,'2026-08-01')).toEqual([]);
});
it('does not accept malformed, mismatched or incomplete provider points',()=>{
 expect(normalizeDemand({interest_over_time:{timeline_data:[]}},request,now)).toEqual([]);
 expect(normalizeDemand(raw,{...request,services:[{id:'s',query:'Other'}]},now)).toEqual([]);
});
it('blocks service selection and concept briefs when only discovered offerings exist',()=>{
 const catalog=resolveCatalog({id:productId,name:'Home Services',scraped_meta:{}});
 const r=rankGroundedOpportunities({workspaceId,productId,signalFoundation:{catalog,connections:[],ownedSignals:[],demand:[],demandUnavailable:'Unavailable',readErrors:[],creativeLearning:'Unavailable'}} as any);
 expect(r.state).toBe('NEEDS_OWNER_INPUT');expect(r.selected).toBeNull();expect(r.alternatives).toEqual([]);
});
it('ranking consumes applicable demand but not product-wide installs as service conversion',()=>{
 const fresh=new Date().toISOString();const epoch=Math.floor(Date.now()/1000);
 const [signal]=normalizeDemand({interest_over_time:{timeline_data:[{timestamp:String(epoch-86400*5),values:[{query:'Recorded service',extracted_value:20}]},{timestamp:String(epoch-86400),values:[{query:'Recorded service',extracted_value:70}]}]}},request,fresh);
 const entries=[{id:'s',name:'Recorded service',status:'CONFIRMED',source:'OWNER_CONFIRMED',kind:'SERVICE',fulfillmentGeographies:['US-AZ']},{id:'other',name:'Other recorded service',status:'CONFIRMED',source:'OWNER_CONFIRMED',kind:'SERVICE',fulfillmentGeographies:['US-AZ']}];
 const ctx={workspaceId,productId,application:{name:'Business',description:'Recorded description',markets:['US']},founderDirection:{},evidence:[{ref:'installs',kind:'CAMPAIGN_PERFORMANCE',label:'132 product installs',text:'132 installs'}],offerings:entries.map(e=>({id:e.id,name:e.name,source:'OWNER_CONFIRMED'})),signalFoundation:{catalog:{confirmed:entries,discovered:[],requiresCatalog:true},demand:[signal],ownedSignals:[],connections:[]}} as any;
 ctx.signalFoundation.catalog.confirmed.forEach((e:any)=>e.serviceArea=normalizeServiceArea({city:'Phoenix',state:'Arizona',country:'US'}));
 expect(rankGroundedOpportunities(ctx).selected).toBeNull();
 ctx.signalFoundation.demand.push({...signal,serviceId:'other',query:'Other recorded service',direction:'STABLE'});
 const r=rankGroundedOpportunities(ctx);expect(r.selected!.serviceId).toBe('s');expect(r.selected!.dimensions.find(d=>d.name==='Conversion/performance')!.points).toBeNull();expect(r.selected!.whyNow[0]).toContain('Observed relative search interest');
 ctx.signalFoundation.demand=[{...signal,fixture:true}];const tied=rankGroundedOpportunities(ctx);expect(tied.selected).toBeNull();expect(tied.state).toBe('INSUFFICIENT_EVIDENCE');expect(tied.alternatives).toHaveLength(2);expect(tied.alternatives.every(c=>c.concepts.length===0)).toBe(true);
});
it('does not ask an LLM to invent an opportunity when service confirmation is required',async()=>{
 const {generateContentOpportunities}=await import('../src/services/opportunity/contentOpportunityService');
 let calls=0;const ctx={signalFoundation:{catalog:{requiresCatalog:true,confirmed:[]}}} as any;
 const r=await generateContentOpportunities({ctx,origin:'AI_CMO_RECOMMENDED',founderId:'owner',generate:async()=>{calls++;return '[]';}});
 expect(calls).toBe(0);expect(r.prioritised).toEqual([]);expect(r.degradedReasons[0]).toContain('Service confirmation');
});

it('retains discovery provenance and leaves omitted discoveries unconfirmed',()=>{
 const discovery=discoverCatalog('<section><h2>Services</h2><h3>Plumbing</h3><h3>Electrical</h3></section>','https://example.com','p',now);
 const first=confirmedCatalog({entries:[{name:'Plumbing',kind:'SERVICE',fulfillmentGeographies:['Phoenix']}]},'p','owner',now,discovery);
 expect(first.entries[0].discoveryProvenance).toEqual(discovery[0]);expect(first.version).toBe(1);expect(first.confirmedAt).toBe(now);
 const resolved=resolveCatalog({id:'p',confirmed_icp:{serviceCatalog:first},scraped_meta:{catalogDiscovery:{entries:discovery}}});
 expect(resolved.confirmed.map(e=>e.name)).toEqual(['Plumbing']);expect(resolved.discovered.map(e=>e.name)).toEqual(['Electrical']);
 expect(confirmedCatalog({entries:[]},'p','owner',now).entries).toEqual([]);
});

it('revisions preserve prior confirmation and unrelated context when areas change or services are removed',()=>{
 const first=confirmedCatalog({entries:[{name:'Plumbing',kind:'SERVICE',fulfillmentGeographies:['Phoenix']}]},'p','owner',now);
 const second=confirmedCatalog({entries:[]},'p','owner',now);
 const revised=reviseCatalogContext({audience:'Existing audience',serviceCatalog:first},second);
 expect(revised.serviceCatalog.version).toBe(2);expect(revised.serviceCatalogHistory).toEqual([first]);expect(revised.audience).toBe('Existing audience');expect(first.entries[0].fulfillmentGeographies).toEqual(['Phoenix']);
});
