'use client'

import { useState } from 'react'
import type { DoorCase, LifecycleInfo } from '@/lib/doorbell/store'

const STATE_TEXT: Record<string, { text: string; cls: string }> = {
  open: { text: 'Open: points are adding up', cls: 'bg-sky-700' },
  helper_review: { text: 'Helper review: items need you', cls: 'bg-amber-700' },
  visitor_left: { text: 'Visitor left: score frozen', cls: 'bg-slate-600' },
  closed: { text: 'Closed', cls: 'bg-slate-700' },
}

const OUTCOMES = [
  { id: 'resolved_safe', label: 'Resolved: safe' },
  { id: 'resolved_incident', label: 'Resolved: incident' },
  { id: 'false_alarm', label: 'False alarm' },
] as const

/**
 * Section 8, helper side: the case state, the "possible new visitor" banner with a split button, the resident's
 * statements and disputes, earlier serious events (information only), and the visitor-left and close actions.
 */
export default function LifecyclePanel({ c, info, onChanged }: { c: DoorCase; info: LifecycleInfo | null | undefined; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const state = STATE_TEXT[c.lifecycle ?? 'open'] ?? STATE_TEXT.open

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/doorbell/lifecycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: c.id, ...body }) })
      if (!r.ok) setErr((await r.text()) || `HTTP ${r.status}`)
      else onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    const pick = window.prompt('Close this case. Type 1 = resolved safe, 2 = resolved incident, 3 = false alarm')
    const outcome = pick ? OUTCOMES[Number(pick) - 1]?.id : undefined
    if (!outcome) return
    const reason = window.prompt('Reason (optional):') ?? undefined
    void act({ action: 'close', outcome, reason: reason || undefined })
  }

  return (
    <div className="mb-3 rounded-xl bg-slate-800 p-3 text-sm" aria-label="Case lifecycle">
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${state.cls}`}>{state.text}</span>

      {c.possibleNewVisitorAt && c.lifecycle !== 'closed' && (
        <div className="mt-2 rounded-lg bg-amber-900 p-2">
          <p className="font-semibold">Possible new visitor</p>
          <p className="text-xs opacity-80">A new event came in after the first visit. It was added to this case because visitors cannot be told apart reliably.</p>
          <button disabled={busy} onClick={() => act({ action: 'split' })} className="mt-1 rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold">Split into a new case</button>
        </div>
      )}

      {info?.statements?.map((s) => (
        <p key={s.id} className="mt-2 text-xs">🗣️ Resident says the visitor is <b>{s.kind}</b>{s.note ? `: ${s.note}` : ''}. This does not lower the score.</p>
      ))}
      {info?.disputed?.map((d) => (
        <p key={d.obsId} className="mt-1 text-xs text-amber-300">🚩 Resident flagged an item as wrong{d.note ? `: ${d.note}` : ''}. Review it below.</p>
      ))}

      {!!info?.prior?.length && (
        <div className="mt-2 text-xs">
          <p className="font-semibold text-slate-300">Earlier serious events (information only, not in the score)</p>
          <ul className="mt-1 space-y-0.5 opacity-80">
            {info.prior.map((p, i) => <li key={i}>{new Date(p.at).toLocaleString()}: {p.code}{p.state === 'uncertain' ? ' (uncertain)' : ''}</li>)}
          </ul>
        </div>
      )}

      {c.lifecycle !== 'closed' && (
        <div className="mt-3 flex gap-2">
          {!c.visitorLeftAt && <button disabled={busy} onClick={() => act({ action: 'visitor_left' })} className="flex-1 rounded-lg bg-slate-600 py-2 text-xs font-semibold">Visitor has left</button>}
          <button disabled={busy} onClick={close} className="flex-1 rounded-lg bg-slate-600 py-2 text-xs font-semibold">Close case…</button>
        </div>
      )}
      {c.closedAt && <p className="mt-2 text-xs opacity-80">Closed{c.outcome ? `: ${c.outcome.replace('_', ' ')}` : ''}.</p>}
      {err && <p className="mt-2 text-xs text-red-400" role="alert">{err}</p>}
    </div>
  )
}
