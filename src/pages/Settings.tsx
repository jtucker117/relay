import { useEffect, useState } from 'react'
import Screen from '../components/Screen'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

interface OrgSettings {
  name: string; tagline: string; site: string; email: string; phone: string; addr: string; logo: string
}

// Business info (brands invoices). Team/user management comes next.
export default function Settings() {
  const { profile } = useAuth()
  const [s, setS] = useState<OrgSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!profile?.org_id) return
    supabase.from('org_settings').select('*').eq('org_id', profile.org_id).maybeSingle()
      .then(({ data }) => setS((data as OrgSettings) ?? blank()))
  }, [profile?.org_id])

  async function save() {
    if (!profile?.org_id || !s) return
    await supabase.from('org_settings').update(s).eq('org_id', profile.org_id)
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  if (!s) return <Screen title="Settings"><p style={{ color: 'var(--ink-soft)' }}>Loading…</p></Screen>

  const field = (key: keyof OrgSettings, label: string) => (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{label}</span>
      <input value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })}
        style={{ padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, fontSize: 14 }} />
    </label>
  )

  return (
    <Screen title="Settings" subtitle="Business info & branding"
      actions={<button onClick={save} style={btn}>{saved ? 'Saved ✓' : 'Save'}</button>}>
      <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
        {field('name', 'Business name')}
        {field('tagline', 'Tagline')}
        {field('site', 'Website')}
        {field('email', 'Billing email')}
        {field('phone', 'Phone')}
        {field('addr', 'Address')}
      </div>
    </Screen>
  )
}

const blank = (): OrgSettings => ({ name: 'SiteStac', tagline: '', site: 'sitestac.com', email: '', phone: '', addr: '', logo: '' })
const btn: React.CSSProperties = {
  padding: '8px 14px', border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer',
}
