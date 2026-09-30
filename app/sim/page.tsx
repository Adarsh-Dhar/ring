'use client'

import { useEffect, useState, useCallback } from 'react'
import { useDoorbell } from '../hooks/useDoorbell'

const nice = (f: string) => f.replace(/^level-\d+-/, '').replace(/\.\w+$/, '').replace(/-/g, ' ')

export default function SimPage() {
  const { snap, refresh } = useDoorbell()
  const [clips, setClips] = useState<string[]>([])
  const [timeout, setTimeoutSec] = useState(30)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const d = await fetch('/api/sim').then((r) => r.json())
    setClips(d.clips)
    setTimeoutSec(d.timeoutSec)
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: object, note?: string) => {
    await fetch('/api/sim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (note) setMsg(note)
    refresh()
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Ring simulator</h1>
      <p className="text-slate-400 mb-6 text-sm">
        No Ring needed. Each button sends a Ring-shaped <code>person_detected</code> webhook through the real pipeline.
        Open <a className="text-cyan-400 underline" href="/resident" target="_blank">/resident</a> and{' '}
        <a className="text-cyan-400 underline" href="/helper?as=h1" target="_blank">/helper?as=h1</a> in other tabs.
      </p>

      <section className="mb-6">
        <h2 className="font-semibold mb-2">1. Ring a visitor</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {clips.map((f) => (
            <button
              key={f}
              onClick={() => post({ action: 'trigger', clip: f, eventType: 'person_detected' }, `Sent event with clip ${f}`)}
              className="px-3 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-left text-sm"
            >
              <span className="block text-slate-400 text-xs">{f.match(/level-(\d+)/)?.[0] ?? ''}</span>
              {nice(f)}
            </button>
          ))}
          <button
            onClick={() => post({ action: 'trigger', clip: null, eventType: 'doorbell_pressed' }, 'Sent doorbell press with no clip')}
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
