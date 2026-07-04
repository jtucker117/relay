import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { PACKAGES, ADDONS, STAGES, PACKAGE_COLOR, pkg, stage as stageDef } from '../lib/catalog'
import { dealTotals, money } from '../lib/money'
import type { Comment, Deal, PackageId, Stage } from '../lib/types'

// Right slide-over: edit a deal end-to-end. Stage stepper, contact, package/add-on
// editor with live totals, project brief, and the notes thread.
export default function DealDetail({ deal, onClose, onChange }: {
  deal: Deal
  onClose: () => void
  onChange: () => void
}) {
  const { profile } = useAuth()
  const [d, setD] = useState<Deal>(deal)
  const [editPlan, setEditPlan] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => { setD(deal) }, [deal])

  const loadComments = useCallback(() => {
    supabase.from('comments').select('*').eq('deal_id', deal.id).order('created_at', { ascending: true })
      .then(({ data }) => setComments((data as Comment[]) ?? []))
  }, [deal.id])
  useEffect(() => { loadComments() }, [loadComments])

  // Persist a patch to the deal (optimistic local + Supabase), then refresh the board.
  async function patch(fields: Partial<Deal>) {
    const next = { ...d, ...fields }
    setD(next)
    await supabase.from('deals').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', deal.id)
    onChange()
  }

  function toggleAddon(id: string) {
    const addons = d.addons.includes(id) ? d.addons.filter((a) => a !== id) : [...d.addons, id]
    patch({ addons })
  }

  async function post() {
    const text = draft.trim()
    if (!text || !profile) return
    const initials = profile.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    setDraft('')
    await supabase.from('comments').insert({
      org_id: profile.org_id, deal_id: deal.id, author: profile.name, initials, text,
    })
    loadComments()
  }

  const t = dealTotals(d)
  const p = pkg(d.package_id)
  const color = PACKAGE_COLOR[d.package_id]
  const brief = d.brief

  return (
    <div style={overlay} onClick={onClose}>
      <aside style={panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ ...stageChip, background: stageDef(d.stage).color + '22', color: stageDef(d.stage).color }}>
              {stageDef(d.stage).name}
            </span>
            <span style={{ ...pkgBadge, background: color + '1F', color }}>{p.name}</span>
            <button onClick={onClose} style={{ ...closeBtn, marginLeft: 'auto' }} aria-label="Close">×</button>
          </div>
          <input style={titleInput} value={d.company} onChange={(e) => setD({ ...d, company: e.target.value })}
            onBlur={(e) => patch({ company: e.target.value })} />
          <input style={subInput} value={d.name} placeholder="Deal name"
            onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={(e) => patch({ name: e.target.value })} />
          <div className="num" style={{ fontSize: 20, marginTop: 8 }}>
            {money(t.setup)} <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>+ {money(t.monthly)}/mo · {money(t.acv)} first-year</span>
          </div>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 22 }}>
          {/* Stage stepper */}
          <div>
            <div style={label}>Stage</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {STAGES.map((s) => {
                const active = s.id === d.stage
                return (
                  <button key={s.id} onClick={() => patch({ stage: s.id as Stage })}
                    style={{
                      flex: 1, padding: '7px 4px', fontSize: 11.5, fontWeight: 600, borderRadius: 7,
                      border: '1px solid ' + (active ? s.color : 'var(--line)'),
                      background: active ? s.color + '18' : 'var(--panel)',
                      color: active ? s.color : 'var(--ink-soft)', cursor: 'pointer',
                    }}>
                    {s.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Contact / source */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {miniField('Contact', d.contact, (v) => setD({ ...d, contact: v }), (v) => patch({ contact: v }))}
            {miniField('Email', d.email, (v) => setD({ ...d, email: v }), (v) => patch({ email: v }))}
            {miniField('Phone', d.phone ?? '', (v) => setD({ ...d, phone: v }), (v) => patch({ phone: v }))}
            {miniField('Source', d.source, (v) => setD({ ...d, source: v }), (v) => patch({ source: v }))}
          </div>

          {/* Package stack + plan editor */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={label}>Package stack</div>
              <button onClick={() => setEditPlan(!editPlan)} style={linkBtn}>{editPlan ? 'Done' : 'Edit plan'}</button>
            </div>

            {!editPlan ? (
              <div style={{ ...planCard, borderColor: color + '55', background: color + '0D' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <b>{p.name} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>· {p.tier}</span></b>
                  <span className="num">{money(p.setup)} · {money(p.monthly)}/mo</span>
                </div>
                <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '6px 0 0' }}>{p.blurb}</p>
                {d.addons.length > 0 && (
                  <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
                    {d.addons.map((id) => {
                      const a = ADDONS.find((x) => x.id === id)!
                      return (
                        <div key={id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span>+ {a.name}</span>
                          <span className="num" style={{ color: 'var(--ink-soft)' }}>{money(a.price)}{a.monthly ? ` · ${money(a.monthly)}/mo` : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>Estimated total</span>
                  <span className="num">{money(t.setup)} · {money(t.monthly)}/mo</span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {PACKAGES.map((pp) => {
                    const on = pp.id === d.package_id
                    return (
                      <button key={pp.id} onClick={() => patch({ package_id: pp.id as PackageId })}
                        style={{
                          padding: 10, borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                          border: '1px solid ' + (on ? PACKAGE_COLOR[pp.id] : 'var(--line)'),
                          background: on ? PACKAGE_COLOR[pp.id] + '12' : 'var(--panel)',
                        }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{pp.name}</div>
                        <div className="num" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{money(pp.setup)}</div>
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ADDONS.map((a) => {
                    const on = d.addons.includes(a.id)
                    return (
                      <button key={a.id} onClick={() => toggleAddon(a.id)}
                        style={{
                          padding: '5px 10px', borderRadius: 20, fontSize: 12.5, cursor: 'pointer',
                          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                          background: on ? 'var(--accent-light)' : 'var(--panel)',
                          color: on ? 'var(--accent-hover)' : 'var(--ink-soft)',
                        }}>
                        {on ? '✓ ' : '+ '}{a.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Project brief */}
          {brief && (
            <div>
              <div style={label}>Project brief</div>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                {brief.industry && briefRow('Industry', brief.industry)}
                {brief.website && briefRow('Website', brief.website)}
                {brief.timeline && briefRow('Launch', brief.timeline)}
                {brief.pages?.length ? briefRow('Pages', brief.pages.join(', ')) : null}
                {brief.tones?.length ? briefRow('Tone', brief.tones.join(', ')) : null}
                {brief.colors?.length ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--ink-soft)', width: 80 }}>Colors</span>
                    <span style={{ display: 'flex', gap: 4 }}>
                      {brief.colors.map((c) => <span key={c} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid var(--line)' }} />)}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Notes & activity */}
          <div>
            <div style={label}>Notes &amp; activity</div>
            <div style={{ display: 'grid', gap: 12, marginBottom: 12 }}>
              {comments.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                  <span style={commentAvatar}>{c.initials}</span>
                  <div>
                    <div style={{ fontSize: 12.5 }}><b>{c.author}</b> <span style={{ color: 'var(--ink-muted)' }}>· {new Date(c.created_at).toLocaleDateString()}</span></div>
                    <div style={{ fontSize: 13.5 }}>{c.text}</div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No notes yet.</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post() }}
                placeholder="Add a note… (⌘+Enter)" style={{ ...miniInput, flex: 1 }} />
              <button onClick={post} style={postBtn}>Post</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function miniField(labelText: string, value: string, onInput: (v: string) => void, onSave: (v: string) => void) {
  return (
    <label style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{labelText}</span>
      <input style={miniInput} value={value} onChange={(e) => onInput(e.target.value)} onBlur={(e) => onSave(e.target.value)} />
    </label>
  )
}
function briefRow(k: string, v: string) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: 'var(--ink-soft)', width: 80, flexShrink: 0 }}>{k}</span>
      <span>{v}</span>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(20,20,25,0.35)', zIndex: 40, display: 'flex', justifyContent: 'flex-end',
}
const panel: React.CSSProperties = {
  width: 580, maxWidth: '100%', background: 'var(--canvas)', height: '100%', overflowY: 'auto',
  boxShadow: '-10px 0 40px rgba(0,0,0,0.18)', animation: 'none',
}
const header: React.CSSProperties = {
  background: 'var(--panel)', borderBottom: '1px solid var(--line)', padding: 20,
}
const label: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 8,
}
const stageChip: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 20 }
const pkgBadge: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 7 }
const titleInput: React.CSSProperties = {
  fontFamily: 'Space Grotesk', fontSize: 22, fontWeight: 700, border: 'none', background: 'transparent',
  width: '100%', padding: 0, outline: 'none',
}
const subInput: React.CSSProperties = {
  fontSize: 14, color: 'var(--ink-soft)', border: 'none', background: 'transparent', width: '100%', padding: 0, outline: 'none',
}
const miniInput: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, background: 'var(--panel)', width: '100%',
}
const planCard: React.CSSProperties = { border: '1px solid', borderRadius: 12, padding: 14, marginTop: 8 }
const linkBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--accent)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
const commentAvatar: React.CSSProperties = {
  width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0,
}
const postBtn: React.CSSProperties = { padding: '8px 14px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }
const closeBtn: React.CSSProperties = { border: 'none', background: 'transparent', fontSize: 22, cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }
