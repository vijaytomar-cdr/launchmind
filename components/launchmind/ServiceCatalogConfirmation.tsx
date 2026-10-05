'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from './Button';
import {api,ApiError,type SignalFoundationView} from '@/lib/api';
import {OwnerServiceArea,US_STATES,SERVICE_COUNTRIES,type ServiceArea} from '@/backend/src/services/content/serviceGeography';
type AreaForm={city:string;state:string;country:string;unknown:boolean};
const blank=():AreaForm=>({city:'',state:'',country:'',unknown:false});
const form=(a?:ServiceArea|null):AreaForm=>a?{city:a.city,state:a.state,country:a.countryCode,unknown:false}:blank();
const valid=(a:AreaForm)=>a.unknown||OwnerServiceArea.safeParse({city:a.city,state:a.state,country:a.country}).success;
type Row={name:string;kind:'PRODUCT'|'SERVICE'|'CATEGORY';checked:boolean;override:boolean;area:AreaForm};
function AreaFields({value,onChange,prefix,disabled}:{value:AreaForm;onChange:(v:AreaForm)=>void;prefix:string;disabled:boolean}){
 const parsed=OwnerServiceArea.safeParse({city:value.city,state:value.state,country:value.country});
 const issues=parsed.success?[]:parsed.error.issues;
 const fieldError=(field:string)=>!value.unknown&&issues.find(i=>i.path[0]===field)?.message;
 const inputStyle={border:'1px solid var(--border)',borderRadius:6,padding:10,width:'100%'};
 return <div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:14}}>
 <label>City / metro<input aria-label={`${prefix} city or metro`} style={inputStyle} placeholder="City or metro (optional)" disabled={disabled||value.unknown} value={value.city} onChange={e=>onChange({...value,city:e.target.value})}/>{fieldError('city')&&<small role="alert">{fieldError('city')}</small>}</label>
 <label>State / province{value.country==='US'?<select aria-label={`${prefix} state or province`} style={inputStyle} disabled={disabled||value.unknown} value={value.state} onChange={e=>onChange({...value,state:e.target.value})}><option value="">Select state</option>{Object.values(US_STATES).map(state=><option key={state}>{state}</option>)}</select>:<input aria-label={`${prefix} state or province`} style={inputStyle} disabled={disabled||value.unknown} value={value.state} onChange={e=>onChange({...value,state:e.target.value})}/>}<small>{!value.unknown&&!value.state?'Choose or enter a state or province.':fieldError('state')}</small></label>
 <label>Country<select aria-label={`${prefix} country`} style={inputStyle} disabled={disabled||value.unknown} value={value.country} onChange={e=>onChange({...value,country:e.target.value})}><option value="">Select country</option>{Object.entries(SERVICE_COUNTRIES).map(([code,name])=><option key={code} value={code}>{name}</option>)}</select>{!value.unknown&&!value.country&&<small>Choose a country.</small>}</label>
 </div><label style={{display:'block',margin:'12px 0'}}><input type="checkbox" disabled={disabled} checked={value.unknown} onChange={e=>onChange({...value,unknown:e.target.checked})}/> I haven’t confirmed {prefix==='Primary'?'the service area':`the area for ${prefix}`} yet</label>
 {value.country==='US'&&value.state&&!value.unknown&&<p style={{fontSize:13}}>Search-demand comparison uses {value.state}-level interest{value.city?`, not ${value.city}-only demand`:''}.</p>}
 </div>;
}
export function ServiceCatalogConfirmation({foundation,productId,productName,token,onConfirmed}:{foundation:SignalFoundationView;productId:string;productName:string;token:string;onConfirmed:()=>Promise<boolean|void>}){
 const confirmed=foundation.catalog.confirmed.length;
 const needsArea=foundation.catalog.confirmed.some(e=>e.geographyStatus!=='CONFIRMED');
 const common=confirmed&&foundation.catalog.confirmed.every(e=>JSON.stringify(e.serviceArea)===JSON.stringify(foundation.catalog.confirmed[0].serviceArea))?foundation.catalog.confirmed[0].serviceArea:null;
 const initial=():Row[]=>[...foundation.catalog.confirmed,...foundation.catalog.discovered].map(e=>({name:e.name,kind:e.kind??'SERVICE',checked:e.status==='CONFIRMED',override:e.status==='CONFIRMED'&&!!('serviceArea' in e&&e.serviceArea)&&!common,area:form('serviceArea' in e?e.serviceArea as ServiceArea:null)}));
 const [rows,setRows]=useState(initial),[shared,setShared]=useState<AreaForm>(()=>form(common)),[open,setOpen]=useState(false),[areaOnly,setAreaOnly]=useState(false),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState<string|null>(null),[fields,setFields]=useState<Record<string,string>>({});
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(open)heading.current?.focus();},[open]);
 const selected=rows.filter(r=>r.checked),invalid=!selected.length||selected.some(r=>!valid(r.override?r.area:shared))||!Number.isInteger(foundation.catalog.version);
 function show(onlyArea=false){setRows(initial());setShared(form(common));setAreaOnly(onlyArea);setError(null);setFields({});setSaved(false);setOpen(true);}
 async function save(){if(lock.current||invalid)return;lock.current=true;setBusy(true);setError(null);setFields({});try{
  await api.contentIntelligence.confirmCatalog(productId,selected.map(r=>{const a=r.override?r.area:shared;return {name:r.name,kind:r.kind,serviceArea:a.unknown?null:OwnerServiceArea.parse({city:a.city,state:a.state,country:a.country})};}),token,foundation.catalog.version);
  setSaved(true);setOpen(false);if(await onConfirmed()===false)setError('Saved. I could not refresh your recommendation yet.');
 }catch(e){if(e instanceof ApiError&&(e.status===400||e.status===409)){setFields(e.fields??{});setError(e.message);}else setError("I couldn't save this yet. Try again.");}finally{lock.current=false;setBusy(false);}}
 return <div>
 {!open&&(confirmed?<div><div style={{fontSize:11,fontWeight:700,color:'var(--sage)',letterSpacing:1,marginBottom:8}}>YOUR SERVICES</div><div style={{display:'flex',gap:12,alignItems:'center'}}><span>{confirmed} confirmed</span><Button variant="secondary" onClick={()=>show()}>Edit services</Button></div>
 {needsArea&&<div style={{marginTop:22}}><div style={{fontSize:11,fontWeight:700,letterSpacing:1,color:'var(--sage)'}}>WHAT I NEED NEXT</div><h2 style={{fontSize:23,fontWeight:600,margin:'10px 0'}}>Confirm your primary service area</h2><p style={{marginBottom:14}}>I have your services, but the previous service-area entry wasn’t specific enough for local market analysis.</p><Button onClick={()=>show(true)}>Confirm service area →</Button></div>}</div>:<div><div style={{fontSize:11,fontWeight:700,color:'var(--sage)'}}>I NEED FROM YOU</div><h2 style={{fontSize:24,fontWeight:600}}>Confirm your services</h2><p style={{margin:'12px 0'}}>I found {foundation.catalog.discovered.length} services on {productName}. Select what customers can currently request.</p><Button onClick={()=>show()}>Confirm services →</Button></div>)}
 {saved&&<p role="status">Saved. {busy?'Updating your recommendations…':''}</p>}
 {open&&<section aria-label="Confirm service selection" style={{maxWidth:900}}><h2 ref={heading} tabIndex={-1} style={{fontSize:24,fontWeight:600,outline:'none',marginBottom:12}}>{areaOnly?'Confirm your primary service area':`Confirm what ${productName} offers`}</h2>
 {areaOnly?<p>Your {confirmed} confirmed services stay selected. Confirm where you currently offer them.</p>:<><p>Select services customers can currently request.</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginTop:14}}>{rows.map((r,i)=><label key={i} style={{display:'flex',gap:8,padding:10,border:'1px solid var(--border)',borderRadius:8}}><input type="checkbox" checked={r.checked} disabled={busy} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,checked:e.target.checked}:v))}/>{r.name}</label>)}</div></>}
 <h3 style={{fontSize:12,fontWeight:700,letterSpacing:1,margin:'24px 0 12px'}}>PRIMARY SERVICE AREA</h3>
 <AreaFields value={shared} prefix="Primary" disabled={busy} onChange={setShared}/><p style={{fontSize:13,marginTop:10}}>This area applies to all selected services unless you set an exception below.</p>
 <details style={{margin:'18px 0'}}><summary>Different area for a service?</summary>{rows.map((r,i)=>r.checked?<div key={i} style={{margin:'14px 0'}}><label><input type="checkbox" checked={r.override} disabled={busy} onChange={e=>setRows(rows.map((v,n)=>n===i?{...v,override:e.target.checked}:v))}/> Different area for {r.name}</label>{r.override&&<AreaFields value={r.area} prefix={r.name} disabled={busy} onChange={area=>setRows(rows.map((v,n)=>n===i?{...v,area}:v))}/>}</div>:null)}</details>
 {Object.entries(fields).map(([key,message])=><p role="alert" key={key}>{key.startsWith('entries.')?selected[Number(key.split('.')[1])]?.name+': ':''}{message}</p>)}
 {!selected.length&&<p>Select at least one service.</p>}
 <div style={{display:'flex',gap:12,marginTop:20}}><Button disabled={busy||invalid} onClick={()=>void save()}>{busy?'Saving…':areaOnly?'Confirm service area':'Confirm services'}</Button><Button variant="secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button></div>
 </section>}
 {error&&<p role="alert" style={{marginTop:12,color:'var(--danger,#a33)'}}>{error}</p>}
 </div>;
}
