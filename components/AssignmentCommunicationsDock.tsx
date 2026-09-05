"use client";
import {useEffect,useMemo,useState} from "react";
import {usePathname} from "next/navigation";
import {createClient} from "../lib/supabase/client";
import CommunicationCenter from "./CommunicationCenter";

export default function AssignmentCommunicationsDock(){
 const pathname=usePathname(),supabase=useMemo(()=>createClient(),[]),[allowed,setAllowed]=useState(false),[onAssignments,setOnAssignments]=useState(false),[open,setOpen]=useState(false);
 useEffect(()=>{let alive=true;async function checkRole(){const{data}=await supabase.rpc("current_user_roles");if(alive)setAllowed(((data||[]) as string[]).some(r=>r==="admin"||r==="assignor"))}void checkRole();return()=>{alive=false}},[supabase]);
 useEffect(()=>{if(pathname!=="/workspace"){setOnAssignments(false);setOpen(false);return}const check=()=>{const heading=document.querySelector("main header h1")?.textContent?.trim()||"";const yes=heading==="Assignments"||heading.startsWith("Assignments —");setOnAssignments(yes);if(!yes)setOpen(false)};check();const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true,characterData:true});return()=>observer.disconnect()},[pathname]);
 if(!allowed||!onAssignments)return null;
 return <><button type="button" onClick={()=>setOpen(v=>!v)} style={{position:"fixed",right:22,bottom:78,zIndex:1002,border:0,borderRadius:999,padding:"12px 18px",background:"#0878f9",color:"white",fontWeight:800,boxShadow:"0 8px 24px rgba(0,0,0,.18)"}}>{open?"Close Communications":"Communications"}</button>{open&&<div style={{position:"fixed",inset:"72px 18px 70px min(250px,18vw)",zIndex:1001,overflow:"auto",background:"#f5f7fb",border:"1px solid #d8e2ee",borderRadius:14,padding:14,boxShadow:"0 18px 50px rgba(0,0,0,.22)"}}><div className="loginMessage" style={{marginBottom:12}}><b>Email remains the default.</b> Text messaging is optional and available only to Admins and Assignors.</div><CommunicationCenter/></div>}</>
}
