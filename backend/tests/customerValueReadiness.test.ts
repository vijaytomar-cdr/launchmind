import {describe,it,expect} from 'vitest';
import {availableInputs,conceptFeasibility,SERVICE_KNOWLEDGE_QUESTIONS} from '../src/services/content/groundedConceptPlanning';
import {ownerConfirmedServiceTruth,productionServiceTruth} from '../src/services/content/serviceCatalog';

const plumbing={id:'op',serviceId:'svc',productService:'Plumbing',audience:'Homeowners',geography:'Phoenix',channel:'LANDING_PAGE',whyNow:['Current demand'],growthThesis:'Test relevance',evidence:[{ref:'demand'}],unavailable:[],learning:{workspace:[],patterns:[],limitation:''},brief:{productTruth:'Connect with trusted, vetted home service professionals.',problem:"Understanding how Plumbing fits a customer's need",demandEvidence:{query:'plumber'}},concepts:[['A','PROBLEM_RECOGNITION'],['B','PRODUCT_DEMONSTRATION'],['C','CUSTOMER_EDUCATION']].map(([key,pattern])=>({key,pattern,opportunityId:'op'}))} as any;
const processOnly={customerSituation:'Customers create a Plumbing service request in AllignX.',whatWeProvide:'AllignX customer service looks for a plumbing provider and connects them with the customer.'};

describe('customer value is a shared production readiness requirement',()=>{
 it('does not treat process truth or demand as a customer reason to care',()=>{
  const states=conceptFeasibility(plumbing,processOnly);
  expect(states.find(s=>s.key==='B')?.state).toBe('BLOCKED');
  expect(states.find(s=>s.key==='B')?.missing.join(' ')).toMatch(/what goes wrong|useful to the customer/i);
  expect(availableInputs(plumbing,processOnly)).not.toContain('CUSTOMER_PROBLEM');
  expect(availableInputs(plumbing,processOnly)).not.toContain('CUSTOMER_VALUE');
 });
 it('allows Product Demonstration once the owner confirms either customer problem or value',()=>{
  expect(conceptFeasibility(plumbing,{...processOnly,customerValue:'Customers can use one request to begin getting Plumbing help.'}).find(s=>s.key==='B')?.state).toBe('READY');
  expect(conceptFeasibility(plumbing,{...processOnly,customerProblem:'Customers are unsure where to begin when they need Plumbing help.'}).find(s=>s.key==='B')?.state).toBe('READY');
 });
 it('evaluates current Plumbing as blocked for A, B, and C until that owner context exists',()=>{
  expect(conceptFeasibility(plumbing,processOnly).map(s=>[s.key,s.state])).toEqual([['A','BLOCKED'],['B','BLOCKED'],['C','BLOCKED']]);
 });
 it('stores focused answers as the inputs readiness and production consume',()=>{
  expect(SERVICE_KNOWLEDGE_QUESTIONS.filter(q=>['CUSTOMER_PROBLEM','CUSTOMER_VALUE'].includes(q.supplies)).map(q=>q.key)).toEqual(['customerProblem','customerValue']);
  const truth=ownerConfirmedServiceTruth({id:'svc',name:'Plumbing',ownerKnowledge:{...processOnly,customerProblem:'Customers are unsure where to begin.',customerValue:'The request gives them a clear starting point.'}})!;
  const production=productionServiceTruth(truth).truth!;
  expect(production.statements.map(s=>s.supplies)).toContain('CUSTOMER_PROBLEM');
  expect(production.statements.map(s=>s.supplies)).toContain('CUSTOMER_VALUE');
 });
});
