import {describe,it,expect} from 'vitest';
import {deriveCustomerHypotheses,confirmedHypothesisKnowledge} from '../src/services/content/customerIntelligence';
import {availableInputs,conceptFeasibility} from '../src/services/content/groundedConceptPlanning';

const plumbing={id:'plumbing',name:'Plumbing',ownerKnowledge:{
 customerSituation:'Customers create a Plumbing service request in AllignX.',
 whatWeProvide:'AllignX customer service looks for a plumbing provider and connects them with the customer.',
}} as any;
const opportunity={id:'op',serviceId:'plumbing',productService:'Plumbing',audience:'Homeowners',evidence:[{ref:'demand'}],brief:{productTruth:'Connect with trusted home service professionals.',demandEvidence:{query:'plumber'}},concepts:[['A','PROBLEM_RECOGNITION'],['B','PRODUCT_DEMONSTRATION'],['C','CUSTOMER_EDUCATION']].map(([key,pattern])=>({key,pattern}))} as any;

describe('customer intelligence discover then confirm',()=>{
 it('uses confirmed service workflow to propose one bounded value hypothesis',()=>{
  const h=deriveCustomerHypotheses(plumbing);
  expect(h).toHaveLength(1);expect(h[0]).toMatchObject({type:'CUSTOMER_VALUE',applicability:'SERVICE_SPECIFIC',confidence:'LIMITED',ownerConfirmationRequired:true});
  expect(h[0].statement).toContain('Plumbing request');expect(h[0].allowedUses.productTruth).toBe(false);
 });
 it('does not invent a customer problem from search demand or a process-only service',()=>{
  expect(deriveCustomerHypotheses({...plumbing,ownerKnowledge:{customerSituation:plumbing.ownerKnowledge.customerSituation}})).toEqual([]);
  expect(availableInputs(opportunity,plumbing.ownerKnowledge)).not.toContain('CUSTOMER_PROBLEM');
 });
 it('promotes only a current selected proposal with its evidence lineage',()=>{
  const h=deriveCustomerHypotheses(plumbing)[0];const promoted=confirmedHypothesisKnowledge(plumbing,[h.id]);
  expect(promoted.knowledge.customerValue).toBe(h.statement);expect(promoted.hypotheses[0].evidenceTypes).toEqual(['OWNER_CONFIRMED_SERVICE_PROCESS']);
  expect(conceptFeasibility(opportunity,{...plumbing.ownerKnowledge,...promoted.knowledge}).find(v=>v.key==='B')?.state).toBe('READY');
 });
 it('keeps a service-specific proposal from becoming Electrical truth',()=>{
  expect(deriveCustomerHypotheses({...plumbing,id:'electrical',name:'Electrical'})[0].statement).toContain('Electrical');
  expect(confirmedHypothesisKnowledge({...plumbing,id:'electrical',name:'Electrical'},['service-flow:plumbing:customer_value']).hypotheses).toEqual([]);
 });
});
