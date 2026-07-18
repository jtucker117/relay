import { useCallback, useEffect, useState } from 'react'
import Screen from '../components/Screen'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Role } from '../lib/types'

interface OrgSettings {
  name: string; tagline: string; site: string; email: string; phone: string; addr: string; logo: string
}
interface Member { user_id: string; name: string; email: string; role: Role }
interface Invite { id: string; email: string; name: string; role: Role }

const ASSIGNABLE: Role[] = ['Admin', 'Salesperson', 'Builder']

export default function Settings() {
  const { profile } = useAuth()
  const orgId = profile?.org_id
  const [s, setS] = useState<OrgSettings | null>(null)
  const [saved, setSaved] = useState(false)

  // Business info
  useEffect(() => {
    if (!orgId) return
    supabase.from('org_settings').select('*').eq('org_id', orgId).maybeSingle()
      .then(({ data }) => setS((data as OrgSettings) ?? blank()))
  }, [orgId])

  async function save() {
    if (!orgId || !s) return
    await supabase.from('org_settings').update(s).eq('org_id', orgId)
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  const field = (key: keyof OrgSettings, label: string) => (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{label}</span>
      <input value={s?.[key] ?? ''} onChange={(e) => s && setS({ ...s, [key]: e.target.value })}
        style={input} />
    </label>
  )

  return (
    <Screen title="Settings" subtitle="Business info, branding & team"
      actions={<button onClick={save} style={btn}>{saved ? 'Saved ✓' : 'Save'}</button>}>
      {!s ? <p style={{ color: 'var(--ink-soft)' }}>Loading…</p> : (
        <div style={{ display: 'grid', gap: 24, maxWidth: 640 }}>
          <section style={cardStyle}>
            <h3 style={h3}>Business info</h3>
            <p style={sub}>Shown on invoices and client-facing docs.</p>
            <div style={{ display: 'grid', gap: 12 }}>
              {field('name', 'Business name')}
              {field('tagline', 'Tagline')}
              {field('site', 'Website')}
              {field('email', 'Billing email')}
              {field('phone', 'Phone')}
              {field('addr', 'Address')}
            </div>
          </section>

          <TeamSection orgId={orgId!} meId={profile!.user_id} myName={profile!.name} orgName={s.name} />
        </div>
      )}
    </Screen>
  )
}

function TeamSection({ orgId, meId, myName, orgName }: { orgId: string; meId: string; myName: string; orgName: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('Salesperson')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      supabase.from('profiles').select('user_id,name,email,role').eq('org_id', orgId),
      supabase.from('invites').select('id,email,name,role').eq('org_id', orgId),
    ])
    setMembers((m.data as Member[]) ?? [])
    setInvites((i.data as Invite[]) ?? [])
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function changeRole(userId: string, newRole: Role) {
    await supabase.from('profiles').update({ role: newRole }).eq('user_id', userId)
    load()
  }
  async function removeMember(userId: string) {
    await supabase.from('profiles').delete().eq('user_id', userId)
    load()
  }
  async function cancelInvite(id: string) {
    await supabase.from('invites').delete().eq('id', id)
    load()
  }
  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setNote(null)
    const to = email.trim(), inviteName = name.trim(), inviteRole = role
    const { error } = await supabase.from('invites').insert({
      org_id: orgId, email: to, name: inviteName, role: inviteRole, invited_by: myName,
    })
    if (error) {
      setBusy(false)
      setErr(error.code === '23505' ? 'That email is already invited.' : error.message)
      return
    }

    // Best-effort invite email — the invite is valid either way.
    const { error: mailErr } = await supabase.functions.invoke('send-invite', {
      body: { email: to, name: inviteName, role: inviteRole, orgName, inviterName: myName, appUrl: window.location.origin },
    })
    setBusy(false)
    setName(''); setEmail(''); setRole('Salesperson')
    setNote(mailErr
      ? `Invite created, but the email didn't send (${mailErr.message}). Send them the signup link manually for now.`
      : `Invite email sent to ${to}.`)
    load()
  }

  const initials = (n: string, fallback: string) =>
    (n || fallback).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <section style={cardStyle}>
      <h3 style={h3}>Team & users</h3>
      <p style={sub}>Invite salespeople and builders. Roles decide what each person sees.</p>

      <div style={{ display: 'grid', gap: 2 }}>
        {members.map((m) => {
          const isMe = m.user_id === meId
          const isOwner = m.role === 'Owner'
          return (
            <div key={m.user_id} style={row}>
              <span style={avatar}>{initials(m.name, m.email)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {m.name || m.email}{isMe && <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}> (you)</span>}
                </div>
                <div style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{m.email}</div>
              </div>
              {isOwner ? (
                <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>Owner</span>
              ) : (
                <select value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value as Role)} style={roleSelect}>
                  {ASSIGNABLE.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {!isMe && !isOwner && (
                <button onClick={() => removeMember(m.user_id)} style={xBtn} aria-label="Remove">×</button>
              )}
            </div>
          )
        })}

        {invites.map((i) => (
          <div key={i.id} style={row}>
            <span style={{ ...avatar, background: 'var(--line)', color: 'var(--ink-soft)' }}>{initials(i.name, i.email)}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {i.name || i.email} <span style={pendingChip}>Invite sent</span>
              </div>
              <div style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{i.email} · {i.role}</div>
            </div>
            <button onClick={() => cancelInvite(i.id)} style={xBtn} aria-label="Cancel invite">×</button>
          </div>
        ))}
      </div>

      <form onSubmit={sendInvite} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 8, marginTop: 16, alignItems: 'center' }}>
        <input style={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input style={input} type="email" placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select style={roleSelect} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ASSIGNABLE.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" disabled={busy} style={btn}>{busy ? '…' : 'Send invite'}</button>
      </form>
      {err && <p style={{ color: '#c33', fontSize: 13, marginTop: 8 }}>{err}</p>}
      {note && <p style={{ color: note.startsWith('Invite email sent') ? 'var(--green)' : 'var(--amber)', fontSize: 13, marginTop: 8 }}>{note}</p>}
      <p style={{ color: 'var(--ink-muted)', fontSize: 12, marginTop: 8 }}>
        Supabase emails the invitee an invitation. They accept from their inbox and land in this
        workspace with the chosen role — no separate signup needed.
      </p>
    </section>
  )
}

const blank = (): OrgSettings => ({ name: 'SiteStac', tagline: '', site: 'sitestac.com', email: '', phone: '', addr: '', logo: '' })

const cardStyle: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: 20,
}
const h3: React.CSSProperties = { fontSize: 15, margin: '0 0 2px' }
const sub: React.CSSProperties = { color: 'var(--ink-soft)', fontSize: 13, margin: '0 0 14px' }
const input: React.CSSProperties = {
  padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, fontSize: 14, background: '#fff', width: '100%',
}
const roleSelect: React.CSSProperties = {
  padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: '#fff',
}
const btn: React.CSSProperties = {
  padding: '8px 14px', border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer',
}
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line-3)',
}
const avatar: React.CSSProperties = {
  width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0,
}
const pendingChip: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--amber)', background: 'var(--amber-bg)', padding: '1px 6px', borderRadius: 5,
}
const xBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: 'var(--ink-muted)', padding: '0 4px',
}
