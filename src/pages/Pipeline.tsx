import { useCallback, useEffect, useState } from 'react'
import Screen from '../components/Screen'
import QuickAddDeal from '../components/QuickAddDeal'
import { supabase } from '../lib/supabase'
import { STAGES, PACKAGE_COLOR, pkg } from '../lib/catalog'
import { dealTotals, pipelineTotal, weightedPipeline, money } from '../lib/money'
import type { Deal } from '../lib/types'

// Reads real deals from Supabase (RLS-scoped to the org) + quick-add.
// Drag-and-drop and the deal detail slide-over come next.
export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(() => {
    supabase
      .from('deals')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        else { setDeals((data as Deal[]) ?? []); setErr(null) }
        setLoading(false)
      })
  }, [])

  useEffect(() => { load() }, [load])

  const stat = (label: string, value: string) => (
    <div style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)' }}>{label}</span>
      <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{value}</span>
    </div>
  )

  return (
    <Screen
      title="Pipeline"
      subtitle="Every deal in flight"
      actions={<button onClick={() => setShowAdd(true)} style={newDealBtn}>+ New deal</button>}
    >
      {showAdd && <QuickAddDeal onClose={() => setShowAdd(false)} onCreated={load} />}
      <div style={{ display: 'flex', gap: 36, marginBottom: 20 }}>
        {stat('Open deals', String(deals.filter((d) => d.stage !== 'won').length))}
        {stat('Pipeline value', money(pipelineTotal(deals)))}
        {stat('Weighted forecast', money(weightedPipeline(deals)))}
      </div>

      {loading && <p style={{ color: 'var(--ink-soft)' }}>Loading deals…</p>}
      {err && (
        <div style={errorBox}>
          <b>Couldn't load deals.</b> {err}
          <div style={{ marginTop: 6, color: 'var(--ink-soft)' }}>
            Make sure the schema is applied and your <code>.env.local</code> points at Supabase.
          </div>
        </div>
      )}

      {!loading && !err && (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
          {STAGES.map((s) => {
            const col = deals.filter((d) => d.stage === s.id)
            const total = col.reduce((sum, d) => sum + dealTotals(d).acv, 0)
            return (
              <div key={s.id} style={column}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                  <b style={{ fontSize: 13 }}>{s.name}</b>
                  <span style={countPill}>{col.length}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-soft)' }}>{money(total)}</span>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {col.map((d) => {
                    const t = dealTotals(d)
                    return (
                      <div key={d.id} style={dealCard}>
                        <b style={{ fontSize: 14 }}>{d.company}</b>
                        <span style={{ ...pkgBadge, background: PACKAGE_COLOR[d.package_id] + '22', color: PACKAGE_COLOR[d.package_id] }}>
                          {pkg(d.package_id).name}
                        </span>
                        <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{d.name}</div>
                        <div className="num" style={{ fontSize: 13, marginTop: 2 }}>
                          {money(t.setup)} · {money(t.monthly)}/mo
                        </div>
                      </div>
                    )
                  })}
                  {col.length === 0 && <div style={{ color: 'var(--ink-muted)', fontSize: 12, padding: '8px 2px' }}>No deals</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && !err && deals.length === 0 && (
        <p style={{ color: 'var(--ink-soft)', marginTop: 16 }}>
          No deals yet. Click <b>+ New deal</b> to add your first lead.
        </p>
      )}
    </Screen>
  )
}

const column: React.CSSProperties = {
  minWidth: 260, background: 'var(--rail)', border: '1px solid var(--line)', borderRadius: 14, padding: 12,
}
const countPill: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, background: '#fff', border: '1px solid var(--line)', borderRadius: 20, padding: '1px 7px',
}
const dealCard: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 12, padding: 12,
  display: 'grid', gap: 4, boxShadow: '0 1px 2px rgba(20,20,25,0.04)',
}
const pkgBadge: React.CSSProperties = {
  justifySelf: 'start', fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 7,
}
const errorBox: React.CSSProperties = {
  background: 'var(--amber-bg)', border: '1px solid var(--amber-2)', color: 'var(--amber)',
  borderRadius: 12, padding: 14, maxWidth: 560,
}
const newDealBtn: React.CSSProperties = {
  padding: '9px 16px', border: 'none', borderRadius: 9, background: 'var(--accent)',
  color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
