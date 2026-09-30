import { NextRequest, NextResponse } from 'next/server'
import { broadcastEvent } from '@/lib/sse-broadcast'
import { listDemoClips } from '@/lib/demo'
import { ingestEvent, setOffline, setTimeoutSec, resetAll, getState } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const s = getState()
  return NextResponse.json({
    clips: listDemoClips().map((c) => c.file).sort(),
    offline: s.offline,
    timeoutSec: s.timeoutSec,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  switch (body.action) {
    case 'trigger': {
      const eventType = body.eventType || 'person_detected'
      const ts = Date.now()
      const payload = {
        meta: { version: '1.0', time: new Date(ts).toISOString(), request_id: `sim_${ts}` },
        data: {
          id: `evt_${ts}_${Math.random().toString(36).slice(2, 6)}`,
          type: eventType,
          attributes: {
            source: 'sim-front-door',
            source_type: 'devices',
            timestamp: ts,
            confidence: 0.93,
            demo_clip: body.clip || null,
          },
        },
      }
      const event = {
        event_id: payload.data.id,
        event_type: payload.data.type,
        timestamp: new Date(ts).toISOString(),
        device_id: 'sim-front-door',
        confidence: 0.93,
        bounding_box: null,
        thumbnail_url: null,
        metadata: { simulated: true, request_id: payload.meta.request_id },
        raw: payload,
      }
      broadcastEvent(event)
      const c = ingestEvent(event)
      return NextResponse.json({ ok: true, case: c })
    }
    case 'offline':
      setOffline(!!body.value)
      return NextResponse.json({ ok: true })
    case 'timeout':
      setTimeoutSec(Number(body.value))
      return NextResponse.json({ ok: true })
    case 'reset':
      resetAll()
      return NextResponse.json({ ok: true })
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}
