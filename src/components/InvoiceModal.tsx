import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { invoiceTotals, money } from '../lib/money'
import { linesForDeal, invoiceNumber, type DraftLine } from '../lib/invoice'
import type { Deal, Invoice, InvoiceLine } from '../lib/types'

interface OrgSettings { name: string; tagline: string; site: string; email: string; phone: string; addr: string; logo: string }
interface Sig { mode: 'draw' | 'type'; name?: string | null; image?: string | null; signed_at: string }

const DEFAULT_NOTE = 'Thanks for choosing us! A 50% deposit is due to begin the build; the balance is due at launch.'

export default function InvoiceModal({ deal, onClose, onChange }: { deal: Deal; onClose: () => void; onChange?: () => void }) {
  const { profile } = useAuth()
  const [inv, setInv] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [org, setOrg] = useState<OrgSettings | null>(null)
  const [sig, setSig] = useState<Sig | null>(null)
  const [loading, setLoading] = useState(true)
  const [sigMode, setSigMode] = useState<'draw' | 'type'>('draw')
  const [signName, setSignName] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  const load = useCallback(async () => {
    const [{ data: invRow }, { data: orgRow }] = await Promise.all([
      supabase.from('invoices').select('*').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('org_settings').select('*').eq('org_id', profile?.org_id).maybeSingle(),
    ])
    setOrg((orgRow as OrgSettings) ?? null)
    if (invRow) {
      setInv(invRow as Invoice)
      const { data: ls } = await supabase.from('invoice_lines').select('*').eq('invoice_id', (invRow as Invoice).id).order('sort')
      setLines(((ls as InvoiceLine[]) ?? []).map((l) => ({ descr: l.descr, amount: Number(l.amount), recurring: l.recurring, custom: l.custom, sort: l.sort })))
      const { data: s } = await supabase.from('signatures').select('*').eq('invoice_id', (invRow as Invoice).id).maybeSingle()
      setSig((s as Sig) ?? null)
    }
    setLoading(false)
  }, [deal.id, profile?.org_id])
  useEffect(() => { load() }, [load])

  // Size the signature canvas to its element.
  useEffect(() => {
    const c = canvasRef.current
    if (!c || sig) return
    c.width = c.offsetWidth; c.height = c.offsetHeight
    const ctx = c.getContext('2d')!; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1A1A1E'
  }, [sig, sigMode, inv])

  async function create() {
    if (!profile?.org_id) return
    const draft = linesForDeal(deal)
    const { data, error } = await supabase.from('invoices').insert({
      org_id: profile.org_id, deal_id: deal.id, number: invoiceNumber(), status: 'draft',
      deposit_pct: 50, tax_pct: 0, notes: DEFAULT_NOTE, client_name: deal.contact, client_company: deal.company, client_email: deal.email,
    }).select().single()
    if (error || !data) return
    const invRow = data as Invoice
    await supabase.from('invoice_lines').insert(draft.map((l) => ({ ...l, invoice_id: invRow.id, org_id: profile.org_id })))
    setInv(invRow); setLines(draft); onChange?.()
  }

  async function saveHeader(fields: Partial<Invoice>) {
    if (!inv) return
    setInv({ ...inv, ...fields })
    await supabase.from('invoices').update(fields).eq('id', inv.id)
  }
  async function saveLines(next: DraftLine[]) {
    setLines(next)
    if (!inv || !profile?.org_id) return
    await supabase.from('invoice_lines').delete().eq('invoice_id', inv.id)
    await supabase.from('invoice_lines').insert(next.map((l, i) => ({ ...l, sort: i, invoice_id: inv.id, org_id: profile.org_id })))
  }
  async function setStatus(status: 'sent' | 'paid') {
    const stamp = status === 'sent' ? { sent_at: new Date().toISOString() } : { paid_at: new Date().toISOString() }
    await saveHeader({ status, ...stamp }); onChange?.()
  }
  async function del() {
    if (!inv) return
    await supabase.from('invoices').delete().eq('id', inv.id)
    onChange?.(); onClose()
  }

  // Signature drawing
  function ptr(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current!.getContext('2d')!; const p = ptr(e)
    drawing.current = true; dirty.current = true; ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!; const p = ptr(e); ctx.lineTo(p.x, p.y); ctx.stroke()
  }
  function up() { drawing.current = false }
  function clearSig() {
    const c = canvasRef.current; if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; setSignName('')
  }
  async function acceptSig() {
    if (!inv || !profile?.org_id) return
    let row: Sig
    if (sigMode === 'type') {
      if (!signName.trim()) return
      row = { mode: 'type', name: signName.trim(), image: null, signed_at: new Date().toISOString() }
    } else {
      if (!dirty.current) return
      row = { mode: 'draw', image: canvasRef.current!.toDataURL('image/png'), name: null, signed_at: new Date().toISOString() }
    }
    await supabase.from('signatures').upsert({ org_id: profile.org_id, invoice_id: inv.id, ...row }, { onConflict: 'invoice_id' })
    setSig(row)
    if (inv.status === 'draft') setStatus('sent')
  }

  const totals = inv ? invoiceTotals(inv, lines as unknown as InvoiceLine[]) : null
  const statusLabel = inv?.status === 'paid' ? 'Paid' : inv?.status === 'sent' ? 'Sent' : 'Draft'

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {loading ? <div style={{ padding: 40 }}>Loading…</div> : !inv ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <h2 style={{ margin: '0 0 8px' }}>No invoice yet</h2>
            <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>Auto-build the line items from {deal.company}'s package stack.</p>
            <button onClick={create} style={primary}>Create invoice</button>
            <button onClick={onClose} style={{ ...ghost, marginLeft: 8 }}>Cancel</button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={topbar} className="invoice-topbar">
              <span style={{ fontSize: 18 }}>🧾</span>
              <b style={{ fontFamily: 'Space Grotesk', fontSize: 16 }}>Invoice designer</b>
              <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{inv.number}</span>
              <span style={{ ...statusChip, ...statusStyle(inv.status) }}>{statusLabel}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={() => window.print()} style={ghost}>🖨 Print / PDF</button>
                <button onClick={onClose} style={primary}>Done</button>
              </div>
            </div>

            <div className="invoice-body" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* LEFT RAIL — editor */}
              <div style={rail} className="invoice-rail">
                <Label>Status</Label>
                {inv.status === 'draft' && <button onClick={() => setStatus('sent')} style={{ ...primary, width: '100%' }}>Send to client</button>}
                {inv.status === 'sent' && <button onClick={() => setStatus('paid')} style={{ ...primary, width: '100%', background: 'var(--green-2)' }}>Mark as paid</button>}
                {inv.status === 'paid' && <div style={{ ...paidBanner }}>✓ Paid in full</div>}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 }}>
                  <Label inline>Line items</Label>
                  <button onClick={() => saveLines(linesForDeal(deal))} style={linkBtn}>⟳ Regenerate</button>
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input value={l.descr} onChange={(e) => saveLines(lines.map((x, j) => j === i ? { ...x, descr: e.target.value } : x))} style={{ ...field, flex: 1 }} />
                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 9, background: '#fff', paddingLeft: 9 }}>
                        <span style={{ color: 'var(--ink-muted)' }}>$</span>
                        <input type="number" value={l.amount} onChange={(e) => saveLines(lines.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} style={{ ...field, border: 'none', width: 70, textAlign: 'right' }} />
                      </div>
                      <button onClick={() => saveLines(lines.map((x, j) => j === i ? { ...x, recurring: !x.recurring } : x))} style={{ ...typePill, ...(l.recurring ? { background: 'var(--accent-light)', color: 'var(--accent)' } : {}) }}>{l.recurring ? '/mo' : 'one-time'}</button>
                      <button onClick={() => saveLines(lines.filter((_, j) => j !== i))} style={xBtn}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => saveLines([...lines, { descr: 'Custom line', amount: 0, recurring: false, custom: true, sort: lines.length }])} style={dashed}>+ One-time</button>
                  <button onClick={() => saveLines([...lines, { descr: 'Custom monthly', amount: 0, recurring: true, custom: true, sort: lines.length }])} style={dashed}>+ Monthly</button>
                </div>
                <p style={hint}>Negative amount = discount. Tap the tag to switch one-time / monthly.</p>

                <Label>Terms</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={miniLabel}>Tax %<input type="number" value={inv.tax_pct} onChange={(e) => saveHeader({ tax_pct: Number(e.target.value) })} style={field} /></label>
                  <label style={miniLabel}>Deposit % to start<input type="number" value={inv.deposit_pct} onChange={(e) => saveHeader({ deposit_pct: Number(e.target.value) })} style={field} /></label>
                </div>

                <Label>Billed to</Label>
                <div style={{ display: 'grid', gap: 8 }}>
                  <input value={inv.client_company} onChange={(e) => saveHeader({ client_company: e.target.value })} style={field} />
                  <input value={inv.client_name} onChange={(e) => saveHeader({ client_name: e.target.value })} style={field} />
                  <input value={inv.client_email} onChange={(e) => saveHeader({ client_email: e.target.value })} style={field} />
                </div>

                <Label>Notes</Label>
                <textarea value={inv.notes} onChange={(e) => saveHeader({ notes: e.target.value })} rows={3} style={{ ...field, resize: 'vertical' }} />

                <button onClick={del} style={deleteBtn}>Delete invoice</button>
              </div>

              {/* RIGHT — branded invoice */}
              <div style={preview} className="invoice-preview">
                <div style={paper} className="invoice-print">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <img src={org?.logo || '/logo.png'} alt={org?.name} style={{ height: 34, marginBottom: 10 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      <div style={{ fontFamily: 'Space Grotesk', fontSize: 18, fontWeight: 700 }}>{org?.name || 'SiteStac'}</div>
                      {org?.tagline && <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{org.tagline}</div>}
                      <div style={{ color: 'var(--ink-muted)', fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
                        {org?.addr}<br />{[org?.email, org?.phone, org?.site].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'Space Grotesk', fontSize: 30, fontWeight: 700, letterSpacing: '.04em' }}>INVOICE</div>
                      <div style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{inv.number}</div>
                      <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Issued {new Date(inv.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <span style={{ ...statusChip, ...statusStyle(inv.status), marginTop: 8, display: 'inline-block' }}>{statusLabel}</span>
                    </div>
                  </div>

                  <div style={{ ...smallLabel, marginTop: 26 }}>Billed to</div>
                  <div style={{ marginTop: 4, marginBottom: 20 }}><b style={{ fontSize: 15 }}>{inv.client_company}</b><br /><span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{inv.client_name}<br />{inv.client_email}</span></div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                    <thead><tr style={{ background: 'var(--rail)', color: 'var(--ink-soft)', textAlign: 'left' }}>
                      <th style={{ padding: '9px 12px', borderRadius: '8px 0 0 8px', fontWeight: 600, letterSpacing: '.03em', fontSize: 11.5 }}>DESCRIPTION</th>
                      <th style={{ padding: '9px 8px', fontWeight: 600, fontSize: 11.5 }}>TYPE</th>
                      <th style={{ padding: '9px 12px', textAlign: 'right', borderRadius: '0 8px 8px 0', fontWeight: 600, fontSize: 11.5 }}>AMOUNT</th>
                    </tr></thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--line-3)' }}>
                          <td style={{ padding: '11px 12px' }}>{l.descr}</td>
                          <td style={{ padding: '11px 8px', color: 'var(--ink-soft)' }}>{l.recurring ? 'Recurring' : 'One-time'}</td>
                          <td className="num" style={{ padding: '11px 12px', textAlign: 'right', fontWeight: 600 }}>{money(l.amount)}{l.recurring ? '/mo' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {totals && (
                    <div style={{ marginLeft: 'auto', width: 320, marginTop: 18, fontSize: 14 }}>
                      <Row k="One-time setup" v={money(totals.setup)} />
                      {Number(inv.tax_pct) > 0 && <Row k={`Tax (${inv.tax_pct}%)`} v={money(totals.tax)} />}
                      <div style={{ borderTop: '2px solid var(--ink)', margin: '8px 0' }} />
                      <Row k="Total due" v={money(totals.total)} bold big />
                      <div style={{ background: 'var(--green-bg)', borderRadius: 8, padding: '9px 12px', margin: '8px 0', display: 'flex', justifyContent: 'space-between', color: 'var(--green)', fontWeight: 600 }}>
                        <span>Deposit to start ({inv.deposit_pct}%)</span><span className="num">{money(totals.deposit)}</span>
                      </div>
                      <Row k="Balance at launch" v={money(totals.balance)} muted />
                      {totals.monthly > 0 && <Row k="Then recurring" v={`${money(totals.monthly)}/mo`} muted />}
                    </div>
                  )}

                  {inv.notes && <p style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)', color: 'var(--ink-soft)', fontSize: 13.5 }}>{inv.notes}</p>}

                  {/* Signature */}
                  <div style={{ marginTop: 20 }}>
                    <div style={smallLabel}>Acceptance &amp; signature</div>
                    {sig ? (
                      <div style={{ marginTop: 10 }}>
                        {sig.mode === 'draw' && sig.image
                          ? <img src={sig.image} alt="signature" style={{ height: 60 }} />
                          : <span style={{ fontFamily: 'cursive', fontSize: 26 }}>{sig.name}</span>}
                        <div style={{ color: 'var(--green)', fontWeight: 600, marginTop: 6 }}>✓ Signed {new Date(sig.signed_at).toLocaleDateString()}</div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 4, background: 'var(--rail)', borderRadius: 10, padding: 4, marginTop: 10, width: 260 }}>
                          {(['draw', 'type'] as const).map((m) => (
                            <button key={m} onClick={() => setSigMode(m)} style={{ flex: 1, padding: '8px', border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 13, background: sigMode === m ? '#fff' : 'transparent', color: sigMode === m ? 'var(--ink)' : 'var(--ink-soft)', boxShadow: sigMode === m ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{m === 'draw' ? 'Draw' : 'Type'}</button>
                          ))}
                        </div>
                        {sigMode === 'draw' ? (
                          <>
                            <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
                              style={{ width: '100%', maxWidth: 460, height: 150, border: '1px dashed var(--line)', borderRadius: 12, marginTop: 10, touchAction: 'none', background: 'var(--panel)' }} />
                            <div style={{ color: 'var(--ink-muted)', fontSize: 12, marginTop: 4 }}>Draw your signature above.</div>
                          </>
                        ) : (
                          <input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Type full name to accept" style={{ ...field, maxWidth: 460, marginTop: 10 }} />
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                          <button onClick={acceptSig} style={primary}>Sign &amp; accept</button>
                          <button onClick={clearSig} style={ghost}>Clear</button>
                        </div>
                      </>
                    )}
                    <div style={{ textAlign: 'right', color: 'var(--ink-muted)', fontSize: 12, marginTop: 18 }}>Thank you for your business · {org?.name || 'SiteStac'}</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Label({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return <div style={{ ...smallLabel, marginTop: inline ? 0 : 22, marginBottom: 8 }}>{children}</div>
}
function Row({ k, v, bold, big, muted }: { k: string; v: string; bold?: boolean; big?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontWeight: bold ? 700 : 400, fontSize: big ? 17 : 14, color: muted ? 'var(--ink-soft)' : 'var(--ink)' }}>
      <span>{k}</span><span className="num">{v}</span>
    </div>
  )
}
function statusStyle(s: string): React.CSSProperties {
  if (s === 'paid') return { background: 'var(--green-bg)', color: 'var(--green)' }
  if (s === 'sent') return { background: 'var(--accent-light)', color: 'var(--accent)' }
  return { background: 'var(--line-3)', color: 'var(--ink-soft)' }
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,20,25,0.45)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 20 }
const modal: React.CSSProperties = { width: 'min(1200px, 97vw)', height: 'min(92vh, 900px)', background: 'var(--panel)', borderRadius: 18, boxShadow: '0 24px 70px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
const topbar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' }
const rail: React.CSSProperties = { width: 400, flexShrink: 0, background: 'var(--rail)', borderRight: '1px solid var(--line)', padding: 22, overflowY: 'auto' }
const preview: React.CSSProperties = { flex: 1, minWidth: 0, overflowY: 'auto', padding: 28, background: 'var(--canvas)' }
const paper: React.CSSProperties = { background: '#fff', border: '1px solid var(--line)', borderRadius: 14, padding: 34, maxWidth: 820, margin: '0 auto' }
const smallLabel: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-muted)', fontWeight: 600 }
const field: React.CSSProperties = { padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, fontSize: 13.5, background: '#fff', width: '100%', fontFamily: 'inherit' }
const primary: React.CSSProperties = { padding: '10px 16px', border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }
const ghost: React.CSSProperties = { padding: '8px 13px', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--panel)', color: 'var(--ink)', fontWeight: 500, cursor: 'pointer', fontSize: 13 }
const linkBtn: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: 8, padding: '5px 11px', fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }
const statusChip: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '2px 10px', borderRadius: 20 }
const typePill: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--line-3)', color: 'var(--ink-soft)', borderRadius: 20, padding: '4px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }
const dashed: React.CSSProperties = { border: '1px dashed var(--line)', background: 'transparent', borderRadius: 9, padding: '8px 14px', fontSize: 13, color: 'var(--ink-soft)', cursor: 'pointer' }
const hint: React.CSSProperties = { color: 'var(--ink-muted)', fontSize: 12, marginTop: 8 }
const miniLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-soft)' }
const xBtn: React.CSSProperties = { border: 'none', background: 'transparent', fontSize: 17, cursor: 'pointer', color: 'var(--ink-muted)' }
const deleteBtn: React.CSSProperties = { width: '100%', marginTop: 24, padding: '11px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel)', color: '#c0392b', fontWeight: 600, cursor: 'pointer' }
const paidBanner: React.CSSProperties = { padding: '11px', borderRadius: 10, background: 'var(--green-bg)', color: 'var(--green)', fontWeight: 600, textAlign: 'center' }
