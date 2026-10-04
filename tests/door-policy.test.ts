/**
 * door-policy: who may open the door and when.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (must be hoisted before imports that use them) ─────────────────────

// Track calls from the store
const smsCalls:  { to: string; body: string; opts: any }[] = []
const pushCalls: { membershipId: string; payload: any }[]  = []
const dbUpdates: { id: string; data: any }[]               = []
const dbCreates: any[]                                      = []

vi.mock('@/lib/doorbell/notify', () => ({
  sendSms:          (to: string, body: string, opts?: any) => { smsCalls.push({ to, body, opts }); return Promise.resolve(true) },
  pushToMembership: (membershipId: string, payload: any)  => { pushCalls.push({ membershipId, payload }); return Promise.resolve() },
  recentFailures:   () => ({ sms: 0, push: 0 }),
  recordFailure:    () => {},
}))

vi.mock('@/lib/db/cases', () => ({
  createCase:            (d: any) => { dbCreates.push({ type: 'case', ...d }); return Promise.resolve(d) },
  getCasesForHousehold:  () => Promise.resolve([]),
  updateCase:            (id: string, data: any) => { dbUpdates.push({ id, data }); return Promise.resolve(data) },
  deleteOldCases:        () => Promise.resolve({}),
  getCase:               () => Promise.resolve(null),
  getOpenCasesForHousehold: () => Promise.resolve([]),
}))

vi.mock('@/lib/db/visits', () => ({
  createExpectedVisit:       (d: any) => { dbCreates.push({ type: 'expected', ...d }); return Promise.resolve(d) },
  createRecurringVisit:      (d: any) => { dbCreates.push({ type: 'recurring', ...d }); return Promise.resolve(d) },
  getExpectedVisitsForHousehold:  () => Promise.resolve([]),
  getRecurringVisitsForHousehold: () => Promise.resolve([]),
  getActiveExpectedVisits:   () => Promise.resolve([]),
  deleteExpectedVisit:       () => Promise.resolve({}),
  deleteRecurringVisit:      () => Promise.resolve({}),
  deleteOldExpectedVisits:   () => Promise.resolve({}),
  updateRecurringVisit:      (id: string, data: any) => { dbUpdates.push({ id, data }); return Promise.resolve(data) },
  markExpectedUsed:          () => Promise.resolve({}),
}))

const HOUSEHOLD = {
  id: 'hh-policy', residentName: 'Maa', timezone: 'UTC',
  timeoutSec: 30, quietEnabled: false, quietStartHour: 22, quietEndHour: 6,
  emergencyNumber: '112', plannedMode: 'helper'
}

let plannedModeOverride = 'helper'

vi.mock('@/lib/db/households', () => ({
  getHousehold:  (id: string) => Promise.resolve({ ...HOUSEHOLD, id, plannedMode: plannedModeOverride }),
  updateHousehold: (id: string, data: any) => {
    if (data.plannedMode) plannedModeOverride = data.plannedMode
    return Promise.resolve({})
  },
  getResidentEpoch:           () => Promise.resolve(1),
  getMembershipsForHousehold: () => Promise.resolve([]),
}))

const HELPER = { id: 'mem-1', userId: 'u-1', householdId: 'hh-policy', role: 'helper', consent: 'approved', tokenEpoch: 1, user: { id: 'u-1', name: 'Priya', phone: '+91999', email: null }, emoji: '🙂' }

vi.mock('@/lib/db/memberships', () => ({
  getApprovedMemberships: () => Promise.resolve([HELPER]),
  getMembership:          (id: string) => Promise.resolve(id === HELPER.id ? HELPER : null),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({ device: { findMany: () => Promise.resolve([]), upsert: () => Promise.resolve({}) } }),
}))

vi.mock('@/lib/ring/client', () => ({
  ringConfiguredForHousehold: () => Promise.resolve(false),
  getConnectionForHousehold:  () => Promise.resolve(null),
  forceRefreshConnection:     () => Promise.resolve(true),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

import {
  addExpected, addRecurring, ingestEvent, selfVerify, answerCase,
  setPlannedMode, PLANNED_MODES, getState,
} from '@/lib/doorbell/store'

const HH = 'hh-policy'

// Force state reload between tests by clearing the module-level map via resetAll
import { resetAll } from '@/lib/doorbell/store'

beforeEach(async () => {
  smsCalls.length  = 0
  pushCalls.length = 0
  dbUpdates.length = 0
  dbCreates.length = 0
  plannedModeOverride = 'helper'
  await resetAll(HH)
})


// ── 1. Unexpected visitor: goes to the helper; door opens only after approval ──

describe('unexpected visitor', () => {
  it('alerts the helper by push and urgent SMS, and does not auto-approve', async () => {
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()
    expect(c!.lane).toBe('normal')
    expect(c!.status).toBe('waiting')
    expect(c!.answer).toBeUndefined()
    expect(c!.confirmedAt).toBeUndefined()
    expect(pushCalls.some(p => p.membershipId === HELPER.id)).toBe(true)
    expect(smsCalls.some(s => s.opts?.urgent === true)).toBe(true)
  })

  it('the resident must not open until the helper says safe', async () => {
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    const r = await answerCase(HH, c!.id, HELPER.id, 'safe', 'known')
    expect(r.ok).toBe(true)
    const done = (r as any).case
    expect(done.status).toBe('answered')
    expect(done.answer).toBe('safe')
  })

  it('a helper saying not safe keeps the door closed', async () => {
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    const r = await answerCase(HH, c!.id, HELPER.id, 'not_safe')
    expect((r as any).case.answer).toBe('not_safe')
  })

  it('does not let the resident skip the helper (selfVerify does nothing)', async () => {
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(await selfVerify(HH, c!.id, true)).toBeNull()
    expect(c!.status).toBe('waiting')
  })
})

// ── 2. Expected visitor ──────────────────────────────────────────────────────

describe('expected visitor in resident mode with a pass-word', () => {
  it('is let in with no helper answer and no urgent SMS', async () => {
    await setPlannedMode(HH, 'resident')
    const now = Date.now()
    await addExpected(HH, '📦', 'Delivery', now - 60_000, now + 60_000, 'Courier', 'sunshine')
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c!.lane).toBe('expected')
    expect(smsCalls.length).toBe(0)                       // helper is not texted

    const r = await selfVerify(HH, c!.id, true)
    expect(r!.status).toBe('answered')
    expect(r!.answer).toBe('safe')
    expect(r!.answeredBy).toBeUndefined()                 // no helper involved
  })
})

describe('expected visitor in the default helper mode', () => {
  it('still waits for a helper to confirm (not auto-approved)', async () => {
    const now = Date.now()
    await addExpected(HH, '📦', 'Delivery', now - 60_000, now + 60_000, 'Courier', 'sunshine')
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c!.lane).toBe('expected')
    expect(c!.status).toBe('waiting')
    expect(c!.answer).toBeUndefined()
  })
})
