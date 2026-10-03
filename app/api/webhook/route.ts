// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { RingWebhookSchema } from '@/lib/schemas/webhook'
import { verifyRingSignature } from '@/lib/ring/verify'
import { ingestEvent, setDeviceOnline } from '@/lib/doorbell/store'
import { IS_PROD } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // 1. Verify the signature over the RAW body before doing anything else.
  const raw = await request.text()
  const key = process.env.RING_HMAC_KEY
  const unsignedOk = !IS_PROD && process.env.ALLOW_UNSIGNED_WEBHOOK === '1'
  if (key) {
    if (!verifyRingSignature(key, raw, request.headers.get('x-signature'))) {
      console.error('[WEBHOOK] Signature verification failed. Key exists but verification returned false.')
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

  // 3. Look up household by Ring account ID
  const db = getDb()
  const connection = await db.ringConnection.findUnique({
    where: { ringAccountId: meta.account_id },
    include: { household: true }
  })

  if (!connection || connection.status !== 'linked' || !connection.householdId) {
    console.warn('[WEBHOOK] No linked household for account', meta.account_id)
    return NextResponse.json({ status: 'ignored' })
  }

  const householdId = connection.householdId

  // 4. Idempotency on request_id using WebhookEvent table
  if (meta.request_id) {
    const existing = await db.webhookEvent.findUnique({
      where: { requestId: meta.request_id }
    })
    if (existing) {
      return NextResponse.json({ status: 'already_processed' })
    }
    await db.webhookEvent.create({
      data: {
        requestId: meta.request_id,
        householdId,
      }
    })
  }

  if (process.env.LOG_WEBHOOK_BODY === '1') console.log('[WEBHOOK]', raw)

  // 5. Route by the real Ring event types. Must answer within 5 s: everything below is synchronous and fast.
  const type = data.type
  const deviceId = data.attributes.source ?? null
  try {
    if (type === 'device_offline' && deviceId) await setDeviceOnline(householdId, deviceId, false, 'Ring reported it offline')
    else if (type === 'device_online' && deviceId) await setDeviceOnline(householdId, deviceId, true, 'Ring reported it online')
    else if (['motion_detected', 'button_press'].includes(type)) {
      const c = await ingestEvent(householdId, { event_type: type, event_id: data.id, device_id: deviceId, raw: json })
      return NextResponse.json({ status: 'processed', case_id: c?.id })
    }
    // Unknown event types: acknowledge with 200 so Ring doesn't drop them
    return NextResponse.json({ status: 'acknowledged' })
  } catch (e) {
    console.error('[WEBHOOK] error', e)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 }) // 5xx so Ring retries
  }
}
