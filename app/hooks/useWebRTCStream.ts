'use client'

import { useState, useRef, useCallback, RefObject } from 'react'

interface UseWebRTCStreamOptions {
  videoRef: RefObject<HTMLVideoElement>
  deviceId?: string
}

interface UseWebRTCStreamReturn {
  streamActive: boolean
  streamError: string | null
  startStream: () => Promise<void>
  stopStream: () => Promise<void>
}

/**
 * Manages WebRTC connection to Ring camera stream.
 * Handles ICE gathering, SDP negotiation, and cleanup.
 */
export function useWebRTCStream({ videoRef, deviceId }: UseWebRTCStreamOptions): UseWebRTCStreamReturn {
  const [streamActive, setStreamActive] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sessionUrlRef = useRef<string | null>(null)

  const startStream = useCallback(async () => {
    setStreamError(null)
    try {
      // Demo mode: loop the newest sample video instead of opening a WebRTC session
      const cfg = await fetch('/api/ring/config').then((r) => r.json()).catch(() => ({}))
      if (cfg.demo) {
        const list = await fetch('/api/ring/clips').then((r) => r.json())
        const first = list.clips?.[0]
        if (!first) throw new Error('No sample videos found. Add .mp4 files to public/samples/')
        const v = videoRef.current
        if (!v) return
        v.srcObject = null
        v.src = `/samples/${encodeURIComponent(first.file)}`
        v.loop = true
        v.muted = true
        await v.play().catch(() => {})
        setStreamActive(true)
        return
      }
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      })
      pcRef.current = pc

      pc.addTransceiver('audio', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'recvonly' })

      pc.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) {
          videoRef.current.srcObject = e.streams[0]
          setStreamActive(true)
        }
      }

      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
      await pc.setLocalDescription(offer)

      // Wait for ICE gathering
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve()
        const timeout = setTimeout(() => resolve(), 3000)
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout)
            resolve()
          }
        }
      })

      const res = await fetch('/api/ring/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdpOffer: pc.localDescription!.sdp, deviceId }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Stream start failed')
      }

      const { sdpAnswer, sessionUrl } = await res.json()
      sessionUrlRef.current = sessionUrl
      await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream failed'
      console.error('Stream error:', err)
      setStreamError(message)
      setStreamActive(false)
    }
  }, [videoRef, deviceId])

  const stopStream = useCallback(async () => {
    pcRef.current?.close()
    pcRef.current = null
    if (sessionUrlRef.current) {
      await fetch('/api/ring/stream', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionUrl: sessionUrlRef.current }),
      }).catch(() => {})
      sessionUrlRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.pause()
      videoRef.current.removeAttribute('src')
      videoRef.current.load()
    }
    setStreamActive(false)
    setStreamError(null)
  }, [videoRef])

  return { streamActive, streamError, startStream, stopStream }
}
