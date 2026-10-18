'use client'
import { useCallback, useEffect, useState } from 'react'

export interface DashboardData {
  ringStatus: string
  pendingAlerts: number
  pendingCases: Array<{
    id: string; createdAt: string; eventType: string; kind: string
    deadlineAt: string; helperIndex: number
    riskLevel?: string | null; interrogationState?: string | null
  }>
  scheduledVisits: number
  activePasses: number
  googleCalendarConnected: boolean
}

export function useDashboardData(workspaceId: string) {
  const [data, setData] = useState<DashboardData | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/dashboard`)
      if (res.ok) setData(await res.json())
    } catch (e) {
      console.error('Failed to load dashboard data', e)
    }
  }, [workspaceId])
  useEffect(() => { load() }, [load])
  return { data, reload: load }
}
