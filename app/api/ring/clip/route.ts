import { NextRequest, NextResponse } from 'next/server'
import { getAccessToken } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const API_BASE = 'https://api.amazonvision.com'
const RING_API_BASE = 'https://api.ring.com'

/**
 * POST /api/ring/clip   body: { deviceId, timestamp (epoch ms), duration (ms), audio?, eventId?, eventType? }
 * Proxies the Media Clips API and streams the MP4 back to the browser.
 * For on_demand events, uses the alternative Ring API VOD/download method.
 * Ring only returns footage that was already recorded, so quiet periods return an error.
 * Note: Ring API expects timestamp in seconds and duration in seconds.
 */
export async function POST(request: NextRequest) {
  try {
    const { deviceId, timestamp, duration, audio, eventId, eventType } = await request.json()
    const id = deviceId || process.env.NEXT_PUBLIC_RING_DEVICE_ID
    if (!id || !timestamp || !duration) {
      return NextResponse.json({ error: 'deviceId, timestamp and duration required' }, { status: 400 })
    }

    const token = await getAccessToken()
    // Ring API expects timestamp in seconds, but we receive it in milliseconds
    const timestampSeconds = Math.floor(timestamp / 1000)
    const durationSeconds = Math.min(Math.floor(duration / 1000), 900)

    console.log('Clip download request:', {
      deviceId: id,
      eventId,
      eventType,
      timestampMs: timestamp,
      timestampSeconds,
      timestampDate: new Date(timestamp).toISOString(),
      durationMs: duration,
      durationSeconds,
      currentDate: new Date().toISOString(),
    })

    // Try using event ID if provided (works for both on_demand and automatic events)
    if (eventId) {
      console.log(`Trying with event ID: ${eventId}`)
      const res = await fetch(`${API_BASE}/v1/devices/${id}/media/video/download`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          duration: durationSeconds,
          audio_options: { audio_enabled: audio !== false },
        }),
        redirect: 'follow',
      })

      if (res.ok) {
        console.log(`Success with event ID: ${eventId}`)
        const headers = new Headers({ 'Content-Type': res.headers.get('content-type') || 'video/mp4' })
        for (const h of ['x-media-timestamp', 'x-media-length']) {
          const v = res.headers.get(h)
          if (v) headers.set(h, v)
        }
        return new Response(res.body, { status: res.status, headers })
      }

      const error = await res.text()
      console.log(`Failed with event ID ${eventId}: ${res.status} - ${error.slice(0, 200)}`)
    }

    // Try Ring clients_api with current token (might work despite research)
    if (eventId) {
      console.log(`Trying Ring clients_api with current token`)
      try {
        const ringEndpoints = [
          `${RING_API_BASE}/clients_api/dings/${eventId}/share/download?disable_redirect=true`,
          `${RING_API_BASE}/clients_api/dings/${eventId}/recording`,
        ]

        for (const endpoint of ringEndpoints) {
          console.log(`Trying Ring endpoint: ${endpoint.split('?')[0]}`)
          
          const res = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          })

          if (res.ok) {
            const contentType = res.headers.get('content-type')
            console.log(`Success with Ring endpoint! Content-Type: ${contentType}`)
            
            if (contentType && contentType.includes('application/json')) {
              const data = await res.json()
              if (data.url) {
                const videoRes = await fetch(data.url, { cache: 'no-store' })
                if (videoRes.ok) {
                  return new NextResponse(videoRes.body, {
                    headers: {
                      'Content-Type': videoRes.headers.get('content-type') || 'video/mp4',
                      'Content-Disposition': `attachment; filename="clip-${eventId.split('.').pop()}.mp4"`,
                    },
                  })
                }
              }
            } else {
              return new NextResponse(res.body, {
                headers: {
                  'Content-Type': contentType || 'video/mp4',
                  'Content-Disposition': `attachment; filename="clip-${eventId.split('.').pop()}.mp4"`,
                },
              })
            }
          }

          const errorText = await res.text()
          console.log(`Ring endpoint failed: ${res.status} - ${errorText.substring(0, 100)}`)
        }
      } catch (err) {
        console.log('Ring clients_api error:', err)
      }
    }

    // Try different Amazon Vision API request formats
    if (eventId) {
      console.log(`Trying Amazon Vision with different request formats`)
      
      const alternativeFormats = [
        {
          body: {
            event: eventId,
            duration: durationSeconds,
            audio_options: { audio_enabled: audio !== false },
          }
        },
        {
          body: {
            eventId: eventId,
            duration: durationSeconds,
            audio_options: { audio_enabled: audio !== false },
          }
        },
        {
          body: {
            event_id: eventId,
            timestamp: timestampSeconds,
            duration: durationSeconds,
            audio_options: { audio_enabled: audio !== false },
          }
        },
      ]

      for (const format of alternativeFormats) {
        console.log(`Trying format: ${Object.keys(format.body).join(', ')}`)
        
        const res = await fetch(`${API_BASE}/v1/devices/${id}/media/video/download`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(format.body),
          redirect: 'follow',
        })

        if (res.ok) {
          console.log(`Success with alternative format!`)
          const headers = new Headers({
            'Content-Type': res.headers.get('content-type') || 'video/mp4',
            'Content-Disposition': `attachment; filename="clip-${eventId.split('.').pop()}.mp4"`,
          })
          return new Response(res.body, { status: res.status, headers })
        }

        const errorText = await res.text()
        console.log(`Format failed: ${res.status} - ${errorText.substring(0, 100)}`)
      }
    }

    // Try different timestamp approaches:
    const strategies = [
      timestampSeconds,
      Math.floor(timestampSeconds / 5) * 5, // Round to nearest 5 seconds
      timestampSeconds - 2, // 2 seconds before event
      timestampSeconds + 1, // 1 second after event
    ]

    let lastError = null
    for (const ts of strategies) {
      console.log(`Trying timestamp: ${ts} (${new Date(ts * 1000).toISOString()})`)

      const res = await fetch(`${API_BASE}/v1/devices/${id}/media/video/download`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: ts,
          duration: durationSeconds, // API expects seconds, max 15 minutes
          audio_options: { audio_enabled: audio !== false },
        }),
        redirect: 'follow',
      })

      if (res.ok) {
        console.log(`Success with timestamp: ${ts}`)
        const headers = new Headers({ 'Content-Type': res.headers.get('content-type') || 'video/mp4' })
        for (const h of ['x-media-timestamp', 'x-media-length']) {
          const v = res.headers.get(h)
          if (v) headers.set(h, v)
        }
        return new Response(res.body, { status: res.status, headers })
      }

      lastError = await res.text()
      console.log(`Failed with timestamp ${ts}: ${res.status} - ${lastError.slice(0, 200)}`)
    }

    // All strategies failed
    return NextResponse.json(
      { error: `Clip download failed. Tried event ID and ${strategies.length} timestamp strategies. Last error: ${lastError?.slice(0, 300)}` },
      { status: 403 }
    )
  } catch (err) {
    console.error('clip download error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Clip download failed' },
      { status: 500 }
    )
  }
}
