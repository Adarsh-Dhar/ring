'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { DoorCase, ExpectedVisit, RecurringVisit, RecurringNow } from '@/lib/doorbell/store'
import type { PublicHelper } from '@/lib/doorbell/config'

export interface DoorbellSnapshot {
  now: number
  me: string | null
  ready: boolean
  emergencyNumber: string
  timeoutSec: number
  offline: boolean
  dbHealthy: boolean
  helpers: PublicHelper[]
  current: DoorCase | null
  history: DoorCase[]
  expected: ExpectedVisit[]
  expectedNow: ExpectedVisit[]
  recurring: (RecurringVisit & { next: number | null })[]
  recurringNow: RecurringNow[]
  timeZone: string
  plannedMode: 'helper' | 'resident' | 'all-helper'
  todayVisits: { id: string; icon: string; label: string; startsAt: number; endsAt: number; done: boolean }[]
  checkin: { doneToday: boolean; dueHour: number }
  quietNow: boolean
  alerts: { degraded: boolean; recentSmsFailures: number; recentPushFailures: number; helpersWithoutPush: string[] } | null
}

/** If no successful response arrives for this long, the screen must stop trusting its last snapshot. */
export const STALE_AFTER_MS = 5000

export function useDoorbell(intervalMs = 1000) {
  const [snap, setSnap] = useState<DoorbellSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const [lastOkAt, setLastOkAt] = useState<number | null>(null)
  const [, tickRender] = useState(0)
  const offsetRef = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/doorbell/state', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
      if (res.status === 401) { setUnauthorized(true); setError('unauthorized'); return }
      if (res.ok === false) throw new Error(`HTTP ${res.status}`) // a 5xx page must never replace the last good data silently
      const data: DoorbellSnapshot = await res.json()
      offsetRef.current = data.now - Date.now()
      setUnauthorized(false)
      setSnap(data)
      setError(null)
      setLastOkAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'offline')
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, intervalMs)
    const r = setInterval(() => tickRender((n) => n + 1), 1000) // re-evaluate staleness even when fetches hang
    const onVis = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', refresh)
    return () => { clearInterval(t); clearInterval(r); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', refresh) }
  }, [refresh, intervalMs])

  const stale = lastOkAt === null || Date.now() - lastOkAt > STALE_AFTER_MS

  const secondsLeft = (deadlineAt: number) =>
    Math.max(0, Math.ceil((deadlineAt - (Date.now() + offsetRef.current)) / 1000))

  return { snap, error, stale, unauthorized, refresh, secondsLeft }
}
