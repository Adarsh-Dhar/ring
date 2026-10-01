import { NextRequest, NextResponse } from 'next/server'
import { RingWebhookSchema } from '@/lib/schemas/webhook'
import { verifyRingSignature } from '@/lib/ring/verify'
import { ingestEvent, setDeviceOnline } from '@/lib/doorbell/store'
import { IS_PROD } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const seen = new Map<string, number>() // request_id -> time. Ring retries failed deliveries; do not alert twice.
const SEEN_MAX = 2000

export async function POST(request: NextRequest) {
  // 1. Verify the signature over the RAW body before doing anything else.
  const raw = await request.text()
  const key = process.env.RING_HMAC_KEY
  const unsignedOk = !IS_PROD && process.env.ALLOW_UNSIGNED_WEBHOOK === '1'
  if (key) {
    if (!verifyRingSignature(key, raw, request.headers.get('x-signature'))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (!unsignedOk) {
    console.error('[WEBHOOK] RING_HMAC_KEY is not set. Rejecting.')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 }) // 5xx: Ring retries, nothing is lost
  }

  // 2. Validate shape.
  let json: unknown
  try { json = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = RingWebhookSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const { meta, data } = parsed.data

  // 3. Only accept events for OUR Ring account, if configured.
  const account = process.env.RING_ACCOUNT_ID
  if (account && meta.account_id && meta.account_id !== account) {
    console.warn('[WEBHOOK] event for another account ignored')
    return NextResponse.json({ status: 'ignored' })
  }

  // 4. Idempotency on request_id.
  if (meta.request_id) {
    if (seen.has(meta.request_id)) return NextResponse.json({ status: 'already_processed' })
    seen.set(meta.request_id, Date.now())
    if (seen.size > SEEN_MAX) for (const k of Array.from(seen.keys()).slice(0, 200)) seen.delete(k)
  }

  if (process.env.LOG_WEBHOOK_BODY === '1') console.log('[WEBHOOK]', raw)

  // 5. Route by the real Ring event types. Must answer within 5 s: everything below is synchronous and fast.
  const type = data.type
  const deviceId = data.attributes.source ?? null
  try {
    if (type === 'device_offline' && deviceId) setDeviceOnline(deviceId, false, 'Ring reported it offline')
    else if (type === 'device_online' && deviceId) setDeviceOnline(deviceId, true, 'Ring reported it online')
    else if (['motion_detected', 'button_press'].includes(type)) {
      const c = ingestEvent({ event_type: type, event_id: data.id, device_id: deviceId, raw: json })
      return NextResponse.json({ status: 'processed', case_id: c?.id })
    }
    // Unknown event types: acknowledge with 200 so Ring doesn't drop them
    return NextResponse.json({ status: 'acknowledged' })
  } catch (e) {
    console.error('[WEBHOOK] error', e)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 }) // 5xx so Ring retries
  }
}
