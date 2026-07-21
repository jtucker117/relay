import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { PACKAGES, ADDONS, STAGES, PACKAGE_COLOR, INDUSTRIES, pkg, stage as stageDef } from '../lib/catalog'
import { dealTotals, money } from '../lib/money'
import PreviewSection from './PreviewSection'
import InvoiceModal from './InvoiceModal'
import type { Comment, Deal, PackageId, Stage } from '../lib/types'

// High-fidelity deal detail — two-column slide-over matching the Relay prototype.
export default function DealDetail({ deal, onClose, onChange }: {
  deal: Deal; onClose: () => void; onChange: () => void
}) {
  const { profile } = useAuth()
  const [d, setD] = useState<Deal>(deal)
  const [editPlan, setEditPlan] = useState(false)
  const [editContact, setEditContact] = useState(false)
  const [showInvoice, setShowInvoice] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => { setD(deal) }, [deal])

  const loadComments = useCallback(() => {
    supabase.from('comments').select('*').eq('deal_id', deal.id).order('created_at', { ascending: true })
      .then(({ data }) => setComments((data as Comment[]) ?? []))
  }, [deal.id])
  useEffect(() => { loadComments() }, [loadComments])

  async function patch(fields: Partial<Deal>) {
    const next = { ...d, ...fields }
    setD(next)
    await supabase.from('deals').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', deal.id)
    onChange()
  }
  function toggleAddon(id: string) {
    patch({ addons: d.addons.includes(id) ? d.addons.filter((a) => a !== id) : [...d.addons, id] })
  }
  async function post() {
    const text = draft.trim()
    if (!text || !profile) return
    const initials = profile.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    setDraft('')
    await supabase.from('comments').insert({ org_id: profile.org_id, deal_id: deal.id, author: profile.name, initials, text })
    loadComments()
  }

  const t = dealTotals(d)
  const p = pkg(d.package_id)
  const color = PACKAGE_COLOR[d.package_id]
  const brief = d.brief
  const curIdx = STAGES.findIndex((s) => s.id === d.stage)

  return (
    <div style={overlay} onClick={onClose}>
      {showInvoice && <InvoiceModal deal={d} onClose={() => setShowInvoice(false)} onChange={onChange} />}
      <aside style={panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="deal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...chip, background: stageDef(d.stage).color + '22', color: stageDef(d.stage).color }}>{stageDef(d.stage).name}</span>
            <span style={{ ...chip, background: color + '1F', color }}>{p.name}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button style={openInvoiceBtn} onClick={() => setShowInvoice(true)}>🧾 Open invoice</button>
              <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
            </div>
          </div>
          <input style={titleInput} value={d.company} onChange={(e) => setD({ ...d, company: e.target.value })} onBlur={(e) => patch({ company: e.target.value })} />
          <input style={subInput} value={d.name} placeholder="Deal name" onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={(e) => patch({ name: e.target.value })} />
          <div className="num" style={{ fontSize: 27, fontWeight: 700, marginTop: 6 }}>
            {money(t.setup)} <span style={{ color: 'var(--ink-soft)', fontSize: 15, fontWeight: 400 }}>+ {money(t.monthly)}/mo · {money(t.acv)} first-year</span>
          </div>

          {/* Connected stage stepper */}
          <div style={{ display: 'flex', gap: 6, marginTop: 18 }}>
            {STAGES.map((s, i) => {
              const done = i < curIdx, active = i === curIdx
              const fill = done ? '#3A3A42' : active ? s.color : 'var(--line)'
              return (
                <button key={s.id} onClick={() => patch({ stage: s.id as Stage })} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <div style={{ height: 6, borderRadius: 4, background: fill }} />
                  <div style={{ fontSize: 12, marginTop: 7, color: active ? s.color : 'var(--ink-muted)', fontWeight: active ? 600 : 500 }}>{s.name}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Two-column body (stacks on mobile) */}
        <div className="deal-body">
          {/* LEFT */}
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <Card label="Client details" action={<button style={editBtn} onClick={() => setEditContact(!editContact)}>✎ {editContact ? 'Done' : 'Edit'}</button>}>
              {!editContact ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field k="Contact"><b>{d.contact || '—'}</b><div style={muted}>{d.email || 'no email'}</div></Field>
                  <Field k="Source"><b>{d.source || '—'}</b><div style={muted}>Updated {timeAgo(d.updated_at)}</div></Field>
                  <Field k="Industry"><b>{d.industry || '—'}</b></Field>
                  <Field k="Current site">
                    {d.website ? <a href={href(d.website)} target="_blank" rel="noreferrer" style={link}>{tidy(d.website)}</a> : <b>No site yet</b>}
                  </Field>
                  {d.socials && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <Field k="Socials">
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                          {socialList(d.socials).map((s) => (
                            <a key={s} href={href(s)} target="_blank" rel="noreferrer" style={link}>{tidy(s)}</a>
                          ))}
                        </div>
                      </Field>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {mini('Contact', d.contact, (v) => setD({ ...d, contact: v }), (v) => patch({ contact: v }))}
                  {mini('Email', d.email, (v) => setD({ ...d, email: v }), (v) => patch({ email: v }))}
                  {mini('Phone', d.phone ?? '', (v) => setD({ ...d, phone: v }), (v) => patch({ phone: v }))}
                  {mini('Source', d.source, (v) => setD({ ...d, source: v }), (v) => patch({ source: v }))}
                  {mini('Industry', d.industry ?? '', (v) => setD({ ...d, industry: v }), (v) => patch({ industry: v || null }), INDUSTRIES)}
                  {mini('Current website', d.website ?? '', (v) => setD({ ...d, website: v }), (v) => patch({ website: v || null }))}
                  <label style={{ display: 'grid', gap: 3, gridColumn: '1 / -1' }}>
                    <span style={fieldLabel}>Social links (one per line)</span>
                    <textarea
                      style={{ ...miniInput, minHeight: 58, resize: 'vertical', fontFamily: 'inherit' }}
                      value={d.socials ?? ''}
                      onChange={(e) => setD({ ...d, socials: e.target.value })}
                      onBlur={(e) => patch({ socials: e.target.value || null })}
                    />
                  </label>
                </div>
              )}
            </Card>

            <Card label="Package stack" action={<button style={editBtn} onClick={() => setEditPlan(!editPlan)}>✎ {editPlan ? 'Done' : 'Edit plan'}</button>}>
              {!editPlan ? (
                <>
                  <div style={{ ...pkgCard, borderColor: color + '55', background: color + '0D' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <b style={{ fontSize: 15 }}>{p.name} <span style={{ ...tierChip, background: color + '22', color }}>{p.tier}</span></b>
                      <span className="num" style={{ fontWeight: 600 }}>{money(p.setup)} + {money(p.monthly)}/mo</span>
                    </div>
                    <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '8px 0 12px' }}>{p.blurb}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {p.features.map((f) => (
                        <div key={f} style={{ display: 'flex', gap: 7, fontSize: 13 }}>
                          <span style={{ color }}>●</span>{f}
                        </div>
                      ))}
                    </div>
                  </div>
                  {d.addons.map((id) => {
                    const a = ADDONS.find((x) => x.id === id)!
                    return (
                      <div key={id} style={addonRow}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-light)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontSize: 12 }}>▪</span>
                        <span style={{ flex: 1, fontSize: 14 }}>{a.name}</span>
                        <span className="num" style={{ color: 'var(--ink-soft)' }}>{money(a.price)}{a.monthly ? ` · ${money(a.monthly)}/mo` : ''}</span>
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, marginTop: 4, borderTop: '1px solid var(--line)' }}>
                    <b style={{ color: 'var(--ink-soft)', fontWeight: 500 }}>Estimated total</b>
                    <b className="num">{money(t.setup)} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>+ {money(t.monthly)}/mo</span></b>
                  </div>
                </>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {PACKAGES.map((pp) => {
                      const on = pp.id === d.package_id
                      return (
                        <button key={pp.id} onClick={() => patch({ package_id: pp.id as PackageId })} style={{ padding: 10, borderRadius: 10, textAlign: 'left', cursor: 'pointer', border: '1px solid ' + (on ? PACKAGE_COLOR[pp.id] : 'var(--line)'), background: on ? PACKAGE_COLOR[pp.id] + '12' : 'var(--panel)' }}>
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
                        <button key={a.id} onClick={() => toggleAddon(a.id)} style={{ padding: '5px 10px', borderRadius: 20, fontSize: 12.5, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--accent-light)' : 'var(--panel)', color: on ? 'var(--accent-hover)' : 'var(--ink-soft)' }}>
                          {on ? '✓ ' : '+ '}{a.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>

            {brief && (
              <Card label="Project brief" action={<span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>from intake form</span>}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {brief.website !== undefined && <Field k="Website"><b>{brief.website || '—'}</b></Field>}
                  {brief.social && <Field k="Social"><b>{brief.social}</b></Field>}
                  {brief.industry && <Field k="Industry"><b>{brief.industry}</b></Field>}
                  {brief.timeline && <Field k="Target launch"><b>{brief.timeline}</b></Field>}
                  {brief.pages?.length ? <Field k="Pages"><b>{brief.pages.join(', ')}</b></Field> : null}
                  {brief.tones?.length ? <Field k="Tone"><b>{brief.tones.join(', ')}</b></Field> : null}
                </div>
                {brief.colors?.length ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={fieldLabel}>Brand colors</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                      {brief.colors.map((c) => <span key={c} style={{ width: 20, height: 20, borderRadius: 5, background: c, border: '1px solid var(--line)' }} />)}
                    </div>
                  </div>
                ) : null}
              </Card>
            )}
          </div>

          {/* RIGHT */}
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <Card label="Notes & activity" action={<span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{comments.length} note{comments.length === 1 ? '' : 's'}</span>}>
              <div style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
                {comments.map((c) => (
                  <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                    <span style={avatar}>{c.initials}</span>
                    <div>
                      <div style={{ fontSize: 13 }}><b>{c.author}</b> <span style={{ color: 'var(--ink-muted)' }}>· {new Date(c.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {new Date(c.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
                      <div style={{ fontSize: 14, marginTop: 2 }}>{c.text}</div>
                    </div>
                  </div>
                ))}
                {comments.length === 0 && <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No notes yet.</div>}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={avatar}>{(profile?.name || 'U').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post() }} placeholder="Write a note…" style={composer} rows={2} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>⌘ + Enter to post</span>
                    <button onClick={post} style={postBtn}>Post</button>
                  </div>
                </div>
              </div>
            </Card>

            <Card label="Free preview" accent>
              <PreviewSection deal={d} />
            </Card>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Card({ label, action, accent, children }: { label: string; action?: ReactNode; accent?: boolean; children: ReactNode }) {
  return (
    <section style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: 18, ...(accent ? { background: 'var(--accent-light-2)', borderColor: '#DBD3FF' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={cardLabel}>{label}</span>
        {action}
      </div>
      {children}
    </section>
  )
}
function Field({ k, children }: { k: string; children: ReactNode }) {
  return <div><div style={fieldLabel}>{k}</div><div style={{ marginTop: 3, fontSize: 14 }}>{children}</div></div>
}
function mini(labelText: string, value: string, onInput: (v: string) => void, onSave: (v: string) => void, options?: string[]) {
  const listId = options ? `dd-${labelText.replace(/\s+/g, '-').toLowerCase()}` : undefined
  return (
    <label style={{ display: 'grid', gap: 3 }}>
      <span style={fieldLabel}>{labelText}</span>
      <input style={miniInput} value={value} list={listId} onChange={(e) => onInput(e.target.value)} onBlur={(e) => onSave(e.target.value)} />
      {options && <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
    </label>
  )
}
// Socials are stored as free text — one link per line is the convention, but tolerate
// commas too since that's how people paste them.
function socialList(raw: string): string[] {
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
}
// Salespeople type "greenlinelawn.com", not "https://…" — make it clickable anyway.
const href = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`)
const tidy = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d > 0) return `${d}d ago`
  const h = Math.floor(diff / 3600000)
  if (h > 0) return `${h}h ago`
  return 'just now'
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,20,25,0.35)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }
const panel: React.CSSProperties = { width: 'min(960px, 96vw)', background: 'var(--canvas)', height: '100%', overflowY: 'auto', boxShadow: '-10px 0 40px rgba(0,0,0,0.18)' }
const chip: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }
const titleInput: React.CSSProperties = { fontFamily: 'Space Grotesk', fontSize: 28, fontWeight: 700, border: 'none', background: 'transparent', width: '100%', padding: 0, margin: '12px 0 0', outline: 'none' }
const subInput: React.CSSProperties = { fontSize: 15, color: 'var(--ink-soft)', border: 'none', background: 'transparent', width: '100%', padding: 0, outline: 'none' }
const cardLabel: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-muted)', fontWeight: 600 }
const fieldLabel: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)' }
const muted: React.CSSProperties = { color: 'var(--ink-soft)', fontSize: 12.5, marginTop: 1 }
const pkgCard: React.CSSProperties = { border: '1px solid', borderRadius: 12, padding: 14, marginBottom: 10 }
const tierChip: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, marginLeft: 4 }
const addonRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px', borderTop: '1px solid var(--line-3)' }
const avatar: React.CSSProperties = { width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0 }
const composer: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', resize: 'vertical', background: '#fff' }
const postBtn: React.CSSProperties = { padding: '7px 16px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }
const miniInput: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, background: '#fff', width: '100%' }
const editBtn: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: 8, padding: '5px 11px', fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }
const openInvoiceBtn: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: 9, padding: '7px 13px', fontSize: 13, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }
const closeBtn: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--panel)', width: 34, height: 34, borderRadius: 9, fontSize: 20, cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }
const link: React.CSSProperties = { color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' }
