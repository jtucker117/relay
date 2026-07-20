import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { pkg } from '../lib/catalog'
import type { Deal } from '../lib/types'

// Branded share URL — proxied to the Supabase preview function by the Cloudflare Worker.
const FN_BASE = `${window.location.origin}/preview`
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'preview'
const rand = () => Math.random().toString(36).slice(2, 7)

// The AI website preview + outside-build options, shown inside the deal detail.
// Sources: generate with Claude (server-side Edge Function), upload an HTML file,
// or paste a live URL. Publishing to the email-locked client portal comes next (Critical 2).
export default function PreviewSection({ deal }: { deal: Deal }) {
  const { profile } = useAuth()
  const [html, setHtml] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Publish state
  const [publishing, setPublishing] = useState(false)
  const [slug, setSlug] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [views, setViews] = useState<{ count: number; last: string | null } | null>(null)
  const shareUrl = slug ? `${FN_BASE}?p=${slug}` : ''

  // Restore the saved draft + any published share link for this deal on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: draft } = await supabase.from('preview_drafts')
        .select('html,external_url').eq('deal_id', deal.id).maybeSingle()
      if (!cancelled && draft) {
        if (draft.html) { setHtml(draft.html); setActiveUrl(null) }
        else if (draft.external_url) { setActiveUrl(draft.external_url); setHtml(null) }
      }
      const { data: pubs } = await supabase.from('previews')
        .select('slug,active,access_code,view_count,last_viewed_at')
        .eq('deal_id', deal.id).order('published_at', { ascending: false }).limit(1)
      const pub = pubs?.[0] as { slug: string; active: boolean; access_code: string | null; view_count: number | null; last_viewed_at: string | null } | undefined
      if (!cancelled && pub) {
        setSlug(pub.slug); setLive(pub.active); setCode(pub.access_code)
        setViews({ count: pub.view_count ?? 0, last: pub.last_viewed_at })
      }
    })()
    return () => { cancelled = true }
  }, [deal.id])

  // Persist the working preview so it survives a refresh.
  async function saveDraft(fields: { html?: string | null; external_url?: string | null }) {
    if (!profile?.org_id) return
    await supabase.from('preview_drafts').upsert({
      deal_id: deal.id, org_id: profile.org_id,
      html: fields.html ?? null, external_url: fields.external_url ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'deal_id' })
  }

  async function publish() {
    if (!profile?.org_id) { setErr('No workspace found.'); return }
    if (html === null && !activeUrl) return
    setPublishing(true); setErr(null)
    try {
      const s = `${slugify(deal.company)}-${rand()}`
      const ac = Math.random().toString(36).slice(2, 8).toUpperCase() // client access code
      if (html !== null) {
        const { error: upErr } = await supabase.storage.from('previews')
          .upload(`${s}.html`, new Blob([html], { type: 'text/html' }), { upsert: true, contentType: 'text/html' })
        if (upErr) throw upErr
      }
      const p = pkg(deal.package_id)
      const { error: insErr } = await supabase.from('previews').insert({
        slug: s, org_id: profile.org_id, deal_id: deal.id, company: deal.company,
        contact: deal.contact, client_email: deal.email,
        package_name: p.name, tier_name: p.tier, access_code: ac,
        external_url: html === null ? activeUrl : null, status: 'review', active: true,
      })
      if (insErr) throw insErr
      setSlug(s); setLive(true); setCode(ac); setViews({ count: 0, last: null })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Publish failed. Did you run migration 003 and deploy the preview function?')
    } finally {
      setPublishing(false)
    }
  }

  async function removePreview() {
    if (!confirm('Remove this preview? Clears the uploaded site and disables the share link.')) return
    setHtml(null); setActiveUrl(null); setUrl(''); setErr(null)
    await supabase.from('preview_drafts').delete().eq('deal_id', deal.id)
    if (slug) {
      await supabase.storage.from('previews').remove([`${slug}.html`])
      await supabase.from('previews').delete().eq('slug', slug)
      setSlug(null); setCode(null); setViews(null); setLive(true)
    }
  }

  async function toggleLive() {
    if (!slug) return
    const next = !live
    setLive(next)
    await supabase.from('previews').update({ active: next }).eq('slug', slug)
  }

  function copyLink() {
    navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) })
  }

  function download() {
    if (html === null) return
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slugify(deal.company)}-preview.html`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(a.href)
  }

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
      saveDraft({ html: data.html })
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
    reader.onload = () => {
      const content = String(reader.result)
      setHtml(content); setActiveUrl(null); setErr(null)
      saveDraft({ html: content })
    }
    reader.readAsText(file)
  }

  function loadUrl() {
    const u = url.trim()
    if (!u) return
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`
    setActiveUrl(full)
    setHtml(null); setErr(null)
    saveDraft({ external_url: full })
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
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            {(['desktop', 'mobile'] as const).map((d) => (
              <button key={d} onClick={() => setDevice(d)}
                style={{ ...toggleBtn, ...(device === d ? toggleActive : {}) }}>
                {d === 'desktop' ? 'Desktop' : 'Mobile'}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {html !== null && <button onClick={download} style={toggleBtn}>⬇ Export HTML</button>}
              <button onClick={removePreview} style={{ ...toggleBtn, color: '#c0392b', borderColor: 'var(--line)' }}>Remove</button>
            </div>
          </div>
          <div style={{ display: 'grid', placeItems: 'center', background: 'var(--rail)', border: '1px solid var(--line)', borderRadius: 12, padding: device === 'mobile' ? 12 : 0, overflow: 'hidden' }}>
            <iframe
              title="Website preview"
              {...(html !== null ? { srcDoc: html } : { src: activeUrl! })}
              style={{ width: frameW, height: 520, border: 'none', borderRadius: device === 'mobile' ? 12 : 11, background: '#fff' }}
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
          {/* Publish → email-locked share link */}
          {!slug ? (
            <div style={{ marginTop: 12 }}>
              <button onClick={publish} disabled={publishing} style={publishBtn}>
                {publishing ? 'Publishing…' : 'Publish → get share link'}
              </button>
              <p style={{ color: 'var(--ink-muted)', fontSize: 12, marginTop: 8 }}>
                Generates a private link + access code — share both with your client. They enter the code to view, and you'll see when they open it.
              </p>
            </div>
          ) : (
            <div style={sharePanel}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: live ? 'var(--green-2)' : 'var(--ink-muted)' }} />
                <b style={{ fontSize: 13 }}>{live ? 'Live — code-locked' : 'Turned off'}</b>
                <label style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-soft)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={live} onChange={toggleLive} style={{ marginRight: 5 }} />
                  Link active
                </label>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input readOnly value={shareUrl} style={{ ...urlInput, fontSize: 12.5 }} onFocus={(e) => e.target.select()} />
                <button onClick={copyLink} style={ghostBtn}>{copied ? 'Copied!' : 'Copy'}</button>
                <a href={shareUrl} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: 'none', display: 'grid', placeItems: 'center' }}>Open ↗</a>
              </div>
              {code && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--ink-soft)' }}>Access code</span>
                  <b className="num" style={{ letterSpacing: '.1em', fontSize: 15 }}>{code}</b>
                  <button onClick={() => navigator.clipboard?.writeText(code)} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }}>Copy</button>
                  <span style={{ marginLeft: 'auto', color: views && views.count > 0 ? 'var(--green)' : 'var(--ink-muted)', fontSize: 12.5 }}>
                    {views && views.count > 0
                      ? `Viewed ${views.count}× · last ${new Date(views.last!).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                      : 'Not viewed yet'}
                  </span>
                </div>
              )}
              {activeUrl && <p style={{ color: 'var(--amber)', fontSize: 12, marginTop: 8 }}>Heads-up: this is an external URL — the code lives on their server, so it isn't code-protected.</p>}
            </div>
          )}
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
const publishBtn: React.CSSProperties = {
  padding: '10px 16px', border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer',
}
const sharePanel: React.CSSProperties = {
  marginTop: 12, padding: 14, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12,
}
