import { useCallback, useEffect, useMemo, useState } from 'react'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { supabase } from '../lib/supabase'
import type { Lead, LeadStatus } from '../lib/types'

// Shared outreach board — ports the standalone SiteStac lead tool into Relay.
// Search • coordinate map • per-lead outreach stages • notes • CSV export • manual add.
// Data lives in the `leads` table (supabase/004_leads.sql), shared across the team.

const STATUS: { id: LeadStatus; label: string; color: string }[] = [
  { id: 'new', label: 'New', color: 'var(--ink-muted)' },
  { id: 'contacted', label: 'Contacted', color: 'var(--blue)' },
  { id: 'followup', label: 'Follow-up', color: 'var(--purple)' },
  { id: 'interested', label: 'Interested', color: 'var(--accent)' },
  { id: 'won', label: 'Won', color: 'var(--green)' },
  { id: 'lost', label: 'Lost', color: '#C0392B' },
  { id: 'unfit', label: 'Unfit', color: 'var(--ink-muted-2)' },
]
const statusMeta = (id: LeadStatus) => STATUS.find((s) => s.id === id) ?? STATUS[0]
const todayISO = () => new Date().toISOString().slice(0, 10)

type SortKey = 'reviews' | 'rating' | 'name' | 'area' | 'contacted'
const num = (v: number | null | undefined) => (v == null ? -1 : v)
const SORTS: Record<SortKey, { label: string; cmp: (a: Lead, b: Lead) => number }> = {
  reviews: { label: 'Most reviews', cmp: (a, b) => num(b.reviews) - num(a.reviews) },
  rating: { label: 'Highest rating', cmp: (a, b) => num(b.rating) - num(a.rating) || num(b.reviews) - num(a.reviews) },
  name: { label: 'Name (A–Z)', cmp: (a, b) => a.name.localeCompare(b.name) },
  area: { label: 'Area', cmp: (a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.name.localeCompare(b.name) },
  contacted: { label: 'Recently contacted', cmp: (a, b) => (b.contacted_on ?? '').localeCompare(a.contacted_on ?? '') },
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [area, setArea] = useState<string>('all')
  const [status, setStatus] = useState<LeadStatus | 'all'>('all')
  const [cat, setCat] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('reviews')
  const [open, setOpen] = useState<Lead | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [liveMsg, setLiveMsg] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const load = useCallback(() => {
    supabase.from('leads').select('*').order('reviews', { ascending: false, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        else { setLeads((data as Lead[]) ?? []); setErr(null) }
        setLoading(false)
      })
  }, [])
  useEffect(() => { load() }, [load])

  const areas = useMemo(
    () => Array.from(new Set(leads.map((l) => l.area).filter(Boolean))).sort() as string[],
    [leads],
  )
  const cats = useMemo(
    () => Array.from(new Set(leads.map((l) => l.category).filter(Boolean))).sort() as string[],
    [leads],
  )

  // Everything except the status filter — drives the status-chip counts.
  const scoped = useMemo(() => {
    const t = q.trim().toLowerCase()
    return leads.filter((l) => {
      if (area !== 'all' && l.area !== area) return false
      if (cat !== 'all' && l.category !== cat) return false
      if (!t) return true
      return [l.name, l.category, l.address, l.phone].some((v) => (v ?? '').toLowerCase().includes(t))
    })
  }, [leads, q, area, cat])

  const filtered = useMemo(() => {
    const rows = status === 'all' ? scoped : scoped.filter((l) => l.status === status)
    const by = SORTS[sort].cmp
    return [...rows].sort(by)
  }, [scoped, status, sort])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const l of scoped) c[l.status] = (c[l.status] ?? 0) + 1
    return c
  }, [scoped])

  // Persist an outreach change and reflect it locally without a full reload.
  async function patch(id: string, fields: Partial<Lead>) {
    const { error } = await supabase.from('leads').update(fields).eq('id', id)
    if (error) { setErr(error.message); return false }
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)))
    setOpen((o) => (o && o.id === id ? { ...o, ...fields } : o))
    return true
  }

  async function remove(id: string) {
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    setLeads((prev) => prev.filter((l) => l.id !== id))
    setOpen(null)
  }

  function exportCsv() {
    const cols: (keyof Lead)[] = ['name', 'category', 'area', 'phone', 'address', 'zip',
      'rating', 'reviews', 'web_status', 'status', 'contacted_on', 'notes', 'source', 'lat', 'lng']
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = [cols.join(','), ...filtered.map((l) => cols.map((c) => esc(l[c])).join(','))]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relay-leads-${todayISO()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Calls the `lead-search` edge function (holds the Anthropic key server-side).
  // Until that function is deployed, fail gracefully — manual add still works.
  async function liveSearch() {
    const query = q.trim()
    if (!query) { setLiveMsg('Type what to search for (e.g. "roofers in Conroe") then hit Live search.'); return }
    setSearching(true); setLiveMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('lead-search', { body: { query } })
      if (error) throw error
      const found = (data as { leads?: Lead[] } | null)?.leads ?? []
      if (found.length) {
        await supabase.from('leads').upsert(found.map((f) => ({ ...f, source: 'live' as const })), { onConflict: 'id' })
        load()
        setLiveMsg(`Added ${found.length} lead${found.length > 1 ? 's' : ''} from live search.`)
      } else {
        setLiveMsg('Live search ran but returned no new businesses.')
      }
    } catch {
      setLiveMsg("Live web search isn't wired up yet — the lead-search edge function isn't deployed. ＋ Add lead still works fully.")
    } finally {
      setSearching(false)
    }
  }

  return (
    <Screen
      title="Leads"
      subtitle="Shared outreach pool"
      actions={
        <>
          <div style={searchWrap}>
            <span style={{ color: 'var(--ink-muted)', display: 'flex' }}><Icon name="search" size={16} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, category, address…" style={searchInput} />
          </div>
          <button onClick={liveSearch} disabled={searching} style={ghostBtn} title="Find new businesses via web search">
            🔍 {searching ? 'Searching…' : 'Live search'}
          </button>
          <button onClick={exportCsv} className="icon-btn" aria-label="Export CSV" title="Export filtered leads to CSV">
            <Icon name="dashboard" size={18} />
          </button>
          <button onClick={() => setShowAdd(true)} style={addBtn}>＋ Add lead</button>
        </>
      }
    >
      {open && <OutreachDrawer lead={open} onClose={() => setOpen(null)} onPatch={patch} onRemove={remove} />}
      {showAdd && <AddLead onClose={() => setShowAdd(false)} onCreated={load} />}

      {liveMsg && (
        <div style={noticeBox}>
          <span style={{ flex: 1 }}>{liveMsg}</span>
          <button onClick={() => setLiveMsg(null)} style={noticeClose}>Dismiss</button>
        </div>
      )}

      {/* Area + industry + sort */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <Chip active={area === 'all'} onClick={() => setArea('all')}>All areas</Chip>
        {areas.map((a) => <Chip key={a} active={area === a} onClick={() => setArea(a)}>{a}</Chip>)}
        <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
        <label style={selectWrap}>
          <span style={{ color: 'var(--ink-muted)' }}>Industry</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={select}>
            <option value="all">All industries</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={selectWrap}>
          <span style={{ color: 'var(--ink-muted)' }}>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={select}>
            {(Object.keys(SORTS) as SortKey[]).map((k) => <option key={k} value={k}>{SORTS[k].label}</option>)}
          </select>
        </label>
      </div>

      {/* Status */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <Chip active={status === 'all'} onClick={() => setStatus('all')}>All ({scoped.length})</Chip>
        {STATUS.map((s) => (
          <Chip key={s.id} active={status === s.id} onClick={() => setStatus(s.id)} dot={s.color}>
            {s.label}{counts[s.id] ? ` ${counts[s.id]}` : ''}
          </Chip>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--ink-soft)' }}>Loading leads…</p>}
      {err && <div style={errorBox}><b>Something went wrong.</b> {err}</div>}

      {!loading && !err && (
        <>
          <LeadMap leads={filtered} onPick={setOpen} />

          <div style={grid}>
            {filtered.map((l) => {
              const m = statusMeta(l.status)
              return (
                <div key={l.id} className="deal-card" style={card} onClick={() => setOpen(l)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <b style={{ fontSize: 14.5, lineHeight: 1.25 }}>{l.name}</b>
                    <span style={{ ...pill, color: m.color, background: 'color-mix(in srgb, ' + m.color + ' 14%, transparent)' }}>{m.label}</span>
                  </div>
                  {l.category && <div style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 3 }}>{l.category}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {l.area && <span style={metaChip}>{l.area}</span>}
                    {l.rating != null && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }} className="num">★ {l.rating} · {l.reviews ?? 0}</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12.5, color: 'var(--ink-muted)' }}>
                    <span>{l.phone ?? 'No phone'}</span>
                    {l.contacted_on && <span className="num">contacted {l.contacted_on}</span>}
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <p style={{ color: 'var(--ink-soft)', gridColumn: '1 / -1' }}>No leads match these filters.</p>
            )}
          </div>
        </>
      )}
    </Screen>
  )
}

// ---- Coordinate map (lightweight SVG scatter, no external map dep) ----
function LeadMap({ leads, onPick }: { leads: Lead[]; onPick: (l: Lead) => void }) {
  const pts = leads.filter((l) => l.lat != null && l.lng != null)
  if (pts.length < 2) return null
  const W = 900, H = 340, pad = 26
  const lats = pts.map((p) => p.lat as number)
  const lngs = pts.map((p) => p.lng as number)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const spanLat = maxLat - minLat || 1, spanLng = maxLng - minLng || 1
  const x = (lng: number) => pad + ((lng - minLng) / spanLng) * (W - 2 * pad)
  const y = (lat: number) => H - pad - ((lat - minLat) / spanLat) * (H - 2 * pad) // north = up

  return (
    <div style={mapWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 'auto' }} preserveAspectRatio="xMidYMid meet">
        {pts.map((p) => {
          const m = statusMeta(p.status)
          return (
            <circle key={p.id} cx={x(p.lng as number)} cy={y(p.lat as number)} r={6}
              fill={m.color} fillOpacity={0.85} stroke="#fff" strokeWidth={1.5}
              style={{ cursor: 'pointer' }} onClick={() => onPick(p)}>
              <title>{p.name} — {m.label}{p.area ? ` (${p.area})` : ''}</title>
            </circle>
          )
        })}
      </svg>
      <div style={{ position: 'absolute', bottom: 8, right: 12, fontSize: 11, color: 'var(--ink-muted)' }}>
        {pts.length} of {leads.length} mapped
      </div>
    </div>
  )
}

// ---- Outreach slide-over ----
function OutreachDrawer({ lead, onClose, onPatch, onRemove }: {
  lead: Lead
  onClose: () => void
  onPatch: (id: string, f: Partial<Lead>) => Promise<boolean>
  onRemove: (id: string) => void
}) {
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [contacted, setContacted] = useState(lead.contacted_on ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = notes !== (lead.notes ?? '') || contacted !== (lead.contacted_on ?? '')

  async function setStatus(s: LeadStatus) {
    // First outreach touch → stamp today's date if none set yet.
    const stamp = s !== 'new' && !contacted ? todayISO() : contacted
    if (stamp !== contacted) setContacted(stamp)
    await onPatch(lead.id, { status: s, contacted_on: stamp || null })
  }
  async function save() {
    setSaving(true)
    await onPatch(lead.id, { notes, contacted_on: contacted || null })
    setSaving(false)
  }

  return (
    <div style={scrim} onClick={onClose}>
      <aside style={drawer} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 19, margin: 0 }}>{lead.name}</h2>
            <div style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 2 }}>
              {[lead.category, lead.area].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} style={xBtn} aria-label="Close">✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {lead.rating != null && <span style={factChip} className="num">★ {lead.rating} · {lead.reviews ?? 0} reviews</span>}
          <span style={factChip}>{lead.web_status}</span>
          <span style={factChip}>{lead.source}</span>
        </div>

        <dl style={{ margin: '18px 0 0', display: 'grid', gap: 10 }}>
          <Field label="Phone">
            {lead.phone ? <a href={`tel:${lead.phone}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{lead.phone}</a> : <span style={{ color: 'var(--ink-muted)' }}>—</span>}
          </Field>
          <Field label="Address">{[lead.address, lead.zip].filter(Boolean).join(' ') || '—'}</Field>
        </dl>

        <div style={{ marginTop: 22 }}>
          <div style={labelText}>Outreach stage</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {STATUS.map((s) => {
              const on = lead.status === s.id
              return (
                <button key={s.id} onClick={() => setStatus(s.id)}
                  style={{
                    ...stageBtn,
                    color: on ? '#fff' : s.color,
                    background: on ? s.color : 'transparent',
                    borderColor: on ? s.color : 'var(--line)',
                  }}>
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={labelText}>Contacted on</div>
          <input type="date" value={contacted} onChange={(e) => setContacted(e.target.value)} style={input} />
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={labelText}>Notes</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
            placeholder="Call notes, who you spoke to, next step…" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
          <button onClick={save} disabled={!dirty || saving} style={{ ...addBtn, opacity: !dirty || saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { if (confirm(`Remove ${lead.name} from the lead pool?`)) onRemove(lead.id) }}
            style={dangerBtn}>Delete lead</button>
        </div>
      </aside>
    </div>
  )
}

// ---- Manual add ----
function AddLead({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: '', category: '', area: 'Magnolia', phone: '', address: '', zip: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  async function submit() {
    if (!f.name.trim()) { setErr('Name is required.'); return }
    setSaving(true); setErr(null)
    const { error } = await supabase.from('leads').insert({
      id: crypto.randomUUID(),
      name: f.name.trim(),
      category: f.category.trim() || null,
      area: f.area.trim() || null,
      phone: f.phone.trim() || null,
      address: f.address.trim() || null,
      zip: f.zip.trim() || null,
      source: 'manual',
      status: 'new',
      web_status: 'likely',
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    onCreated(); onClose()
  }

  return (
    <div style={scrim} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 18, margin: '0 0 14px' }}>Add lead</h2>
        {err && <div style={{ ...errorBox, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'grid', gap: 10 }}>
          <input autoFocus value={f.name} onChange={set('name')} placeholder="Business name *" style={input} />
          <input value={f.category} onChange={set('category')} placeholder="Category (e.g. Roofing)" style={input} />
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={f.area} onChange={set('area')} placeholder="Area" style={{ ...input, flex: 1 }} />
            <input value={f.zip} onChange={set('zip')} placeholder="ZIP" style={{ ...input, width: 110 }} />
          </div>
          <input value={f.phone} onChange={set('phone')} placeholder="Phone" style={input} />
          <input value={f.address} onChange={set('address')} placeholder="Address" style={input} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving} style={addBtn}>{saving ? 'Adding…' : 'Add lead'}</button>
        </div>
      </div>
    </div>
  )
}

// ---- Small presentational helpers ----
function Chip({ active, onClick, children, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; dot?: string }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999,
      fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
      border: '1px solid ' + (active ? 'var(--accent)' : 'var(--line)'),
      background: active ? 'var(--accent-light-2)' : 'var(--panel)',
      color: active ? 'var(--accent)' : 'var(--ink-soft)',
    }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />}
      {children}
    </button>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 13.5 }}>
      <dt style={{ width: 74, color: 'var(--ink-muted)', flexShrink: 0 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  )
}

const searchWrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 36,
  border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel)', width: 260,
}
const searchInput: React.CSSProperties = {
  border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, width: '100%', fontFamily: 'inherit',
}
const addBtn: React.CSSProperties = {
  padding: '9px 16px', border: 'none', borderRadius: 10, background: 'var(--accent)',
  color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
}
const ghostBtn: React.CSSProperties = {
  padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel)',
  color: 'var(--ink-soft)', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', fontSize: 13,
}
const dangerBtn: React.CSSProperties = {
  padding: '9px 14px', border: '1px solid var(--line)', borderRadius: 10, background: 'transparent',
  color: '#C0392B', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
const selectWrap: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5,
}
const select: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--panel)',
  fontSize: 12.5, fontFamily: 'inherit', color: 'var(--ink)', cursor: 'pointer', outline: 'none',
}
const grid: React.CSSProperties = {
  display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', marginTop: 16,
}
const card: React.CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 12, padding: 14,
  boxShadow: '0 1px 2px rgba(20,20,25,0.04)',
}
const pill: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 7, whiteSpace: 'nowrap', flexShrink: 0,
}
const metaChip: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 500, color: 'var(--ink-soft)', background: 'var(--rail)',
  border: '1px solid var(--line-3)', padding: '2px 8px', borderRadius: 6,
}
const mapWrap: React.CSSProperties = {
  position: 'relative', background: 'var(--rail)', border: '1px solid var(--line-2)',
  borderRadius: 14, padding: 8, marginBottom: 16, overflow: 'hidden',
}
const errorBox: React.CSSProperties = {
  background: 'var(--amber-bg)', border: '1px solid var(--amber-2)', color: 'var(--amber)',
  borderRadius: 12, padding: 14, maxWidth: 560,
}
const noticeBox: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, background: 'var(--accent-light-2)',
  border: '1px solid var(--accent-light)', color: 'var(--ink-2)', borderRadius: 12,
  padding: '10px 14px', marginBottom: 14, fontSize: 13.5,
}
const noticeClose: React.CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--accent)', fontWeight: 600,
  cursor: 'pointer', fontSize: 12.5, flexShrink: 0,
}
const scrim: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(20,20,25,0.32)', zIndex: 50,
  display: 'flex', justifyContent: 'flex-end',
}
const drawer: React.CSSProperties = {
  width: 440, maxWidth: '92vw', height: '100%', background: 'var(--panel)',
  borderLeft: '1px solid var(--line)', padding: 24, overflowY: 'auto',
}
const modal: React.CSSProperties = {
  margin: 'auto', width: 440, maxWidth: '92vw', background: 'var(--panel)',
  border: '1px solid var(--line)', borderRadius: 16, padding: 22, alignSelf: 'center',
  boxShadow: '0 24px 60px -20px rgba(20,20,25,0.4)',
}
const xBtn: React.CSSProperties = {
  border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: 8, width: 30, height: 30,
  cursor: 'pointer', color: 'var(--ink-soft)', flexShrink: 0,
}
const factChip: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: 'var(--ink-soft)', background: 'var(--rail)',
  border: '1px solid var(--line-3)', padding: '3px 9px', borderRadius: 7,
}
const labelText: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-muted)', marginBottom: 7,
}
const stageBtn: React.CSSProperties = {
  padding: '6px 11px', borderRadius: 8, border: '1px solid', fontSize: 12.5, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}
const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9,
  background: 'var(--panel)', fontSize: 13.5, outline: 'none', fontFamily: 'inherit', color: 'var(--ink)',
}
