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
    let tries = 0
    const load = async () => {
      try {
        const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}`, { cache: 'no-store' })
        if (r.ok && !stop) setAi(await r.json())
      } catch { /* AI is optional */ }
      // The summary arrives after the alert: poll for ~40s, then stop.
      if (!stop && ++tries < 14) setTimeout(load, 3000)
    }
    void load()
    return () => { stop = true }
  }, [caseId])

  if (!ai) return null
  const flags = Array.isArray(ai.riskFlags) ? (ai.riskFlags as string[]) : []
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
