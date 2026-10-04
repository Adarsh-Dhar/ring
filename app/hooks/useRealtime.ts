/**
 * SSE client hook for realtime state updates
 * Replaces polling with Server-Sent Events
 * Includes heartbeat detection for fail-closed behavior
 */

import { useState, useEffect, useRef, useCallback } from 'react'

export interface ResidentState {
  cases: any[]
  deviceOnline: boolean
  lastHeartbeat: Date | null
  household: any
}

export interface UseRealtimeOptions {
  householdId: string
  token: string
  onHeartbeatLost?: () => void
  onStateChange?: (state: ResidentState) => void
}

export function useRealtime(options: UseRealtimeOptions) {
  const { householdId, token, onHeartbeatLost, onStateChange } = options

  const [state, setState] = useState<ResidentState | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastHeartbeatRef = useRef<number>(Date.now())

  const HEARTBEAT_TIMEOUT = 10000 // 10 seconds without heartbeat = connection lost

  const handleHeartbeatLost = useCallback(() => {
    console.warn('[SSE] Heartbeat lost - connection may be dead')
    setConnected(false)
    setError('Connection lost')
    onHeartbeatLost?.()
  }, [onHeartbeatLost])

  const resetHeartbeatTimer = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current)
    }

    heartbeatTimeoutRef.current = setTimeout(() => {
      handleHeartbeatLost()
    }, HEARTBEAT_TIMEOUT)
  }, [handleHeartbeatLost])

  useEffect(() => {
    // Build SSE URL
    const url = `/api/events?householdId=${householdId}`

    // Create EventSource
    const eventSource = new EventSource(url, {
      withCredentials: true,
    })

    eventSourceRef.current = eventSource

    // Handle connection open
    eventSource.onopen = () => {
      console.log('[SSE] Connected')
      setConnected(true)
      setError(null)
      resetHeartbeatTimer()
    }

    // Handle messages
    eventSource.onmessage = (event) => {
      // Heartbeat
      if (event.data === ': heartbeat') {
        lastHeartbeatRef.current = Date.now()
        resetHeartbeatTimer()
        return
      }

      // State update
      try {
        const data = JSON.parse(event.data)

        if (data.error) {
          console.error('[SSE] Server error:', data.error)
          setError(data.error)
          return
        }

        setState(data)
        onStateChange?.(data)
      } catch (error) {
        console.error('[SSE] Failed to parse message:', error)
      }
    }

    // Handle errors
    eventSource.onerror = (error) => {
      console.error('[SSE] Error:', error)
      setConnected(false)
      setError('Connection error')

      // EventSource automatically reconnects
      // If it doesn't reconnect, heartbeat timeout will trigger
    }

    // Cleanup
    return () => {
      console.log('[SSE] Disconnecting')
      eventSource.close()
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current)
      }
    }
  }, [householdId, onStateChange, resetHeartbeatTimer])

  return {
    state,
    connected,
    error,
  }
}
