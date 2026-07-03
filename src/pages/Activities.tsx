import Screen from '../components/Screen'

export default function Activities() {
  return (
    <Screen title="Activities" subtitle="Tasks & follow-ups">
      <p style={{ color: 'var(--ink-soft)' }}>
        Tasks grouped by Today / Tomorrow / This week, checkable, with per-task Google Calendar
        links (a <code>calendar.google.com/render</code> deep link — no OAuth). Backed by the
        <code> activities</code> table.
      </p>
    </Screen>
  )
}
