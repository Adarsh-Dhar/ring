'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { DoorCase } from '@/lib/doorbell/store'
import type { Helper } from '@/lib/doorbell/config'

const label = (c: DoorCase) =>
  c.status === 'waiting'
    ? '⏳ Waiting'
    : c.status === 'no_response'
      ? '⚠️ Nobody answered'
      : c.answer === 'safe'
        ? '✅ Safe'
        : c.answer === 'not_safe'
          ? '⛔ Not safe'
          : '📞 Will call'

export default function HistoryPage() {
  const [data, setData] = useState<{ helpers: Helper[]; cases: DoorCase[] } | null>(null)

  useEffect(() => {
    fetch('/api/doorbell/history', { cache: 'no-store' }).then((r) => r.json()).then(setData)
  }, [])

  if (!data) return <main className="p-6 text-slate-400">Loading…</main>

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-slate-900 p-4 text-white">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">History</h1>
        <Link href="/helper" className="text-sm text-cyan-400">Back</Link>
      </header>
      {data.cases.length === 0 && <p className="text-slate-500">No cases yet.</p>}
      <ul className="space-y-3">
        {data.cases.map((c) => (
          <li key={c.id} className="rounded-2xl bg-slate-800 p-4">
            <details>
              <summary className="flex cursor-pointer justify-between gap-3">
                <span>
                  {c.kind === 'sos' ? '🆘 SOS' : '🚪 Visitor'} · {new Date(c.createdAt).toLocaleString()}
                </span>
                <span>
                  {label(c)}
                  {c.answeredBy ? ` · ${data.helpers.find((h) => h.id === c.answeredBy)?.name ?? c.answeredBy}` : ''}
                </span>
              </summary>
              <ul className="mt-3 space-y-1 text-sm text-slate-300">
                {c.log.map((l, i) => (
                  <li key={i}>
                    <span className="text-slate-500">{new Date(l.t).toLocaleTimeString()}</span> {l.msg}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </main>
  )
}
