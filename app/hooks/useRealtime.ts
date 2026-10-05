/**
 * SSE client hook for realtime state updates
 * Replaces polling with Server-Sent Events
 * Includes heartbeat detection for fail-closed behavior
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ResidentView } from '@/lib/state/resident-view'

export interface UseRealtimeOptions {
  householdId: string
  token: string
  onHeartbeatLost?: () => void
  onStateChange?: (state: ResidentView) => void
}

export function useRealtime(options: UseRealtimeOptions) {
  const { householdId, token, onHeartbeatLost, onStateChange } = options

  const [state, setState] = useState<ResidentView | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastHeartbeatRef = useRef<number>(Date.now())

  // Store callbacks in refs to avoid re-creating EventSource on every render
  const onHeartbeatLostRef = useRef(onHeartbeatLost)
  const onStateChangeRef = useRef(onStateChange)

  // Update refs when callbacks change
  useEffect(() => {
    onHeartbeatLostRef.current = onHeartbeatLost
  }, [onHeartbeatLost])

  useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  const HEARTBEAT_TIMEOUT = 10000 // 10 seconds without heartbeat = connection lost

  const handleHeartbeatLost = useCallback(() => {
    console.warn('[SSE] Heartbeat lost - connection may be dead')
    setConnected(false)
    setError('Connection lost')
    onHeartbeatLostRef.current?.()
  }, [])

  const resetHeartbeatTimer = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current)
    }

    heartbeatTimeoutRef.current = setTimeout(() => {
      handleHeartbeatLost()
    }, HEARTBEAT_TIMEOUT)
  }, [handleHeartbeatLost])

  useEffect(() => {
    // Build SSE URL - householdId is no longer in query string
    // Server uses session to determine household
    const url = `/api/events`

    // Create EventSource
    const eventSource = new EventSource(url, {
      withCredentials: true,
    })

    eventSourceRef.current = eventSource

    // Start heartbeat timer immediately (before connection opens)
    // This ensures a connection that never opens fails closed
    resetHeartbeatTimer()

    // Handle connection open
    eventSource.onopen = () => {
      console.log('[SSE] Connected')
      setConnected(true)
      setError(null)
      resetHeartbeatTimer()
    }

    // Handle heartbeat events
    eventSource.addEventListener('heartbeat', (event) => {
      lastHeartbeatRef.current = Date.now()
      resetHeartbeatTimer()
    })

    // Handle state events
    eventSource.addEventListener('state', (event) => {
      try {
        const data = JSON.parse(event.data)
        // data.view is the ResidentView object
        setState(data.view)
        onStateChangeRef.current?.(data.view)
      } catch (error) {
        console.error('[SSE] Failed to parse state message:', error)
      }
    })

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
  }, [resetHeartbeatTimer]) // Only depend on resetHeartbeatTimer, not callbacks

  return {
    state,
    connected,
    error,
  }
}
