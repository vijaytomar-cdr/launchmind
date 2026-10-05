/**
 * Small, deterministic customer-intelligence projection.
 *
 * This is deliberately a projection over the governed service catalog, not a
 * second knowledge store.  It can propose a customer-value angle only where
 * the owner has already confirmed the service workflow.  It never turns that
 * workflow into an AllignX capability claim; confirmation remains required.
 */
import {ownerConfirmedServiceTruth,productionServiceTruth,type OwnerServiceKnowledge} from './serviceCatalog';

export type CustomerHypothesisType='CUSTOMER_PROBLEM'|'CUSTOMER_VALUE';
export interface CustomerHypothesis {
 id:string;
 type:CustomerHypothesisType;
 statement:string;
 evidenceTypes:string[];
 evidenceReason:string;
 applicability:'SERVICE_SPECIFIC';
 confidence:'LIMITED';
 ownerConfirmationRequired:true;
 allowedUses:{marketContext:boolean;marketingHypothesis:boolean;productTruth:false};
}

const idFor=(serviceId:string,type:CustomerHypothesisType)=>`service-flow:${serviceId}:${type.toLowerCase()}`;

/**
 * The only V1 hypothesis we can responsibly derive with the currently active
 * sources. Search demand says people seek the service, not why. Public
 * customer-language sources are not configured for this workspace, so we do
 * not fabricate a problem statement from the demand score.
 */
export function deriveCustomerHypotheses(service:{id:string;name:string;ownerKnowledge?:OwnerServiceKnowledge|null}):CustomerHypothesis[]{
 const truth=productionServiceTruth(ownerConfirmedServiceTruth(service)).truth;
 const hasRequest=truth?.statements.some(s=>s.key==='customerSituation')??false;
 const hasProviderSearch=truth?.statements.some(s=>s.key==='whatWeProvide')??false;
 if(!hasRequest||!hasProviderSearch)return [];
 return [{
  id:idFor(service.id,'CUSTOMER_VALUE'),type:'CUSTOMER_VALUE',
  statement:`Customers can start a ${service.name} request in AllignX while customer service looks for a provider.`,
  evidenceTypes:['OWNER_CONFIRMED_SERVICE_PROCESS'],
  evidenceReason:`Your confirmed ${service.name.toLowerCase()} workflow says customers create a request and AllignX customer service looks for a provider.`,
  applicability:'SERVICE_SPECIFIC',confidence:'LIMITED',ownerConfirmationRequired:true,
  allowedUses:{marketContext:false,marketingHypothesis:true,productTruth:false},
 }];
}

export function confirmedHypothesisKnowledge(service:{id:string;name:string;ownerKnowledge?:OwnerServiceKnowledge|null},ids:string[]){
 const hypotheses=deriveCustomerHypotheses(service);
 const selected=hypotheses.filter(h=>ids.includes(h.id));
 return {
  hypotheses:selected,
  knowledge:Object.fromEntries(selected.map(h=>[h.type==='CUSTOMER_PROBLEM'?'customerProblem':'customerValue',h.statement])),
 };
}
