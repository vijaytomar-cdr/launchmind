'use client';
import React,{useState} from 'react';
import {api} from '@/lib/api';
import {conceptPresentation,buildGroundedConceptHandoff,recommendGroundedConcept} from '@/lib/groundedConceptPlanning';
import {ServiceKnowledgeForm} from '@/components/launchmind/ServiceKnowledgeForm';
import type {GroundedContentRecommendation,ContentIntelligenceView} from '@/lib/api';
const box={padding:24,border:'1px solid var(--border2)',borderRadius:16,background:'var(--surface)',display:'grid',gap:14};
type CustomerHypothesis={id:string;type:'CUSTOMER_VALUE';statement:string;evidenceReason:string};
/** Owner-safe display projection. The server recomputes and validates this id
 * before it promotes anything into owner knowledge. */
function displayCustomerHypotheses(service:{id:string;name:string;ownerKnowledge?:{customerSituation?:string;whatWeProvide?:string}|null}):CustomerHypothesis[]{
 if(!service.ownerKnowledge?.customerSituation?.trim()||!service.ownerKnowledge?.whatWeProvide?.trim())return [];
 return [{id:`service-flow:${service.id}:customer_value`,type:'CUSTOMER_VALUE',
  statement:`Customers can start a ${service.name} request in AllignX while customer service looks for a provider.`,
  evidenceReason:`Your confirmed ${service.name.toLowerCase()} workflow says customers create a request and AllignX customer service looks for a provider.`}];
}
export function CurrentGroundedOpportunity({recommendation,token,planningWork=[]}:{recommendation:GroundedContentRecommendation;token?:string;planningWork?:ContentIntelligenceView['planningWork']}){
 const g=recommendation.selected;
 // The owner's answers live on the confirmed catalog entry for THIS service.
 // Readiness must be computed with them, or "Save and re-check" saves without
 // re-checking and the owner sees the same "I need more" state they just answered.
 const serviceEntry=recommendation.foundation?.catalog.confirmed.find(s=>s.id===g?.serviceId);
 const ownerKnowledge=(serviceEntry as {ownerKnowledge?:{customerSituation?:string;whatWeProvide?:string;customerNote?:string;customerProblem?:string;customerValue?:string}}|undefined)?.ownerKnowledge??null;
 const policy=g?recommendGroundedConcept(g,ownerKnowledge):null;
 if(!g||!policy)return null;
 const hypotheses=serviceEntry?displayCustomerHypotheses({id:g.serviceId,name:g.productService,ownerKnowledge}):[];
 const [addingInfo,setAddingInfo]=useState(false);const [selectedHypotheses,setSelectedHypotheses]=useState<string[]>(hypotheses.map(h=>h.id));
 const [chosen,setChosen]=useState(planningWork.find(w=>w.opportunityId===g?.id)?.conceptKey??policy?.recommendedConceptKey??'');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 const chosenFeasibility=policy.feasibility.find(f=>f.key===chosen)??null;
 const chosenBlocked=chosenFeasibility?.state==='BLOCKED';
 const existing=planningWork.find(w=>w.opportunityId===g.id&&w.conceptKey===chosen);
 const create=async()=>{if(existing){window.location.assign(`/dashboard/content?planning=${encodeURIComponent(existing.id)}`);return;}if(!token||busy)return;setBusy(true);setError(null);try{const result=await api.contentIntelligence.planConcept({productId:String(g.brief.productId),opportunityId:g.id,conceptKey:chosen},token);window.location.assign(`/dashboard/content?planning=${encodeURIComponent(result.id)}`);}catch{setError('The plan could not be saved. Refresh this page and try again.');}finally{setBusy(false);}};
 const confirmHypotheses=async()=>{if(!token||busy||!selectedHypotheses.length)return;setBusy(true);setError(null);try{await api.contentIntelligence.saveServiceKnowledge({productId:String(g.brief.productId),serviceId:g.serviceId,confirmHypothesisIds:selectedHypotheses},token);window.location.reload();}catch{setError('I couldn’t save that confirmation yet. Try again.');}finally{setBusy(false);}};
 const scope=serviceEntry?.serviceArea;
 return <>
 <section style={box} aria-label="Current opportunity">
 <div>Current opportunity</div><h2 style={{fontSize:30,margin:0}}>{g.productService}</h2>
 <p style={{margin:0}}>Confidence: LIMITED — {g.confidenceExplanation}</p>
 <div><strong>Who</strong><p>{g.audience}</p><strong>Where</strong><p>{g.geography}. {scope?.scopeDisclosure}</p></div>
 <div><h3>Why now</h3><ul>{g.whyNow.map(w=><li key={w}>{w}</li>)}</ul></div>
 <div><h3>Growth thesis</h3><p>{g.growthThesis}</p></div>
 <div><strong>What to create</strong><p>Test a landing-page explanation of {g.productService}, using one of the three approaches below. Channel and creative approaches are hypotheses, not proven winners.</p></div>
 <div><strong>What’s missing</strong><p>Service-level conversion · Provider capacity · Attributable campaign performance · Performance-backed creative learning</p></div>
 <details><summary>What LaunchMind knows</summary><p>{g.learning.workspace.join(' · ')||'No relevant workspace learning available.'}</p><p>{g.learning.patterns.length?g.learning.patterns.join(' · '):'No applicable performance-backed creative pattern.'} {g.learning.limitation}</p></details>
 </section>
 <section id="recommended-concepts" style={box} aria-label="Recommended concepts"><h2>Recommended concepts</h2>
 {/* Nothing is executable well. Asking for the one missing thing is a better
     AI CMO answer than sending the owner into production that cannot succeed. */}
 {policy.needsOwnerInput&&hypotheses.length>0
  ? <div role="status" style={{padding:16,borderRadius:10,background:'var(--sage-d)',border:'1px solid var(--sage)',display:'grid',gap:12}}>
     <div><strong>I found something to confirm</strong><p style={{margin:'5px 0 0',fontSize:13}}>Based on your confirmed {g.productService.toLowerCase()} service flow, this is the customer-value angle I think is relevant. Confirm it if it is true for your customers.</p></div>
     {hypotheses.map(h=><label key={h.id} style={{padding:12,borderRadius:9,background:'white',display:'grid',gap:5,cursor:'pointer'}}><span style={{display:'flex',gap:9,alignItems:'start'}}><input type="checkbox" checked={selectedHypotheses.includes(h.id)} onChange={()=>setSelectedHypotheses(s=>s.includes(h.id)?s.filter(id=>id!==h.id):[...s,h.id])}/><strong>{h.type==='CUSTOMER_VALUE'?'Customer value':'Customer problem'}: {h.statement}</strong></span><span style={{fontSize:12,color:'var(--ink2)',marginLeft:25}}>Why I think this: {h.evidenceReason}</span></label>)}
     <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" disabled={busy||!selectedHypotheses.length||!token} onClick={()=>void confirmHypotheses()} style={{padding:'10px 14px',borderRadius:9,background:'var(--sage)',color:'white',fontWeight:650,border:0,cursor:'pointer',fontSize:13}}>{busy?'Saving…':'Confirm selected'}</button><button type="button" onClick={()=>setAddingInfo(true)} style={{padding:'10px 14px',borderRadius:9,border:'1px solid var(--border2)',background:'white',fontWeight:650,cursor:'pointer',fontSize:13}}>None of these are right</button><button type="button" onClick={()=>setAddingInfo(true)} style={{padding:'10px 14px',borderRadius:9,border:'1px solid var(--border2)',background:'white',fontWeight:650,cursor:'pointer',fontSize:13}}>Add or edit</button></div>
    </div>
  :policy.needsOwnerInput
  ? <div role="status" style={{padding:14,borderRadius:10,background:'#fdf3e3',border:'1px solid #f2d29f',display:'grid',gap:8}}>
     <strong style={{color:'#7d4306'}}>I need a little more before I can make something strong</strong>
     <p style={{margin:0,fontSize:13}}>I have a real demand signal for {g.productService.toLowerCase()}, but not enough confirmed detail to write content worth putting in front of a customer.</p>
     <ul style={{margin:0,paddingLeft:18,fontSize:13}}>{[...new Set(policy.feasibility.flatMap(f=>f.missing))].slice(0,3).map(m=><li key={m}>{m}</li>)}</ul>
     <button type="button" onClick={()=>setAddingInfo(true)} style={{justifySelf:'start',padding:'10px 14px',borderRadius:9,background:'var(--sage)',color:'white',fontWeight:650,border:0,cursor:'pointer',fontSize:13}}>Add this information →</button>
    </div>
  : <p>Here are three ways to test {g.productService.toLowerCase()}. Choose an approach before creating production content.</p>}
 {addingInfo&&<ServiceKnowledgeForm productId={String(g.brief.productId)} serviceId={g.serviceId}
   serviceName={g.productService} token={token}
   requiredInputs={['CUSTOMER_PROBLEM','CUSTOMER_VALUE']}
   onSaved={()=>{setAddingInfo(false);window.location.reload();}}
   onCancel={()=>setAddingInfo(false)}/>}
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:18}}>{g.concepts.map(c=>{
 const p=conceptPresentation(g,c.key);buildGroundedConceptHandoff(g,c.key);
 const f=policy.feasibility.find(x=>x.key===c.key);const blocked=f?.state==='BLOCKED';
 return <article key={c.key} style={{border:chosen===c.key?'2px solid var(--sage)':'1px solid var(--border2)',background:chosen===c.key?'var(--sage-d)':blocked?'var(--raised)':'transparent',borderRadius:12,padding:18,display:'grid',gap:12,opacity:blocked?.85:1}}><h3 style={{fontWeight:650}}>{c.key} · {c.name}</h3>
 {/* A decision, not a score. The owner sees whether LaunchMind can do this
     well right now and what would change it — never the policy behind it. */}
 {f&&f.state!=='READY'&&<div style={{padding:'8px 10px',borderRadius:8,background:blocked?'#fdf3e3':'var(--raised)',border:`1px solid ${blocked?'#f2d29f':'var(--border)'}`}}>
  <strong style={{fontSize:12,color:blocked?'#7d4306':'var(--ink2)'}}>{blocked?'Needs more product detail':'Possible, but less specific'}</strong>
  <p style={{margin:'4px 0 0',fontSize:13}}>{f.ownerSummary}</p>
 </div>}
 {c.key===policy.recommendedConceptKey&&<div><strong>{chosen===c.key?'Recommended first':'LaunchMind recommendation'}</strong><ul>{policy.recommendationBasis.map(r=><li key={r}>{r}</li>)}</ul></div>}
 {planningWork.some(w=>w.opportunityId===g.id&&w.conceptKey===c.key)&&<p style={{fontWeight:650,color:'var(--sage)'}}>✓ Production brief created</p>}
 <div><strong>Idea</strong><p>{p.idea}</p></div><div><strong>Why test it</strong><p>{p.whyTest}</p></div><div><strong>Approach</strong><p>{p.approach}</p></div>
 <button type="button" aria-pressed={chosen===c.key} aria-label={chosen===c.key?`${c.name} selected`:`Choose ${c.name} instead`} disabled={busy} onClick={()=>setChosen(c.key)} style={{padding:12,border:'1px solid var(--sage)',borderRadius:8,fontWeight:650,cursor:'pointer',background:chosen===c.key?'var(--sage-d)':'white',color:'var(--ink)'}}>{chosen===c.key?'✓ Selected':'Choose this instead'}</button></article>;
 })}</div>
 {chosen!==policy.recommendedConceptKey&&!chosenBlocked&&<p role="status">You’re choosing {g.concepts.find(c=>c.key===chosen)?.name} instead of LaunchMind’s recommended first test.</p>}
 {/* Selecting a blocked concept must not quietly enter the same failing
     production loop. The owner gets the two moves that can actually work. */}
 {chosenBlocked&&<div role="status" style={{padding:14,borderRadius:10,background:'#fdf3e3',border:'1px solid #f2d29f',display:'grid',gap:8}}>
  <strong style={{color:'#7d4306'}}>I can’t make this one strong yet</strong>
  <p style={{margin:0,fontSize:13}}>{chosenFeasibility?.ownerSummary}</p>
  {!!chosenFeasibility?.missing.length&&<div>
   <p style={{margin:'0 0 4px',fontSize:12,fontWeight:650}}>What I’d need from you</p>
   <ul style={{margin:0,paddingLeft:18,fontSize:13}}>{chosenFeasibility.missing.map(m=><li key={m}>{m}</li>)}</ul>
  </div>}
  <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:2}}>
   <button type="button" onClick={()=>setAddingInfo(true)} style={{padding:'10px 14px',borderRadius:9,background:'var(--sage)',color:'white',fontWeight:650,border:0,cursor:'pointer',fontSize:13}}>Add this information →</button>
   {policy.recommendedConceptKey&&<button type="button" onClick={()=>setChosen(policy.recommendedConceptKey!)} style={{padding:'10px 14px',borderRadius:9,border:'1px solid var(--border2)',background:'white',fontWeight:650,cursor:'pointer',fontSize:13}}>Use {g.concepts.find(c=>c.key===policy.recommendedConceptKey)?.name} instead</button>}
  </div>
 </div>}
 {!chosenBlocked&&<button disabled={busy||!token} onClick={()=>void create()} style={{padding:12,borderRadius:9,background:'var(--sage)',color:'white',fontWeight:650,cursor:'pointer'}}>{busy?'Preparing your work…':existing?'Open in Content Studio →':chosen===policy.recommendedConceptKey?'Create recommended concept →':'Create selected concept →'}</button>}
 <p style={{fontSize:12}}>Opens a planning item in Content Studio. No copy or images are generated yet.</p>{error&&<p role="alert">{error}</p>}
 <details><summary>Compare concepts</summary><div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}><thead><tr>{['Concept','Primary job','Why test','Best use','Risk / unknown'].map(h=><th style={{padding:8}} key={h}>{h}</th>)}</tr></thead><tbody>{g.concepts.map(c=>{const p=conceptPresentation(g,c.key);return <tr key={c.key}>{[c.name,p.job,p.hypothesis,p.bestUse,p.risk].map((v,i)=><td key={i} style={{padding:8,verticalAlign:'top'}}>{v}</td>)}</tr>})}</tbody></table></div></details>
 </section></>;
}
export function PreviousWork({active,hasHistory,children}:{active:boolean;hasHistory:boolean;children:React.ReactNode}){
 if(active&&!hasHistory)return null;
 return active?<details style={box}><summary style={{fontSize:20,fontWeight:600}}>Previous work</summary><p>Earlier directions and content created before the current market recommendation. Their presence does not establish success or failure.</p>{children}</details>:<>{children}</>;
}
