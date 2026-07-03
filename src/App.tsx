import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import AppShell from './components/AppShell'
import Pipeline from './pages/Pipeline'
import Dashboard from './pages/Dashboard'
import Activities from './pages/Activities'
import BuildQueue from './pages/BuildQueue'
import Settings from './pages/Settings'

function Splash({ label }: { label: string }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--ink-soft)' }}>
      {label}
    </div>
  )
}

export default function App() {
  const { session, profile, loading } = useAuth()

  if (loading) return <Splash label="Loading…" />

  // Not signed in → auth screen.
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Signed in but no org yet → bootstrap workspace.
  if (!profile?.org_id) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    )
  }

  // Full app.
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Pipeline />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="activities" element={<Activities />} />
        <Route path="build" element={<BuildQueue />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
