'use client'

import { useEffect, useState } from 'react'
import { PURPOSES } from '@/lib/doorbell/purposes'

interface Approved { id: string; name: string; purpose: string; since: number; by: 'helper' | 'resident' }

/** Guardian view: who is registered as a regular visitor, and a way to remove them (their face is deleted). */
export default function RegularVisitorsAdmin({ registerUrl }: { registerUrl?: string }) {
  const [items, setItems] = useState<Approved[]>([])
  const [msg, setMsg] = useState('')

  const load = () =>
    fetch('/api/regular-visitors', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { approved: [] }))
      .then(d => setItems(d.approved ?? []))
      .catch(() => {})
  useEffect(() => { load() }, [])

  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}? Their saved face is deleted.`)) return
    const r = await fetch('/api/regular-visitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision: 'remove' }) })
    setMsg(r.ok ? `${name} removed.` : (await r.json().catch(() => ({}))).error || 'Could not remove.')
    load()
  }

  return (
    <>
      <h2 className="mt-8 mb-2 text-sm uppercase tracking-wide text-slate-400">Regular visitors</h2>
      <p className="mb-2 text-sm text-slate-400">People who registered their face and were approved. The door camera tags them for the helper. It never opens the door by itself.</p>
      {registerUrl && (
        <div className="mb-3 flex items-center gap-2 bg-slate-700 rounded-lg px-3 py-2">
          <code className="text-xs text-cyan-300 break-all flex-1">{registerUrl}</code>
          <button onClick={() => { navigator.clipboard?.writeText(registerUrl).catch(() => {}); setMsg('Registration link copied!') }} className="shrink-0 text-sm text-slate-400 hover:text-white" aria-label="Copy registration link">📋 Copy</button>
        </div>
      )}
      {msg && <p className="mb-2 text-sm text-emerald-300">{msg}</p>}
      <ul className="mb-6 space-y-2">
        {items.length === 0 && <li className="text-sm text-slate-500">No regular visitors yet.</li>}
        {items.map(r => {
          const p = (PURPOSES as any)[r.purpose] ?? PURPOSES.other
          return (
            <li key={r.id} className="flex items-center justify-between rounded-xl bg-slate-800 px-4 py-3">
              <span>{p.icon} {r.name} <span className="text-xs text-slate-500">· approved by {r.by} · {new Date(r.since).toLocaleDateString()}</span></span>
              <button onClick={() => remove(r.id, r.name)} className="text-sm text-red-300">Remove</button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
