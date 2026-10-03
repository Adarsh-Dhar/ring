'use client'

import { useEffect, useRef, useState } from 'react'

type St = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

/**
 * Live Ring video over WebRTC/WHEP. The SDP offer goes through OUR server (/api/ring/live),
 * which adds the Ring token. Ring ends a session after 30 s (battery) or 60 s (wired). Video only.
 */
export default function LiveView({ caseId }: { caseId: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const session = useRef('')
  const [st, setSt] = useState<St>('idle')
  const [msg, setMsg] = useState('')

  const stop = async (next: St = 'ended') => {
    pc.current?.close()
    pc.current = null
    if (session.current) {
      fetch('/api/ring/live', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, sessionId: session.current }) }).catch(() => {})
      session.current = ''
    }
    setSt(next)
  }

  const start = async () => {
    setSt('connecting'); setMsg('')
    try {
      const conn = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pc.current = conn
      conn.addTransceiver('video', { direction: 'recvonly' }) // Ring streams video only
      conn.ontrack = (e) => { if (video.current) video.current.srcObject = e.streams[0] ?? new MediaStream([e.track]) }
      conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'connected') setSt('live')
        if (['failed', 'closed', 'disconnected'].includes(conn.connectionState)) setSt((s) => (s === 'live' || s === 'connecting' ? 'ended' : s))
      }
      await conn.setLocalDescription(await conn.createOffer())
      // Wait for ICE gathering so the offer contains all candidates (WHEP is a single request/response).
      await new Promise<void>((res) => {
        if (conn.iceGatheringState === 'complete') return res()
        const t = setTimeout(res, 2500)
        conn.addEventListener('icegatheringstatechange', () => { if (conn.iceGatheringState === 'complete') { clearTimeout(t); res() } })
      })
      const r = await fetch(`/api/ring/live?caseId=${encodeURIComponent(caseId)}`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: conn.localDescription!.sdp })
      if (r.ok === false) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      session.current = r.headers.get('X-Session-Id') || ''
      await conn.setRemoteDescription({ type: 'answer', sdp: await r.text() })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed')
      await stop('error')
    }
  }

  useEffect(() => () => { void stop('idle') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSt('idle') }, [caseId])

  return (
    <div className="rounded-xl bg-black aspect-video relative overflow-hidden">
      <video ref={video} autoPlay muted playsInline className="h-full w-full" />
      {st !== 'live' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-slate-300">
          {st === 'error' && <p className="text-amber-300">Could not show the door: {msg}. Use the Ring app.</p>}
          {st === 'ended' && <p>Video ended (Ring limits each view to 30 to 60 seconds).</p>}
          <button onClick={start} disabled={st === 'connecting'} className="rounded-xl bg-cyan-500 px-5 py-3 font-bold text-black disabled:opacity-50">
            {st === 'connecting' ? 'Connecting…' : st === 'idle' ? '📹 Show the door' : '📹 Watch again'}
          </button>
        </div>
      )}
    </div>
  )
}
