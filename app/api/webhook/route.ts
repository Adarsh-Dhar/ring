import { NextRequest, NextResponse } from 'next/server'
import { RingWebhookSchema } from '@/lib/schemas/webhook'
import { verifyRingSignature } from '@/lib/ring/verify'
import { ingestEvent, setDeviceOnline } from '@/lib/doorbell/store'
import { IS_PROD } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Which event types should open a doorbell case.
// Controlled by RING_TRIGGER_EVENTS (comma-separated). Default: button_press only.
const TRIGGER_EVENTS = new Set(
  (process.env.RING_TRIGGER_EVENTS ?? 'button_press')
    .split(',').map(s => s.trim()).filter(Boolean)
)

export async function POST(request: NextRequest) {
  // 1. Verify the HMAC signature over the RAW body before doing anything else.
  const raw        = await request.text()
  const key        = process.env.RING_HMAC_KEY
  const unsignedOk = !IS_PROD && process.env.ALLOW_UNSIGNED_WEBHOOK === '1'

  if (key) {
    if (!verifyRingSignature(key, raw, request.headers.get('x-signature'))) {
      console.error('[WEBHOOK] Signature verification failed — key exists but HMAC does not match.')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (!unsignedOk) {
    console.error('[WEBHOOK] RING_HMAC_KEY is not set — rejecting unsigned webhook.')
    // 503 so Ring retries when the server is misconfigured temporarily
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // 2. Parse and validate the payload shape.
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = RingWebhookSchema.safeParse(json)
  if (!parsed.success) {
    console.warn('[WEBHOOK] Unexpected payload shape:', parsed.error.issues)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { meta, data } = parsed.data

  // 3. Guard: account_id is required to look up the household.
  if (!meta.account_id) {
    console.warn('[WEBHOOK] Missing meta.account_id — cannot route event, ignoring.')
    return NextResponse.json({ status: 'ignored' })
  }

  // 4. Look up household by Ring account ID.
  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[WEBHOOK] Failed to get database connection', e)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  let connection: any
  try {
    connection = await db.ringConnection.findUnique({
      where:   { ringAccountId: meta.account_id },
      include: { household: true },
    })
  } catch (e) {
    console.error('[WEBHOOK] DB lookup failed for account', meta.account_id, e)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if (!connection || connection.status !== 'linked' || !connection.householdId) {
    console.warn('[WEBHOOK] No linked household for Ring account', meta.account_id, '— ignoring event.')
    return NextResponse.json({ status: 'ignored' })
  }

  const householdId = connection.householdId

  // 5. Idempotency — skip events we have already processed.
  if (meta.request_id) {
    try {
      const existing = await db.webhookEvent.findUnique({
        where: { requestId: meta.request_id },
      })
      if (existing) {
        return NextResponse.json({ status: 'already_processed' })
      }
      await db.webhookEvent.create({
        data: { requestId: meta.request_id, householdId },
      })
    } catch (e) {
      // If the create failed due to a race (duplicate), treat as already processed
      console.warn('[WEBHOOK] Idempotency check failed (possible race):', e)
      return NextResponse.json({ status: 'already_processed' })
    }
  }

  if (process.env.LOG_WEBHOOK_BODY === '1') {
    console.log('[WEBHOOK] Processing event', data.type, 'for household', householdId)
  }

  // 6. Route by event type. Must respond within 5 s — everything is fast.
  const type     = data.type
  const deviceId = data.attributes?.source ?? null

  try {
    // Device online/offline updates — always processed regardless of TRIGGER_EVENTS
    if (type === 'device_offline' && deviceId) {
      await setDeviceOnline(householdId, deviceId, false, 'Ring reported it offline')
      return NextResponse.json({ status: 'processed' })
    }

    if (type === 'device_online' && deviceId) {
      await setDeviceOnline(householdId, deviceId, true, 'Ring reported it online')
      return NextResponse.json({ status: 'processed' })
    }

    // Doorbell/motion events — only create a case if the event type is in TRIGGER_EVENTS
    if (TRIGGER_EVENTS.has(type)) {
      const c = await ingestEvent(householdId, {
        event_type: type,
        event_id:   data.id,
        device_id:  deviceId,
        raw:        json,
      })
      return NextResponse.json({ status: 'processed', case_id: c?.id ?? null })
    }

    // Known but non-triggering event (e.g. motion_detected when only button_press is configured)
    console.log(`[WEBHOOK] Event "${type}" is not in RING_TRIGGER_EVENTS — acknowledging without action.`)
    return NextResponse.json({ status: 'acknowledged', reason: `"${type}" not in trigger list` })
  } catch (e) {
    console.error('[WEBHOOK] Error processing event', type, e)
    // Return 500 so Ring retries
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
