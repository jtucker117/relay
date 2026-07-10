import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import Icon from './Icon'

const NAV = [
  { to: '/', label: 'Pipeline', icon: 'pipeline', end: true },
  { to: '/leads', label: 'Leads', icon: 'leads' },
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/activities', label: 'Activities', icon: 'activities', badge: 'activities' },
  { to: '/build', label: 'Build Queue', icon: 'build' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

export default function AppShell() {
  const { profile, signOut } = useAuth()
  const [orgName, setOrgName] = useState('')
  const [openTasks, setOpenTasks] = useState(0)

  useEffect(() => {
    if (!profile?.org_id) return
    supabase.from('org_settings').select('name').eq('org_id', profile.org_id).maybeSingle()
      .then(({ data }) => setOrgName((data as { name: string } | null)?.name ?? ''))
    supabase.from('activities').select('id', { count: 'exact', head: true })
      .eq('org_id', profile.org_id).eq('done', false)
      .then(({ count }) => setOpenTasks(count ?? 0))
  }, [profile?.org_id])

  const initials = (profile?.name || 'U')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={sidebar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 20px' }}>
          <span style={logoMark}>R</span>
          <b style={{ color: '#fff', fontFamily: 'Space Grotesk', fontSize: 18 }}>Relay</b>
          <span style={chip}>CRM</span>
        </div>

        <nav style={{ display: 'grid', gap: 3 }}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 9,
                textDecoration: 'none', fontWeight: 500, fontSize: 14,
                color: isActive ? '#fff' : 'var(--sidebar-muted)',
                background: isActive ? 'var(--sidebar-active)' : 'transparent',
              })}>
              <Icon name={n.icon} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge === 'activities' && openTasks > 0 && <span style={badge}>{openTasks}</span>}
            </NavLink>
          ))}
        </nav>

        {orgName && (
          <div style={{ marginTop: 22 }}>
            <div style={sectionLabel}>Workspace</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', color: '#fff', fontSize: 14 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
              {orgName}
            </div>
          </div>
        )}

        <div style={{ marginTop: 'auto' }}>
          <div style={profileRow}>
            <span style={avatar}>{initials}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.name || 'You'}
              </div>
              <div style={{ color: 'var(--sidebar-muted)', fontSize: 12 }}>{profile?.role}</div>
            </div>
            <button onClick={signOut} title="Sign out" style={signOutBtn}>Sign out</button>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}

const sidebar: React.CSSProperties = {
  width: 236, flexShrink: 0, background: 'var(--sidebar)', color: '#fff',
  padding: 16, display: 'flex', flexDirection: 'column',
}
const logoMark: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: '#fff',
  display: 'grid', placeItems: 'center', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 16,
}
const chip: React.CSSProperties = {
  fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 10, color: '#fff',
  background: 'var(--sidebar-active)', padding: '2px 6px', borderRadius: 5,
}
const badge: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#fff',
  borderRadius: 10, padding: '1px 7px', minWidth: 20, textAlign: 'center',
}
const sectionLabel: React.CSSProperties = {
  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em',
  color: 'var(--sidebar-muted)', padding: '0 12px 4px',
}
const profileRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 8px 4px',
  borderTop: '1px solid #26262C',
}
const avatar: React.CSSProperties = {
  width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0,
}
const signOutBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--sidebar-muted)', fontSize: 11,
  cursor: 'pointer', padding: 0, flexShrink: 0,
}
