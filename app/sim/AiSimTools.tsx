'use client'

import { useRef, useState } from 'react'
import InterrogationCard from '../helper/InterrogationCard'

const b64 = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1] ?? '')
  r.onerror = () => rej(new Error('read failed'))
  r.readAsDataURL(blob)
})

const speak = (text: string) => new Promise<void>((res) => {
  if (!('speechSynthesis' in window)) return res()
  const u = new SpeechSynthesisUtterance(text)
  u.onend = () => res(); u.onerror = () => res()
  window.speechSynthesis.speak(u)
})

interface Props {
  caseId: string
  lane?: 'normal' | 'expected' | null
}

/** Simulates the doorbell speaker + mic in the browser (SimTalkback). */
export default function AiSimTools({ caseId, lane }: Props) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const rec = useRef<MediaRecorder | null>(null)

  async function recordOnce(seconds: number): Promise<{ data: string; mimeType: string } | null> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'audio/webm'
    const chunks: Blob[] = []
    const mr = new MediaRecorder(stream, { mimeType }); rec.current = mr
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise<void>((r) => { mr.onstop = () => r() })
    mr.start(); setTimeout(() => mr.state !== 'inactive' && mr.stop(), seconds * 1000)
    await done
    stream.getTracks().forEach((t) => t.stop())
    if (!chunks.length) return null
    return { data: await b64(new Blob(chunks, { type: mimeType })), mimeType }
  }

  async function runInterrogator() {
    if (!caseId) return setStatus('Ring the doorbell first.')
    setBusy(true)
    try {
      const s = await (await fetch(`/api/ai/interrogator/script?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' })).json()
      if (!s.enabled) { setStatus('AI interrogator is off for this household.'); return }
      await speak(s.lines.greet)

      // Multi-turn loop: the server decides when to stop. There is no client-side turn limit
      // (an operator ceiling, if set, comes back as s.maxTurns).
      const maxTurns = typeof s.maxTurns === 'number' ? s.maxTurns : Infinity
      for (let turn = 0; turn < maxTurns; turn++) {
        setStatus(`🎙️ Listening… speak now (10s) - answer ${turn + 1}${Number.isFinite(maxTurns) ? `/${maxTurns}` : ''}`)
        const clip = await recordOnce(s.listenSeconds || 10)
        if (!clip) { setStatus('Nothing recorded.'); return }

        const r = await fetch('/api/ai/interrogator/audio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId, audio: clip.data, mimeType: clip.mimeType.split(';')[0] }),
        })
        const j = await r.json()
        if (!r.ok) { setStatus(j.error || 'Upload failed'); return }

        if (j.final) {
          if (j.close) await speak(j.close)
          setStatus('Done. The summary appears on the helper card.')
          return
        }

        if (j.question) {
          await speak(j.question)
        } else {
          setStatus('Done. No more questions.')
          return
        }
      }
    } catch (e: any) { setStatus(e?.message || 'Failed') } finally { setBusy(false) }
  }

  const isPlanned = lane === 'expected'

  return (
    <section className="mt-4 rounded-xl border border-slate-700 p-3 text-sm text-slate-200">
      <h2 className="mb-2 font-semibold">🤖 AI tools (sim)</h2>
      {caseId && <InterrogationCard key={caseId} caseId={caseId} />}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          disabled={busy || !caseId || isPlanned}
          onClick={runInterrogator}
          className="rounded-lg bg-slate-700 px-3 py-2 disabled:opacity-50"
        >
          🎙️ Run interrogator
        </button>
        {isPlanned && <span className="text-xs text-slate-400">Planned visit: interrogator off</span>}
      </div>
      {status && <p className="mt-2 text-slate-300 whitespace-pre-line" role="status">{status}</p>}
    </section>
  )
}
