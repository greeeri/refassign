'use client'
import {ChangeEvent,useEffect,useMemo,useRef,useState} from 'react'
import {createClient} from '../lib/supabase/client'
import {readAllPages} from '../lib/supabase/readAll'
import {applyLocationImport,exportLocationsCSV,exportVenueCatalogCSV,parseLocationCSV,validateLocationImport,type ImportLocation,type ImportVenue,type LocationImportRow} from '../lib/locations/importExport'

export default function LocationsRosterManager(){
 const supabase=useMemo(()=>createClient(),[])
 const mounted=useRef(false),generation=useRef(0),busy=useRef(false),currentUser=useRef<string|null>(null)
 const [allowed,setAllowed]=useState(false),[locations,setLocations]=useState<ImportLocation[]>([]),[venues,setVenues]=useState<ImportVenue[]>([]),[rows,setRows]=useState<LocationImportRow[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[importing,setImporting]=useState(false),[loading,setLoading]=useState(false),[reading,setReading]=useState(false)
 async function authorizedUser(expected?:string){
  const auth=await supabase.auth.getUser()
  if(auth.error||!auth.data.user)throw new Error('Sign in again before importing locations.')
  if(expected&&auth.data.user.id!==expected)throw new Error('The signed-in user changed. Refresh and review this import again.')
  const profile=await supabase.from('profiles').select('role').eq('id',auth.data.user.id).maybeSingle()
  if(profile.error||!['admin','assignor'].includes(profile.data?.role||''))throw new Error('Only authorized Administrators and Assignors can import locations.')
  return auth.data.user.id
 }
 async function load(keepMessage=false){
  if(busy.current)return
  const version=++generation.current
  const valid=()=>mounted.current&&generation.current===version
  setAllowed(false);setLoading(true);setRows([]);setReading(false);setError('');if(!keepMessage)setMessage('')
  try{
   const userId=await authorizedUser();if(!valid())return
   currentUser.current=userId
   const [fields,parents]=await Promise.all([
    readAllPages<ImportLocation>((from,to)=>supabase.from('locations').select('id,name,address,city,state,field_complex,active,venue_id').order('id').range(from,to)),
    readAllPages<ImportVenue>((from,to)=>supabase.rpc('get_location_venue_options').order('id').range(from,to)),
   ])
   if(!valid())return
   if(fields.error||parents.error)throw new Error((fields.error||parents.error)!.message)
   setLocations(fields.data||[]);setVenues(parents.data||[]);setAllowed(true)
  }catch(cause){if(valid())setError(cause instanceof Error?cause.message:'Could not load locations and venues.')}
  finally{if(valid())setLoading(false)}
 }
 useEffect(()=>{
  mounted.current=true;void load()
  const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
   if(currentUser.current&&session?.user?.id!==currentUser.current){
    generation.current++;currentUser.current=null;setAllowed(false);setRows([]);setLocations([]);setVenues([]);setReading(false);setImporting(false);setLoading(false);setMessage('');setError('Sign-in changed. Refresh and review the import again.')
   }
  })
  return()=>{mounted.current=false;generation.current++;data.subscription.unsubscribe()}
 },[])
 function downloadCSV(content:string,filename:string){
  if(!allowed||busy.current||loading)return
  const blob=new Blob([content],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)
 }
 function downloadCurrent(){downloadCSV(exportLocationsCSV(locations,venues),'refassign-locations.csv')}
 function downloadVenueIds(){downloadCSV(exportVenueCatalogCSV(venues),'refassign-venue-ids.csv')}
 async function handleFile(event:ChangeEvent<HTMLInputElement>){
  const input=event.target,file=input.files?.[0];input.value=''
  if(!file||!allowed||busy.current||loading)return
  const version=++generation.current,valid=()=>mounted.current&&generation.current===version
  setRows([]);setMessage('');setError('');setReading(true)
  try{
   const buffer=await file.arrayBuffer();let raw:string[][]|null=null
   try{const XLSX=await import('xlsx');const workbook=XLSX.read(buffer,{type:'array'});if(workbook.SheetNames.length)raw=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:'',raw:false}) as string[][]}catch{}
   if(!raw?.length)raw=parseLocationCSV(new TextDecoder('utf-8').decode(buffer))
   if(valid())setRows(validateLocationImport(raw,locations,venues))
  }catch(cause){if(valid())setError(cause instanceof Error?`${cause.message} Selected file: ${file.name}`:'Unable to read locations file.')}
  finally{if(valid())setReading(false)}
 }
 async function applyImport(){
  if(!allowed||busy.current||reading||loading||!rows.length||rows.some(row=>!row.valid)||!currentUser.current)return
  const version=++generation.current,userId=currentUser.current
  const valid=()=>mounted.current&&generation.current===version
  busy.current=true;setImporting(true);setError('');setMessage('')
  try{
   const result=await applyLocationImport(supabase,rows,async()=>{await authorizedUser(userId)},valid)
   if(!valid())return
   // Clear the consumed preview even on partial failure: repeating inserts is unsafe.
   setRows([])
   const progress=`Confirmed: ${result.updated} field metadata updates, ${result.added} new fields, ${result.associations} venue associations.`
   setMessage(progress)
   if(result.error||result.stopped){setError(`${result.error||'Import stopped.'} Earlier confirmed changes were not rolled back. Refresh, export and review before retrying.`);setAllowed(false)}
   else{
    busy.current=false
    const reloadVersion=generation.current+1
    await load(true)
    if(mounted.current&&generation.current===reloadVersion)setMessage(`Locations import complete. ${progress}`)
   }
  }catch(cause){if(valid()){setRows([]);setAllowed(false);setError(`${cause instanceof Error?cause.message:'Import failed.'} Refresh and export before retrying; completed writes are not rolled back.`)}}
  finally{busy.current=false;if(mounted.current)setImporting(false)}
 }
 const invalid=rows.filter(row=>!row.valid).length
 return <section className="card"><div className="cardHead"><div><h3>Locations Import / Export</h3><p>Export stable field IDs and venue IDs, edit in Excel/Sheets, then preview changes. Venue names are informational; they never create, match or merge venues.</p></div><button className="secondary" disabled={!allowed||loading||importing} onClick={downloadCurrent}>Download Current Locations</button><button className="secondary" disabled={!allowed||loading||importing} onClick={downloadVenueIds}>Download Venue IDs</button></div>
 <p>Keep <code>venue_action=preserve</code> to retain the parent. To associate an existing field, keep its exported <code>id</code>, enter an available <code>venue_id</code>, and choose <code>set</code>. To unassign, choose <code>clear</code> and blank <code>venue_id</code>. Blank parent columns alone never clear a mapping.</p>
 <p><small>Older files without venue columns still work. Without a field ID, only an unambiguous name may update metadata. Add new fields first, then export their IDs before assigning venues. Field Complex remains a separate legacy setting.</small></p>
 <button type="button" className="secondary" disabled={loading||importing} onClick={()=>void load()}>{loading?'Loading locations…':'Refresh locations and venues'}</button>
 {!allowed&&!loading&&<p>Only authorized Administrators and Assignors can use the uploader. Refresh to recheck access and current IDs.</p>}
 <input aria-label="Locations import file" type="file" disabled={!allowed||loading||importing} onChange={handleFile}/>
 {reading&&<p>Reading import preview…</p>}{error&&<div role="alert" className="errorBox">{error}</div>}{message&&<div role="status" className="loginMessage">{message}</div>}
 {rows.length>0&&<><p>{rows.length} rows • {rows.filter(row=>row.action==='Update').length} updates • {rows.filter(row=>row.action==='Add').length} additions • {invalid} errors</p><div className="tableWrap"><table><thead><tr><th>Row</th><th>Action</th><th>Field / ID</th><th>Address</th><th>City</th><th>State</th><th>Field Complex</th><th>Active</th><th>Parent venue action</th><th>Validation</th></tr></thead><tbody>{rows.map(row=><tr key={row.row}><td>{row.row}</td><td>{row.action}</td><td><b>{row.name}</b><small>{row.id||'New field'}</small></td><td>{row.address}</td><td>{row.city}</td><td>{row.state}</td><td>{row.field_complex}</td><td>{row.active}</td><td>{row.venue_action}{row.venue_action==='set'&&<><br/>{row.venue_name}<br/><code>{row.venue_id}</code></>}</td><td>{row.valid?'Ready':row.issue}</td></tr>)}</tbody></table></div><p>Imports are sequential, not all-or-nothing. A failed row stops later rows; confirmed earlier writes remain saved.</p><button className="primary" disabled={!allowed||importing||reading||invalid>0} onClick={applyImport}>{importing?'Updating Locations…':'Apply Location Changes'}</button></>}
 </section>
}
