'use client'

import {FormEvent,useEffect,useMemo,useState} from 'react'
import {useRouter} from 'next/navigation'
import {createPasswordRecoveryClient} from '../../lib/supabase/client'

export default function SetPasswordPage(){
 const router=useRouter()
 const supabase=useMemo(()=>createPasswordRecoveryClient(),[])
 const [password,setPassword]=useState('')
 const [confirm,setConfirm]=useState('')
 const [message,setMessage]=useState('')
 const [loading,setLoading]=useState(false)
 const [ready,setReady]=useState(false)
 useEffect(()=>{
  let active=true
  async function checkInvitationSession(){
   const {data:{session}}=await supabase.auth.getSession()
   if(!active)return
   if(session){setReady(true);return}
   window.setTimeout(async()=>{
    const {data:{session:delayedSession}}=await supabase.auth.getSession()
    if(!active)return
    if(delayedSession)setReady(true)
    else setMessage('This invitation link is invalid or has expired. Ask your organization to send a new invitation.')
   },3000)
  }
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
   if(active&&session)setReady(true)
  })
  void checkInvitationSession()
  return()=>{active=false;subscription.unsubscribe()}
 },[supabase])
 async function savePassword(event:FormEvent){
  event.preventDefault();setMessage('')
  if(password.length<8){setMessage('Password must be at least 8 characters.');return}
  if(password!==confirm){setMessage('Passwords do not match.');return}
  setLoading(true)
  const {error}=await supabase.auth.updateUser({password})
  setLoading(false)
  if(error){setMessage(error.message);return}
  const requested=new URLSearchParams(window.location.search).get('next')||'/workspace'
  const destination=requested.startsWith('/')&&!requested.startsWith('//')?requested:'/workspace'
  setMessage('Password created. Taking you to RefAssign…')
  window.setTimeout(()=>{router.replace(destination);router.refresh()},700)
 }
 return <main className="loginPage"><section className="loginCard"><div className="loginBrand">Ref<span>Assign</span></div><p>Sports Officials Management</p><h1>Create your password</h1><p>{ready?'Your email is confirmed. Create a password for future RefAssign logins.':'Validating your invitation…'}</p>{ready&&<form onSubmit={savePassword}><label>New password<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label><label>Confirm password<input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)}/></label><button className="primary loginButton" disabled={loading}>{loading?'Saving…':'Create password and continue'}</button></form>}{message&&<div className="loginMessage">{message}</div>}{!ready&&message&&<button type="button" className="secondary" style={{marginTop:10,width:'100%'}} onClick={()=>router.replace('/login')}>Return to sign in</button>}</section></main>
}
