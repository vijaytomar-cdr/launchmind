'use client';
import {useEffect,useState} from 'react';
import {api} from '@/lib/api';
import * as T from '@/lib/design-system/typography';
import {Dialog} from '@/components/launchmind/Dialog';
import {ContentStudioLoading} from '@/components/launchmind/LoadingState';

type Work=Awaited<ReturnType<typeof api.contentIntelligence.planningWork>>;
type Editable={h1:string;subhead:string;benefits:string;objectionSection:string;cta:string};

const btnPrimary:React.CSSProperties={padding:'11px 18px',border:0,borderRadius:10,background:'var(--sage)',color:'white',fontSize:14,fontWeight:650,cursor:'pointer'};
const btnGhost:React.CSSProperties={padding:'11px 18px',border:'1px solid var(--border)',borderRadius:10,background:'white',color:'var(--ink)',fontSize:14,fontWeight:600,cursor:'pointer'};

function toEditable(content:Record<string,any>):Editable{
 return {h1:String(content.h1??''),subhead:String(content.subhead??''),
  benefits:Array.isArray(content.benefits)?content.benefits.join('\n'):'',
  objectionSection:String(content.objectionSection??''),
  cta:Array.isArray(content.ctas)?content.ctas.join(', '):String(content.cta??'')};
}
function fromEditable(e:Editable){
 return {h1:e.h1.trim(),subhead:e.subhead.trim(),
  benefits:e.benefits.split('\n').map(s=>s.trim()).filter(Boolean),
  proofSection:'',objectionSection:e.objectionSection.trim(),
  ctas:e.cta.split(',').map(s=>s.trim()).filter(Boolean)};
}

