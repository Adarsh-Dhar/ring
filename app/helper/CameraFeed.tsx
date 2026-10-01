'use client'

import { useEffect, useRef, useState } from 'react'

type St = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

/**
 * Door camera for the helper in SIMULATOR mode. Behaves like Ring live view:
 *  - short connection delay, video only (no sound), no looping
 *  - ends by itself after the session limit (30 s battery / 60 s wired) and must be restarted
 *  - mandatory watermark (Ring logo, device id, app name, timestamp)
 * The session itself is requested from the server (/api/ring/live/sim), so the audit log and Ring token path are real.
 */
export default function CameraFeed({ file, caseId, deviceId = 'fake-doorbell-001' }: { file: string; caseId: string; deviceId?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const sessionId = useRef('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [st, setSt] = useState<St>('idle')
  const [left, setLeft] = useState(0)
  const [msg, setMsg] = useState('')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const stop = (next: St) => {
    timers.current.forEach(clearTimeout); timers.current = []
    video.current?.pause()
    if (sessionId.current) {
      fetch('/api/ring/live', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, sessionId: sessionId.current }) }).catch(() => {})
      sessionId.current = ''
    }
    setSt(next)
  }

  const start = async () => {
    setSt('connecting'); setMsg('')
    try {
      await new Promise((r) => timers.current.push(setTimeout(r, 1200 + Math.random() * 2300))) // WebRTC setup takes a moment
      const r = await fetch(`/api/ring/live/sim?caseId=${encodeURIComponent(caseId)}`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      sessionId.current = d.sessionId
      const v = video.current!
      v.src = `/api/doorbell/clip?file=${encodeURIComponent(file)}`
      await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('clip missing')) })
      if (isFinite(v.duration) && v.duration > 4) v.currentTime = Math.random() * (v.duration - 2)
      await v.play()
      setSt('live'); setLeft(d.maxSeconds)
      const tick = setInterval(() => setLeft((s) => s - 1), 1000)
      timers.current.push(setTimeout(() => { clearInterval(tick); stop('ended') }, d.maxSeconds * 1000))
    } catch (e) { setMsg(e instanceof Error ? e.message : 'failed'); stop('error') }
  }

  useEffect(() => { stop('idle') }, [caseId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stop('idle') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
      <video ref={video} muted playsInline className="h-full w-full object-cover" />
      {st === 'live' && (
        <>
          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-bold text-white">🔴 LIVE · {left}s left</span>
          {/* Ring's mandatory watermark */}
          <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 font-mono text-[10px] text-white/80">
            ◉ ring · {deviceId} · Doorbell Helper · {now.toISOString().slice(0, 19)}Z
          </span>
        </>
      )}
      {st !== 'live' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black px-6 text-center text-sm text-slate-300">
          {st === 'error' && <p className="text-amber-300">Could not show the door: {msg}. Use the Ring app.</p>}
          {st === 'ended' && <p>Video ended (Ring limits each view to 30 to 60 seconds).</p>}
          <button onClick={start} disabled={st === 'connecting'} className="rounded-xl bg-cyan-500 px-5 py-3 font-bold text-black disabled:opacity-50">
            {st === 'connecting' ? 'Connecting…' : st === 'idle' ? '� Show the door' : '� Watch again'}
          </button>
        </div>
      )}
    </div>
  )
}
