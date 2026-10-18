import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import {
  ingestEvent,
  setDeviceOnline,
  raiseSos,
  ackCase,
  answerCase,
  confirmCase,
  selfVerify,
  checkIn,
  addExpected,
  setPlannedMode,
  setQuiet,
  setTimeoutSec,
  getState,
  resetAll,
  PLANNED_MODES,
} from '@/lib/doorbell/store'
import { getDb } from '@/lib/db/client'
import { getMembership, getApprovedMemberships } from '@/lib/db/memberships'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { newObsId } from '@/lib/doorstep/riskRules'
import type { Observation } from '@/lib/doorstep/riskRules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEMO_MODE = process.env.DEMO_MODE === '1'

// Stable fake device IDs — callers may pass a device name with the sim- prefix
const SIM_DEVICE_FRONT = 'sim-front-door'
const SIM_DEVICE_BACK  = 'sim-back-door'

const Body = z.discriminatedUnion('action', [
  // ── A. Ring events ─────────────────────────────────────────────────────────
  z.object({
    action: z.literal('event'),
    event:  z.enum(['button_press', 'motion_detected', 'device_offline', 'device_online']),
    device: z.string().regex(/^sim-[a-z0-9-]{1,30}$/).optional(),
  }),

  // ── B. Helper actions ──────────────────────────────────────────────────────
  z.object({ action: z.literal('ack'),    caseId: z.string().min(1).max(80) }),
  z.object({
    action:  z.literal('answer'),
    caseId:  z.string().min(1).max(80),
    answer:  z.enum(['safe', 'not_safe', 'call_me']),
    visitor: z.enum(['known', 'delivery', 'unknown']).optional(),
  }),

  // ── C. Resident actions ────────────────────────────────────────────────────
  z.object({ action: z.literal('sos') }),
  z.object({ action: z.literal('confirm'), caseId: z.string().min(1).max(80), ok: z.boolean() }),
  z.object({ action: z.literal('verify'),  caseId: z.string().min(1).max(80), ok: z.boolean() }),
  z.object({ action: z.literal('checkin') }),

  // ── D. Planned visits ──────────────────────────────────────────────────────
  z.object({
    action:     z.literal('expected'),
    label:      z.string().min(1).max(40).default('Demo visitor'),
    icon:       z.string().max(4).default('👤'),
    who:        z.string().max(40).optional(),
    passphrase: z.string().min(2).max(30).optional(),
    minutes:    z.number().int().min(1).max(120).default(10),
  }),

  // ── E. Settings ────────────────────────────────────────────────────────────
  z.object({
    action: z.literal('plannedMode'),
    mode:   z.enum([...PLANNED_MODES] as [string, ...string[]]),
  }),
  z.object({ action: z.literal('quiet'),   enabled: z.boolean() }),
  z.object({ action: z.literal('timeout'), value: z.number().int().min(5).max(600) }),

  // ── G. State + reset ───────────────────────────────────────────────────────
  z.object({ action: z.literal('state') }),
  z.object({ action: z.literal('reset') }),

  // ── H. Sensor events (no hardware needed) ──────────────────────────────────
  z.object({
    action:  z.literal('sensor'),
    type:    z.enum(['lock_tamper', 'door_wedge', 'door_force', 'tamper']),
    caseId:  z.string().min(1).max(80),
  }),
  // Simulate a camera-model "uncertain" forced-entry observation (camera sees it but can't confirm)
  z.object({
    action: z.literal('camera_uncertain_forced_entry'),
    caseId: z.string().min(1).max(80),
  }),
])

/**
 * GET — returns whether the simulator is enabled.
 */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  return NextResponse.json({ enabled: DEMO_MODE })
}

