import type { ReactNode } from 'react'

// Shared header + page frame (66px header, canvas body) per the design tokens.
export default function Screen({ title, subtitle, actions, children }: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <header style={{
        height: 66, background: 'var(--panel)', borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px',
      }}>
        <div>
          <h1 style={{ fontSize: 18, margin: 0 }}>{title}</h1>
          {subtitle && <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{actions}</div>
      </header>
      <div style={{ padding: 24 }}>{children}</div>
    </>
  )
}
