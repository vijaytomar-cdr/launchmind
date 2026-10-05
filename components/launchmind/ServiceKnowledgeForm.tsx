'use client';
import {useState} from 'react';
import {api} from '@/lib/api';
import * as T from '@/lib/design-system/typography';
// Single source of truth: the questions are declared beside the inputs
// feasibility checks, so the form cannot drift from what readiness needs.
import {SERVICE_KNOWLEDGE_QUESTIONS,type ConceptInput} from '@/lib/groundedConceptPlanning';

/**
 * The three questions concept readiness found missing — asked directly, for
 * ONE service, in the owner's words.
 *
 * NOT a settings page. It appears where the owner was told something was
 * missing, asks only for that, saves to the governed catalog entry the owner
 * already confirms services through, and hands the decision straight back.
 */
export function ServiceKnowledgeForm({productId,serviceId,serviceName,token,onSaved,onCancel,requiredInputs}:{
 productId:string;serviceId:string;serviceName:string;token?:string;
 onSaved:()=>void;onCancel:()=>void;requiredInputs?:ConceptInput[];
}){
 const [values,setValues]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 const answered=Object.values(values).some(v=>v.trim().length>0);
 const save=async()=>{
  if(!token||busy||!answered)return;setBusy(true);setError(null);
  try{
   const knowledge=Object.fromEntries(Object.entries(values).filter(([,v])=>v.trim().length>0));
   await api.contentIntelligence.saveServiceKnowledge({productId,serviceId,knowledge},token);
   onSaved();
  }catch{setError('I couldn’t save this yet. Try again.');}
  finally{setBusy(false);}
 };
 return <div role="group" aria-label={`Add ${serviceName} information`} style={{padding:16,borderRadius:12,background:'var(--surface)',border:'1px solid var(--border2)',display:'grid',gap:14}}>
  <div>
   <h3 style={{...T.sectionTitle,fontSize:18,margin:0}}>Tell me about {serviceName.toLowerCase()}</h3>
   <p style={{...T.body,marginTop:6}}>Answer whichever you can. Anything you add here I can use; anything you leave blank I won’t invent.</p>
  </div>
  {SERVICE_KNOWLEDGE_QUESTIONS.filter(q=>!requiredInputs?.length||requiredInputs.includes(q.supplies)).map(q=>
   <div key={q.key}>
    <label htmlFor={`sk-${q.key}`} style={{...T.bodyStrong,display:'block'}}>{q.label(serviceName.toLowerCase())}</label>
    <p style={{...T.meta,margin:'2px 0 6px'}}>{q.help}</p>
    <textarea id={`sk-${q.key}`} rows={3} value={values[q.key]??''}
     onChange={e=>setValues(v=>({...v,[q.key]:e.target.value}))}
     style={{width:'100%',padding:'10px 12px',border:'1px solid var(--border)',borderRadius:8,fontSize:14,fontFamily:'inherit'}}/>
   </div>)}
  {error&&<p role="alert" style={{...T.body,color:'#b3261e'}}>{error}</p>}
  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
   <button type="button" disabled={!answered||busy||!token} onClick={()=>void save()}
    style={{padding:'11px 16px',border:0,borderRadius:9,background:'var(--sage)',color:'white',fontWeight:650,
     cursor:answered&&!busy?'pointer':'not-allowed',opacity:answered&&!busy?1:.6}}>
    {busy?'Saving…':'Save and re-check'}</button>
   <button type="button" disabled={busy} onClick={onCancel}
    style={{padding:'11px 16px',border:'1px solid var(--border2)',borderRadius:9,background:'white',fontWeight:650,cursor:'pointer'}}>Cancel</button>
  </div>
 </div>;
}
