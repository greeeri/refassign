'use client'

import {FormEvent,useEffect,useMemo,useState} from 'react'
import {useRouter} from 'next/navigation'
import {createPasswordRecoveryClient} from '../../lib/supabase/client'

export default function ResetPasswordPage(){
 const router=useRouter()
 const supabase=useMemo(()=>createPasswordRecoveryClient(),[])
 const [password,setPassword]=useState('')
 const [confirm,setConfirm]=useState('')
 const [message,setMessage]=useState('')
 const [loading,setLoading]=useState(false)
 const [ready,setReady]=useState(false)
 useEffect(()=>{
  let active=true
  async function checkRecoverySession(){
   const {data:{session}}=await supabase.auth.getSession()
   if(!active)return
   if(session){setReady(true);return}
   window.setTimeout(async()=>{
    const {data:{session:delayedSession}}=await supabase.auth.getSession()
    if(!active)return
    if(delayedSession)setReady(true)
    else setMessage('This password reset link is invalid or has expired. Return to sign in and request one new reset email.')
   },3000)
  }
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(active&&session&&(event==='PASSWORD_RECOVERY'||event==='SIGNED_IN'))setReady(true)
  })
  void checkRecoverySession()
  return()=>{active=false;subscription.unsubscribe()}
 },[supabase])
 async function updatePassword(event:FormEvent){
  event.preventDefault();setMessage('')
  if(password.length<8){setMessage('Password must be at least 8 characters.');return}
  if(password!==confirm){setMessage('Passwords do not match.');return}
  setLoading(true)
  const {error}=await supabase.auth.updateUser({password})
  setLoading(false)
  if(error){setMessage(error.message);return}
  setMessage('Password updated. Taking you to RefAssign…')
  setTimeout(()=>{router.replace('/');router.refresh()},700)
 }
 return <main className="loginPage"><section className="loginCard"><div className="loginBrand">Ref<span>Assign</span></div><p>Sports Officials Management</p><h1>Set new password</h1><p>{ready?'Choose a new password for your RefAssign account.':'Validating your password reset link…'}</p>{ready&&<form onSubmit={updatePassword}><label>New password<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm password<input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="primary loginButton" disabled={loading}>{loading?'Updating…':'Update password'}</button></form>}{message&&<div className="loginMessage">{message}</div>}{!ready&&message&&<button type="button" className="secondary" style={{marginTop:10,width:'100%'}} onClick={()=>router.replace('/login')}>Return to sign in</button>}</section></main>
}
