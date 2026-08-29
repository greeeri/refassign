'use client'

import {useEffect,useMemo,useState} from 'react'
import {createClient} from '../lib/supabase/client'

type RequestRow={id:string;block_id:string|null;official_id:string;status:'pending'|'approved'|'denied';request_note:string|null;requested_at:string;review_note:string|null;reviewed_at:string|null;block_type:string|null;block_start_date:string|null;block_end_date:string|null;block_starts_at:string|null;block_ends_at:string|null;block_notes:string|null}
type Official={id:string;first_name:string;last_name:string}

export default function BlockRemovalRequests(){
  const supabase=useMemo(()=>createClient(),[])
  const [rows,setRows]=useState<RequestRow[]>([]),[officials,setOfficials]=useState<Official[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('')

  async function load(){
    setError('')
    const [r,o]=await Promise.all([
      supabase.from('block_removal_requests').select('id,block_id,official_id,status,request_note,requested_at,review_note,reviewed_at,block_type,block_start_date,block_end_date,block_starts_at,block_ends_at,block_notes').order('requested_at',{ascending:false}),
      supabase.from('officials').select('id,first_name,last_name')
    ])
    if(r.error||o.error){setError((r.error||o.error)?.message||'Unable to load removal requests.');return}
    setRows((r.data||[]) as RequestRow[]);setOfficials((o.data||[]) as Official[])
  }
  useEffect(()=>{void load()},[])
  function officialName(id:string){const o=officials.find(x=>x.id===id);return o?`${o.last_name}, ${o.first_name}`:'Official'}
  function blockLabel(r:RequestRow){if(r.block_type==='time'&&r.block_starts_at){const s=new Date(r.block_starts_at),e=r.block_ends_at?new Date(r.block_ends_at):null;return `${s.toLocaleDateString()} ${s.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}${e?`–${e.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:''}`}if(r.block_type==='date')return r.block_start_date===r.block_end_date?(r.block_start_date||'Date'):`${r.block_start_date||''} through ${r.block_end_date||''}`;return r.block_type?`${r.block_type.charAt(0).toUpperCase()}${r.block_type.slice(1)} block`:'Availability block'}
  async function review(r:RequestRow,status:'approved'|'denied'){const action=status==='approved'?'approve and remove this availability block':'decline this removal request';if(!window.confirm(`Are you sure you want to ${action}?`))return;const note=window.prompt('Optional review note:')||null;setBusy(r.id);setError('');const {error}=await supabase.from('block_removal_requests').update({status,review_note:note}).eq('id',r.id).eq('status','pending');if(error)setError(error.message);else await load();setBusy('')}
  const pending=rows.filter(r=>r.status==='pending'),history=rows.filter(r=>r.status!=='pending')
  return <><section className="card"><div className="cardHead"><div><h2>Block Removal Requests</h2><p>Requests from officials appear here for Assignor or Administrator approval.</p></div><span className="badge yellow">{pending.length} pending</span></div><div className="tableWrap"><table><thead><tr><th>Official</th><th>Block</th><th>Official Note</th><th>Requested</th><th>Decision</th></tr></thead><tbody>{pending.length?pending.map(r=><tr key={r.id}><td><b>{officialName(r.official_id)}</b></td><td><b>{blockLabel(r)}</b>{r.block_notes&&<small style={{display:'block',marginTop:4}}>{r.block_notes}</small>}</td><td>{r.request_note||'—'}</td><td>{new Date(r.requested_at).toLocaleString()}</td><td><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" className="acceptButton" disabled={busy===r.id} onClick={()=>void review(r,'approved')}>Approve</button><button type="button" className="dangerButton" disabled={busy===r.id} onClick={()=>void review(r,'denied')}>Decline</button></div></td></tr>):<tr><td colSpan={5}>No pending block removal requests.</td></tr>}</tbody></table></div>{error&&<div className="errorBox">{error}</div>}</section>{history.length>0&&<section className="card"><div className="cardHead"><div><h2>Removal Request History</h2><p>Previously approved and declined requests are retained for review.</p></div></div><div className="tableWrap"><table><thead><tr><th>Official</th><th>Block</th><th>Status</th><th>Review Note</th><th>Reviewed</th></tr></thead><tbody>{history.map(r=><tr key={r.id}><td>{officialName(r.official_id)}</td><td>{blockLabel(r)}</td><td><span className={`badge ${r.status==='approved'?'green':'red'}`}>{r.status}</span></td><td>{r.review_note||'—'}</td><td>{r.reviewed_at?new Date(r.reviewed_at).toLocaleString():'—'}</td></tr>)}</tbody></table></div></section>}</>}
