'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface RingClip {
  id: string
  eventType: string
  startMs: number
  endMs: number | null
  eventId?: string
  downloadable?: boolean
}

const LABEL_KEY = 'ring-clip-labels'

function readLabels(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LABEL_KEY) || '{}')
  } catch {
    return {}
  }
}
function writeLabels(l: Record<string, number>) {
  try {
    localStorage.setItem(LABEL_KEY, JSON.stringify(l))
  } catch {}
}

/** Lists a camera's recorded events, lets you label each with a number, and plays them by number. */
export function useRecordedClips(deviceId: string | null) {
  const [clips, setClips] = useState<RingClip[]>([])
  const [labels, setLabels] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [clipLoading, setClipLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(15) // length of each downloaded clip
  const [current, setCurrent] = useState<{ clip: RingClip; url: string } | null>(null)
  const cache = useRef(new Map<string, string>())

  useEffect(() => {
    const urls = cache.current
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  const load = useCallback(async () => {
    if (!deviceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ring/clips?deviceId=${encodeURIComponent(deviceId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load videos')
      const list: RingClip[] = data.clips

      // Stable numbering: unlabeled videos get the next free number, oldest first,
      // so a video keeps its number when new ones arrive.
      const saved = readLabels()
      let next = Math.max(0, ...Object.values(saved)) + 1
      for (const c of [...list].sort((a, b) => a.startMs - b.startMs)) {
        if (saved[c.id] == null) saved[c.id] = next++
      }
      writeLabels(saved)
      setLabels(saved)
      setClips(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load videos')
    } finally {
      setLoading(false)
    }
  }, [deviceId])

  const setLabel = useCallback((id: string, n: number) => {
    setLabels((prev) => {
      const next = { ...prev, [id]: n }
      writeLabels(next)
      return next
    })
  }, [])

  const play = useCallback(
    async (clip: RingClip) => {
      if (!deviceId) return
      setError(null)
      setClipLoading(true)
      try {
        const key = `${clip.id}:${seconds}`
        let url = cache.current.get(key)
        if (!url) {
          const body = {
            deviceId,
            timestamp: clip.startMs,
            duration: seconds * 1000,
            eventId: clip.eventId, // Try using event ID first
            eventType: clip.eventType, // Pass event type for VOD method
          }
          console.log('Playing clip:', {
            clipId: clip.id,
            eventId: clip.eventId,
            eventType: clip.eventType,
            startMs: clip.startMs,
            startDate: new Date(clip.startMs).toISOString(),
            duration: seconds,
            body
          })
          const res = await fetch('/api/ring/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `Download failed (${res.status})`)
          }
          url = URL.createObjectURL(await res.blob())
          cache.current.set(key, url)
        }
        setCurrent({ clip, url })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not play this video')
      } finally {
        setClipLoading(false)
      }
    },
    [deviceId, seconds]
  )

  const clipByLabel = useCallback(
    (n: number) => clips.find((c) => labels[c.id] === n),
    [clips, labels]
  )

  return { clips, labels, loading, clipLoading, error, setError, seconds, setSeconds, current, load, setLabel, play, clipByLabel }
}
