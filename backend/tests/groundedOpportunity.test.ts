import {it,expect} from 'vitest';
import {rankGroundedOpportunities} from '../src/services/opportunity/groundedOpportunity';
import {buildOpportunityPrompt} from '../src/services/opportunity/contentOpportunityService';
import type {ProductContentContext} from '../src/services/content/productContentContext';
function context():ProductContentContext{return {workspaceId:'w1',productId:'p1',application:{name:'Known product',description:'Connect with local professionals',category:null,markets:['US']},brand:{fields:{},missing:[]} as any,founderDirection:{audienceConfirmed:'Confirmed audience',contextDelta:'Customers are not reachable after a request',primaryGoal:'20 bookings/month',competitors:[]},evidence:[{ref:'direction',kind:'FOUNDER_DIRECTION',label:'Owner direction',text:'Customers are not reachable after a request'},{ref:'goal',kind:'BUSINESS_GOAL',label:'Owner goal',text:'20 bookings/month'},{ref:'product',kind:'PRODUCT_CONTEXT',label:'Product profile',text:'Connect with local professionals'}],authorizedAssets:[],observedAssetCount:0,marketIntelligenceAvailable:false,brandProvenance:[],unavailable:[],prohibitedTerms:[]};}
it('selects reported business problem before generic product education without inventing services',()=>{
 const r=rankGroundedOpportunities(context());expect(r.selected!.problem).toContain('Reaching customers');expect(r.selected!.productService).toBe('Known product');expect(r.alternatives).toHaveLength(1);expect(r.selected!.score).toBeGreaterThan(r.alternatives[0].score);expect(r.catalogLimitation).toContain('No explicit service catalog');
});
it('missing measurements are null and the goal never becomes observed bookings',()=>{
 const s=rankGroundedOpportunities(context()).selected!;expect(s.confidence).toBe('LIMITED');for(const name of ['Demand','Conversion/performance','Capacity/readiness','Market momentum'])expect(s.dimensions.find(d=>d.name===name)!.points).toBeNull();expect(s.dimensions.find(d=>d.name==='Business value')!.reason).toContain('not observed');
});
it('does not manufacture trends from stale or current public listing evidence',()=>{
 const c=context();c.evidence.push({ref:'market',kind:'MARKET_INTELLIGENCE',label:'Listing',text:'Listed publicly',freshness:'STALE'});const s=rankGroundedOpportunities(c).selected!;expect(s.brief.marketMoment).toEqual([]);expect(s.timing).toContain('no verified external');
});
it('only considers recorded service names and cannot assign generic context to one service',()=>{
 const c=context();c.offerings=[{id:'s1',name:'First recorded service',source:'OWNER_CONFIRMED'},{id:'s2',name:'Second recorded service',source:'OWNER_CONFIRMED'}];const r=rankGroundedOpportunities(c);expect([r.selected!,...r.alternatives].every(s=>s.serviceBasis==='OWNER_CONFIRMED')).toBe(true);expect(r.selected!.score).toBe(r.alternatives[0].score);expect(r.selected!.problem).not.toContain('Reaching');
});
it('binds distinct concept briefs to one opportunity, product, channel and evidence set',()=>{
 const s=rankGroundedOpportunities(context(),['Question hook']).selected!;expect(new Set(s.concepts.map(c=>c.pattern)).size).toBe(3);expect(s.concepts.every(c=>c.opportunityId===s.id&&c.productId==='p1'&&c.channel===s.channel)).toBe(true);expect(s.brief.productTruth).toBe(context().application.description);expect(s.brief.evidenceRefs).toEqual(['direction','goal','product']);
});
it('identity changes with workspace and evidence, and memory is not performance proof',()=>{
 const c=context();const a=rankGroundedOpportunities(c).selected!;c.workspaceId='w2';expect(rankGroundedOpportunities(c).selected!.id).not.toBe(a.id);c.evidence.push({ref:'m1',kind:'MARKETING_MEMORY',label:'Goal remembered',text:'Goal'});expect(rankGroundedOpportunities(c).selected!.learning.limitation).toContain('does not establish');
});
it('passes the selected grounded brief before model opportunity proposals',()=>{const p=buildOpportunityPrompt(context());expect(p).toContain('SERVER-SELECTED GROUNDED OPPORTUNITY');expect(p).toContain('Reaching customers');expect(p).toContain('No unsupported capabilities');});
