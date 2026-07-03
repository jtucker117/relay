import Screen from '../components/Screen'

export default function Dashboard() {
  return (
    <Screen title="Dashboard" subtitle="Pipeline health at a glance">
      <p style={{ color: 'var(--ink-soft)' }}>
        Metric cards (Open pipeline, Collected, Won this quarter, Win rate), the stage funnel, and
        package mix land here — all computed from real deals + paid invoices via the helpers in
        <code> src/lib/money.ts</code>.
      </p>
    </Screen>
  )
}
