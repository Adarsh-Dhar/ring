'use client'

import React, { useEffect, useRef, useState } from 'react'

type St = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

/**
 * Live Ring video over WebRTC/WHEP. The SDP offer goes through OUR server (/api/ring/live),
 * which adds the Ring token. Ring ends a session after 30 s (battery) or 60 s (wired). Video only.
 *
 * For simulated cases (deviceId starting with "sim-"), renders a looping sample clip from
 * /sim/videos/ instead of attempting a real WebRTC connection.
 */
export default function LiveView({ caseId, deviceId }: { caseId: string; deviceId?: string | null }) {
  const isSim = !!deviceId?.startsWith('sim-')

  // ── Simulated video path ────────────────────────────────────────────────────
  // Pick a clip based on the device name so different "cameras" can show different clips.
  // Source chain (tried in order):
  //   1. /api/sim/videos/<device> (uploaded video for this household)
  //   2. /sim/videos/<suffix>.mp4 (public folder, device-specific)
  //   3. /sim/videos/default.mp4 (public folder, fallback)
  function simVideoSources(id: string): string[] {
    const suffix = id.replace(/^sim-/, '')
    return [
      `/api/sim/videos/${id}`,
      `/sim/videos/${suffix}.mp4`,
      '/sim/videos/default.mp4',
    ]
  }

  if (isSim) {
    return (
      <SimVideo
        sources={simVideoSources(deviceId!)}
        label={deviceId!}
      />
    )
  }

  return <RealLiveView caseId={caseId} />
}

// ── Sim video component ────────────────────────────────────────────────────────

function SimVideo({ sources, label }: { sources: string[]; label: string }) {
  const [srcIndex, setSrcIndex] = useState(0)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUploadedClip, setHasUploadedClip] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  const currentSrc = sources[srcIndex]
  const uploadedClipUrl = sources[0] // First source is the uploaded clip

  // Check if uploaded clip exists
  React.useEffect(() => {
    const checkUploadedClip = async () => {
      setLoading(true)
      try {
        const url = new URL(uploadedClipUrl, window.location.origin)
        url.searchParams.set('device', label)
        const response = await fetch(url.toString())
        const data = await response.json()
        setHasUploadedClip(data.exists === true)
      } catch (e) {
        console.error('[SimVideo] Failed to check uploaded clip:', e)
        setHasUploadedClip(false)
      } finally {
        setLoading(false)
      }
    }
    checkUploadedClip()
  }, [label, uploadedClipUrl])

  const handleError = () => {
    console.warn(`[SimVideo] Failed to load source ${srcIndex}: ${currentSrc}`)
    
    // If uploaded clip exists and fails, show error instead of falling back
    if (srcIndex === 0 && hasUploadedClip === true) {
      setError('Failed to play uploaded video')
      return
    }
    
    // Otherwise, try next source
    if (srcIndex < sources.length - 1) {
      setSrcIndex(srcIndex + 1)
      setError(null)
    } else {
      setMissing(true)
      setError('No video available')
    }
  }

  const handleLoad = () => {
    setError(null)
  }

  // Reset when label changes (device changed)
  React.useEffect(() => {
    setSrcIndex(0)
    setMissing(false)
    setError(null)
    setHasUploadedClip(null)
  }, [label])

  if (loading) {
    return (
      <div className="rounded-xl bg-slate-800 aspect-video flex items-center justify-center text-slate-400 text-sm">
        Loading video…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl bg-slate-800 aspect-video flex flex-col items-center justify-center gap-2 text-slate-400 text-sm text-center px-6">
        <p className="text-2xl">⚠️</p>
        <p>{error}</p>
        <p className="text-xs text-slate-500">Device: {label}</p>
      </div>
    )
  }

  if (missing) {
    return (
      <div className="rounded-xl bg-slate-800 aspect-video flex flex-col items-center justify-center gap-2 text-slate-400 text-sm text-center px-6">
        <p className="text-2xl">🎬</p>
        <p>No sample video found.</p>
        <p className="text-xs">
          Place an MP4 in <code className="bg-slate-700 rounded px-1">public/sim/videos/default.mp4</code>
        </p>
        <p className="text-xs text-slate-500">Device: {label}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-black aspect-video relative overflow-hidden">
      <video
        key={currentSrc}
        src={currentSrc}
        autoPlay
        loop
        muted
        playsInline
        onError={handleError}
        onLoadStart={handleLoad}
        className="h-full w-full object-cover"
      />
      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-slate-300">
        🎬 Sim · {label}
      </div>
    </div>
  )
}

// ── Real WHEP live view ────────────────────────────────────────────────────────

function RealLiveView({ caseId }: { caseId: string }) {
  const video   = useRef<HTMLVideoElement>(null)
  const pc      = useRef<RTCPeerConnection | null>(null)
  const session = useRef('')
  const [st,  setSt]  = useState<St>('idle')
  const [msg, setMsg] = useState('')

  const stop = async (next: St = 'ended') => {
    pc.current?.close()
    pc.current = null
    if (session.current) {
      fetch('/api/ring/live', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, sessionId: session.current }),
      }).catch(() => {})
      session.current = ''
    }
    setSt(next)
  }

  const start = async () => {
    setSt('connecting'); setMsg('')
    try {
      const conn = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pc.current = conn
      conn.addTransceiver('video', { direction: 'recvonly' })
      conn.ontrack = (e) => {
        if (video.current) video.current.srcObject = e.streams[0] ?? new MediaStream([e.track])
      }
      conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'connected') setSt('live')
        if (['failed', 'closed', 'disconnected'].includes(conn.connectionState)) {
          setSt(s => (s === 'live' || s === 'connecting' ? 'ended' : s))
        }
      }
      await conn.setLocalDescription(await conn.createOffer())
      await new Promise<void>(res => {
        if (conn.iceGatheringState === 'complete') return res()
        const t = setTimeout(res, 2500)
        conn.addEventListener('icegatheringstatechange', () => {
          if (conn.iceGatheringState === 'complete') { clearTimeout(t); res() }
        })
      })
      const r = await fetch(`/api/ring/live?caseId=${encodeURIComponent(caseId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: conn.localDescription!.sdp,
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      session.current = r.headers.get('X-Session-Id') || ''
      await conn.setRemoteDescription({ type: 'answer', sdp: await r.text() })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed')
      await stop('error')
    }
  }

  useEffect(() => () => { void stop('idle') }, [])          // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSt('idle') }, [caseId])

  return (
    <div className="rounded-xl bg-black aspect-video relative overflow-hidden">
      <video ref={video} autoPlay muted playsInline className="h-full w-full" />
      {st !== 'live' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-slate-300">
          {st === 'error'  && <p className="text-amber-300">Could not show the door: {msg}. Use the Ring app.</p>}
          {st === 'ended'  && <p>Video ended (Ring limits each view to 30–60 seconds).</p>}
          <button
            onClick={start}
            disabled={st === 'connecting'}
            className="rounded-xl bg-cyan-500 px-5 py-3 font-bold text-black disabled:opacity-50"
          >
            {st === 'connecting' ? 'Connecting…' : st === 'idle' ? '📹 Show the door' : '📹 Watch again'}
          </button>
        </div>
      )}
    </div>
  )
}
