'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { DoorCase, ExpectedVisit } from '@/lib/doorbell/store'
import type { Helper } from '@/lib/doorbell/config'

export interface DoorbellSnapshot {
  now: number
  timeoutSec: number
  offline: boolean
  helpers: Helper[]
  current: DoorCase | null
  history: DoorCase[]
  expected: ExpectedVisit[]
  expectedNow: ExpectedVisit[]
  checkin: { doneToday: boolean; dueHour: number }
}

export function useDoorbell(intervalMs = 1000) {
  const [snap, setSnap] = useState<DoorbellSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const offsetRef = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/doorbell/state', { cache: 'no-store' })
      const data: DoorbellSnapshot = await res.json()
      offsetRef.current = data.now - Date.now()
      setSnap(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'offline')
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, intervalMs)
    return () => clearInterval(t)
  }, [refresh, intervalMs])

  const secondsLeft = (deadlineAt: number) =>
    Math.max(0, Math.ceil((deadlineAt - (Date.now() + offsetRef.current)) / 1000))

  return { snap, error, refresh, secondsLeft }
}
