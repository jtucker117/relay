import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Email/password + magic-link sign-in (Critical 1).
// An invite email links here as /login?email=<address>, so pre-fill signup with that address.
export default function Login() {
  const [params] = useSearchParams()
  const invitedEmail = params.get('email') ?? ''
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>(invitedEmail ? 'signup' : 'signin')
  const [email, setEmail] = useState(invitedEmail)
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password, options: { data: { name } },
        })
        if (error) throw error
        setMsg('Account created. Check your email if confirmation is required, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email })
        if (error) throw error
        setMsg('Magic link sent — check your inbox.')
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={logoMark}>R</span>
          <b style={{ fontFamily: 'Space Grotesk', fontSize: 18 }}>Relay</b>
          <span style={chip}>CRM</span>
        </div>
        <p style={{ color: 'var(--ink-soft)', margin: '0 0 20px' }}>
          {invitedEmail && mode === 'signup'
            ? "You've been invited — create your account to join."
            : mode === 'signup' ? 'Create your account' : 'Sign in to your workspace'}
        </p>

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          {mode === 'signup' && (
            <input style={input} placeholder="Your name" value={name}
              onChange={(e) => setName(e.target.value)} required />
          )}
          <input style={input} type="email" placeholder="you@agency.com" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          {mode !== 'magic' && (
            <input style={input} type="password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          )}
          <button style={primaryBtn} disabled={busy}>
            {busy ? '…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send magic link'}
          </button>
        </form>

        {err && <p style={{ color: 'var(--red, #c33)', marginTop: 12 }}>{err}</p>}
        {msg && <p style={{ color: 'var(--green)', marginTop: 12 }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 14, marginTop: 18, fontSize: 13 }}>
          {mode !== 'signin' && <a style={link} onClick={() => setMode('signin')}>Sign in</a>}
          {mode !== 'signup' && <a style={link} onClick={() => setMode('signup')}>Create account</a>}
          {mode !== 'magic' && <a style={link} onClick={() => setMode('magic')}>Email me a link</a>}
        </div>
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  width: 380, maxWidth: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 16, padding: 30, boxShadow: '0 1px 2px rgba(20,20,25,0.04)',
}
const logoMark: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: '#fff',
  display: 'grid', placeItems: 'center', fontFamily: 'Space Grotesk', fontWeight: 700,
}
const chip: React.CSSProperties = {
  fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 11, color: 'var(--accent)',
  background: 'var(--accent-light)', padding: '2px 7px', borderRadius: 6,
}
const input: React.CSSProperties = {
  padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10,
  background: '#fff', fontSize: 14, fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  padding: '11px 12px', border: 'none', borderRadius: 10, background: 'var(--accent)',
  color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
}
const link: React.CSSProperties = { color: 'var(--accent)', cursor: 'pointer' }
