import { NextRequest, NextResponse } from 'next/server'
import { getAccessToken } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const API_BASE = 'https://api.amazonvision.com'

// Accepts epoch seconds, epoch milliseconds, or an ISO date string
function toMs(v: unknown): number | null {
  if (typeof v === 'number') {
    // If it's less than 1e12, it's probably seconds
    if (v < 1e12) return v * 1000
    // Otherwise assume milliseconds (Ring API returns milliseconds)
    return v
  }
  if (typeof v === 'string' && v) {
    const n = Number(v)
    if (!Number.isNaN(n)) {
      // If it's less than 1e12, it's probably seconds
      if (n < 1e12) return n * 1000
      // Otherwise assume milliseconds
      return n
    }
    const d = Date.parse(v)
    return Number.isNaN(d) ? null : d
  }
  return null
}

/**
 * GET /api/ring/clips?deviceId=...&eventTypes=motion,ding
 * Lists past events for a device (Event History API). Each event's start time
 * is what /api/ring/clip uses to download the matching MP4.
 */
export async function GET(request: NextRequest) {
  try {
    const deviceId =
      request.nextUrl.searchParams.get('deviceId') || process.env.NEXT_PUBLIC_RING_DEVICE_ID
    if (!deviceId) {
      return NextResponse.json({ error: 'deviceId required' }, { status: 400 })
    }

    const url = new URL(`${API_BASE}/v1/history/devices/${deviceId}/events`)
    const eventTypesParam = request.nextUrl.searchParams.get('eventTypes')
    if (eventTypesParam) url.searchParams.set('event_types', eventTypesParam)
    // Don't set default event types - let's see what types are available

    const token = await getAccessToken()
    console.log('Ring API token obtained, length:', token.length)
    console.log('Requesting Ring API:', url.toString())
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    console.log('Ring API response status:', res.status)
    if (!res.ok) {
      const text = await res.text()
      console.log('Ring API error response:', text)
      return NextResponse.json(
        { error: `Event history failed: ${res.status} - ${text}` },
        { status: res.status }
      )
    }

    const json = await res.json()
    const events: any[] = Array.isArray(json.data) ? json.data : []

    // Reduce verbose logging - only log event types summary
    const foundEventTypes = new Set(events.map((ev) => ev.attributes?.event_type))
    console.log('Event types found:', Array.from(foundEventTypes).join(', '))

    const clips = events
      .map((ev) => {
        const a = ev.attributes ?? {}
        const startMs = toMs(a.start ?? a.started_at)
        const endMs = toMs(a.end ?? a.ended_at)
        const eventType = String(a.event_type ?? 'unknown')
        // Downloadable event types according to Ring API documentation
        const downloadableEventTypes = ['motion', 'ding', 'doorbell_motion', 'doorbell_motion_detected']
        return {
          id: String(ev.id ?? `${a.event_type}_${a.start}`),
          eventId: ev.id, // Include the actual event ID
          eventType,
          startMs,
          endMs,
          downloadable: downloadableEventTypes.includes(eventType),
        }
      })
      .filter((c) => c.startMs !== null)
      .sort((a, b) => (b.startMs as number) - (a.startMs as number))

    // debugFirst = the first raw event, so you can check the real response shape
    return NextResponse.json({ clips, total: events.length, debugFirst: events[0] ?? null })
  } catch (err) {
    console.error('clips list error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list clips' },
      { status: 500 }
    )
  }
}
