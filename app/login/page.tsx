'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage(error.message)
        return
      }
      router.replace('/')
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function forgotPassword() {
    if (!email) {
      setMessage('Enter your email address first, then select Forgot password.')
      return
    }
    setResetting(true)
    setMessage('')
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`
      })
      setMessage(error ? error.message : 'Password reset email sent. Check your inbox.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to send password reset email.')
    } finally {
      setResetting(false)
    }
  }

  return <main className="loginPage">
    <section className="loginCard">
      <div className="loginBrand">Ref<span>Assign</span></div>
      <p>Sports Officials Management</p>
      <h1>Sign in</h1>
      <p>Enter your email address and password.</p>
      <form onSubmit={signIn}>
        <label>Email address<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" /></label>
        <button className="primary loginButton" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <button type="button" className="secondary" style={{marginTop:10,width:'100%'}} disabled={resetting} onClick={()=>void forgotPassword()}>{resetting?'Sending…':'Forgot password?'}</button>
      {message && <div className="loginMessage">{message}</div>}
    </section>
  </main>
}
