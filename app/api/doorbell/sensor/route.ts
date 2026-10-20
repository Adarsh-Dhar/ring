/**
 * Sensor event endpoint — receives knock, lock-tamper, door-wedge, door-force and tamper events
 * from physical sensors attached to the doorbell or door frame.
 *
 * Security mirrors the Ring webhook route:
 *  - HMAC-SHA256 over the raw body using SENSOR_HMAC_KEY (header: X-Sensor-Signature: sha256=<hex>)
 *  - ±5 minute timestamp window (anti-replay)
 *  - Idempotency via WebhookEvent (requestId = eventId)
 *  - Per-household rate limiting
 *
 * Sensor-to-behaviour mapping (spec 4.2):
 *  knock       → extra_knock         (via kind:'knock' edit — 30 s window + cap of 5)
 *  lock_tamper → lock_manipulation   (requires entryDeniedAt stamp)
 *  door_wedge  → door_wedge_or_follow_in
 *  door_force  → forced_entry_or_assault  (opens a case if none is open)
 *  tamper      → forced_entry_or_assault  (opens a case if none is open)
 *
 * No active case:
 *  - door_force / tamper → opens a new case (emergency)
 *  - All other types → logged and ignored
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { IS_PROD } from '@/lib/auth'
import { checkRateLimit } from '@/lib/ratelimit/redis'
import { SensorEventSchema, type SensorEventType } from '@/lib/schemas/sensor'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { resolveSensorHousehold } from '@/lib/doorstep/sensorRouting'
import { ingestEvent, openSensorCase } from '@/lib/doorbell/store'
import { newObsId } from '@/lib/doorstep/riskRules'
import { markVisitorLeft } from '@/lib/doorstep/caseLifecycle'
import type { Observation } from '@/lib/doorstep/riskRules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const WINDOW_MS = 5 * 60 * 1000

function verifySensorSignature(key: string, rawBody: string, header: string | null): boolean {
  if (!header) return false
  const received = header.startsWith('sha256=') ? header.slice(7) : header
  const expected = crypto.createHmac('sha256', key).update(rawBody, 'utf8').digest()
  if (!/^[0-9a-fA-F]+$/.test(received) || received.length !== expected.length * 2) return false
  return crypto.timingSafeEqual(Buffer.from(received, 'hex') as unknown as Uint8Array, expected as unknown as Uint8Array)
}

export async function POST(request: NextRequest) {
  // 1. HMAC verification
  const raw         = await request.text()
  const key         = process.env.SENSOR_HMAC_KEY
  const unsignedOk  = !IS_PROD && process.env.ALLOW_UNSIGNED_WEBHOOK === '1'

  if (key) {
    if (!verifySensorSignature(key, raw, request.headers.get('x-sensor-signature'))) {
      console.error('[SENSOR] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else if (!unsignedOk) {
    console.error('[SENSOR] SENSOR_HMAC_KEY is not set — rejecting unsigned sensor event')
    return NextResponse.json({ error: 'Sensor endpoint not configured' }, { status: 503 })
  }

  // 2. Parse and validate
  let json: unknown
  try { json = JSON.parse(raw) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = SensorEventSchema.safeParse(json)
  if (!parsed.success) {
    console.warn('[SENSOR] Invalid payload:', parsed.error.issues)
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const evt = parsed.data

  // 3. Timestamp window (anti-replay)
  const eventMs = new Date(evt.at).getTime()
  const now     = Date.now()
  if (isNaN(eventMs) || Math.abs(now - eventMs) > WINDOW_MS) {
    console.warn('[SENSOR] Timestamp outside window:', evt.at)
    return NextResponse.json({ error: 'Timestamp out of window' }, { status: 400 })
  }

  // 4. Household lookup by deviceId. Exactly one registered match, or the event is dropped (never guess a household).
  const db = getDb()
  const rows = await db.device.findMany({
    where: { ringDeviceId: evt.deviceId },
    select: { householdId: true },
  }).catch(() => [] as { householdId: string }[])
  const route = resolveSensorHousehold(rows)
  if (route.ok === false) {
    console.error('[SENSOR] Dropped event from', evt.deviceId, '-', route.reason)
    return NextResponse.json({ status: 'ignored', reason: route.reason })
  }
  const householdId = route.householdId

  // 5. Rate limiting (H-33: key per household and type, exempt door_force and tamper)
  const isHighSeverity = evt.type === 'door_force' || evt.type === 'tamper'
  if (!isHighSeverity) {
    const rl = await checkRateLimit({ key: `sensor:${householdId}:${evt.type}`, limit: 60, window: 60 })
    if (!rl.allowed) {
      console.warn('[SENSOR] Rate limit exceeded for household', householdId, 'type', evt.type)
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }
  }

  // 6. Idempotency
  try {
    const existing = await db.webhookEvent.findUnique({
      where: { householdId_requestId: { householdId, requestId: evt.eventId } }
    })
    if (existing) {
      // If the row is stuck in 'processing' for > 60s, allow retry
      if (existing.status === 'processing' && Date.now() - existing.receivedAt.getTime() > 60_000) {
        await db.webhookEvent.delete({ where: { id: existing.id } })
      } else {
        return NextResponse.json({ status: 'already_processed' })
      }
    }
    await db.webhookEvent.create({
      data: { requestId: evt.eventId, householdId, status: 'processing' }
    })
  } catch {
    // Race condition — treat as already processed
    return NextResponse.json({ status: 'already_processed' })
  }

  // 7. Find or open an active case for this household
  const openCases = await db.case.findMany({
    // Section 8: the case is the visitor episode, so any case that is not closed is active (not only one still waiting).
    where: { householdId, closedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true },
  })

  let caseId: string | null = openCases[0]?.id ?? null

  // For high-severity events with no open case, open one now (N-02)
  const isHighSeverity = evt.type === 'door_force' || evt.type === 'tamper' || evt.type === 'lock_tamper' || evt.type === 'door_wedge'
  if (!caseId && isHighSeverity) {
    const c = await openSensorCase(householdId, evt.deviceId, evt.type as any).catch((e) => {
      console.error('[SENSOR] Failed to open case for high-severity event:', e)
      return null
    })
    caseId = c?.id ?? null

    // High-severity event failed to open a case — return 500 error
    if (!caseId) {
      console.error('[SENSOR] Failed to open case for high-severity event', evt.type)
      // Delete the webhook event row so it can be retried
      await db.webhookEvent.deleteMany({
        where: { householdId, requestId: evt.eventId, status: 'processing' }
      }).catch(() => {})
      return NextResponse.json({ error: 'Failed to open case for high-severity event' }, { status: 500 })
    }
  }

  if (!caseId) {
    // No active case and not high-severity — log and ignore
    console.log('[SENSOR] No active case for household', householdId, '— sensor event', evt.type, 'ignored')
    return NextResponse.json({ status: 'ignored', reason: 'no_active_case' })
  }

  // 8. Map sensor event to risk observation
  try {
    const result = await applySensorEvent(caseId, evt.type, evt.at, evt.eventId)
    // Update webhook event status to done
    await db.webhookEvent.updateMany({
      where: { householdId, requestId: evt.eventId, status: 'processing' },
      data: { status: 'done', processedAt: new Date() }
    })
    return NextResponse.json({ status: 'processed', caseId, behaviour: result.behaviour })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[SENSOR] Failed to apply sensor event:', e)
    // Delete the processing row so it can be retried
    await db.webhookEvent.deleteMany({
      where: { householdId, requestId: evt.eventId, status: 'processing' }
    }).catch(() => {})
    return NextResponse.json({ error: `Processing failed: ${msg}` }, { status: 500 })
  }
}

async function applySensorEvent(caseId: string, type: SensorEventType, at: string, eventId: string) {
  switch (type) {
    case 'visitor_left': {
      // Door evidence of departure (section 8.1). Writes no points. Serious events stay active.
      await markVisitorLeft(caseId, { role: 'sensor' }, new Date(at))
      return { behaviour: 'visitor_left' }
    }

    case 'knock': {
      // Routes through the existing knock edit (enforces 30 s window + cap of 5)
      await applyRiskEdit(caseId, { kind: 'knock', at })
      return { behaviour: 'extra_knock' }
    }

    case 'lock_tamper': {
      const obs: Observation = {
        id: newObsId(),
        code: 'lock_manipulation',
        at,
        quotes: ['Sensor: lock tamper detected'],
        source: 'sensor',
        state: 'confirmed',
        points: 0,
        debug: { eventId },
      }
      await applyRiskEdit(caseId, { kind: 'append', observation: obs })
      return { behaviour: 'lock_manipulation' }
    }

    case 'door_wedge': {
      const obs: Observation = {
        id: newObsId(),
        code: 'door_wedge_or_follow_in',
        at,
        quotes: ['Sensor: door wedge or follow-in detected'],
        source: 'sensor',
        state: 'confirmed',
        points: 0,
        debug: { eventId },
      }
      await applyRiskEdit(caseId, { kind: 'append', observation: obs })
      return { behaviour: 'door_wedge_or_follow_in' }
    }

    case 'door_force':
    case 'tamper': {
      const obs: Observation = {
        id: newObsId(),
        code: 'forced_entry_or_assault',
        at,
        quotes: [`Sensor: ${type === 'door_force' ? 'door force' : 'tamper'} detected`],
        source: 'sensor',
        state: 'confirmed',
        points: 0,
        debug: { eventId },
      }
      await applyRiskEdit(caseId, { kind: 'append', observation: obs })
      return { behaviour: 'forced_entry_or_assault' }
    }
  }
}
