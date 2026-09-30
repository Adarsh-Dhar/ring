'use client'

import { useEffect, useState, useCallback } from 'react'
import { useDoorbell } from '../hooks/useDoorbell'

const nice = (f: string) => f.replace(/^level-\d+-/, '').replace(/\.\w+$/, '').replace(/-/g, ' ')

export default function SimPage() {
  const { snap, refresh } = useDoorbell()
  const [clips, setClips] = useState<string[]>([])
  const [timeout, setTimeoutSec] = useState(30)
  const [msg, setMsg] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [needPin, setNeedPin] = useState(false)

  const load = useCallback(async () => {
    const pin = sessionStorage.getItem('setupPin') || ''
    const r = await fetch('/api/sim', { headers: { 'x-setup-pin': pin } })
    if (r.status === 401) {
      setNeedPin(true)
      setMsg('')
      return
    }
    setNeedPin(false)
    if (!r.ok) {
      setMsg('Simulator is off. Set ENABLE_SIM=1 (development only).')
      setClips([])
      return
    }
    const d = await r.json()
    setClips(d.clips)
    setTimeoutSec(d.timeoutSec)
    setMsg('')
  }, [])

  const post = async (body: object, note?: string) => {
    const r = await fetch('/api/sim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-setup-pin': sessionStorage.getItem('setupPin') || '' }, body: JSON.stringify(body) })
    if (r.status === 401) {
      setNeedPin(true)
      setMsg('PIN required')
      return
    }
    if (note) setMsg(note)
    refresh()
  }

  const submitPin = async () => {
    if (!pinInput.trim()) {
      setMsg('Please enter a PIN')
      return
    }
    sessionStorage.setItem('setupPin', pinInput)
    setPinInput('')
    await load()
  }

  if (needPin) {
    return (
      <main className="mx-auto max-w-sm p-6 text-white">
        <h1 className="mb-4 text-xl font-bold">Guardian PIN</h1>
        <input
          type="password"
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitPin()}
          placeholder="Enter PIN"
          className="w-full mb-3 rounded-lg bg-slate-700 p-2 text-white"
          autoFocus
        />
        <button onClick={submitPin} className="w-full rounded-lg bg-cyan-500 py-3 font-bold text-black cursor-pointer hover:bg-cyan-400">
          Unlock
        </button>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Ring simulator</h1>
      <p className="text-slate-400 mb-6 text-sm">
        No Ring needed. Each button sends a Ring-shaped <code>button_press</code> webhook through the real pipeline.
        Open <a className="text-cyan-400 underline" href="/resident" target="_blank">/resident</a> and{' '}
        <a className="text-cyan-400 underline" href="/helper" target="_blank">/helper</a> in other tabs (sign in with a link from Setup first). Needs ENABLE_SIM=1 and a non-production build.
      </p>

      <section className="mb-6">
        <h2 className="font-semibold mb-2">1. Ring a visitor</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {clips.map((f) => (
            <button
              key={f}
              onClick={() => post({ action: 'trigger', clip: f, eventType: 'button_press' }, `Sent event with clip ${f}`)}
              className="px-3 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-left text-sm"
            >
              <span className="block text-slate-400 text-xs">{f.match(/level-(\d+)/)?.[0] ?? ''}</span>
              {nice(f)}
            </button>
          ))}
          <button
            onClick={() => post({ action: 'trigger', clip: null, eventType: 'button_press' }, 'Sent doorbell press with no clip')}
            className="px-3 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-left text-sm"
          >
            <span className="block text-slate-400 text-xs">no clip</span>doorbell pressed
          </button>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold mb-2">2. Failure modes</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => post({ action: 'offline', value: !snap?.offline }, snap?.offline ? 'Ring back online' : 'Ring set OFFLINE')}
            className={`px-4 py-2 rounded-xl ${snap?.offline ? 'bg-amber-600' : 'bg-slate-700'}`}
          >
            {snap?.offline ? 'Ring is OFFLINE (click to restore)' : 'Simulate Ring offline'}
          </button>
          <label className="text-sm flex items-center gap-2">
            Escalation seconds
            <input
              type="number"
              min={3}
              value={timeout}
              onChange={(e) => setTimeoutSec(Number(e.target.value))}
              onBlur={() => post({ action: 'timeout', value: timeout }, `Timeout set to ${timeout}s (applies to next case)`)}
              className="w-20 px-2 py-1 rounded bg-slate-800 border border-slate-600"
            />
          </label>
          <button onClick={() => post({ action: 'reset' }, 'Reset')} className="px-4 py-2 rounded-xl bg-red-800">
            Reset everything
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">3. Live state</h2>
        <pre className="text-xs bg-slate-800 rounded-xl p-3 overflow-auto max-h-72 text-cyan-300">
          {JSON.stringify({ offline: snap?.offline, current: snap?.current && { status: snap.current.status, helperIndex: snap.current.helperIndex, answer: snap.current.answer, log: snap.current.log.map((l) => l.msg) } }, null, 2)}
        </pre>
        {msg && <p className="text-xs text-slate-400 mt-2">{msg}</p>}
      </section>
    </main>
  )
}
