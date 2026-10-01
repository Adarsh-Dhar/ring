'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useDoorbell } from '../hooks/useDoorbell'
import type { Answer, Visitor, ExpectedVisit } from '@/lib/doorbell/store'
import EnableAlerts from './EnableAlerts'
import ExpectedForm from './ExpectedForm'
import LiveView from './LiveView'

export default function HelperPage() {
  const { snap, stale, unauthorized, refresh, secondsLeft } = useDoorbell()
  const [err, setErr] = useState('')
  const [visitor, setVisitor] = useState<Visitor | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const caseId = snap?.current?.id
  useEffect(() => setVisitor(null), [caseId])

  if (unauthorized) {
    return <main className="p-6 text-center text-amber-300">You are not signed in. Open your personal link again, or ask the guardian for a new one.</main>
  }
  if (!snap) return <main className="p-6 text-slate-400">Loading…</main>

  const me = snap?.me ?? ''
  const helper = snap.helpers.find((h) => h.id === me)
  const c = snap.current
  const idx = c ? c.chain.indexOf(me) : -1
  const visible = !!c && idx >= 0 && (c.kind === 'sos' || c.helperIndex >= idx || c.status !== 'waiting')
  const myTurn = !!c && c.status === 'waiting' && idx >= 0 && (c.kind === 'sos' || c.helperIndex === idx)

  const answer = async (a: Answer, who?: Visitor) => {
    if (!c) return
    setErr('')
    const r = await fetch('/api/doorbell/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: c.id, answer: a, visitor: who ?? visitor ?? undefined }),
    })
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || 'Could not send your answer. Try again or call the resident.')
    refresh()
  }
  const ack = async () => {
    if (!c) return
    await fetch('/api/doorbell/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: c.id }) })
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
  const ExpectedButtons = (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => { setVisitor('known'); void answer('safe', 'known') }} className="rounded-2xl bg-emerald-600 py-5 text-lg font-bold">✅ It's them</button>
        <button onClick={() => answer('not_safe')} className="rounded-2xl bg-red-600 py-5 text-lg font-bold">⛔ Not them</button>
        <button onClick={() => answer('call_me')} className="rounded-2xl bg-indigo-600 py-5 text-lg font-bold">📞 I'll call</button>
      </div>
      <p className="mt-2 text-xs text-slate-400">If you do nothing, it becomes a normal visitor alert after a short wait.</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Helper: {helper?.emoji} {helper?.name ?? 'choose a helper'}</h1>
      </header>
      <div className="flex items-center justify-between mb-4">
        <EnableAlerts />
        <Link href="/setup" className="text-sm text-cyan-400">⚙️ Setup</Link>
      </div>
      {stale && <p className="mb-4 rounded-xl bg-amber-700 p-3 text-center font-semibold">Connection lost. What you see may be out of date.</p>}
      {err && <p className="mb-4 rounded-xl bg-red-900 p-3 text-center">{err}</p>}
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
        <div className={`rounded-2xl p-4 ${c.kind === 'sos' ? 'bg-rose-900' : c.lane === 'expected' ? 'bg-sky-900' : 'bg-slate-800'}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">
              {c.kind === 'sos' ? '🆘 Resident pressed "I need help"'
                : c.lane === 'expected' ? `${c.visitIcon} ${c.visitLabel} may be at the door`
                : '🚪 Someone is at the door'}
            </h2>
            {c.status === 'waiting' && (
              <span className="px-3 py-1 rounded-full bg-black/30 text-sm">{secondsLeft(c.deadlineAt)}s left</span>
            )}
          </div>

          {c.kind === 'sos' ? (
            c.deviceId ? (
              <LiveView caseId={c.id} />
            ) : (
              <div className="rounded-xl bg-black aspect-video flex items-center justify-center text-slate-400 text-sm text-center px-6">
                No Ring device connected for this case.
              </div>
            )
          ) : (
            <div className="rounded-xl bg-slate-700 aspect-video flex items-center justify-center text-slate-400 text-sm text-center px-6">
              Video is only shown when resident needs help (SOS)
            </div>
          )}

          {c.kind === 'sos' && c.status === 'waiting' && !c.ackedAt && (
            <button onClick={ack} className="mt-3 w-full rounded-2xl bg-white py-4 text-lg font-bold text-rose-900">👀 I have seen this. I am on it.</button>
          )}
          {c.ackedAt && <p className="mt-3 text-sm text-emerald-300">Seen by {snap.helpers.find((h) => h.id === c.ackedBy)?.name}.</p>}

          {(snap.expectedNow.length > 0 || snap.recurringNow.length > 0) && (
            <p className="mb-2 text-sm text-amber-300">Expected now: {[...snap.expectedNow, ...snap.recurringNow].map((e) => `${e.icon} ${e.label}`).join(', ')}</p>
          )}

          {c.status === 'waiting' && myTurn && (c.lane === 'expected' ? ExpectedButtons : Buttons)}
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