/** Generated copy, shown as one reviewable creative package once a draft exists. */
function GeneratedCopy({content,visual,approved,onApprove,onEdit,onRegenerate,approving,regenerating,approveError,regenerateReady}:{
 content:Record<string,any>;approved:boolean;approving:boolean;regenerating:boolean;approveError:string|null;
 visual?:{imageUrl:string}|null;
 onApprove:()=>void;onEdit:()=>void;onRegenerate:()=>void;regenerateReady:boolean;
}){
 const coreMessage=typeof content.primaryText==='string';
 const [inspect,setInspect]=useState(false);
 const visualColumn=visual?.imageUrl&&<div style={{display:'grid',gap:8,justifyItems:'center',alignContent:'start'}}>
  <p style={{...T.eyebrow,justifySelf:'start',width:'min(100%,360px)'}}>Creative</p>
  <button type="button" onClick={()=>setInspect(true)} aria-label="Inspect finished creative" style={{padding:0,border:'1px solid var(--border)',borderRadius:12,background:'var(--raised)',cursor:'zoom-in',overflow:'hidden',width:'min(100%,360px)',aspectRatio:'1 / 1'}}>
   <img src={visual.imageUrl} alt="Finished AllignX Plumbing creative — view larger" style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/>
  </button>
  <button type="button" onClick={()=>setInspect(true)} style={{border:0,padding:0,background:'transparent',color:'var(--sage)',fontSize:13,fontWeight:650,cursor:'pointer',justifySelf:'start',width:'min(100%,360px)'}}>View larger ↗</button>
  {inspect&&<Dialog label="Finished creative" onClose={()=>setInspect(false)} maxWidth={900}><div style={{display:'grid',gap:12,padding:20}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><p style={T.bodyStrong}>Finished creative</p><button type="button" onClick={()=>setInspect(false)} style={btnGhost}>Close</button></div>
   <img src={visual.imageUrl} alt="Finished AllignX Plumbing creative" style={{width:'100%',maxHeight:'78vh',objectFit:'contain',display:'block'}}/>
  </div></Dialog>}
 </div>;
 return <section aria-label="Generated content" style={{...T.card,padding:'clamp(20px,3vw,32px)',borderColor:approved?'var(--sage)':'var(--border)',display:'grid',gap:20}}>
  <div>
   <p style={{...T.eyebrow,color:approved?'var(--sage)':undefined}}>{approved?'Approved':'Ready for review'}</p>
   <p style={{...T.body,marginTop:4}}>{approved?'This version is approved. Nothing has been published.':'LaunchMind created this message for the current opportunity. Nothing has been approved or published yet.'}</p>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))',gap:'clamp(24px,4vw,48px)',alignItems:'start'}}>
   {visualColumn}
   <div style={{display:'grid',gap:14,minWidth:0,maxWidth:640}}>
    <p style={T.eyebrow}>Message</p>
    {coreMessage ? <>
     <div><p style={T.eyebrow}>Primary text</p><p style={{...T.bodyStrong,marginTop:6}}>{String(content.primaryText)}</p></div>
     <div><p style={T.eyebrow}>Headline</p><h2 style={{...T.sectionTitle,fontSize:26,marginTop:6}}>{String(content.headline??'')}</h2></div>
     <div><p style={T.eyebrow}>Description</p><p style={{...T.body,marginTop:6}}>{String(content.description??'')}</p></div>
    </> : <><h2 style={{...T.sectionTitle,fontSize:26}}>{String(content.h1??'')}</h2><p style={{...T.bodyStrong}}>{String(content.subhead??'')}</p></>}
    {!!content.proofSection&&<p style={T.body}>{String(content.proofSection)}</p>}
    {Array.isArray(content.benefits)&&content.benefits.length>0&&<ul style={{display:'grid',gap:10,paddingLeft:20}}>{content.benefits.map((b:string,i:number)=><li key={i} style={T.body}>{b}</li>)}</ul>}
    {!!content.objectionSection&&<p style={{...T.body,color:'var(--ink2)'}}>{String(content.objectionSection)}</p>}
    {(coreMessage ? !!content.cta : Array.isArray(content.ctas)&&content.ctas.length>0)&&<div><p style={T.eyebrow}>CTA</p><p style={{...T.bodyStrong,marginTop:6}}>{coreMessage ? String(content.cta) : content.ctas.join(' · ')}</p></div>}
    {approveError&&<p role="alert" style={{...T.body,color:'#b3261e'}}>{approveError}</p>}
    <div style={{display:'flex',gap:10,flexWrap:'wrap',paddingTop:4}}>
     {!approved&&<button type="button" style={{...btnPrimary,opacity:approving?.7:1}} disabled={approving||regenerating} onClick={onApprove}>{approving?'Approving…':'Approve'}</button>}
     <button type="button" style={btnGhost} disabled={approving||regenerating} onClick={onEdit}>Edit creative</button>
     <button type="button" style={{...btnGhost,opacity:regenerateReady?1:.6,cursor:regenerateReady?'pointer':'not-allowed'}} disabled={approving||regenerating||!regenerateReady} onClick={onRegenerate}>{regenerating?'Creating another version…':regenerateReady?'Create another version':'Checking…'}</button>
    </div>
   </div>
  </div>
 </section>;
}

/** Inline editor for the generated draft — re-governed on save, never a second persistence path. */
function EditDraft({draft,onChange,onSave,onCancel,saving,error}:{
 draft:Editable;onChange:(d:Editable)=>void;onSave:()=>void;onCancel:()=>void;saving:boolean;error:string|null;
}){
 const field=(label:string,key:keyof Editable,rows=1)=>
  <div><label style={{...T.eyebrow,display:'block',marginBottom:6}}>{label}</label>
   {rows===1
    ?<input value={draft[key]} onChange={e=>onChange({...draft,[key]:e.target.value})} style={{width:'100%',padding:'10px 12px',border:'1px solid var(--border)',borderRadius:8,fontSize:14}}/>
    :<textarea value={draft[key]} onChange={e=>onChange({...draft,[key]:e.target.value})} rows={rows} style={{width:'100%',padding:'10px 12px',border:'1px solid var(--border)',borderRadius:8,fontSize:14,fontFamily:'inherit'}}/>}
  </div>;
 return <section aria-label="Edit generated content" style={{...T.card,padding:'clamp(20px,3vw,32px)',display:'grid',gap:16}}>
  <p style={T.eyebrow}>Editing draft</p>
  {field('Headline','h1')}
  {field('Subhead','subhead',2)}
  {field('Benefits (one per line)','benefits',5)}
  {field('Objection / trust section','objectionSection',3)}
  {field('Call to action (comma-separated)','cta')}
  {error&&<p role="alert" style={{...T.body,color:'#b3261e'}}>{error}</p>}
  <p style={{...T.body,color:'var(--ink2)'}}>Your edit will be checked against the same content rules as a new draft before it is saved.</p>
  <div style={{display:'flex',gap:10}}>
   <button type="button" style={{...btnPrimary,opacity:saving?.7:1}} disabled={saving} onClick={onSave}>{saving?'Saving…':'Save edit'}</button>
   <button type="button" style={btnGhost} disabled={saving} onClick={onCancel}>Cancel</button>
  </div>
 </section>;
}

