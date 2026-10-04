'use client'

import { useEffect, useState } from 'react'
import { PURPOSES } from '@/lib/doorbell/purposes'

interface Pending { id: string; name: string; purpose: string; note: string | null; contactKind: string; createdAt: number }

const ago = (ms: number) => {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`
  return `${Math.floor(d / 86_400_000)} d ago`
}

/** Pending "register as a regular visitor" requests. A helper OR the resident can approve; the first answer wins. */
export default function RegularVisitors() {
  const [items, setItems] = useState<Pending[]>([])
  const [acting, setActing] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState('')

  const load = () => {
    fetch('/api/regular-visitors', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { pending: [] }))
      .then(d => setItems(d.pending ?? []))
      .catch(() => {})
  }
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [])

  const decide = async (id: string, decision: 'approve' | 'decline') => {
    setErrMsg(''); setActing(id + decision)
    const r = await fetch('/api/regular-visitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision }) })
    setActing(null)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setErrMsg(j.error || 'Could not save. Try again.')
    load()
  }

  if (!items.length) return null
  return (
    <section className="mb-6">
      <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-3">Regular visitor registrations</h2>
      {errMsg && <p role="alert" className="mb-3 rounded-xl bg-red-900 p-3 text-sm">{errMsg}</p>}
      <ul className="space-y-3">
        {items.map(r => {
          const p = (PURPOSES as any)[r.purpose] ?? PURPOSES.other
          return (
            <li key={r.id} className="rounded-2xl bg-slate-800 p-4">
              <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/regular-visitors/${r.id}/photo`} alt={`Photo of ${r.name}`} className="h-28 w-28 rounded-xl object-cover bg-slate-700 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-lg font-semibold"><span>{p.icon}</span><span className="truncate">{r.name}</span></div>
                  <p className="text-sm text-slate-400">{p.label} · {ago(r.createdAt)}</p>
                  {r.note && <p className="text-sm text-slate-300 mt-1 italic">"{r.note}"</p>}
                </div>
              </div>
              <p className="mt-3 text-xs text-amber-300">Approve only if you know this person and the photo is really them.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => decide(r.id, 'approve')} disabled={acting !== null} className="rounded-xl bg-emerald-700 py-3 font-semibold text-sm hover:bg-emerald-600 disabled:opacity-40">✅ Approve</button>
                <button onClick={() => decide(r.id, 'decline')} disabled={acting !== null} className="rounded-xl bg-red-800 py-3 font-semibold text-sm hover:bg-red-700 disabled:opacity-40">❌ Decline</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
