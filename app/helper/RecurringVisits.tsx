'use client'

import { useState } from 'react'
import type { DoorbellSnapshot } from '../hooks/useDoorbell'

const KINDS = [
  { icon: '🩺', label: 'Doctor' },
  { icon: '🧑‍⚕️', label: 'Nurse' },
  { icon: '🏋️', label: 'Physio' },
  { icon: '🧹', label: 'Cleaner' },
  { icon: '🍱', label: 'Meals' },
  { icon: '👤', label: 'Visit' },
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const json = { 'Content-Type': 'application/json' }
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

export default function RecurringVisits({ items, timeZone, onChange, adminPin }: {
  items: DoorbellSnapshot['recurring']; timeZone: string; onChange: () => void; adminPin?: string
}) {
  const [kind, setKind] = useState(0)
  const [name, setName] = useState('')
  const [days, setDays] = useState<number[]>([1])
  const [every, setEvery] = useState(1)
  const [from, setFrom] = useState('10:00')
  const [to, setTo] = useState('11:00')
  const [missed, setMissed] = useState(true)
  const [nextWeek, setNextWeek] = useState(false)
  const [err, setErr] = useState('')

  const headers = adminPin ? { ...json, 'x-setup-pin': adminPin } : json

  const toggle = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))
  const fmtNext = (t: number | null) =>
    t ? new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }) : 'none coming'

  const add = async () => {
    setErr('')
    if (!days.length) return setErr('Pick at least one day.')
    if (mins(to) <= mins(from)) return setErr('End time must be after start time.')
    const r = await fetch('/api/doorbell/recurring', {
      method: 'POST', headers,
      body: JSON.stringify({
        icon: KINDS[kind].icon, label: name.trim() || KINDS[kind].label,
        days, everyNWeeks: every, startMin: mins(from), endMin: mins(to),
        alertIfMissed: missed, startNextWeek: every > 1 && nextWeek,
      }),
    })
    if (!r.ok) return setErr((await r.json().catch(() => ({}))).error || 'Could not save.')
    setName('')
    onChange()
  }
  const pause = async (id: string, paused: boolean) => {
    await fetch('/api/doorbell/recurring', { method: 'PATCH', headers, body: JSON.stringify({ id, paused }) })
    onChange()
  }
  const remove = async (id: string) => {
    await fetch('/api/doorbell/recurring', { method: 'DELETE', headers, body: JSON.stringify({ id }) })
    onChange()
  }

  return (
    <section className="mt-6 rounded-2xl bg-slate-800 p-4">
      <h3 className="mb-1 text-sm uppercase tracking-wide text-slate-400">Regular visits</h3>
      <p className="mb-3 text-xs text-slate-500">Times are in {timeZone}. A bell inside the window is handled quietly and needs one tap from you.</p>
      <ul className="mb-4 space-y-2 text-sm">
        {items.map((v) => (
          <li key={v.id} className={`flex items-center justify-between gap-2 ${v.paused ? 'opacity-50' : ''}`}>
            <span>
              {v.icon} {v.label} · {v.days.map((d) => DAYS[d]).join(', ')}{v.everyNWeeks > 1 ? ` · every ${v.everyNWeeks} weeks` : ''} · {hhmm(v.startMin)} to {hhmm(v.endMin)}
              <span className="block text-xs text-slate-400">{v.paused ? 'Paused' : `Next: ${fmtNext(v.next)}`}</span>
            </span>
            <span className="flex gap-3">
              <button onClick={() => pause(v.id, !v.paused)} className="text-cyan-400">{v.paused ? 'Resume' : 'Pause'}</button>
              <button onClick={() => remove(v.id)} className="text-red-400">Remove</button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="text-slate-500">No regular visits yet.</li>}
      </ul>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(Number(e.target.value))} className="rounded-lg bg-slate-700 p-2">
            {KINDS.map((k, i) => <option key={k.label} value={i}>{k.icon} {k.label}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name, e.g. Dr. Sharma" className="flex-1 rounded-lg bg-slate-700 p-2" />
        </div>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <button key={d} onClick={() => toggle(i)} className={`rounded-full px-3 py-1 text-sm ${days.includes(i) ? 'bg-cyan-500 font-semibold text-black' : 'bg-slate-700'}`}>{d}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Every</span>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className="rounded-lg bg-slate-700 p-2">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? 'week' : `${n} weeks`}</option>)}
          </select>
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg bg-slate-700 p-2" />
          <span>to</span>
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg bg-slate-700 p-2" />
        </div>
        {every > 1 && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nextWeek} onChange={(e) => setNextWeek(e.target.checked)} /> Start next week instead of this week</label>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={missed} onChange={(e) => setMissed(e.target.checked)} /> Tell me if they do not come</label>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button onClick={add} className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black">Add regular visit</button>
      </div>
    </section>
  )
}