export function ProductionBrief({work,ready=false,preparing=false,stale=false,creating=false,onGenerate,
 editing=false,draft,onStartEdit,onEditChange,onSaveEdit,onCancelEdit,saving=false,editError=null,
 onApprove,approving=false,approveError=null}:{
 work:Work;ready?:boolean;preparing?:boolean;stale?:boolean;creating?:boolean;onGenerate?:()=>void;
 editing?:boolean;draft?:Editable;onStartEdit?:()=>void;onEditChange?:(d:Editable)=>void;
 onSaveEdit?:()=>void;onCancelEdit?:()=>void;saving?:boolean;editError?:string|null;
 onApprove?:()=>void;approving?:boolean;approveError?:string|null;
}){
 const h=work.handoff,c=h.groundedBrief.concepts.find((c:any)=>c.key===h.concept.key);
 const direction=h.concept.family==='PRODUCT_DEMONSTRATION'
  ? `Explain the product’s supported role for someone looking for ${h.service.name.toLowerCase()} help.`
  : h.concept.family==='CUSTOMER_EDUCATION'
  ? `Answer service-fit questions for someone considering ${h.service.name.toLowerCase()} help.`
  : `Help someone recognize when they may need ${h.service.name.toLowerCase()} help.`;
 const label={...T.eyebrow,marginBottom:8};
 const state=creating?'CREATING':work.generation?.status??'READY_TO_CREATE';
 const failed=state==='NEEDS_ATTENTION',success=state==='READY_FOR_REVIEW';
 const approved=work.content?.status==='CONTENT_APPROVED';
 const feas=work.feasibility ?? null;
 // Only when there is no usable draft. An existing approved or reviewable
 // draft is real work and is never hidden behind a change-of-direction notice.
 const changeDirection=!!feas?.shouldChangeDirection&&!!feas?.selected&&!success;
 // The server could not re-check this brief against current evidence. Generating
 // anyway would run on evidence nobody has confirmed is still true, so the owner
 // gets the action that resolves it rather than a button that cannot succeed.
 const cannotRefresh=feas?.state==='CANNOT_REFRESH'&&!success;
 const reason=work.generation?.reason==='FORMAT'?'Some required wording still did not fit the content format.':work.generation?.reason==='UNSUPPORTED_WORDING'?'The draft still contained wording LaunchMind could not safely support.':'LaunchMind could not complete the required content checks.';

 // The brief is the PRIMARY content only before a draft exists. Once
 // generated copy is on the page, the brief becomes reference material.
 const briefBody=<>
  <div><div style={label}>Content type</div><p style={T.body}>Core marketing message</p></div>
  <div><div style={label}>Message direction</div><p style={T.bodyStrong}>{direction}</p></div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:24}}>
   <div><div style={label}>Audience</div><p style={T.body}>{h.audience}</p></div>
   <div><div style={label}>Market</div><p style={T.body}>{h.geography}</p></div>
   <div><div style={label}>Goal</div><p style={T.body}>{h.growthThesis}</p></div>
  </div>
 </>;

 return <main style={{padding:'clamp(20px,3vw,32px)',maxWidth:1040,margin:'0 auto',display:'grid',gap:24}}>
  <a href="/dashboard/intelligence/content" style={{color:'var(--sage)',fontSize:14}}>← Back to Content Intelligence</a>
  <div><p style={T.eyebrow}>Content Studio</p><h1 style={{...T.pageTitle,marginTop:12}}>{h.service.name} — {c?.name}</h1></div>

  {!success&&<section aria-label="Production state" aria-live="polite" style={{...T.card,padding:'clamp(20px,3vw,32px)',borderColor:(failed||changeDirection)?'#d7a75b':'var(--border)',display:'grid',gap:20}}>
   <p style={T.eyebrow}>{state==='CREATING'?'Creating':cannotRefresh?'Needs your confirmation':changeDirection?'Change of direction recommended':failed?'Needs attention':'Ready to create'}</p>
   {cannotRefresh&&<div>
    <h2 style={T.sectionTitle}>I need to re-check this brief first.</h2>
    <p style={{...T.body,marginTop:8}}>{feas!.ownerAction}</p>
   </div>}
   {/* EVIDENCE, NOT WORDING. When LaunchMind can see that this concept cannot
       be executed well with what it currently knows, another identical
       generation is not a responsible next action — so it is not offered. */}
   {changeDirection&&<div>
    <h2 style={T.sectionTitle}>{feas!.alternative?'I recommend changing direction.':'I need one more piece of customer context before I can make this strong.'}</h2>
    <p style={{...T.body,marginTop:8}}>{feas!.selected!.ownerSummary}</p>
    {feas!.alternative&&<p style={{...T.body,marginTop:8}}>{feas!.alternative.ownerSummary}</p>}
    {feas!.selected!.missing.length>0&&<div style={{marginTop:12}}>
     <p style={T.eyebrow}>What would change this</p>
     <ul style={{display:'grid',gap:6,paddingLeft:18,marginTop:6}}>{feas!.selected!.missing.map(m=><li key={m} style={T.body}>{m}</li>)}</ul>
    </div>}
   </div>}
   {failed&&!changeDirection&&<div><h2 style={T.sectionTitle}>I couldn’t finish this draft yet.</h2><p style={{...T.body,marginTop:8}}>LaunchMind wasn’t able to produce wording that passed the required content checks. Nothing was replaced.</p><details style={{marginTop:10}}><summary>Why couldn’t LaunchMind finish this?</summary><p style={T.body}>{reason}</p></details></div>}
   {state==='CREATING'&&<p style={T.body}>LaunchMind is creating your content…</p>}
   {briefBody}
   <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
    {changeDirection||cannotRefresh
     ? <a href="/dashboard/intelligence/content#recommended-concepts" style={{...btnPrimary,textDecoration:'none',display:'inline-block'}}>{cannotRefresh?'Open Content Intelligence →':feas?.alternative?'Choose a different approach →':'Add the missing information →'}</a>
     : <><button type="button" disabled={!ready||state==='CREATING'} onClick={onGenerate} style={{...btnPrimary,cursor:ready?'pointer':'not-allowed',opacity:ready?1:.6}}>{state==='CREATING'?'Creating content…':failed?'Try again':'Generate content →'}</button>
       <a href="/dashboard/intelligence/content#recommended-concepts" style={{color:'var(--sage)',fontWeight:600,fontSize:14}}>Change direction</a></>}
   </div>
   {stale&&<p style={{...T.body,marginTop:4}}>This brief needs to be refreshed before creation. <a href="/dashboard/intelligence/content">Return to Content Intelligence →</a></p>}
   {preparing&&!stale&&state!=='CREATING'&&<p style={T.body}>Checking your production brief…</p>}
   <details style={{fontSize:14,color:'var(--ink2)'}}><summary>Why this direction?</summary><p style={{marginTop:12}}>{work.decision.overridden?'You chose this approach instead of LaunchMind’s recommended first test.':'You accepted LaunchMind’s recommended first test.'}</p></details>
  </section>}

  {success&&work.content&&!editing&&
   <GeneratedCopy content={work.content.content} visual={work.visual} approved={approved} approving={approving} regenerating={creating}
    approveError={approveError} regenerateReady={ready} onApprove={()=>onApprove?.()} onEdit={()=>onStartEdit?.()}
    onRegenerate={()=>onGenerate?.()}/>}

  {success&&editing&&draft&&
   <EditDraft draft={draft} onChange={d=>onEditChange?.(d)} onSave={()=>onSaveEdit?.()}
    onCancel={()=>onCancelEdit?.()} saving={saving} error={editError}/>}

  {success&&<details style={{...T.card,padding:20}}>
   <summary style={{...T.eyebrow,cursor:'pointer'}}>Brief · strategy and direction</summary>
   <div style={{display:'grid',gap:20,marginTop:16}}>{briefBody}
    <a href="/dashboard/intelligence/content#recommended-concepts" style={{color:'var(--sage)',fontWeight:600,fontSize:14}}>Change direction</a>
   </div>
  </details>}

  {success&&<details style={{...T.card,padding:20}}><summary style={{...T.eyebrow,cursor:'pointer'}}>Version history · how this creative evolved</summary>
   <div style={{display:'grid',gap:8,marginTop:14}}>{(work.history??[]).map((v:any)=><div key={v.version_number} style={{...T.innerBlock}}>
    Version {v.version_number}{v.current?' · Current':''}{v.approved?' · Approved':''}{v.visual?' · Visual attached':''}
    <span style={{color:'var(--ink3)'}}> · {String(v.change_type).replace(/_/g,' ')}</span></div>)}</div>
  </details>}
 </main>;
}

