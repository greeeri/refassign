"use client";
import {useEffect,useState} from "react";

type TaxDocument={id:string;organization_id:string;original_name:string;status:string;subscription_status:string|null;can_delete:boolean;submitted_at:string;file_size_bytes:number;download_url:string;organizations:{name:string}|{name:string}[]|null};
export default function SuperAdminTaxDocuments(){
 const[documents,setDocuments]=useState<TaxDocument[]>([]);
 const[query,setQuery]=useState("");
 const[error,setError]=useState("");
 const[notice,setNotice]=useState("");
 const[deleting,setDeleting]=useState("");
 useEffect(()=>{void(async()=>{const response=await fetch("/api/super-admin/tax-documents");const result=await response.json();if(!response.ok)setError(result.error||"Tax documents could not be loaded.");else setDocuments(result.documents||[])})()},[]);
 const filtered=documents.filter(document=>{const organization=Array.isArray(document.organizations)?document.organizations[0]?.name:document.organizations?.name;return `${organization||""} ${document.original_name} ${document.status}`.toLowerCase().includes(query.toLowerCase())});
 async function remove(document:TaxDocument){
  const organization=Array.isArray(document.organizations)?document.organizations[0]?.name:document.organizations?.name;
  if(!window.confirm(`Delete the test tax record "${document.original_name}" for ${organization||"this organization"}? This permanently removes the stored file and cannot be undone.`))return;
  setDeleting(document.id);setError("");setNotice("");
  const response=await fetch("/api/super-admin/tax-documents",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:document.id})});
  const result=await response.json();
  if(!response.ok)setError(result.error||"The test tax record could not be deleted.");
  else{setDocuments(current=>current.filter(item=>item.id!==document.id));setNotice(result.warning||"Test tax record deleted and logged.")}
  setDeleting("");
 }
 return <section className="card">
  <div className="cardHead"><div><h2>Billing &amp; Tax Documents</h2><p>Private company archive for tax support and audits. Every download is logged.</p></div><span className="badge green">{documents.length} document{documents.length===1?"":"s"}</span></div>
  <label>Search organizations or files<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Organization, filename, or status"/></label>
  {error&&<div className="errorBox">{error}</div>}
  {notice&&<div className="loginMessage">{notice}</div>}
  {!error&&!filtered.length&&<p>No matching tax documents.</p>}
  {!!filtered.length&&<div className="tableWrap"><table><thead><tr><th>Organization</th><th>Document</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>{filtered.map(document=>{const organization=Array.isArray(document.organizations)?document.organizations[0]?.name:document.organizations?.name;return <tr key={document.id}><td><b>{organization||"Unknown organization"}</b></td><td>{document.original_name}</td><td>{new Date(document.submitted_at).toLocaleString()}</td><td>{document.status}<small>Subscription: {document.subscription_status||"unknown"}</small></td><td><div className="toolbar"><a className="secondary" href={document.download_url} target="_blank" rel="noreferrer">Download</a>{document.can_delete&&<button type="button" className="danger" disabled={!!deleting} onClick={()=>void remove(document)}>{deleting===document.id?"Deleting…":"Delete test record"}</button>}</div></td></tr>})}</tbody></table></div>}
 </section>
}
