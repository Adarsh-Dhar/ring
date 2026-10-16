'use client'

import { useEffect, useState } from 'react'

type Ai = {
  visitorSummary: string | null
  riskFlags: string[] | unknown
  clipDescription: string | null
  greeterState: string | null
  clipActions?: string[] | null
  clipPeopleCount?: number | null
  clipApproachedDoor?: boolean | null
}

/** Advisory AI info for an open case. Renders nothing when there is none (AI off, or not ready yet). */
export default function AiCaseCard({ caseId }: { caseId: string }) {
  const [ai, setAi] = useState<Ai | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    let stop = false
    const startedAt = Date.now()
    const MAX_POLL_MS = 90_000   // never poll forever (AI off, quota spent, or nothing to analyse)
    const load = async () => {
      try {
        const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}`, { cache: 'no-store' })
        if (!r.ok || stop) { setAnalyzing(false); return }
        const data = await r.json()
        setAi(data)

        const greeterActive = data.greeterState === 'greeting' || data.greeterState === 'listening'
        const haveClip = !!data.clipDescription
        const finished = (haveClip && !greeterActive) || data.greeterState === 'unsupported'
        const timedOut = Date.now() - startedAt > MAX_POLL_MS
        if (finished || timedOut) { setAnalyzing(false); return }

        setAnalyzing(true)
        setTimeout(load, 4000)
      } catch { setAnalyzing(false) /* AI is optional */ }
    }
    void load()
    return () => { stop = true }
  }, [caseId])

  if (!ai && !analyzing) return null

  const flags = Array.isArray(ai?.riskFlags) ? (ai.riskFlags as string[]) : []

  // Show unsupported message
  if (ai?.greeterState === 'unsupported') {
    return (
      <p className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
        🎙️ Greeter unavailable on this doorbell (simulator only)
      </p>
    )
  }

  // Show analyzing state
  if (analyzing && !ai?.visitorSummary && !ai?.clipDescription && flags.length === 0) {
    return (
      <p className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
        🔍 AI is analysing the footage…
      </p>
    )
  }

  // Show active greeter state
  if (!ai?.visitorSummary && !ai?.clipDescription && flags.length === 0) {
    return ai?.greeterState === 'listening' || ai?.greeterState === 'greeting'
      ? <p className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">🎙️ Doorbell is asking the visitor who they are…</p>
      : null
  }

  return (
    <div className="mb-3 rounded-xl bg-slate-800 p-3 text-sm space-y-2">
      {ai?.visitorSummary && <p>🎙️ <b>Visitor said:</b> {ai.visitorSummary}</p>}
      {ai?.clipDescription && <p>📷 {ai.clipDescription}</p>}
      {ai?.clipActions && ai.clipActions.length > 0 && (
        <p className="text-xs text-slate-300">
          <b>Actions:</b> {ai.clipActions.join(', ')}
        </p>
      )}
      {ai?.clipDescription && ((ai.clipPeopleCount ?? 0) > 0 || (ai.clipActions?.length ?? 0) > 0) && (
        <p className="text-xs text-slate-300">
          <span><b>People:</b> {ai.clipPeopleCount}</span>
          {ai.clipApproachedDoor != null && <span> · <b>Approached door:</b> {ai.clipApproachedDoor ? 'Yes' : 'No'}</span>}
        </p>
      )}
      {flags.length > 0 && (
        <ul className="rounded-lg bg-amber-900/60 p-2 text-amber-100">
          {flags.map((f) => <li key={f}>⚠️ {f}</li>)}
        </ul>
      )}
      <p className="text-xs text-slate-400">AI summary, may be wrong. Check the person yourself before you answer.</p>
    </div>
  )
}
