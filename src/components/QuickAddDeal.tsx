import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { PACKAGES, STAGES, INDUSTRIES } from '../lib/catalog'
import type { PackageId, Stage } from '../lib/types'

// Quick-add a new deal/lead → inserts into Supabase (org-scoped via RLS).
export default function QuickAddDeal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: () => void
}) {
  const { profile } = useAuth()
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [socials, setSocials] = useState('')
  const [industry, setIndustry] = useState('')
  const [packageId, setPackageId] = useState<PackageId>('one')
  const [stage, setStage] = useState<Stage>('lead')
  const [source, setSource] = useState('Manual')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!profile?.org_id) { setErr('No workspace found.'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('deals').insert({
      org_id: profile.org_id,
      company, name, contact, email,
      website: website.trim() || null,
      socials: socials.trim() || null,
      industry: industry.trim() || null,
      package_id: packageId, addons: [], stage, source, notes: '', brief: null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onCreated()
    onClose()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>New deal</h2>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>
        <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 16, fontSize: 13 }}>
          Add a lead to your pipeline. You can flesh out the brief, add-ons, and preview later.
        </p>

        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          {field('Company', <input style={input} value={company} onChange={(e) => setCompany(e.target.value)} required autoFocus placeholder="Greenline Lawn Co." />)}
          {field('Deal name', <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="One-page site + booking" />)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {field('Contact name', <input style={input} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Dana Reyes" />)}
            {field('Contact email', <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dana@greenline.co" />)}
          </div>
          {/* Research context — what a builder needs to start pulling reference sites. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {field('Industry', (
              <>
                <input style={input} value={industry} onChange={(e) => setIndustry(e.target.value)} list="industry-options" placeholder="Roofing" />
                <datalist id="industry-options">
                  {INDUSTRIES.map((i) => <option key={i} value={i} />)}
                </datalist>
              </>
            ))}
            {field('Current website', <input style={input} type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="greenlinelawn.com — or leave blank if none" />)}
          </div>
          {field('Social links', (
            <textarea
              style={{ ...input, minHeight: 62, resize: 'vertical' }}
              value={socials}
              onChange={(e) => setSocials(e.target.value)}
              placeholder={'facebook.com/greenlinelawn\ninstagram.com/greenlinelawn'}
            />
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {field('Package', (
              <select style={input} value={packageId} onChange={(e) => setPackageId(e.target.value as PackageId)}>
                {PACKAGES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ))}
            {field('Stage', (
              <select style={input} value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ))}
            {field('Source', <input style={input} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Manual" />)}
          </div>

          {err && <p style={{ color: '#c33', margin: 0, fontSize: 13 }}>{err}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
            <button type="submit" disabled={busy} style={primaryBtn}>{busy ? 'Adding…' : 'Add deal'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function field(label: string, control: React.ReactNode) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{label}</span>
      {control}
    </label>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(20,20,25,0.4)', display: 'grid',
  placeItems: 'center', padding: 20, zIndex: 50,
}
const modal: React.CSSProperties = {
  width: 560, maxWidth: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 16, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
}
const input: React.CSSProperties = {
  padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, fontSize: 14,
  background: '#fff', fontFamily: 'inherit', width: '100%',
}
const primaryBtn: React.CSSProperties = {
  padding: '9px 16px', border: 'none', borderRadius: 9, background: 'var(--accent)',
  color: '#fff', fontWeight: 600, cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  padding: '9px 16px', border: '1px solid var(--line)', borderRadius: 9, background: '#fff',
  color: 'var(--ink)', fontWeight: 500, cursor: 'pointer',
}
const closeBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer',
  color: 'var(--ink-soft)',
}
