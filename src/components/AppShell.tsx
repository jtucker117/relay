import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

const NAV = [
  { to: '/', label: 'Pipeline', end: true },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/activities', label: 'Activities' },
  { to: '/build', label: 'Build Queue' },
  { to: '/settings', label: 'Settings' },
]

export default function AppShell() {
  const { profile, signOut } = useAuth()
  const initials = (profile?.name || 'U')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={sidebar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px 18px' }}>
          <span style={logoMark}>R</span>
          <b style={{ color: '#fff', fontFamily: 'Space Grotesk', fontSize: 17 }}>Relay</b>
          <span style={chip}>CRM</span>
        </div>
        <nav style={{ display: 'grid', gap: 2 }}>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              style={({ isActive }) => ({
                // Always emit an explicit background so the active highlight clears on nav.
                display: 'block', padding: '9px 12px', borderRadius: 9, textDecoration: 'none',
                fontWeight: 500, fontSize: 14,
                color: isActive ? '#fff' : 'var(--sidebar-muted)',
                background: isActive ? 'var(--sidebar-active)' : 'transparent',
              })}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto' }}>
          <div style={profileRow}>
            <span style={avatar}>{initials}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile?.name || 'You'}
              </div>
              <div style={{ color: 'var(--sidebar-muted)', fontSize: 12 }}>{profile?.role}</div>
            </div>
          </div>
          <a onClick={signOut} style={{ color: 'var(--sidebar-muted)', fontSize: 12, cursor: 'pointer', padding: '8px 6px 0', display: 'inline-block' }}>
            Sign out
          </a>
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
  width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', color: '#fff',
  display: 'grid', placeItems: 'center', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 15,
}
const chip: React.CSSProperties = {
  fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 10, color: '#fff',
  background: 'var(--sidebar-active)', padding: '2px 6px', borderRadius: 5,
}
const profileRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px',
  borderTop: '1px solid #26262C',
}
const avatar: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0,
}
