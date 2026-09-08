"use client";

import {useEffect,useState} from "react";
import {OFFICIAL_BLOCK_ANNUAL_PRICE_CENTS,PLAN_CATALOG,PlanCode} from "../../../lib/saas/planCatalog";
import {createTierTestClient as createClient} from "../../../lib/supabase/client";
import TestAuthPanel from "../TestAuthPanel";
import TestWorkspaceDashboard from "../TestWorkspaceDashboard";
import w from "./workspace.module.css";

type SavedWorkspace={organization_id:string;name:string;primary_sport:string|null;role:string;viewer_permissions:string[];plan:PlanCode;official_limit:number|null;additional_official_blocks:number;texting_addon:boolean;leagues:{name:string;region:string|null;coverage:string}[]};
const money=(cents:number|null)=>cents===null?"Custom":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100);

export default function TestOperationsWorkspace(){
 const [email,setEmail]=useState("");
 const [loading,setLoading]=useState(true);
 const [message,setMessage]=useState("");
 const [workspaces,setWorkspaces]=useState<SavedWorkspace[]>([]);
 const [current,setCurrent]=useState<SavedWorkspace|null>(null);
 const load=async()=>{setLoading(true);setMessage("");const supabase=createClient();const {data:{user}}=await supabase.auth.getUser();setEmail(user?.email||"");if(!user){setCurrent(null);setLoading(false);return}await supabase.rpc("accept_my_organization_invitations");const {data,error}=await supabase.rpc("get_my_test_workspaces");if(error){setMessage(error.message);setLoading(false);return}const rows=(data||[]) as SavedWorkspace[];setWorkspaces(rows);const requested=new URLSearchParams(window.location.search).get("organization");const stored=window.localStorage.getItem("refassign-last-test-workspace");const selected=rows.find(row=>row.organization_id===(requested||stored))||rows[0]||null;if(selected)window.localStorage.setItem("refassign-last-test-workspace",selected.organization_id);setCurrent(selected);setLoading(false)};
 useEffect(()=>{const supabase=createClient();void load();const {data}=supabase.auth.onAuthStateChange(()=>void load());return()=>data.subscription.unsubscribe()},[]);
 const signOut=async()=>{await createClient().auth.signOut({scope:"local"});window.localStorage.removeItem("refassign-last-test-workspace");setEmail("");setCurrent(null);setWorkspaces([])};
 if(loading)return <main className={w.page}><p className={w.loading}>Loading your isolated workspace…</p></main>;
 if(!email)return <main className={w.page}><div className={w.brand}><img src="/brand/ref-pro-group-logo.png" alt="Ref Pro Group"/><span/><img src="/brand/refassign-logo.png" alt="RefAssign"/></div><section className={w.auth}><p>Operational workspace</p><h1>Sign in to RefAssign</h1><span>Use your isolated test account. No Iowa Soccer data is connected.</span><TestAuthPanel onAuthenticated={()=>void load()}/><a href="/tier-test">Return to organization setup</a></section></main>;
 if(!current)return <main className={w.page}><section className={w.auth}><p>Operational workspace</p><h1>No organization access yet</h1><span>Create an organization or accept a team invitation before opening the workspace.</span>{message&&<strong>{message}</strong>}<a href="/tier-test">Open organization setup</a><button onClick={()=>void signOut()}>Sign out / switch account</button></section></main>;
 const plan=PLAN_CATALOG[current.plan];
 const annual=plan.annualPriceCents===null?null:plan.annualPriceCents+current.additional_official_blocks*OFFICIAL_BLOCK_ANNUAL_PRICE_CENTS+(current.texting_addon?18_000:0);
 return <main className={w.page}><div className={w.topbar}><div className={w.brand}><img src="/brand/ref-pro-group-logo.png" alt="Ref Pro Group"/><span/><img src="/brand/refassign-logo.png" alt="RefAssign"/></div>{workspaces.length>1&&<label>Organization<select value={current.organization_id} onChange={event=>{const next=workspaces.find(row=>row.organization_id===event.target.value);if(next){setCurrent(next);window.localStorage.setItem("refassign-last-test-workspace",next.organization_id)}}}>{workspaces.map(row=><option key={row.organization_id} value={row.organization_id}>{row.name}</option>)}</select></label>}</div><TestWorkspaceDashboard mode="operations" organizationId={current.organization_id} organization={current.name} sport={current.primary_sport||"Sport"} officials={(current.official_limit||0)+current.additional_official_blocks*25} planName={plan.name} includedOfficials={plan.includedOfficials} estimate={money(annual)} textingEnabled={current.plan==="enterprise"||current.texting_addon} leagues={current.leagues.map((league,index)=>({id:index+1,name:league.name,region:league.region||"",coverage:league.coverage}))} accessRole={current.role} viewerPermissions={current.viewer_permissions||[]} onEdit={()=>window.location.assign("/tier-test")} onSwitchAccount={()=>void signOut()}/></main>;
}
