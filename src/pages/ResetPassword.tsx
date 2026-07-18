import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

// Shown when the user arrives from a password-reset email (PASSWORD_RECOVERY).
// They have a temporary recovery session, so updateUser sets the new password.
export default function ResetPassword() {
  const { clearRecovering, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    clearRecovering() // done → the existing session drops them into the app
  }

  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={logoMark}>R</span>
          <b style={{ fontFamily: 'Space Grotesk', fontSize: 18 }}>Relay</b>
        </div>
        <p style={{ color: 'var(--ink-soft)', margin: '0 0 20px' }}>Set a new password</p>

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <input style={input} type="password" placeholder="New password" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" autoFocus />
          <button style={primaryBtn} disabled={busy}>{busy ? '…' : 'Save new password'}</button>
        </form>

        {err && <p style={{ color: '#c33', marginTop: 12 }}>{err}</p>}

        <div style={{ marginTop: 18, fontSize: 13 }}>
          <a style={link} onClick={() => { clearRecovering(); signOut() }}>Cancel</a>
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
const input: React.CSSProperties = {
  padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10,
  background: '#fff', fontSize: 14, fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  padding: '11px 12px', border: 'none', borderRadius: 10, background: 'var(--accent)',
  color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
}
const link: React.CSSProperties = { color: 'var(--accent)', cursor: 'pointer' }
