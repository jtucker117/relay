import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Deal } from '../lib/types'

// The AI website preview + outside-build options, shown inside the deal detail.
// Sources: generate with Claude (server-side Edge Function), upload an HTML file,
// or paste a live URL. Publishing to the email-locked client portal comes next (Critical 2).
export default function PreviewSection({ deal }: { deal: Deal }) {
  const [html, setHtml] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function generate() {
    setBusy(true); setErr(null); setActiveUrl(null)
    try {
      const { data, error } = await supabase.functions.invoke('generate-preview', {
        body: { company: deal.company, packageId: deal.package_id, brief: deal.brief ?? {} },
      })
      if (error) {
        // Surface the function's JSON error body (FunctionsHttpError hides it behind .context).
        let detail = error.message
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
        if (ctx?.json) { try { const b = await ctx.json(); if (b?.error) detail = b.error } catch { /* keep generic */ } }
        throw new Error(detail)
      }
      if (data?.error) throw new Error(data.error)
      if (!data?.html) throw new Error('No HTML returned.')
      setHtml(data.html)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Generation failed. Is the Edge Function deployed with an API key?')
    } finally {
      setBusy(false)
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setHtml(String(reader.result)); setActiveUrl(null); setErr(null) }
    reader.readAsText(file)
  }

  function loadUrl() {
    const u = url.trim()
    if (!u) return
    setActiveUrl(/^https?:\/\//i.test(u) ? u : `https://${u}`)
    setHtml(null); setErr(null)
  }

  const hasPreview = html !== null || activeUrl !== null
  const frameW = device === 'mobile' ? 390 : '100%'

  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-muted)', marginBottom: 8 }}>
        Website preview
      </div>

      {/* Source actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button onClick={generate} disabled={busy} style={aiBtn}>
          {busy ? 'Generating…' : '✨ Generate with AI'}
        </button>
        <button onClick={() => fileRef.current?.click()} style={ghostBtn}>Upload HTML</button>
        <input ref={fileRef} type="file" accept=".html,.htm,text/html" onChange={onFile} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 200 }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="or paste a live URL (Lovable, etc.)"
            onKeyDown={(e) => e.key === 'Enter' && loadUrl()} style={urlInput} />
          <button onClick={loadUrl} style={ghostBtn}>Embed</button>
        </div>
      </div>

      {err && <p style={{ color: '#c33', fontSize: 13, marginTop: 0 }}>{err}</p>}
      {busy && <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Claude is designing the site — this can take up to a minute…</p>}

      {hasPreview && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['desktop', 'mobile'] as const).map((d) => (
              <button key={d} onClick={() => setDevice(d)}
                style={{ ...toggleBtn, ...(device === d ? toggleActive : {}) }}>
                {d === 'desktop' ? 'Desktop' : 'Mobile'}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', placeItems: 'center', background: 'var(--rail)', border: '1px solid var(--line)', borderRadius: 12, padding: device === 'mobile' ? 12 : 0, overflow: 'hidden' }}>
            <iframe
              title="Website preview"
              {...(html !== null ? { srcDoc: html } : { src: activeUrl! })}
              style={{ width: frameW, height: 520, border: 'none', borderRadius: device === 'mobile' ? 12 : 11, background: '#fff' }}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
          <p style={{ color: 'var(--ink-muted)', fontSize: 12, marginTop: 8 }}>
            Publishing this to the email-locked client portal (a shareable preview.sitestac.com link) is the next milestone.
          </p>
        </>
      )}
    </div>
  )
}

const aiBtn: React.CSSProperties = {
  padding: '9px 14px', border: 'none', borderRadius: 9, fontWeight: 600, cursor: 'pointer', color: '#fff',
  background: 'linear-gradient(135deg,#7C5CFF,#4CC2E6)',
}
const ghostBtn: React.CSSProperties = {
  padding: '9px 14px', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--panel)',
  color: 'var(--ink)', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
}
const urlInput: React.CSSProperties = {
  flex: 1, padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 9, fontSize: 13.5, background: 'var(--panel)',
}
const toggleBtn: React.CSSProperties = {
  padding: '5px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)',
  color: 'var(--ink-soft)', fontSize: 12.5, cursor: 'pointer',
}
const toggleActive: React.CSSProperties = { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }
