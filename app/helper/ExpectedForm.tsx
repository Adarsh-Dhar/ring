'use client'

import { useState } from 'react'
import type { ExpectedVisit } from '@/lib/doorbell/store'

const KINDS = { delivery: { icon: '📦', label: 'Delivery' }, visit: { icon: '👤', label: 'Visit' } }
const at  = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() }
const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const json = { 'Content-Type': 'application/json' }

export default function ExpectedForm({ items, onChange }: { items: ExpectedVisit[]; onChange: () => void }) {
  const [kind, setKind] = useState<keyof typeof KINDS>('delivery')
  const [from, setFrom] = useState('14:00')
  const [to,   setTo]   = useState('16:00')
  const [who,  setWho]  = useState('')
  const [word, setWord] = useState('')

  const add = async () => {
    await fetch('/api/doorbell/expected', {
      method:  'POST',
      headers: json,
      body: JSON.stringify({
        ...KINDS[kind],
        startsAt:   at(from),
        endsAt:     at(to),
        who:        who.trim()  || undefined,
        passphrase: word.trim() || undefined,
      }),
    })
    setWho(''); setWord('')
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
        {items.map(e => (
          <li key={e.id} className="flex justify-between">
            <span>
              {e.icon} {e.label} · {fmt(e.startsAt)} to {fmt(e.endsAt)}
              {e.passphrase && <span className="ml-2 text-xs text-slate-400">· has a pass-word</span>}
            </span>
            <button onClick={() => remove(e.id)} className="text-red-400">Remove</button>
          </li>
        ))}
        {items.length === 0 && <li className="text-slate-500">Nothing expected.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={e => setKind(e.target.value as keyof typeof KINDS)} className="rounded-lg bg-slate-700 p-2">
          <option value="delivery">📦 Delivery</option>
          <option value="visit">👤 Visit</option>
        </select>
        <input type="time" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg bg-slate-700 p-2" />
        <input type="time" value={to}   onChange={e => setTo(e.target.value)}   className="rounded-lg bg-slate-700 p-2" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={who} onChange={e => setWho(e.target.value)} maxLength={40}
          placeholder="Who (optional, e.g. Dr. Sharma)"
          className="flex-1 rounded-lg bg-slate-700 p-2 text-sm"
        />
        <input
          value={word} onChange={e => setWord(e.target.value)} maxLength={30}
          placeholder="Pass-word (optional)"
          className="flex-1 rounded-lg bg-slate-700 p-2 text-sm"
        />
      </div>
      <button onClick={add} className="mt-2 rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black">Add</button>
    </section>
  )
}
