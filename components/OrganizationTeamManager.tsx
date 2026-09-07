"use client";

import {useEffect,useState} from "react";
import {createClient} from "../lib/supabase/client";
import styles from "./OrganizationTeamManager.module.css";

type TeamAccess={id:string;user_id?:string;email:string;role:string;viewer_permissions:string[];status:"active"|"pending"};
type TeamData={members:TeamAccess[];invitations:TeamAccess[]};
const roles=["admin","assignor","viewer","billing"] as const;
const labels:Record<string,string>={owner:"Organization owner",admin:"Administrator",assignor:"Assignor",viewer:"Read-only viewer",billing:"Billing manager"};
const permissions=[
  ["overview","Overview dashboard"],["games","Games and schedules"],["assignments","Assignments"],
  ["officials","Officials directory"],["reporting","Reporting"],["analytics","Analytics"],
  ["payroll","Payroll summaries"],["training_documents","Training and documents"],
] as const;

export default function OrganizationTeamManager({organizationId,organization,canManage}:{organizationId:string;organization:string;canManage:boolean}){
 const [team,setTeam]=useState<TeamData>({members:[],invitations:[]}),[email,setEmail]=useState(""),[role,setRole]=useState("assignor"),[viewerPermissions,setViewerPermissions]=useState<string[]>(["overview"]),[busy,setBusy]=useState(""),[message,setMessage]=useState("");
 const load=async()=>{const {data,error}=await createClient().rpc("get_organization_team",{p_organization_id:organizationId});if(error){setMessage(error.message);return}setTeam((data||{members:[],invitations:[]}) as TeamData)};
 useEffect(()=>{if(organizationId)void load()},[organizationId]);
 const invite=async()=>{if(!email.includes("@")||!canManage)return;setBusy("invite");setMessage("");const supabase=createClient();const {data,error}=await supabase.functions.invoke("send-organization-invitation",{body:{organizationId,email,role,viewerPermissions:role==="viewer"?viewerPermissions:[]}});if(error){setMessage(error.message);setBusy("");return}const {data:{session}}=await supabase.auth.getSession();const response=await fetch("/api/tier-test/team-invitation",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session?.access_token||""}`},body:JSON.stringify({organizationId,organization,email,roleLabel:labels[role],actionLink:data.actionLink,invitationId:data.invitationId})});const result=await response.json().catch(()=>({})) as{error?:string};if(!response.ok)setMessage(result.error||"The invitation email could not be sent.");else{setEmail("");setMessage("Invitation sent.")}await load();setBusy("")};
 const save=async(item:TeamAccess,newRole:string,newPermissions:string[])=>{setBusy(item.id);setMessage("");const supabase=createClient(),args={p_role:newRole,p_viewer_permissions:newRole==="viewer"?newPermissions:[]};const {error}=item.status==="pending"?await supabase.rpc("update_organization_invitation",{p_invitation_id:item.id,...args}):await supabase.rpc("update_organization_member_access",{p_organization_id:organizationId,p_user_id:item.user_id,p_current_role:item.role,p_new_role:newRole,p_viewer_permissions:args.p_viewer_permissions});setMessage(error?error.message:"Team access updated.");await load();setBusy("")};
 return <div className={styles.wrap}>
  <section className={styles.heading}><div><p>Organization workspace</p><h2>Team &amp; roles</h2><span>Invite teammates, change their roles, and control read-only access.</span></div></section>
  {!canManage&&<section className={styles.notice}>Only the organization owner or an administrator can change team access.</section>}
  {canManage&&<section className={styles.invite}><h3>Invite a team member</h3><div className={styles.inviteGrid}><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="team@example.com"/></label><label>Workspace role<select value={role} onChange={e=>setRole(e.target.value)}>{roles.map(code=><option value={code} key={code}>{labels[code]}</option>)}</select></label></div>{role==="viewer"&&<PermissionPicker selected={viewerPermissions} onChange={setViewerPermissions}/>}<button className="primary" disabled={busy==="invite"||!email.includes("@")||role==="viewer"&&!viewerPermissions.length} onClick={()=>void invite()}>{busy==="invite"?"Sending…":"Send invitation"}</button></section>}
  {message&&<p className={styles.message}>{message}</p>}
  <section className={styles.list}><div className={styles.listHead}><h3>Organization access</h3><b>{team.members.length} active · {team.invitations.length} pending</b></div>{[...team.members,...team.invitations].length===0?<p className={styles.empty}>No additional team members have been added.</p>:[...team.members,...team.invitations].map(item=><MemberCard key={item.id} item={item} disabled={!canManage||busy===item.id} onSave={save}/>)}</section>
 </div>
}

function PermissionPicker({selected,onChange}:{selected:string[];onChange:(next:string[])=>void}){return <fieldset className={styles.permissions}><legend>Viewer can see</legend>{permissions.map(([code,label])=><label key={code}><input type="checkbox" checked={selected.includes(code)} onChange={()=>onChange(selected.includes(code)?selected.filter(item=>item!==code):[...selected,code])}/><span>{label}</span></label>)}</fieldset>}

function MemberCard({item,disabled,onSave}:{item:TeamAccess;disabled:boolean;onSave:(item:TeamAccess,role:string,permissions:string[])=>Promise<void>}){const [role,setRole]=useState(item.role),[selected,setSelected]=useState(item.viewer_permissions||[]);useEffect(()=>{setRole(item.role);setSelected(item.viewer_permissions||[])},[item.role,item.viewer_permissions]);const locked=item.role==="owner";return <article className={styles.member}><div className={styles.identity}><span>{item.email.slice(0,1).toUpperCase()}</span><div><strong>{item.email}</strong><small>{labels[item.role]||item.role}</small></div><em>{item.status==="pending"?"Pending":"Active"}</em></div>{locked?<p>The organization owner role cannot be changed here.</p>:<><label>Role<select value={role} disabled={disabled} onChange={e=>setRole(e.target.value)}>{roles.map(code=><option value={code} key={code}>{labels[code]}</option>)}</select></label>{role==="viewer"&&<PermissionPicker selected={selected} onChange={setSelected}/>}<button className="primary" disabled={disabled||role==="viewer"&&!selected.length} onClick={()=>void onSave(item,role,selected)}>{disabled?"Saving…":"Save changes"}</button></>}</article>}
