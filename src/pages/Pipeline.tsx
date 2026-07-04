import { useCallback, useEffect, useMemo, useState } from 'react'
import Screen from '../components/Screen'
import QuickAddDeal from '../components/QuickAddDeal'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import { STAGES, PACKAGE_COLOR, pkg } from '../lib/catalog'
import { dealTotals, pipelineTotal, weightedPipeline, money } from '../lib/money'
import type { Deal } from '../lib/types'

// High-fidelity pipeline board: stat bar, search, stage columns, tinted deal cards.
// Reads real deals from Supabase (RLS-scoped). Drag-and-drop + deal slide-over next.
export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [q, setQ] = useState('')

  const load = useCallback(() => {
    supabase.from('deals').select('*').order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        else { setDeals((data as Deal[]) ?? []); setErr(null) }
        setLoading(false)
      })
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return deals
    return deals.filter((d) =>
      [d.company, d.name, d.contact, d.email].some((v) => (v ?? '').toLowerCase().includes(t)))
  }, [deals, q])

  return (
    <Screen
      title="Pipeline"
      subtitle="Every deal in flight"
      actions={
        <>
          <div style={searchWrap}>
            <span style={{ color: 'var(--ink-muted)', display: 'flex' }}><Icon name="search" size={16} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients, deals…" style={searchInput} />
          </div>
          <button className="icon-btn" aria-label="Notifications"><Icon name="bell" size={18} /></button>
          <button onClick={() => setShowAdd(true)} style={newDealBtn}>+ New deal</button>
        </>
      }
    >
      {showAdd && <QuickAddDeal onClose={() => setShowAdd(false)} onCreated={load} />}

      {/* Inline stat bar */}
      <div style={statBar}>
        <span><b className="num" style={{ fontSize: 15 }}>{filtered.filter((d) => d.stage !== 'won').length}</b> open deals</span>
        <span style={divider} />
        <span>Pipeline value <b className="num" style={{ fontSize: 15 }}>{money(pipelineTotal(filtered))}</b></span>
        <span style={divider} />
        <span>Weighted <b className="num" style={{ fontSize: 15, color: 'var(--accent)' }}>{money(weightedPipeline(filtered))}</b></span>
      </div>

      {loading && <p style={{ color: 'var(--ink-soft)' }}>Loading deals…</p>}
      {err && (
        <div style={errorBox}>
          <b>Couldn't load deals.</b> {err}
        </div>
      )}

      {!loading && !err && (
        <div className="pipe-scroll" style={{ display: 'flex', gap: 18, overflowX: 'auto', paddingBottom: 10, marginTop: 18 }}>
          {STAGES.map((s) => {
            const col = filtered.filter((d) => d.stage === s.id)
            const total = col.reduce((sum, d) => sum + dealTotals(d).acv, 0)
            return (
              <div key={s.id} style={column}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '0 2px' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color }} />
                  <b style={{ fontSize: 13.5 }}>{s.name}</b>
                  <span style={countPill}>{col.length}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-soft)' }} className="num">{money(total)}</span>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {col.map((d) => {
                    const t = dealTotals(d)
                    const color = PACKAGE_COLOR[d.package_id]
                    const n = d.addons.length
                    return (
                      <div key={d.id} className="deal-card" style={dealCard}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <b style={{ fontSize: 14.5 }}>{d.company}</b>
                          <span style={{ ...pkgBadge, background: color + '1F', color }}>{pkg(d.package_id).name}</span>
                        </div>
                        {d.name && <div style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 3 }}>{d.name}</div>}
                        {n > 0 && (
                          <span style={addonChip}>+{n} add-on{n > 1 ? 's' : ''}</span>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                          <span className="num" style={{ fontSize: 13 }}>{money(t.setup)} · {money(t.monthly)}/mo</span>
                          {d.source && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{d.source}</span>}
                        </div>
                      </div>
                    )
                  })}
                  {col.length === 0 && <div style={{ color: 'var(--ink-muted)', fontSize: 12.5, padding: '10px 2px' }}>No deals</div>}
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

const searchWrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 36,
  border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel)', width: 240,
}
const searchInput: React.CSSProperties = {
  border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, width: '100%', fontFamily: 'inherit',
}
const statBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 16, color: 'var(--ink-soft)', fontSize: 13.5,
}
const divider: React.CSSProperties = { width: 1, height: 18, background: 'var(--line)' }
const column: React.CSSProperties = { minWidth: 268, maxWidth: 300, flexShrink: 0 }
const countPill: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 20, padding: '1px 8px', color: 'var(--ink-soft)',
}
const dealCard: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 12, padding: 14,
  boxShadow: '0 1px 2px rgba(20,20,25,0.04)',
}
const pkgBadge: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 7, whiteSpace: 'nowrap', flexShrink: 0,
}
const addonChip: React.CSSProperties = {
  display: 'inline-block', marginTop: 8, fontSize: 11.5, fontWeight: 500, color: 'var(--ink-soft)',
  background: 'var(--rail)', border: '1px solid var(--line-3)', padding: '2px 8px', borderRadius: 6,
}
const errorBox: React.CSSProperties = {
  background: 'var(--amber-bg)', border: '1px solid var(--amber-2)', color: 'var(--amber)',
  borderRadius: 12, padding: 14, maxWidth: 560, marginTop: 18,
}
const newDealBtn: React.CSSProperties = {
  padding: '9px 16px', border: 'none', borderRadius: 10, background: 'var(--accent)',
  color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
}
