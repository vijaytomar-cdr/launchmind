'use client';
import React from 'react';
import type {SignalFoundationView} from '@/lib/api';
export function DemandComparison({foundation,selectedServiceId}:{foundation:SignalFoundationView;selectedServiceId?:string}){
 const tournament=foundation.demandTournament,complete=tournament?.status==='COMPLETE';
 const name=(id:string)=>foundation.catalog.confirmed.find(s=>s.id===id)?.name??'Service';
 const cell={padding:8};
 return <details style={{marginTop:18}}><summary>Compare eligible services</summary>
 <div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left',marginTop:12}}><thead><tr>{(complete?['Service','Demand evidence','Trend','Outcome']:['Service','Demand','Trend','Performance']).map(h=><th key={h} style={cell}>{h}</th>)}</tr></thead><tbody>
 {foundation.catalog.confirmed.map(service=>{
  const stages=complete?tournament.stages.filter(s=>s.serviceIds.includes(service.id)):[];
  const last=stages.at(-1),signal=last?.signals.find(s=>s.serviceId===service.id),final=complete&&tournament.finalWinnerId===service.id;
  return <tr key={service.id}><td style={cell}>{service.name}</td><td style={cell}>{!last?'—':final?'Final comparison winner':stages.length===2?'Won first comparison; compared in final':signal&&signal.value<1?'Low relative search interest':last.stage===1?'First comparison':'Final comparison'}</td><td style={cell}>{signal?signal.direction.charAt(0)+signal.direction.slice(1).toLowerCase():'—'}</td><td style={cell}>{!last?'—':service.id===selectedServiceId?'Recommended':final?'Demand winner':last.stage===1&&(tournament?.stages.length??0)>1?'Not advanced':'Not selected'}</td></tr>;
 })}</tbody></table></div>
 <p style={{fontSize:12,marginTop:10}}>{complete?'Each result belongs to its own comparison. There is no shared numeric score across all services.':'— Not available.'} Service-level conversion, capacity and performance learning are not available yet.</p>
 {complete&&<details style={{marginTop:12}}><summary>How this comparison worked</summary>
 <p>Services entered in a fixed order based on their saved identities. The first comparison’s winner advanced to face the remaining services. This is a demand-based selection path, not a ranking of every service.</p>
 {tournament.stages.map(stage=><section key={stage.stage} style={{marginTop:16}}><h3>{stage.stage===1&&tournament.stages.length>1?'First comparison':'Final comparison'}</h3><p>{name(stage.winnerId)} had the highest mean relative search interest within this comparison.</p><p style={{fontSize:12}}>{stage.window.start} to {stage.window.end} · {stage.signals[0]?.ownerGeography?.state??stage.geography}-level interest · Retrieved {stage.fetchedAt.slice(0,10)}</p>
 <table style={{width:'100%',textAlign:'left'}}><thead><tr><th style={cell}>Service</th><th style={cell}>Search query</th><th style={cell}>Relative interest in this comparison</th><th style={cell}>Trend</th><th style={cell}>Outcome</th></tr></thead><tbody>{stage.signals.map(s=><tr key={s.serviceId}><td style={cell}>{name(s.serviceId)}</td><td style={cell}>{s.query}</td><td style={cell}>{s.value.toFixed(1)}</td><td style={cell}>{s.direction.toLowerCase()}</td><td style={cell}>{s.serviceId===stage.winnerId?stage.stage===1?'Advanced':'Demand winner':stage.stage===1?'Not advanced':'Not selected'}</td></tr>)}</tbody></table>
 <p style={{fontSize:12}}><a href={stage.signals[0]?.sourceRef} target="_blank" rel="noreferrer">View source comparison</a></p></section>)}
 <p style={{fontSize:12}}>Search samples and query wording can affect results. Relative search interest is not search volume, bookings or conversion.</p>
 </details>}
 </details>;
}
