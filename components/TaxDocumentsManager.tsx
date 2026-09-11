"use client";
import {useEffect,useState} from "react";

type TaxDocument={id:string;original_name:string;mime_type:string;file_size_bytes:number;status:string;submitted_at:string;download_url:string};
export default function TaxDocumentsManager({organizationId}:{organizationId:string}){
 const[documents,setDocuments]=useState<TaxDocument[]>([]);
 const[organizationName,setOrganizationName]=useState("");
 const[error,setError]=useState("");
 useEffect(()=>{void(async()=>{setError("");const response=await fetch(`/api/billing/tax-documents?organization_id=${encodeURIComponent(organizationId)}`);const result=await response.json();if(!response.ok)setError(result.error||"Tax documents could not be loaded.");else{setDocuments(result.documents||[]);setOrganizationName(result.organization?.name||"")}})()},[organizationId]);
 return <section className="card">
  <div className="cardHead"><div><h2>Billing &amp; Tax Documents</h2><p>{organizationName||"Organization"} · private audit records</p></div><a className="secondary" href="/billing">Open billing setup</a></div>
  {error&&<div className="errorBox">{error}</div>}
  {!error&&!documents.length&&<p>No tax-exemption certificates have been submitted for this organization.</p>}
  {!!documents.length&&<div className="tableWrap"><table><thead><tr><th>Document</th><th>Submitted</th><th>Status</th><th>File size</th><th></th></tr></thead><tbody>{documents.map(document=><tr key={document.id}><td><b>{document.original_name}</b><small>{document.mime_type}</small></td><td>{new Date(document.submitted_at).toLocaleString()}</td><td>{document.status}</td><td>{document.file_size_bytes>1?`${(document.file_size_bytes/1024).toFixed(0)} KB`:"Archived record"}</td><td><a className="secondary" href={document.download_url} target="_blank" rel="noreferrer">Download</a></td></tr>)}</tbody></table></div>}
 </section>
}
