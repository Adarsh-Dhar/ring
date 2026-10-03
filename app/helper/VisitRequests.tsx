'use client'

import { useEffect, useState } from 'react'
import { PURPOSES } from '@/lib/doorbell/purposes'

interface VisitReq {
  id:          string
  name:        string
  purpose:     string
  note:        string | null
  contactKind: string
  startsAt:    number
  endsAt:      number
  createdAt:   number
  helperOk:    boolean
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

const ago = (ms: number) => {
  const diff = Date.now() - ms
  if (diff < 60_000)  return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h ago`
  return `${Math.floor(diff / 86400_000)} d ago`
}

export default function VisitRequests({ requireResidentOk }: { requireResidentOk?: boolean }) {
  const [requests, setRequests] = useState<VisitReq[]>([])
  const [acting, setActing] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState('')

  const load = () => {
    fetch('/api/visit-requests')
      .then(r => r.ok ? r.json() : { requests: [] })
      .then(d => setRequests(d.requests ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [])

  const decide = async (id: string, decision: 'approve' | 'decline') => {
    setErrMsg('')
    setActing(id + decision)
    const r = await fetch('/api/visit-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision }),
    })
    setActing(null)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErrMsg(j.error || 'Could not process. Try again.'); return }
    load()
  }

  if (!requests.length) return null

  const purpose = (k: string) => (PURPOSES as any)[k] ?? PURPOSES.other

  return (
    <section className="mb-6">
      <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-3">Visit requests</h2>
      {errMsg && <p role="alert" className="mb-3 rounded-xl bg-red-900 p-3 text-sm">{errMsg}</p>}
      <ul className="space-y-3">
        {requests.map(r => {
          const p = purpose(r.purpose)
          const waitingResident = requireResidentOk && r.helperOk
          return (
            <li key={r.id} className="rounded-2xl bg-slate-800 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <span>{p.icon}</span>
                  <span>{r.name}</span>
                  <span className="text-sm text-slate-400">{p.label}</span>
                </div>
                <span className="text-xs text-slate-500 shrink-0">{ago(r.createdAt)}</span>
              </div>
              <p className="text-sm text-slate-300 mt-1">
                {fmt(r.startsAt)} – {new Date(r.endsAt).toLocaleTimeString([], { timeStyle: 'short' })}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                via {r.contactKind === 'sms' ? 'SMS' : 'email'}
              </p>
              {r.note && <p className="text-sm text-slate-300 mt-2 italic">"{r.note}"</p>}
              <div className="mt-3">
                {waitingResident ? (
                  <p className="text-sm text-amber-400">Approved by you — waiting for resident.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => decide(r.id, 'approve')}
                      disabled={acting !== null}
                      className="rounded-xl bg-emerald-700 py-3 font-semibold text-sm hover:bg-emerald-600 disabled:opacity-40"
                    >
                      ✅ Approve
                    </button>
                    <button
                      onClick={() => decide(r.id, 'decline')}
                      disabled={acting !== null}
                      className="rounded-xl bg-red-800 py-3 font-semibold text-sm hover:bg-red-700 disabled:opacity-40"
                    >
                      ❌ Decline
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
