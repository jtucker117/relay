import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

// First-run: signed in but no org. Calls the bootstrap_org RPC to create the workspace.
export default function Onboarding() {
  const { refreshProfile, signOut } = useAuth()
  const [orgName, setOrgName] = useState('SiteStac')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('bootstrap_org', { org_name: orgName })
    if (error) { setErr(error.message); setBusy(false); return }
    await refreshProfile()
    setBusy(false)
  }

  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: 400, maxWidth: '100%', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, padding: 30 }}>
        <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Create your workspace</h1>
        <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
          Name your agency workspace. You'll be its Owner and can invite teammates in Settings.
        </p>
        <form onSubmit={create} style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Agency name"
            required
            style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14 }}
          />
          <button disabled={busy} style={{ padding: '11px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
        {err && <p style={{ color: '#c33', marginTop: 12 }}>{err}</p>}
        <a onClick={signOut} style={{ color: 'var(--ink-soft)', fontSize: 13, cursor: 'pointer', display: 'inline-block', marginTop: 16 }}>
          Sign out
        </a>
      </div>
    </div>
  )
}
