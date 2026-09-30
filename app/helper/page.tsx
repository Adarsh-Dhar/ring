'use client'

import { useEffect, useState } from 'react'
import { useDoorbell } from '../hooks/useDoorbell'
import type { Answer } from '@/lib/doorbell/store'

export default function HelperPage() {
  const { snap, refresh, secondsLeft } = useDoorbell()
  const [me, setMe] = useState('h1')
  const [, force] = useState(0)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('as')
    if (q) setMe(q)
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  if (!snap) return <main className="p-6 text-slate-400">Loading…</main>

  const idx = snap.helpers.findIndex((h) => h.id === me)
  const helper = snap.helpers[idx]
  const c = snap.current
  const visible = !!c && (c.kind === 'sos' || c.helperIndex >= idx || c.status !== 'waiting')
  const myTurn = !!c && c.status === 'waiting' && (c.kind === 'sos' || c.helperIndex === idx)

  const answer = async (a: Answer) => {
    if (!c) return
    await fetch('/api/doorbell/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: c.id, helperId: me, answer: a }),
    })
    refresh()
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Helper: {helper?.emoji} {helper?.name}</h1>
        <div className="flex gap-2">
          {snap.helpers.map((h) => (
            <button
              key={h.id}
              onClick={() => setMe(h.id)}
              className={`px-3 py-1 rounded-full text-sm ${h.id === me ? 'bg-cyan-500 text-black font-semibold' : 'bg-slate-700'}`}
            >
              {h.name}
            </button>
          ))}
        </div>
      </header>

      {!c || !visible ? (
        <div className="rounded-2xl bg-slate-800 p-10 text-center">
          <div className="text-6xl mb-3">😌</div>
          <p className="text-lg">Nothing needs you right now.</p>
          {c && c.status === 'waiting' && (
            <p className="text-sm text-slate-400 mt-2">
              {snap.helpers[c.helperIndex]?.name} has been asked. It reaches you if they do not answer.
            </p>
          )}
        </div>
      ) : (
        <div className={`rounded-2xl p-4 ${c.kind === 'sos' ? 'bg-rose-900' : 'bg-slate-800'}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">
              {c.kind === 'sos' ? '🆘 Resident pressed "I need help"' : '🚪 Someone is at the door'}
            </h2>
            {c.status === 'waiting' && (
              <span className="px-3 py-1 rounded-full bg-black/30 text-sm">{secondsLeft(c.deadlineAt)}s left</span>
            )}
          </div>

          {c.clip ? (
            <video
              key={c.id}
              src={`/api/doorbell/clip?file=${encodeURIComponent(c.clip)}`}
              autoPlay
              loop
              muted
              playsInline
              controls
              className="w-full rounded-xl bg-black aspect-video"
            />
          ) : c.kind === 'visitor' ? (
            <div className="rounded-xl bg-black aspect-video flex items-center justify-center text-slate-400 text-sm text-center px-6">
              No clip attached. With a real Ring, open the Ring app (Shared User) to watch live.
            </div>
          ) : null}

          {c.status === 'waiting' && myTurn && (
            <div className="grid grid-cols-3 gap-3 mt-4">
              <button onClick={() => answer('safe')} className="py-5 rounded-2xl bg-emerald-600 text-lg font-bold">✅ Safe</button>
              <button onClick={() => answer('not_safe')} className="py-5 rounded-2xl bg-red-600 text-lg font-bold">⛔ Not safe</button>
              <button onClick={() => answer('call_me')} className="py-5 rounded-2xl bg-indigo-600 text-lg font-bold">📞 I'll call</button>
            </div>
          )}
          {c.status === 'answered' && (
            <p className="mt-4 text-emerald-300">
              Answered: {c.answer === 'safe' ? 'Safe' : c.answer === 'not_safe' ? 'Not safe' : 'Will call'} by{' '}
              {snap.helpers.find((h) => h.id === c.answeredBy)?.name}.
            </p>
          )}
          {c.status === 'no_response' && (
            <div className="mt-4">
              <p className="text-amber-300 mb-3">Nobody answered. Resident was told to keep the door closed. You can still answer:</p>
              <div className="grid grid-cols-3 gap-3">
                <button onClick={() => answer('safe')} className="py-4 rounded-2xl bg-emerald-600 font-bold">✅ Safe</button>
                <button onClick={() => answer('not_safe')} className="py-4 rounded-2xl bg-red-600 font-bold">⛔ Not safe</button>
                <button onClick={() => answer('call_me')} className="py-4 rounded-2xl bg-indigo-600 font-bold">📞 I'll call</button>
              </div>
            </div>
          )}
        </div>
      )}

      <section className="mt-6">
        <h3 className="text-sm uppercase tracking-wide text-slate-400 mb-2">Latest case timeline</h3>
        <ul className="text-sm space-y-1 text-slate-300">
          {(snap.history[0]?.log ?? []).map((l, i) => (
            <li key={i}>
              <span className="text-slate-500">{new Date(l.t).toLocaleTimeString()}</span> {l.msg}
            </li>
          ))}
          {snap.history.length === 0 && <li className="text-slate-500">No events yet.</li>}
        </ul>
      </section>
    </main>
  )
}
