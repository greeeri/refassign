"use client";
import {useEffect,useState} from "react";
import {createClient} from "../../lib/supabase/client";

type BillingPlan={key:"starter"|"pro_founding"|"pro"|"premier";name:string;price:string;detail:string;special?:boolean};
type SubscriptionSummary={plan:string;status:string;trial_ends_at:string|null;current_period_end:string|null;founding_offer:boolean|null};
const plans:BillingPlan[]=[
 {key:"starter",name:"Starter",price:"$299/year",detail:"Up to 50 officials"},
 {key:"pro_founding",name:"Founding Organization Special",price:"$499/year",detail:"Pro plan · Up to 100 officials · introductory launch rate",special:true},
 {key:"pro",name:"Pro",price:"$599/year",detail:"Up to 100 officials"},
 {key:"premier",name:"Premier",price:"$999/year",detail:"Up to 250 officials"}
];
export default function BillingPage(){
 const[org,setOrg]=useState("");const[busy,setBusy]=useState("");const[message,setMessage]=useState("");const[sub,setSub]=useState<SubscriptionSummary|null>(null);
 useEffect(()=>{void(async()=>{const s=createClient();const{data:{user}}=await s.auth.getUser();if(!user)return;const{data}=await s.from("refassign_subscriptions").select("plan,status,trial_ends_at,current_period_end,founding_offer").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();setSub(data as SubscriptionSummary|null)})()},[]);
 async function checkout(plan:BillingPlan["key"]){setBusy(plan);setMessage("");const r=await fetch("/api/billing/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan,organization_name:org})});const j=await r.json();if(r.ok&&j.url)location.href=j.url;else{setMessage(j.error||"Could not start checkout.");setBusy("")}}
 async function portal(){setBusy("portal");const r=await fetch("/api/billing/portal",{method:"POST"});const j=await r.json();if(r.ok&&j.url)location.href=j.url;else{setMessage(j.error||"Could not open billing portal.");setBusy("")}}
 return <main style={{maxWidth:1100,margin:"40px auto",padding:20}}><h1>RefAssign Plans</h1><p>All organization plans include a 14-day free trial. Officials use RefAssign at no cost.</p>{sub&&<section className="card"><b>Current billing status:</b> {sub.status} · {String(sub.plan).replace("_"," ")}{sub.trial_ends_at&&<> · Trial ends {new Date(sub.trial_ends_at).toLocaleDateString()}</>}<button className="secondary" style={{marginLeft:16}} onClick={portal} disabled={!!busy}>Manage billing</button></section>}<label style={{display:"block",maxWidth:480,margin:"24px 0"}}>Organization name<input value={org} onChange={e=>setOrg(e.target.value)} placeholder="League, club, association or assigning organization"/></label><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:16}}>{plans.map(p=><section className="card" key={p.key} style={p.special?{border:"2px solid #63c735"}:undefined}><h2>{p.name}</h2><h3>{p.price}</h3><p>{p.detail}</p><button className="primary" disabled={!!busy||!org.trim()} onClick={()=>checkout(p.key)}>{busy===p.key?"Opening Stripe…":"Start 14-Day Free Trial"}</button></section>)}</div><section className="card" style={{marginTop:16}}><h2>Enterprise</h2><p>250+ officials · custom pricing, development options, onboarding and partnership support.</p><a href="mailto:Erin.Green@ref-assign.com">Contact Ref Pro Group</a></section>{message&&<p>{message}</p>}</main>
}
