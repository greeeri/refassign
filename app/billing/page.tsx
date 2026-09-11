"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {createClient} from "../../lib/supabase/client";

type PlanKey="starter"|"pro_founding"|"pro"|"premier";
type BillingPlan={key:PlanKey;name:string;price:number;limit:number;detail:string;special?:boolean};
type SubscriptionSummary={organization_name:string;plan:string;status:string;trial_ends_at:string|null;current_period_end:string|null;founding_offer:boolean|null};
type TaxExemptionSummary={subscription_id:string;purchaser_state:string;status:string;certificate_original_name:string;certified_at:string;certificate_url:string|null};
const plans:BillingPlan[]=[
 {key:"starter",name:"Starter",price:299,limit:50,detail:"Up to 50 officials"},
 {key:"pro_founding",name:"Founding Organization Special",price:499,limit:100,detail:"Pro plan · introductory launch rate",special:true},
 {key:"pro",name:"Pro",price:599,limit:100,detail:"Up to 100 officials"},
 {key:"premier",name:"Premier",price:999,limit:250,detail:"Up to 250 officials"}
];
const states=[
 ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],["DC","District of Columbia"]
] as const;
export default function BillingPage(){
 const[org,setOrg]=useState("");const[officials,setOfficials]=useState(50);const[texting,setTexting]=useState(false);const[plan,setPlan]=useState<PlanKey>("starter");const[busy,setBusy]=useState("");const[message,setMessage]=useState("");const[sub,setSub]=useState<SubscriptionSummary|null>(null);const[userEmail,setUserEmail]=useState("");const[authReady,setAuthReady]=useState(false);const[state,setState]=useState("IA");const[iowaCertified,setIowaCertified]=useState(false);const[certificate,setCertificate]=useState<File|null>(null);const[taxExemption,setTaxExemption]=useState<TaxExemptionSummary|null>(null);const[replaceCertificate,setReplaceCertificate]=useState(false);
 useEffect(()=>{const requested=new URLSearchParams(window.location.search).get("plan");if(plans.some(item=>item.key===requested))setPlan(requested as PlanKey);void(async()=>{const s=createClient();const{data:{user}}=await s.auth.getUser();setUserEmail(user?.email||"");setAuthReady(true);if(!user)return;const[{data},taxResponse]=await Promise.all([s.from("refassign_subscriptions").select("organization_name,plan,status,trial_ends_at,current_period_end,founding_offer").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),fetch("/api/billing/tax-exemption")]);const subscription=data as SubscriptionSummary|null;setSub(subscription);if(subscription?.organization_name)setOrg(subscription.organization_name);if(subscription&&plans.some(item=>item.key===subscription.plan))setPlan(subscription.plan as PlanKey);if(taxResponse.ok){const tax=await taxResponse.json();setTaxExemption(tax.exemption||null);if(tax.exemption){setIowaCertified(true);setState(tax.exemption.purchaser_state||"IA")}}})()},[]);
 const selected=plans.find(item=>item.key===plan)!;const extraBlocks=Math.max(0,Math.ceil((officials-selected.limit)/25));const annual=selected.price+extraBlocks*50+(texting?180:0);
 const returnPath=useMemo(()=>`/billing?plan=${plan}`,[plan]);
 async function saveExemption(){setBusy("exemption");setMessage("");const form=new FormData();form.set("plan",plan);form.set("organization_name",org);form.set("purchaser_state",state);form.set("iowa_exemption_certified",String(iowaCertified));if(certificate)form.set("exemption_certificate",certificate);if(taxExemption?.subscription_id)form.set("subscription_id",taxExemption.subscription_id);const r=await fetch("/api/billing/tax-exemption",{method:"POST",body:form});const j=await r.json();if(r.ok&&j.exemption){setTaxExemption(j.exemption);setCertificate(null);setReplaceCertificate(false);setMessage("Iowa exemption certificate saved.")}else setMessage(j.error||"Could not save the exemption certificate.");setBusy("")}
 async function checkout(){setBusy("checkout");setMessage("");const form=new FormData();form.set("plan",plan);form.set("organization_name",org);form.set("official_count",String(officials));form.set("texting_addon",String(texting));form.set("purchaser_state",state);form.set("iowa_exemption_certified",String(iowaCertified));if(certificate)form.set("exemption_certificate",certificate);if(taxExemption?.subscription_id)form.set("prepared_subscription_id",taxExemption.subscription_id);const r=await fetch("/api/billing/checkout",{method:"POST",body:form});const j=await r.json();if(r.ok&&j.url)location.href=j.url;else{setMessage(j.error||"Could not start checkout.");setBusy("")}}
 async function portal(){setBusy("portal");const r=await fetch("/api/billing/portal",{method:"POST"});const j=await r.json();if(r.ok&&j.url)location.href=j.url;else{setMessage(j.error||"Could not open billing portal.");setBusy("")}}
 return <main style={{maxWidth:1100,margin:"40px auto",padding:20}}>
  <Link href="/pricing">← Back to pricing</Link>
  <h1>Set up your RefAssign organization</h1>
  <p>Confirm your capacity and communication options before beginning the 14-day trial.</p>
  {sub&&<section className="card"><b>Current billing status:</b> {sub.status} · {String(sub.plan).replace("_"," ")}{sub.trial_ends_at&&<> · Trial ends {new Date(sub.trial_ends_at).toLocaleDateString()}</>}<button className="secondary" style={{marginLeft:16}} onClick={portal} disabled={!!busy}>Manage billing</button></section>}
  {authReady&&!userEmail&&<section className="card"><h2>Create or sign in to your organization account</h2><p>Your account will own the new organization workspace.</p><Link className="primary" style={{display:"inline-block",textDecoration:"none"}} href={`/login?signup=organization&next=${encodeURIComponent(returnPath)}`}>Continue with account setup</Link></section>}
  {userEmail&&<>
   <section className="card"><b>Organization owner:</b> {userEmail}</section>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,margin:"20px 0"}}>
    <section className="card"><h2>1. Organization</h2><label>Organization name<input value={org} onChange={event=>setOrg(event.target.value)} placeholder="League, club, association, or assigning organization"/></label><label style={{display:"block",marginTop:12}}>Organization state<select value={state} onChange={event=>{setState(event.target.value);if(event.target.value!=="IA"){setIowaCertified(false);setCertificate(null)}}}>{states.map(([code,name])=><option value={code} key={code}>{name}</option>)}</select></label></section>
    <section className="card"><h2>2. Capacity</h2><label>Expected number of officials<input type="number" min={1} max={5000} value={officials} onChange={event=>setOfficials(Math.max(1,Number(event.target.value)||1))}/></label>{extraBlocks>0&&<p>{extraBlocks} additional block{extraBlocks===1?"":"s"} of 25 · ${extraBlocks*50}/year</p>}</section>
    <section className="card"><h2>3. Text features</h2><label style={{display:"flex",gap:10,alignItems:"center"}}><input type="checkbox" checked={texting} onChange={event=>setTexting(event.target.checked)} style={{width:"auto"}}/>Add text messaging · $180/year</label><p>Email communication remains included.</p></section>
   </div>
   <h2>4. Choose your plan</h2>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16}}>{plans.map(item=><button type="button" className="card" key={item.key} onClick={()=>setPlan(item.key)} style={{textAlign:"left",border:plan===item.key?"2px solid #2563eb":item.special?"2px solid #63c735":undefined}}><h3>{item.name}</h3><b>${item.price}/year</b><p>{item.detail}</p></button>)}</div>
   {state==="IA"&&<section className="card" style={{marginTop:18}}>
    <h2>5. Iowa commercial-use tax exemption</h2>
    {taxExemption&&!replaceCertificate?<><p><b>Certificate saved:</b> {taxExemption.certificate_original_name} · {taxExemption.status}</p><p><a href={taxExemption.certificate_url||"#"} target="_blank" rel="noreferrer">View certificate</a></p><button type="button" className="secondary" onClick={()=>setReplaceCertificate(true)}>Replace certificate</button></>:<>
     <p>Complete this only when RefAssign will be used exclusively for your organization’s commercial purposes.</p>
     <p><a href="https://revenue.iowa.gov/media/2265/download?inline" target="_blank" rel="noreferrer">Download the Iowa Sales Tax Exemption Certificate (31-014) from the Department of Revenue</a>, complete it, and attach it below.</p>
     <label style={{display:"flex",gap:10,alignItems:"flex-start"}}><input type="checkbox" checked={iowaCertified} onChange={event=>setIowaCertified(event.target.checked)} style={{width:"auto",marginTop:4}}/><span>I certify that this organization is a commercial enterprise and will use RefAssign exclusively for commercial purposes under Iowa Code §423.3(104).</span></label>
     <label style={{display:"block",marginTop:14}}>Completed Iowa sales-tax exemption certificate<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={event=>setCertificate(event.target.files?.[0]||null)}/></label>
     <small>PDF, JPG, or PNG · maximum 10 MB. The certificate is stored privately with your billing record.</small>
     <div style={{marginTop:14,display:"flex",gap:10}}><button type="button" className="primary" disabled={!!busy||!org.trim()||!iowaCertified||!certificate} onClick={()=>void saveExemption()}>{busy==="exemption"?"Saving…":"Save exemption certificate"}</button>{replaceCertificate&&<button type="button" className="secondary" onClick={()=>{setReplaceCertificate(false);setCertificate(null)}}>Cancel</button>}</div>
    </>}
   </section>}
   <section className="card" style={{marginTop:18}}><h2>Annual total: ${annual}</h2><p>Includes the selected plan{extraBlocks?`, ${extraBlocks*25} additional officials`:""}{texting?", and text messaging":""}. Your 14-day trial begins through Stripe checkout.</p><button className="primary" disabled={!!busy||!org.trim()||officials>250||(state==="IA"&&!taxExemption)} onClick={()=>void checkout()}>{busy==="checkout"?"Opening Stripe…":"Continue to secure payment"}</button>{state==="IA"&&!taxExemption&&<p>Save the Iowa exemption certificate above before continuing.</p>}{officials>250&&<p>Organizations with more than 250 officials require an Enterprise plan. <a href="mailto:Erin.Green@ref-assign.com">Contact Ref Pro Group.</a></p>}</section>
  </>}
  {message&&<p className="loginMessage">{message}</p>}
  <p style={{textAlign:"center",marginTop:30}}>© 2026 Ref Pro Group, LLC. All rights reserved.</p>
 </main>
}
