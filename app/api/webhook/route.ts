import { NextRequest, NextResponse } from 'next/server'
import { RingWebhookSchema } from '@/lib/schemas/webhook'
import { verifyRingSignature } from '@/lib/ring/verify'
import { IS_PROD } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import { ingestEvent, setDeviceOnline } from '@/lib/doorbell/store'
import { enqueueJob, isQueueInitialized } from '@/lib/queue'
import { JOB_NAMES } from '@/lib/queue/jobs'
import { checkRateLimit } from '@/lib/ratelimit/redis'

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

  // 3. Guard: reject events with timestamps that are too old (replay attack prevention).
  // Ring's timestamp is in ISO 8601 format with microseconds. We allow a 5-minute window.
  const WEBHOOK_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
  try {
    const eventTime = new Date(meta.time).getTime()
    const now = Date.now()
    if (isNaN(eventTime)) {
      console.warn('[WEBHOOK] Invalid timestamp format:', meta.time)
      return NextResponse.json({ error: 'Invalid timestamp' }, { status: 400 })
    }
    if (now - eventTime > WEBHOOK_TIMESTAMP_WINDOW_MS) {
      console.warn('[WEBHOOK] Timestamp too old:', meta.time, 'age:', now - eventTime, 'ms')
      return NextResponse.json({ error: 'Timestamp too old' }, { status: 400 })
    }
    // Also reject events that are too far in the future (clock skew attack)
    if (eventTime - now > WEBHOOK_TIMESTAMP_WINDOW_MS) {
      console.warn('[WEBHOOK] Timestamp too far in the future:', meta.time, 'offset:', eventTime - now, 'ms')
      return NextResponse.json({ error: 'Timestamp too far in the future' }, { status: 400 })
    }
  } catch (e) {
    console.warn('[WEBHOOK] Failed to parse timestamp:', meta.time, e)
    return NextResponse.json({ error: 'Invalid timestamp' }, { status: 400 })
  }

  // 4. Guard: account_id is required to look up the household.
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

  // Redis rate limiting for webhook events
  const rateLimitResult = await checkRateLimit({
    key: `webhook:${householdId}`,
    limit: 100, // 100 events per minute per household
    window: 60,
  })

  if (!rateLimitResult.allowed) {
    console.warn('[WEBHOOK] Rate limit exceeded for household', householdId)
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

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
    const useQueue = isQueueInitialized()

    // Device online/offline updates — enqueue for async processing, fall back to inline if queue not available
    if (type === 'device_offline' && deviceId) {
      if (useQueue) {
        try {
          await enqueueJob(JOB_NAMES.DEVICE_OFFLINE, {
            householdId,
            deviceId,
            reason: 'Ring reported it offline',
          })
          return NextResponse.json({ status: 'enqueued' })
        } catch (queueError) {
          console.warn('[WEBHOOK] Queue error, processing inline:', queueError)
        }
      }
      await setDeviceOnline(householdId, deviceId, false, 'Ring reported it offline')
      return NextResponse.json({ status: 'processed_inline' })
    }

    if (type === 'device_online' && deviceId) {
      if (useQueue) {
        try {
          await enqueueJob(JOB_NAMES.DEVICE_ONLINE, {
            householdId,
            deviceId,
            reason: 'Ring reported it online',
          })
          return NextResponse.json({ status: 'enqueued' })
        } catch (queueError) {
          console.warn('[WEBHOOK] Queue error, processing inline:', queueError)
        }
      }
      await setDeviceOnline(householdId, deviceId, true, 'Ring reported it online')
      return NextResponse.json({ status: 'processed_inline' })
    }

    // Doorbell/motion events — enqueue for async processing if in TRIGGER_EVENTS
    if (TRIGGER_EVENTS.has(type)) {
      if (useQueue) {
        try {
          await enqueueJob(JOB_NAMES.WEBHOOK_PROCESS, {
            householdId,
            eventType: type,
            eventId: data.id,
            deviceId,
            raw: json,
          })
          return NextResponse.json({ status: 'enqueued' })
        } catch (queueError) {
          console.warn('[WEBHOOK] Queue error, processing inline:', queueError)
        }
      }
      const c = await ingestEvent(householdId, {
        event_type: type,
        event_id: data.id,
        device_id: deviceId,
        raw: json,
      })
      return NextResponse.json({ status: 'processed_inline', case_id: c?.id ?? null })
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
