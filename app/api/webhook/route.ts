import { NextRequest, NextResponse } from 'next/server'
import { parseRingWebhook } from '@/lib/schemas/webhook'
import { ingestEvent } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const processedRequests = new Set<string>()
const MAX_PROCESSED_IDS = 1000

function normalizeRingEvent(body: any) {
  const { meta, data } = body
  return {
    event_id: data.id,
    event_type: data?.type,
    timestamp:
      typeof data.attributes.timestamp === 'number'
        ? new Date(data.attributes.timestamp).toISOString()
        : data.attributes.timestamp || meta.time,
    device_id: data.attributes.source,
    raw: body,
  }
}

function normalizeGenericEvent(body: any) {
  return {
    event_id: body.event_id || body.id || `evt_${Date.now()}`,
    event_type: body.event_type || body.type || body.data?.type || 'unknown',
    timestamp: body.timestamp || new Date().toISOString(),
    device_id: body.device_id || null,
    raw: body,
  }
}

export async function POST(request: NextRequest) {
  try {
    const expected = process.env.RING_WEBHOOK_SECRET
    if (expected && request.headers.get('Authorization') !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    if (process.env.LOG_WEBHOOK_BODY === '1') {
      console.log('[WEBHOOK] body', JSON.stringify(body, null, 2))
    }

    const requestId = body?.meta?.request_id
    if (requestId) {
      if (processedRequests.has(requestId)) {
        return NextResponse.json({ status: 'already_processed', request_id: requestId })
      }
      processedRequests.add(requestId)
      if (processedRequests.size > MAX_PROCESSED_IDS) {
        Array.from(processedRequests).slice(0, 100).forEach((id) => processedRequests.delete(id))
      }
    }

    const event = parseRingWebhook(body).success ? normalizeRingEvent(body) : normalizeGenericEvent(body)
    console.log('[WEBHOOK] type', event.event_type)
    const c = ingestEvent(event)
    return NextResponse.json({ status: 'processed', event_id: event.event_id, case_id: c?.id ?? null })
  } catch (error) {
    console.error('[WEBHOOK] Error:', error)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
