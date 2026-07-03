import Screen from '../components/Screen'

export default function BuildQueue() {
  return (
    <Screen title="Build Queue" subtitle="Approved & revision jobs">
      <p style={{ color: 'var(--ink-soft)' }}>
        Jobs = previews that are approved or have changes requested. Inline client comments each get
        a “Reply &amp; email” box that writes the reply back into the shared preview record (so it
        appears in the client portal) and triggers a Resend email (Critical 3).
      </p>
    </Screen>
  )
}
