"use client";

import {FormEvent,useState} from "react";
import {createClient} from "../../lib/supabase/client";
import auth from "./auth.module.css";

export default function TestAuthPanel({onAuthenticated}:{onAuthenticated:(email:string)=>void}){
 const [mode,setMode]=useState<"signin"|"signup">("signup");
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [name,setName]=useState("");
 const [message,setMessage]=useState("");
 const [loading,setLoading]=useState(false);
 const submit=async(event:FormEvent)=>{event.preventDefault();setLoading(true);setMessage("");const supabase=createClient();
  if(mode==="signup"){
   const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:name}}});
   if(error)setMessage(error.message);else if(data.session)onAuthenticated(email);else setMessage("Check your email to confirm the test account, then return here and sign in.");
  }else{
   const {data,error}=await supabase.auth.signInWithPassword({email,password});
   if(error)setMessage(error.message);else if(data.user)onAuthenticated(data.user.email||email);
  }
  setLoading(false);
 };
 return <div className={auth.panel}><div className={auth.heading}><div><span>Secure test account required</span><h4>{mode==="signup"?"Create your organization-owner account":"Sign in to save this workspace"}</h4></div><div><button className={mode==="signup"?auth.active:""} onClick={()=>setMode("signup")} type="button">Create account</button><button className={mode==="signin"?auth.active:""} onClick={()=>setMode("signin")} type="button">Sign in</button></div></div><form onSubmit={submit}>{mode==="signup"&&<label>Your name<input required value={name} onChange={e=>setName(e.target.value)} autoComplete="name"/></label>}<label>Email address<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label><label>Password<input required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==="signup"?"new-password":"current-password"}/></label><button disabled={loading}>{loading?"Please wait…":mode==="signup"?"Create secure test account":"Sign in"}</button></form>{message&&<p>{message}</p>}<small>This account exists only in the separate RefAssign test database.</small></div>
}
