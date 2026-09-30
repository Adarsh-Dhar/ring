'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { Helper } from '@/lib/doorbell/config'
import type { Quiet } from '@/lib/doorbell/store'
import { usePin } from '../hooks/usePin'

interface Setup {
  helpers: Helper[]
  quiet: Quiet
  timeoutSec: number
}

const BADGE: Record<Helper['consent'], string> = {
  approved: 'bg-emerald-600',
  pending: 'bg-amber-600',
  declined: 'bg-red-700',
}
const input = 'rounded-lg bg-slate-700 p-2 text-white'
const btn = 'rounded-lg bg-slate-700 px-3 py-1'

export default function SetupPage() {
  const { pin, setPin } = usePin()
  const [pinInput, setPinInput] = useState('')
  const [needPin, setNeedPin] = useState(false)
  const [data, setData] = useState<Setup | null>(null)
  const [err, setErr] = useState('')
  const [origin, setOrigin] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', emoji: '🙂' })
  const [secs, setSecs] = useState(30)
  const [quiet, setQuietForm] = useState<Quiet>({ enabled: false, startHour: 22, endHour: 6 })

  const load = useCallback(async () => {
    const r = await fetch('/api/setup', { headers: { 'x-setup-pin': pin }, cache: 'no-store' })
    if (r.status === 401) return setNeedPin(true)
    setNeedPin(false)
    const d: Setup = await r.json()
    setData(d)
    setSecs(d.timeoutSec)
    setQuietForm(d.quiet)
  }, [pin])

  useEffect(() => {
    setOrigin(window.location.origin)
    load()
  }, [load])

  const act = async (body: object) => {
    setErr('')
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-setup-pin': pin },
      body: JSON.stringify(body),
    })
    if (!r.ok) setErr((await r.json()).error || 'Something went wrong')
    load()
  }

  if (needPin) {
    return (
      <main className="mx-auto max-w-sm p-6 text-white">
        <h1 className="mb-4 text-xl font-bold">Guardian PIN</h1>
        <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} className={`${input} mb-3 w-full`} />
        <button onClick={() => setPin(pinInput)} className="w-full rounded-lg bg-cyan-500 py-3 font-bold text-black">Unlock</button>
      </main>
    )
  }
  if (!data) return <main className="p-6 text-slate-400">Loading…</main>

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 text-white">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Setup</h1>
        <Link href="/" className="text-sm text-cyan-400">Home</Link>
      </header>
      {err && <p className="mb-3 rounded-lg bg-red-900 p-3 text-sm">{err}</p>}

      <h2 className="mb-1 text-sm uppercase tracking-wide text-slate-400">Helpers</h2>
      <p className="mb-2 text-sm text-slate-400">Asked in this order, top first. Only approved helpers are asked.</p>
      <ul className="mb-6 space-y-3">
        {data.helpers.map((h) => (
          <li key={h.id} className="rounded-2xl bg-slate-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">
                {h.emoji} {h.name} <span className="text-sm text-slate-400">{h.phone}</span>
              </span>
              <span className={`rounded-full px-3 py-1 text-xs ${BADGE[h.consent]}`}>{h.consent}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <button className={btn} onClick={() => act({ action: 'move', id: h.id, dir: -1 })}>↑</button>
              <button className={btn} onClick={() => act({ action: 'move', id: h.id, dir: 1 })}>↓</button>
              {h.consent !== 'approved' && (
                <Link href={`/consent?id=${h.id}`} className="rounded-lg bg-amber-600 px-3 py-1">Ask for consent</Link>
              )}
              <button className={btn} onClick={() => navigator.clipboard.writeText(`${origin}/helper?as=${h.id}`)}>Copy helper link</button>
              <button className={`${btn} text-red-300`} onClick={() => act({ action: 'remove', id: h.id })}>Remove</button>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Add a helper</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        <input placeholder="+919876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
        <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className={`${input} w-16`} />
        <button
          onClick={async () => {
            await act({ action: 'add', ...form })
            setForm({ name: '', phone: '', emoji: '🙂' })
          }}
          className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black"
        >
          Add
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">A new helper gets no alerts until someone approves them on the consent page.</p>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Time each helper has to answer</h2>
      <div className="mb-6 flex items-center gap-2">
        <input type="number" min={3} max={600} value={secs} onChange={(e) => setSecs(Number(e.target.value))} className={`${input} w-24`} />
        <span>seconds</span>
        <button onClick={() => act({ action: 'timeout', value: secs })} className={btn}>Save</button>
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Quiet hours (night lock)</h2>
      <p className="mb-2 text-sm text-slate-400">At night the resident screen always says do not open, even if a helper says safe. Helpers are still alerted.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quiet.enabled} onChange={(e) => setQuietForm({ ...quiet, enabled: e.target.checked }) } /> On
        </label>
        <span>from</span>
        <input type="number" min={0} max={23} value={quiet.startHour} onChange={(e) => setQuietForm({ ...quiet, startHour: Number(e.target.value) })} className={`${input} w-20`} />
        <span>to</span>
        <input type="number" min={0} max={23} value={quiet.endHour} onChange={(e) => setQuietForm({ ...quiet, endHour: Number(e.target.value) })} className={`${input} w-20`} />
        <span>o'clock</span>
        <button onClick={() => act({ action: 'quiet', ...quiet })} className={btn}>Save</button>
      </div>
    </main>
  )
}
