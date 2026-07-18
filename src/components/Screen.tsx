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
      <header className="screen-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{subtitle}</div>}
        </div>
        {actions && <div className="screen-actions">{actions}</div>}
      </header>
      <div className="screen-body">{children}</div>
    </>
  )
}