/**
 * POST — dispatch any simulator action.
 * Requires DEMO_MODE=1 and an active guardian session.
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  if (!DEMO_MODE) {
    return fail('Simulator is disabled. Set DEMO_MODE=1 on the server and restart.', 403)
  }

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const householdId = a.session!.householdId
  const b = p.data

  try {
    switch (b.action) {

      // ── A. Ring events ────────────────────────────────────────────────────
      case 'event': {
        const deviceId = b.device ?? SIM_DEVICE_FRONT

        if (b.event === 'device_offline') {
          await setDeviceOnline(householdId, deviceId, false, 'Simulated offline event')
          return NextResponse.json({ ok: true, result: 'processed', event: b.event, deviceId })
        }
        if (b.event === 'device_online') {
          await setDeviceOnline(householdId, deviceId, true, 'Simulated online event')
          return NextResponse.json({ ok: true, result: 'processed', event: b.event, deviceId })
        }

        // Respect RING_TRIGGER_EVENTS just like the real webhook handler does
        const triggerEvents = new Set(
          (process.env.RING_TRIGGER_EVENTS ?? 'button_press')
            .split(',').map(s => s.trim()).filter(Boolean)
        )
        if (!triggerEvents.has(b.event)) {
          return NextResponse.json({
            ok:     true,
            result: 'ignored',
            reason: `"${b.event}" is not in RING_TRIGGER_EVENTS (currently: ${[...triggerEvents].join(', ')}). Add it to fire a case.`,
          })
        }

        const doorCase = await ingestEvent(householdId, {
          event_type: b.event,
          event_id:   `sim-${Date.now()}`,
          device_id:  deviceId,
        })

        if (!doorCase) {
          return NextResponse.json({
            ok:     true,
            result: 'ignored',
            reason: 'An active case is already open for this household.',
          })
        }
        return NextResponse.json({ ok: true, result: 'processed', event: b.event, caseId: doorCase.id })
      }

      // ── B. Helper actions ─────────────────────────────────────────────────
      case 'ack': {
        // Use the first approved membership as the simulated helper
        const memberships = await getApprovedMemberships(householdId)
        if (!memberships.length) return fail('No approved helpers in this household.', 409)
        const membershipId = memberships[0].id
        const r = await ackCase(householdId, b.caseId, membershipId)
        if (r.ok === false) return fail(r.error, r.status)
        return NextResponse.json({ ok: true, result: 'acked', by: memberships[0].user.name })
      }

      case 'answer': {
        if (b.answer === 'safe' && b.visitor !== 'known' && b.visitor !== 'delivery') {
          return fail('Please set visitor to "known" or "delivery" when answering safe.', 400)
        }
        // Use the membership that is currently on-call for this case
        const db = getDb()
        const state = await getState(householdId, 'helper')
        if (!state) return fail('Household not found.', 404)
        const cur = (state as any).current
        if (!cur || cur.id !== b.caseId) return fail('Case is not currently active.', 409)
        const chainMembershipId: string = cur.chain[cur.helperIndex]
        const membership = await getMembership(chainMembershipId)
        if (!membership) return fail('Current on-call helper not found.', 404)
        const r = await answerCase(householdId, b.caseId, chainMembershipId, b.answer, b.visitor)
        if (r.ok === false) return fail(r.error, r.status)
        return NextResponse.json({ ok: true, result: 'answered', by: membership.user.name })
      }

      // ── C. Resident actions ───────────────────────────────────────────────
      case 'sos': {
        const c = await raiseSos(householdId)
        return NextResponse.json({ ok: true, result: 'sos_raised', caseId: c.id })
      }

      case 'confirm': {
        const c = await confirmCase(householdId, b.caseId, b.ok)
        if (!c) return fail('No active case awaiting resident confirmation.', 404)
        return NextResponse.json({ ok: true, result: b.ok ? 'confirmed_open' : 'declined_open' })
      }

      case 'verify': {
        const c = await selfVerify(householdId, b.caseId, b.ok)
        if (!c) return fail('No active expected case awaiting passphrase verification.', 404)
        return NextResponse.json({ ok: true, result: b.ok ? 'verified_ok' : 'verified_fail', retry: (c as any).status === 'waiting' })
      }

      case 'checkin': {
        await checkIn(householdId)
        return NextResponse.json({ ok: true, result: 'checked_in' })
      }

      // ── D. Planned visits ─────────────────────────────────────────────────
      case 'expected': {
        const now = Date.now()
        const e = await addExpected(
          householdId,
          b.icon, b.label,
          now - 60_000,                    // starts 1 min ago so it matches immediately
          now + b.minutes * 60_000,
          b.who,
          b.passphrase,
        )
        return NextResponse.json({ ok: true, result: 'expected_added', expectedId: e.id, label: e.label })
      }

      // ── E. Settings ───────────────────────────────────────────────────────
      case 'plannedMode': {
        await setPlannedMode(householdId, b.mode as any)
        return NextResponse.json({ ok: true, result: 'planned_mode_set', mode: b.mode })
      }

      case 'quiet': {
        // Toggle quiet hours for the current hour so it takes effect immediately
        const hour = new Date().getHours()
        await setQuiet(householdId, {
          enabled:   b.enabled,
          startHour: hour,
          endHour:   (hour + 1) % 24,
        })
        return NextResponse.json({ ok: true, result: 'quiet_set', enabled: b.enabled })
      }

      case 'timeout': {
        await setTimeoutSec(householdId, b.value)
        return NextResponse.json({ ok: true, result: 'timeout_set', value: b.value })
      }

      // ── G. State + reset ──────────────────────────────────────────────────
      case 'state': {
        const state = await getState(householdId, 'helper')
        return NextResponse.json({ ok: true, state })
      }

      case 'reset': {
        await resetAll(householdId)
        return NextResponse.json({ ok: true, result: 'reset' })
      }

      // ── H. Sensor events ─────────────────────────────────────────────────
      case 'sensor': {
        const at = new Date().toISOString()
        const eventId = `sim-sensor-${Date.now()}`
        const TYPE_TO_CODE: Record<string, Observation['code']> = {
          lock_tamper: 'lock_manipulation',
          door_wedge:  'door_wedge_or_follow_in',
          door_force:  'forced_entry_or_assault',
          tamper:      'forced_entry_or_assault',
        }
        const code = TYPE_TO_CODE[b.type]
        if (!code) return fail(`Unknown sensor type: ${b.type}`, 400)
        const obs: Observation = {
          id: newObsId(),
          code,
          at,
          quotes: [`Simulated sensor: ${b.type}`],
          source: 'sensor',
          state: 'confirmed',
          points: 0,
          debug: { eventId },
        }
        const r = await applyRiskEdit(b.caseId, { kind: 'append', observation: obs })
        if (!r.ok) return fail((r as { ok: false; error: string }).error, 409)
        return NextResponse.json({ ok: true, result: 'sensor_applied', code, caseId: b.caseId })
      }

      case 'camera_uncertain_forced_entry': {
        // Simulates a camera model describing forced entry but not confirming it (spec 4.3)
        const obs: Observation = {
          id: newObsId(),
          code: 'forced_entry_or_assault',
          at: new Date().toISOString(),
          quotes: ['Camera model: possible forced entry (uncertain)'],
          source: 'transcript', // camera-model descriptions use transcript source → uncertain
          state: 'uncertain',
          points: 0,
          debug: { eventId: `sim-camera-${Date.now()}` },
        }
        const r2 = await applyRiskEdit(b.caseId, { kind: 'append', observation: obs })
        if (!r2.ok) return fail((r2 as { ok: false; error: string }).error, 409)
        return NextResponse.json({ ok: true, result: 'camera_uncertain_applied', caseId: b.caseId })
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[SIM action=${b.action}]`, e)
    return fail(`Simulation failed: ${msg}`, 503)
  }
}
