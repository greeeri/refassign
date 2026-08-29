'use client'

import {FormEvent,useState} from 'react'
import {useRouter} from 'next/navigation'
import {createClient} from '../../lib/supabase/client'

export default function ResetPasswordPage(){
 const router=useRouter()
 const [password,setPassword]=useState('')
 const [confirm,setConfirm]=useState('')
 const [message,setMessage]=useState('')
 const [loading,setLoading]=useState(false)
 async function updatePassword(event:FormEvent){
  event.preventDefault();setMessage('')
  if(password.length<8){setMessage('Password must be at least 8 characters.');return}
  if(password!==confirm){setMessage('Passwords do not match.');return}
  setLoading(true)
  const supabase=createClient()
  const {error}=await supabase.auth.updateUser({password})
  setLoading(false)
  if(error){setMessage(error.message);return}
  setMessage('Password updated. Taking you to RefAssign…')
  setTimeout(()=>{router.replace('/');router.refresh()},700)
 }
 return <main className="loginPage"><section className="loginCard"><div className="loginBrand">Ref<span>Assign</span></div><p>Sports Officials Management</p><h1>Set new password</h1><p>Choose a new password for your RefAssign account.</p><form onSubmit={updatePassword}><label>New password<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirm password<input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="primary loginButton" disabled={loading}>{loading?'Updating…':'Update password'}</button></form>{message&&<div className="loginMessage">{message}</div>}</section></main>
}
