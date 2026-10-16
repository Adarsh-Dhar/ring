'use client'

import { useRef, useState } from 'react'
import { extractFrames, validateFramesSize } from './extractFrames'

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

/** Simulates the doorbell speaker + mic in the browser (SimTalkback) and lets you try the Describer with an image. */
export default function AiSimTools({ caseId }: { caseId: string }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const rec = useRef<MediaRecorder | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)

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

  async function runGreeter() {
    if (!caseId) return setStatus('Ring the doorbell first.')
    setBusy(true)
    try {
      const s = await (await fetch('/api/ai/greeter/script', { cache: 'no-store' })).json()
      if (!s.enabled) { setStatus('AI greeter is off for this household.'); return }
      await speak(s.lines.greet)
      for (let attempt = 0; attempt < 2; attempt++) {
        setStatus('🎙️ Listening… speak now (10s)')
        const clip = await recordOnce(s.listenSeconds || 10)
        if (!clip) { setStatus('Nothing recorded.'); return }
        const r = await fetch('/api/ai/greeter/audio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId, audio: clip.data, mimeType: clip.mimeType.split(';')[0], lastTry: attempt === 1 }),
        })
        const j = await r.json()
        if (!r.ok) { setStatus(j.error || 'Upload failed'); return }
        if (j.reprompt) { await speak(j.reprompt); continue }
        if (j.close) await speak(j.close)
        setStatus('Done. The summary appears on the helper card.'); return
      }
    } catch (e: any) { setStatus(e?.message || 'Failed') } finally { setBusy(false) }
  }

  async function describe(file: File) {
    setBusy(true); setStatus('Describing…')
    try {
      const r = await fetch('/api/ai/describe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: caseId || undefined, image: await b64(file), mimeType: file.type || 'image/jpeg' }),
      })
      const j = await r.json()
      setStatus(r.ok ? (j.result ? `📷 ${j.result.description}` : 'No AI result (off, over budget, or failed).') : j.error)
    } finally { setBusy(false) }
  }

  async function describeVideo(file: File) {
    setBusy(true); setStatus('Extracting frames…')
    try {
      const frames = await extractFrames(file)
      if (!validateFramesSize(frames)) {
        setStatus('Frames too large. Max 1.5 MB total.')
        return
      }
      setStatus('Describing video…')
      const r = await fetch('/api/ai/describe-video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: caseId || undefined, frames }),
      })
      const j = await r.json()
      if (r.ok) {
        setStatus(`🎞 ${j.summary}`)
        if (j.actions && j.actions.length > 0) {
          setStatus(s => `${s}\nActions: ${j.actions.join(', ')}`)
        }
      } else {
        setStatus(j.error || 'Video description failed')
      }
    } catch (e: any) {
      setStatus(e?.message || 'Failed to extract frames')
    } finally { setBusy(false) }
  }

  return (
    <section className="mt-4 rounded-xl border border-slate-700 p-3 text-sm text-slate-200">
      <h2 className="mb-2 font-semibold">🤖 AI tools (sim)</h2>
      <div className="flex flex-wrap gap-2 items-center">
        <button disabled={busy || !caseId} onClick={runGreeter} className="rounded-lg bg-slate-700 px-3 py-2 disabled:opacity-50">🎙️ Run door greeter</button>
        <label className="rounded-lg bg-slate-700 px-3 py-2 cursor-pointer">
          📷 Describe image
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void describe(f); e.currentTarget.value = '' }} />
        </label>
        <label className="rounded-lg bg-slate-700 px-3 py-2 cursor-pointer">
          🎞 Describe video
          <input type="file" accept="video/mp4,video/webm" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void describeVideo(f); e.currentTarget.value = '' }} />
        </label>
      </div>
      {status && <p className="mt-2 text-slate-300 whitespace-pre-line" role="status">{status}</p>}
    </section>
  )
}
