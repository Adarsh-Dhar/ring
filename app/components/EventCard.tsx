'use client'

import { memo } from 'react'

export interface DetectionEvent {
  event_id: string
  event_type: string
  timestamp: string
  confidence: number | null
  bounding_box: { x: number; y: number; width: number; height: number } | null
  thumbnail_url: string | null
  metadata: Record<string, unknown>
  raw: unknown
}

interface EventCardProps {
  event: DetectionEvent
  expanded: boolean
  onToggle: () => void
}

/** Single event card - memoized to prevent unnecessary re-renders */
export const EventCard = memo(function EventCard({ event, expanded, onToggle }: EventCardProps) {
  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'person_detected': return 'bg-cyan-400'
      case 'ai_analysis': return 'bg-purple-400'
      case 'wander_alert': return 'bg-red-400'
      default: return 'bg-green-400'
    }
  }

  return (
    <div className="card cursor-pointer hover:border-slate-500 transition" onClick={onToggle}>
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full shrink-0 ${getEventColor(event.event_type)}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white">{event.event_type}</span>
            {event.confidence && (
              <span className="text-xs text-slate-400">{(event.confidence * 100).toFixed(0)}%</span>
            )}
          </div>
          <p className="text-xs text-slate-500">{new Date(event.timestamp).toLocaleTimeString()}</p>
        </div>
        {event.thumbnail_url && (
          <img src={event.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover" />
        )}
      </div>
      {expanded && (
        <pre className="mt-3 p-2 bg-dash-dark rounded text-xs text-cyan-300 overflow-x-auto max-h-48 font-mono">
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      )}
    </div>
  )
})
