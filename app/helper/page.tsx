'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useDoorbell } from '../hooks/useDoorbell'
import type { Answer, Visitor, ExpectedVisit } from '@/lib/doorbell/store'
import type { Helper } from '@/lib/doorbell/config'
import EnableAlerts from './EnableAlerts'
import ExpectedForm from './ExpectedForm'

export default function HelperPage() {
  const { snap, refresh, secondsLeft } = useDoorbell()
  const [me, setMe] = useState('h1')
  const [visitor, setVisitor] = useState<Visitor | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('as')
    if (q) setMe(q)
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const caseId = snap?.current?.id
  useEffect(() => setVisitor(null), [caseId])

  if (!snap) return <main className="p-6 text-slate-400">Loading…</main>

  const helper = snap.helpers.find((h) => h.id === me)
  const c = snap.current
  const idx = c ? c.chain.indexOf(me) : -1
  const visible = !!c && idx >= 0 && (c.kind === 'sos' || c.helperIndex >= idx || c.status !== 'waiting')
  const myTurn = !!c && c.status === 'waiting' && idx >= 0 && (c.kind === 'sos' || c.helperIndex === idx)

  const answer = async (a: Answer) => {
    if (!c) return
    await fetch('/api/doorbell/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: c.id, helperId: me, answer: a, visitor: visitor ?? undefined }),
    })
    refresh()
  }

  const canSafe = visitor === 'known' || visitor === 'delivery'
  const Buttons = (
    <div className="mt-4">
      <p className="mb-2 text-sm text-slate-300">Who is it?</p>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {([['known', '👤 Known'], ['delivery', '📦 Delivery'], ['unknown', '❓ Unknown']] as const).map(([v, t]) => (
          <button
            key={v}
            onClick={() => setVisitor(v)}
            className={`rounded-xl py-3 font-semibold ${visitor === v ? 'bg-cyan-500 text-black' : 'bg-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <button disabled={!canSafe} onClick={() => answer('safe')} className="rounded-2xl bg-emerald-600 py-5 text-lg font-bold disabled:opacity-30">✅ Safe</button>
        <button onClick={() => answer('not_safe')} className="rounded-2xl bg-red-600 py-5 text-lg font-bold">⛔ Not safe</button>
        <button onClick={() => answer('call_me')} className="rounded-2xl bg-indigo-600 py-5 text-lg font-bold">📞 I'll call</button>
      </div>
    </div>
  )

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Helper: {helper?.emoji} {helper?.name ?? 'choose a helper'}</h1>
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
      <div className="flex items-center justify-between mb-4">
        <EnableAlerts helperId={me} />
        <Link href="/setup" className="text-sm text-cyan-400">⚙️ Setup</Link>
      </div>
      <a href="/helper/history" className="mb-4 inline-block text-sm text-cyan-400">📋 History</a>

      {!c || !visible ? (
        <div className="rounded-2xl bg-slate-800 p-10 text-center">
          <div className="text-6xl mb-3">😌</div>
          <p className="text-lg">Nothing needs you right now.</p>
          {c && c.status === 'waiting' && (
            <p className="text-sm text-slate-400 mt-2">
              {snap.helpers.find((h) => h.id === c.chain[c.helperIndex])?.name} has been asked. It reaches you if they do not answer.
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

          {snap.expectedNow.length > 0 && (
            <p className="mb-2 text-sm text-amber-300">Expected now: {snap.expectedNow.map((e: ExpectedVisit) => `${e.icon} ${e.label}`).join(', ')}</p>
          )}

          {c.status === 'waiting' && myTurn && Buttons}
          {c.status === 'answered' && (
            <p className="mt-4 text-emerald-300">
              Answered: {c.answer === 'safe' ? 'Safe' : c.answer === 'not_safe' ? 'Not safe' : 'Will call'} by{' '}
              {snap.helpers.find((h) => h.id === c.answeredBy)?.name}.
            </p>
          )}
          {c.status === 'no_response' && (
            <div className="mt-4">
              <p className="text-amber-300 mb-3">Nobody answered. Resident was told to keep the door closed. You can still answer:</p>
              {Buttons}
            </div>
          )}
        </div>
      )}

      <ExpectedForm items={snap.expected} onChange={refresh} />

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