export function GroundedPlanningWork({id,token}:{id:string;token:string}){
 const [work,setWork]=useState<Work|null>(null),[error,setError]=useState(false),[ready,setReady]=useState(false),[stale,setStale]=useState(false),[creating,setCreating]=useState(false);
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState<Editable|null>(null),[saving,setSaving]=useState(false),[editError,setEditError]=useState<string|null>(null);
 const [approving,setApproving]=useState(false),[approveError,setApproveError]=useState<string|null>(null),[reload,setReload]=useState(0);

 const load=()=>api.contentIntelligence.planningWork(id,token);
 useEffect(()=>{let alive=true;setWork(null);setError(false);setReady(false);setStale(false);
  load().then(async w=>{if(!alive)return;setWork(w);try{const p=await api.contentIntelligence.preparePlanning(id,token);if(alive)setReady(p.canGenerate)}catch{if(alive)setStale(true)}}).catch(()=>{if(alive)setError(true)});
  return()=>{alive=false}},[id,token,reload]);
 useEffect(()=>{if(work?.generation?.status!=='CREATING')return;const timer=setInterval(()=>{void load().then(setWork).catch(()=>{});},2500);return()=>clearInterval(timer)},[id,token,work?.generation?.status]);

 const generate=async()=>{if(!ready||creating||work?.generation?.status==='CREATING')return;setEditing(false);setApproveError(null);setCreating(true);try{await api.contentIntelligence.generatePlanning(id,token);setWork(await load());}catch{try{setWork(await load());}catch{setStale(true)}}finally{setCreating(false)}};

 const startEdit=()=>{if(!work?.content)return;setDraft(toEditable(work.content.content));setEditError(null);setEditing(true);};
 const cancelEdit=()=>{setEditing(false);setDraft(null);setEditError(null);};
 const saveEdit=async()=>{if(!draft)return;setSaving(true);setEditError(null);
  try{
   const res=await api.contentIntelligence.editPlanning(id,fromEditable(draft),token);
   if(res.ownerState==='NEEDS_OWNER_INPUT'||res.ownerState==='LAUNCHMIND_CAN_REPAIR'){
    setEditError(res.message??'LaunchMind could not save this edit — it did not pass the required content checks.');
   }else{
    setEditing(false);setDraft(null);setWork(await load());
   }
  }catch{setEditError('This edit could not be saved. Please try again.');}
  finally{setSaving(false);}
 };

 const approve=async()=>{if(!work?.content||!work.generation?.assetId)return;setApproving(true);setApproveError(null);
  try{
   await api.contentIntelligence.approvePlanning(work.generation.assetId,work.content.versionNumber,token,work.visual?.renderJobId);
   setWork(await load());
  }catch{setApproveError('LaunchMind could not approve this version — it no longer passes the current content checks. Try Regenerate.');}
  finally{setApproving(false);}
 };

 if(error)return <section role="alert" style={{...T.card,padding:24,display:'grid',gap:12}}><p style={T.bodyStrong}>We couldn’t load this creative.</p><button type="button" style={{...btnGhost,width:'fit-content'}} onClick={()=>setReload(v=>v+1)}>Try again</button></section>;
 if(!work)return <ContentStudioLoading message="Loading your creative…"/>;
 return <ProductionBrief work={work} ready={ready} preparing={!ready&&!stale} stale={stale} creating={creating}
  onGenerate={()=>void generate()}
  editing={editing} draft={draft??undefined} onStartEdit={startEdit} onEditChange={setDraft}
  onSaveEdit={()=>void saveEdit()} onCancelEdit={cancelEdit} saving={saving} editError={editError}
  onApprove={()=>void approve()} approving={approving} approveError={approveError}/>;
}
