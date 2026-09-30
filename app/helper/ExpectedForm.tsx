'use client'

import { useState } from 'react'
import type { ExpectedVisit } from '@/lib/doorbell/store'

const KINDS = { delivery: { icon: '📦', label: 'Delivery' }, visit: { icon: '👤', label: 'Visit' } }
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const json = { 'Content-Type': 'application/json' }

export default function ExpectedForm({ items, onChange }: { items: ExpectedVisit[]; onChange: () => void }) {
  const [kind, setKind] = useState<keyof typeof KINDS>('delivery')
  const [from, setFrom] = useState('14:00')
  const [to, setTo] = useState('16:00')

  const add = async () => {
    await fetch('/api/doorbell/expected', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ...KINDS[kind], startsAt: at(from), endsAt: at(to) }),
    })
    onChange()
  }
  const remove = async (id: string) => {
    await fetch('/api/doorbell/expected', { method: 'DELETE', headers: json, body: JSON.stringify({ id }) })
    onChange()
  }

  return (
    <section className="mt-6 rounded-2xl bg-slate-800 p-4">
      <h3 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Expected today</h3>
      <ul className="mb-3 space-y-1 text-sm">
        {items.map((e) => (
          <li key={e.id} className="flex justify-between">
            <span>{e.icon} {e.label} · {fmt(e.startsAt)} to {fmt(e.endsAt)}</span>
            <button onClick={() => remove(e.id)} className="text-red-400">Remove</button>
          </li>
        ))}
        {items.length === 0 && <li className="text-slate-500">Nothing expected.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KINDS)} className="rounded-lg bg-slate-700 p-2">
          <option value="delivery">📦 Delivery</option>
          <option value="visit">👤 Visit</option>
        </select>
        <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg bg-slate-700 p-2" />
        <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg bg-slate-700 p-2" />
        <button onClick={add} className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black">Add</button>
      </div>
    </section>
  )
}
