'use client'

import { useEffect, useState } from 'react'

type Ai = {
  visitorSummary: string | null
  riskFlags: string[] | unknown
  clipDescription: string | null
  greeterState: string | null
}

/** Advisory AI info for an open case. Renders nothing when there is none (AI off, or not ready yet). */
export default function AiCaseCard({ caseId }: { caseId: string }) {
  const [ai, setAi] = useState<Ai | null>(null)

  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}`, { cache: 'no-store' })
        if (r.ok && !stop) {
          const data = await r.json()
          setAi(data)

          // Keep polling while greeter is active or case is waiting
          const isActive = data.greeterState === 'greeting' || data.greeterState === 'listening'
          const isWaiting = data.visitorSummary === null && data.clipDescription === null
          const isUnsupported = data.greeterState === 'unsupported'

          // Stop polling if done, failed, unsupported, or we have results
          if (!isActive && !isWaiting && !isUnsupported) {
            return
          }

          // Continue polling every 3-5 seconds
          if (!stop) setTimeout(load, 4000)
        }
      } catch { /* AI is optional */ }
    }
    void load()
    return () => { stop = true }
  }, [caseId])

  if (!ai) return null
  const flags = Array.isArray(ai.riskFlags) ? (ai.riskFlags as string[]) : []

  // Show unsupported message
  if (ai.greeterState === 'unsupported') {
    return (
      <p className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
        🎙️ Greeter unavailable on this doorbell (simulator only)
      </p>
    )
  }

  // Show active greeter state
  if (!ai.visitorSummary && !ai.clipDescription && flags.length === 0) {
    return ai.greeterState === 'listening' || ai.greeterState === 'greeting'
      ? <p className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">🎙️ Doorbell is asking the visitor who they are…</p>
      : null
  }

  return (
    <div className="mb-3 rounded-xl bg-slate-800 p-3 text-sm space-y-2">
      {ai.visitorSummary && <p>🎙️ <b>Visitor said:</b> {ai.visitorSummary}</p>}
      {ai.clipDescription && <p>📷 {ai.clipDescription}</p>}
      {flags.length > 0 && (
        <ul className="rounded-lg bg-amber-900/60 p-2 text-amber-100">
          {flags.map((f) => <li key={f}>⚠️ {f}</li>)}
        </ul>
      )}
      <p className="text-xs text-slate-400">AI summary, may be wrong. Check the person yourself before you answer.</p>
    </div>
  )
}
