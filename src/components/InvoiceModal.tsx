import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { invoiceTotals, money } from '../lib/money'
import { linesForDeal, invoiceNumber, type DraftLine } from '../lib/invoice'
import type { Deal, Invoice, InvoiceLine } from '../lib/types'

interface OrgSettings { name: string; tagline: string; site: string; email: string; phone: string; addr: string; logo: string }
interface Sig { mode: 'draw' | 'type'; name?: string; signed_at: string }

export default function InvoiceModal({ deal, onClose, onChange }: { deal: Deal; onClose: () => void; onChange?: () => void }) {
  const { profile } = useAuth()
  const [inv, setInv] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [org, setOrg] = useState<OrgSettings | null>(null)
  const [sig, setSig] = useState<Sig | null>(null)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [loading, setLoading] = useState(true)
  const [signName, setSignName] = useState('')

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

  async function create() {
    if (!profile?.org_id) return
    const draft = linesForDeal(deal)
    const { data, error } = await supabase.from('invoices').insert({
      org_id: profile.org_id, deal_id: deal.id, number: invoiceNumber(), status: 'draft',
      deposit_pct: 50, tax_pct: 0, notes: '', client_name: deal.contact, client_company: deal.company, client_email: deal.email,
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
    if (!inv) return
    const stamp = status === 'sent' ? { sent_at: new Date().toISOString() } : { paid_at: new Date().toISOString() }
    await saveHeader({ status, ...stamp })
    onChange?.()
  }
  async function sign() {
    if (!inv || !signName.trim() || !profile?.org_id) return
    const row = { org_id: profile.org_id, invoice_id: inv.id, mode: 'type' as const, name: signName.trim(), signed_at: new Date().toISOString() }
    await supabase.from('signatures').upsert(row, { onConflict: 'invoice_id' })
    setSig(row)
    if (inv.status === 'draft') setStatus('sent')
  }

  const totals = inv ? invoiceTotals(inv, lines as unknown as InvoiceLine[]) : null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {loading ? <p style={{ color: 'var(--ink-soft)' }}>Loading…</p> : !inv ? (
          <div style={{ textAlign: 'center', padding: 30 }}>
            <h2 style={{ margin: '0 0 8px' }}>No invoice yet</h2>
            <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>Auto-build the line items from {deal.company}'s package stack.</p>
            <button onClick={create} style={primary}>Create invoice</button>
            <button onClick={onClose} style={{ ...ghost, marginLeft: 8 }}>Cancel</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <b style={{ fontFamily: 'Space Grotesk', fontSize: 18 }}>{inv.number}</b>
              <span style={{ ...statusChip, ...statusStyle(inv.status) }}>{inv.status === 'paid' ? 'Paid' : inv.status === 'sent' ? 'Sent' : 'Draft'}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={() => setView(view === 'edit' ? 'preview' : 'edit')} style={ghost}>{view === 'edit' ? 'Preview' : 'Edit'}</button>
                {view === 'preview' && <button onClick={() => window.print()} style={ghost}>Print / PDF</button>}
                <button onClick={onClose} style={closeBtn}>×</button>
              </div>
            </div>

            {view === 'edit' ? (
              <>
                <div style={{ display: 'grid', gap: 6 }}>
                  {lines.map((l, i) => (
                    <div key={i} style={lineRow}>
                      <input value={l.descr} onChange={(e) => saveLines(lines.map((x, j) => j === i ? { ...x, descr: e.target.value } : x))} style={{ ...lineInput, flex: 1 }} />
                      <input type="number" value={l.amount} onChange={(e) => saveLines(lines.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} style={{ ...lineInput, width: 100, textAlign: 'right' }} />
                      <label style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={l.recurring} onChange={(e) => saveLines(lines.map((x, j) => j === i ? { ...x, recurring: e.target.checked } : x))} />/mo
                      </label>
                      <button onClick={() => saveLines(lines.filter((_, j) => j !== i))} style={xBtn}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => saveLines([...lines, { descr: 'Custom line', amount: 0, recurring: false, custom: true, sort: lines.length }])} style={ghost}>+ One-time line</button>
                  <button onClick={() => saveLines([...lines, { descr: 'Custom monthly', amount: 0, recurring: true, custom: true, sort: lines.length }])} style={ghost}>+ Monthly line</button>
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                  <label style={miniLabel}>Tax %<input type="number" value={inv.tax_pct} onChange={(e) => saveHeader({ tax_pct: Number(e.target.value) })} style={numInput} /></label>
                  <label style={miniLabel}>Deposit %<input type="number" value={inv.deposit_pct} onChange={(e) => saveHeader({ deposit_pct: Number(e.target.value) })} style={numInput} /></label>
                </div>
                {totals && <TotalsBlock totals={totals} inv={inv} />}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  {inv.status === 'draft' && <button onClick={() => setStatus('sent')} style={primary}>Send invoice</button>}
                  {inv.status !== 'paid' && <button onClick={() => setStatus('paid')} style={{ ...primary, background: 'var(--green-2)' }}>Mark as paid</button>}
                  {inv.status === 'paid' && <span style={{ color: 'var(--green)', fontWeight: 600, alignSelf: 'center' }}>✓ Paid in full</span>}
                </div>
              </>
            ) : (
              <BrandedInvoice org={org} inv={inv} lines={lines} totals={totals!} deal={deal} sig={sig} signName={signName} setSignName={setSignName} onSign={sign} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TotalsBlock({ totals, inv }: { totals: ReturnType<typeof invoiceTotals>; inv: Invoice }) {
  const row = (k: string, v: string, bold?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400, padding: '3px 0' }}>
      <span style={{ color: bold ? 'var(--ink)' : 'var(--ink-soft)' }}>{k}</span><span className="num">{v}</span>
    </div>
  )
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
      {row('Setup', money(totals.setup))}
      {Number(inv.tax_pct) > 0 && row(`Tax (${inv.tax_pct}%)`, money(totals.tax))}
      {row('Total due', money(totals.total), true)}
      {row(`Deposit now (${inv.deposit_pct}%)`, money(totals.deposit))}
      {row('Balance at launch', money(totals.balance))}
      {totals.monthly > 0 && row('Recurring', `${money(totals.monthly)}/mo`)}
    </div>
  )
}

function BrandedInvoice({ org, inv, lines, totals, deal, sig, signName, setSignName, onSign }: {
  org: OrgSettings | null; inv: Invoice; lines: DraftLine[]; totals: ReturnType<typeof invoiceTotals>
  deal: Deal; sig: Sig | null; signName: string; setSignName: (v: string) => void; onSign: () => void
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: 'Space Grotesk', fontSize: 20, fontWeight: 700 }}>{org?.name || 'SiteStac'}</div>
          {org?.tagline && <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{org.tagline}</div>}
          <div style={{ color: 'var(--ink-muted)', fontSize: 12, marginTop: 6 }}>{org?.addr}<br />{org?.email} · {org?.phone}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Space Grotesk', fontSize: 26, fontWeight: 700, letterSpacing: '.04em' }}>INVOICE</div>
          <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{inv.number}</div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{new Date(inv.created_at).toLocaleDateString()}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Billed to</div>
      <div style={{ marginBottom: 18, marginTop: 3 }}><b>{deal.company}</b><br /><span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{deal.contact} · {deal.email}</span></div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead><tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--ink-soft)' }}><th style={{ padding: '6px 0' }}>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--line-3)' }}>
              <td style={{ padding: '7px 0' }}>{l.descr}{l.recurring && <span style={{ color: 'var(--ink-muted)' }}> /mo</span>}</td>
              <td className="num" style={{ textAlign: 'right' }}>{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginLeft: 'auto', width: 260, marginTop: 12 }}><TotalsBlock totals={totals} inv={inv} /></div>
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Signature</div>
        {sig ? (
          <div><span style={{ fontFamily: 'cursive', fontSize: 22 }}>{sig.name}</span><span style={{ marginLeft: 10, color: 'var(--green)', fontWeight: 600 }}>✓ Signed {new Date(sig.signed_at).toLocaleDateString()}</span></div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Type full name to accept" style={{ ...numInput, width: 240 }} />
            <button onClick={onSign} style={primary}>Sign &amp; accept</button>
          </div>
        )}
      </div>
    </div>
  )
}

function statusStyle(s: string): React.CSSProperties {
  if (s === 'paid') return { background: 'var(--green-bg)', color: 'var(--green)' }
  if (s === 'sent') return { background: 'var(--accent-light)', color: 'var(--accent)' }
  return { background: 'var(--line-3)', color: 'var(--ink-soft)' }
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,20,25,0.4)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 20 }
const modal: React.CSSProperties = { width: 640, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }
const primary: React.CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer' }
const ghost: React.CSSProperties = { padding: '7px 13px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', color: 'var(--ink)', fontWeight: 500, cursor: 'pointer', fontSize: 13 }
const closeBtn: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--panel)', width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer', color: 'var(--ink-soft)' }
const statusChip: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 20 }
const lineRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const lineInput: React.CSSProperties = { padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, background: '#fff' }
const xBtn: React.CSSProperties = { border: 'none', background: 'transparent', fontSize: 17, cursor: 'pointer', color: 'var(--ink-muted)' }
const miniLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--ink-soft)' }
const numInput: React.CSSProperties = { padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13.5, background: '#fff', width: 90 }
