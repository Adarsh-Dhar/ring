import { useState, useEffect, useRef, useCallback } from 'react'
import { captureBurst } from '@/lib/ring/camera'

interface SceneAnalysis {
  narration: string
  activity: string
  people_count: number
  threat_level: 'low' | 'medium' | 'high'
  reason: string
}

interface UseSceneDescriptionProps {
  videoRef: React.RefObject<HTMLVideoElement>
  active: boolean
  deviceId?: string
}

export function useSceneDescription({ videoRef, active, deviceId }: UseSceneDescriptionProps) {
  const [latest, setLatest] = useState<SceneAnalysis | null>(null)
  const [history, setHistory] = useState<SceneAnalysis[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const analyzeScene = useCallback(async () => {
    if (!enabled || !videoRef.current || !deviceId) return

    try {
      setAnalyzing(true)
      setError(null)

      // Check if video is ready
      const video = videoRef.current
      if (video.readyState < 2 || video.paused || video.ended) {
        console.log('Video not ready for capture, skipping this cycle')
        return
      }

      // Capture burst of frames
      const frames = await captureBurst(video, 4, 700)
      
      if (frames.length === 0) {
        throw new Error('Failed to capture frames')
      }

      // Send to analysis API with retry logic
      let response: Response
      let retries = 0
      const maxRetries = 2
      
      while (retries <= maxRetries) {
        try {
          response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: frames })
          })
          
          if (response.ok) break
          
          // If not OK, check if we should retry
          if (retries < maxRetries && response.status >= 500) {
            retries++
            await new Promise(r => setTimeout(r, 2000 * retries)) // Exponential backoff
            continue
          }
          
          break
        } catch (networkError) {
          if (retries < maxRetries) {
            retries++
            await new Promise(r => setTimeout(r, 2000 * retries))
            continue
          }
          throw networkError
        }
      }

      if (!response.ok) {
        const errorData = await response.json()
        
        // Handle specific error types with user-friendly messages
        if (errorData.error === 'rate_limit') {
          throw new Error('Rate limit exceeded. Analysis will retry automatically.')
        }
        if (errorData.error === 'service_unavailable') {
          throw new Error('AI service is currently busy. Analysis will retry automatically.')
        }
        if (errorData.error === 'network_error') {
          throw new Error('Network timeout. Analysis will retry automatically.')
        }
        
        throw new Error(errorData.details || 'Analysis failed')
      }

      const result: SceneAnalysis = await response.json()

      // Update latest and history
      setLatest(result)
      setHistory(prev => {
        const newHistory = [result, ...prev].slice(0, 20)
        return newHistory
      })
      
      // Reset retry count on success
      setRetryCount(0)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Analysis failed'
      setError(errorMessage)
      console.error('Scene analysis error:', err)
      
      // Increment retry count for service issues
      if (errorMessage.includes('busy') || errorMessage.includes('timeout') || errorMessage.includes('rate limit')) {
        setRetryCount(prev => prev + 1)
      }
    } finally {
      setAnalyzing(false)
    }
  }, [videoRef, deviceId, enabled])

  // Start/stop analysis loop based on stream state
  useEffect(() => {
    if (active && enabled) {
      // Initial analysis after a short delay
      const initialDelay = setTimeout(() => {
        analyzeScene()
      }, 5000)

      // Dynamic interval based on retry count - back off when service is having issues
      const getInterval = () => {
        if (retryCount > 3) return 60000 // 1 minute if many retries
        if (retryCount > 1) return 45000 // 45 seconds if some retries
        return 30000 // 30 seconds normal
      }

      // Set up recurring analysis with dynamic interval
      const scheduleNextAnalysis = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(() => {
          analyzeScene()
          scheduleNextAnalysis()
        }, getInterval())
      }

      scheduleNextAnalysis()

      return () => {
        clearTimeout(initialDelay)
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
      }
    } else {
      // Clear timeout when not active
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [active, enabled, analyzeScene, retryCount])

  return {
    latest,
    history,
    analyzing,
    error,
    enabled,
    setEnabled,
    retryCount
  }
}
