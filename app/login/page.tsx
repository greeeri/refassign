'use client'

import { FormEvent, useState } from 'react'
import { createClient } from '../../lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setMessage('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` }
    })

    setLoading(false)
    setMessage(error ? error.message : 'Check your email for your RefAssign sign-in link.')
  }

  return <main className="loginPage">
    <section className="loginCard">
      <div className="loginBrand">Ref<span>Assign</span></div>
      <p>Sports Officials Management</p>
      <h1>Sign in</h1>
      <p>Enter your email and we’ll send you a secure sign-in link.</p>
      <form onSubmit={signIn}>
        <label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <button className="primary loginButton" disabled={loading}>{loading ? 'Sending…' : 'Email me a sign-in link'}</button>
      </form>
      {message && <div className="loginMessage">{message}</div>}
    </section>
  </main>
}
