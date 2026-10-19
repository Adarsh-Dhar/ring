'use client'

import { useState } from 'react'
import type { LifecycleInfo } from '@/lib/doorbell/store'

/**
 * Section 8.2, resident side. The resident can:
 *  - say the visitor is expected or known (recorded and shown to the helper; it does not lower anything by itself)
 *  - flag a noted item as wrong, for the helper to review (a flag only; only a helper can retract)
 *  - say a "possible new visitor" is a different person, which splits it into a new case
 */
export default function ResidentCaseNotes({ caseId, info, possibleNewVisitor, onChanged }: {
  caseId: string
  info: LifecycleInfo | null
  possibleNewVisitor: boolean
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const send = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/doorbell/resident-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, ...body }) })
      setMsg(r.ok ? done : 'That did not work. Please try again.')
      if (r.ok) onChanged?.()
    } catch {
      setMsg('That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const told = info?.statements?.length ?? 0
  const notes = info?.notes ?? []
  return (
    <section className="rounded-3xl bg-black/30 p-4 text-lg" aria-label="Tell your helper about this visitor">
      <div className="grid grid-cols-2 gap-3">
        <button disabled={busy} onClick={() => send({ action: 'statement', kind: 'expected' }, 'Your helper has been told you expected this visitor.')} className="rounded-2xl bg-white py-3 font-bold text-slate-900">I expected them</button>
        <button disabled={busy} onClick={() => send({ action: 'statement', kind: 'known' }, 'Your helper has been told you know this visitor.')} className="rounded-2xl bg-white py-3 font-bold text-slate-900">I know them</button>
      </div>
      {told > 0 && <p className="mt-2 text-sm opacity-80">Your helper can see what you said. They still decide.</p>}
      {notes.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold">What was noticed</p>
          <ul className="mt-1 space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{n.label}</span>
                {n.disputed
                  ? <span className="opacity-70">Flagged for your helper</span>
                  : <button disabled={busy} onClick={() => send({ action: 'dispute', obsId: n.id }, 'Flagged. Your helper will look at it.')} className="rounded-xl bg-black/40 px-3 py-1 font-semibold">This is wrong</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {possibleNewVisitor && (
        <div className="mt-3 rounded-2xl bg-black/30 p-3">
          <p className="text-sm">Someone may have come to the door after the first visitor.</p>
          <button disabled={busy} onClick={() => send({ action: 'split' }, 'Started a new case for the new visitor.')} className="mt-2 w-full rounded-2xl bg-white py-3 font-bold text-slate-900">It is a different person</button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm" role="status">{msg}</p>}
    </section>
  )
}
