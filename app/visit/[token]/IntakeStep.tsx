'use client'

import { useEffect, useState } from 'react'

/** Follow-up questions after a visit request. Fail-open: any error calls onDone() and the flow continues as before. */
export default function IntakeStep({ token, statusToken, onDone }: { token: string; statusToken: string; onDone: () => void }) {
  const [q, setQ] = useState<string | null>(null)
  const [a, setA] = useState('')
  const [busy, setBusy] = useState(true)

  const call = async (answer?: string) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/visit-requests/public/${token}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answer === undefined ? { statusToken } : { statusToken, answer }),
      })
      const j = r.ok ? await r.json() : { question: null, done: true }
      if (j.done || !j.question) { onDone(); return }
      setQ(j.question); setA('')
    } catch { onDone(); return }
    setBusy(false)
  }

  useEffect(() => { void call() /* eslint-disable-next-line */ }, [])

  if (!q) return <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><p>One moment…</p></main>

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto flex flex-col justify-center gap-4">
      <p className="text-slate-400 text-sm">One quick question to help the helpers decide:</p>
      <h1 className="text-xl font-semibold">{q}</h1>
      <input value={a} onChange={e => setA(e.target.value)} maxLength={300}
        className="w-full rounded-xl bg-slate-700 px-4 py-3 text-white" placeholder="Your answer" />
      <button disabled={busy || !a.trim()} onClick={() => call(a)}
        className="rounded-xl bg-cyan-600 py-3 font-semibold disabled:opacity-40">{busy ? 'Sending…' : 'Send answer'}</button>
      <button onClick={onDone} className="text-sm text-slate-400">Skip</button>
    </main>
  )
}
