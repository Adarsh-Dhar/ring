'use client'

import { useEffect, useState } from 'react'
import { PURPOSES } from '@/lib/doorbell/purposes'

interface Pending { id: string; name: string; purpose: string }

/** Big, calm card on the resident screen: "Do you know this person?" Only rendered while no doorbell case is open. */
export default function RegularApprovals() {
  const [items, setItems] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)

  const load = () => {
    fetch('/api/regular-visitors', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { pending: [] }))
      .then(d => setItems(d.pending ?? []))
      .catch(() => {})
  }
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [])

  const decide = async (id: string, decision: 'approve' | 'decline') => {
    setBusy(true)
    await fetch('/api/regular-visitors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision }) }).catch(() => {})
    setBusy(false)
    load()
  }

  const r = items[0]
  if (!r) return null
  const p = (PURPOSES as any)[r.purpose] ?? PURPOSES.other
  return (
    <div className="w-full rounded-3xl bg-black/30 p-4 text-center" aria-label="Someone wants to be a regular visitor">
      <p className="text-xl font-bold mb-2">{p.icon} {r.name} wants to visit often</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/regular-visitors/${r.id}/photo`} alt={`Photo of ${r.name}`} className="mx-auto mb-3 h-44 w-44 rounded-2xl object-cover" />
      <p className="mb-3 text-lg">Do you know this person?</p>
      <div className="grid grid-cols-2 gap-4">
        <button disabled={busy} onClick={() => decide(r.id, 'approve')} className="rounded-3xl bg-white py-5 text-2xl font-bold text-emerald-900 disabled:opacity-50">✅ Yes</button>
        <button disabled={busy} onClick={() => decide(r.id, 'decline')} className="rounded-3xl border-4 border-white bg-black/40 py-5 text-2xl font-bold disabled:opacity-50">✋ No</button>
      </div>
      {items.length > 1 && <p className="mt-2 text-sm opacity-80">{items.length - 1} more waiting</p>}
    </div>
  )
}
