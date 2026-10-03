/**
 * code-mode.test.ts — tests for the live-code resident-check flow in store.ts.
 * Extends the planned-visits fixture with codeSecret-bearing visits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (match planned-visits.test.ts setup) ───────────────────────────────

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
  id: 'hh-code', residentName: 'Nani', timezone: 'UTC',
  timeoutSec: 30, quietEnabled: false, quietStartHour: 22, quietEndHour: 6,
  emergencyNumber: '112', plannedMode: 'helper',
}
let plannedModeOverride = 'resident'

vi.mock('@/lib/db/households', () => ({
  getHousehold:  (id: string) => Promise.resolve({ ...HOUSEHOLD, id, plannedMode: plannedModeOverride }),
  updateHousehold: (id: string, data: any) => {
    if (data.plannedMode) plannedModeOverride = data.plannedMode
    return Promise.resolve({})
  },
  getResidentEpoch:           () => Promise.resolve(1),
  getMembershipsForHousehold: () => Promise.resolve([]),
}))

const HELPER = {
  id: 'mem-c1', userId: 'u-c1', householdId: 'hh-code', role: 'helper', consent: 'approved',
  tokenEpoch: 1, user: { id: 'u-c1', name: 'Ravi', phone: '+91888', email: null }, emoji: '🙂',
}

vi.mock('@/lib/db/memberships', () => ({
  getApprovedMemberships: () => Promise.resolve([HELPER]),
  getMembership:          (id: string) => Promise.resolve(id === HELPER.id ? HELPER : null),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({ device: { findMany: () => Promise.resolve([]) } }),
}))

vi.mock('@/lib/ring/client', () => ({
  ringConfiguredForHousehold: () => Promise.resolve(false),
  getConnectionForHousehold:  () => Promise.resolve(null),
  forceRefreshConnection:     () => Promise.resolve(true),
}))

vi.mock('@/lib/doorbell/request-lifecycle', () => ({
  sweepRequests:          () => Promise.resolve(),
  cancelRequestForVisit:  () => Promise.resolve(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  addExpected, addRecurring, ingestEvent, selfVerify, answerCase,
  setPlannedMode, getState, resetAll,
} from '@/lib/doorbell/store'

const HH = 'hh-code'

beforeEach(async () => {
  smsCalls.length  = 0
  pushCalls.length = 0
  dbUpdates.length = 0
  dbCreates.length = 0
  plannedModeOverride = 'resident'
  await resetAll(HH)
})

// ── Code mode case opening ────────────────────────────────────────────────────

describe('resident mode + codeSecret visit', () => {
  it('opens a case with checkMode=code when visit has codeSecret', async () => {
    const now = Date.now()
    // addExpected does not set codeSecret; we inject it after via store's internal expected list
    const visit = await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000, 'Dr. Rao')
    // Manually set codeSecret on the in-memory visit to simulate an approved request visit
    ;(visit as any).codeSecret = 'a'.repeat(64)

    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()
    expect(c!.lane).toBe('expected')
    expect(c!.checkMode).toBe('code')
    expect(c!.checkWord).toBeUndefined()  // no passphrase in code mode
    expect(c!.expectedId).toBe(visit.id)
  })

  it('resident snapshot includes checkCode, helper snapshot does not', async () => {
    const now = Date.now()
    const visit = await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000, 'Dr. Rao')
    ;(visit as any).codeSecret = 'b'.repeat(64)

    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()

    const residentSnap = await getState(HH, 'resident')
    const helperSnap   = await getState(HH, 'helper')

    // Resident gets checkCode injected
    expect((residentSnap!.current as any)?.checkCode).toBeTruthy()
    // Helper never gets checkCode
    expect((helperSnap!.current as any)?.checkCode).toBeUndefined()
  })

  it('expected and expectedNow never contain passphrase or codeSecret', async () => {
    const now = Date.now()
    await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000, 'Dr. Rao', 'sunshine')
    const snap = await getState(HH, 'helper')
    const j = JSON.stringify(snap)
    expect(j).not.toContain('sunshine')
    expect(j).not.toContain('codeSecret')
  })
})

// ── selfVerify in code mode ───────────────────────────────────────────────────

describe('selfVerify code mode', () => {
  async function openCodeCase() {
    const now = Date.now()
    const visit = await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000, 'Dr. Rao')
    ;(visit as any).codeSecret = 'c'.repeat(64)
    return { visit, c: await ingestEvent(HH, { event_type: 'button_press' }) }
  }

  it('"No" once in code mode: still waiting, checkAttempts=1, no SMS', async () => {
    const { c } = await openCodeCase()
    expect(c).not.toBeNull()
    smsCalls.length = 0
    const result = await selfVerify(HH, c!.id, false)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('waiting')      // still open
    expect(result!.lane).toBe('expected')        // not demoted yet
    expect(result!.checkAttempts).toBe(1)
    expect(smsCalls.length).toBe(0)              // no escalation SMS yet
  })

  it('"No" twice demotes to unknown visitor and sends SMS', async () => {
    const { c } = await openCodeCase()
    expect(c).not.toBeNull()
    await selfVerify(HH, c!.id, false)           // first no
    smsCalls.length = 0
    const result = await selfVerify(HH, c!.id, false)  // second no
    expect(result).not.toBeNull()
    expect(result!.lane).toBe('normal')          // demoted
    expect(result!.checkMode).toBeUndefined()    // cleared
    expect(smsCalls.length).toBeGreaterThan(0)   // urgent SMS sent
  })

  it('"Yes" sets usedAt on single-use visit', async () => {
    const now = Date.now()
    const visit = await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000, 'Dr. Rao')
    ;(visit as any).codeSecret = 'd'.repeat(64)
    ;(visit as any).singleUse  = true
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()

    const result = await selfVerify(HH, c!.id, true)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('answered')
    expect(result!.answer).toBe('safe')
    // The in-memory visit should have usedAt set
    expect((visit as any).usedAt).toBeTypeOf('number')
  })

  it('helper safe answer also burns a single-use visit', async () => {
    const now = Date.now()
    const visit = await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000)
    ;(visit as any).codeSecret = 'e'.repeat(64)
    ;(visit as any).singleUse  = true
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()
    await answerCase(HH, c!.id, HELPER.id, 'safe', 'known')
    expect((visit as any).usedAt).toBeTypeOf('number')
  })

  it('next ring in the window after use is unplanned (single use)', async () => {
    const now = Date.now()
    const visit = await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000)
    ;(visit as any).codeSecret = 'f'.repeat(64)
    ;(visit as any).singleUse  = true
    ;(visit as any).usedAt     = now - 1000   // already used

    // Ingest a second ring — the visit is used, so it should be unplanned
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()
    expect(c!.lane).toBe('normal')   // no match because visit is used
  })
})

// ── Recurring / manual visits unaffected ─────────────────────────────────────

describe('recurring and non-codeSecret visits unaffected', () => {
  it('recurring visit still opens expected lane without code mode', async () => {
    await setPlannedMode(HH, 'resident')
    const now = Date.now()
    // Day 0 = Thursday (day number in UTC)
    const dayNum = Math.floor(now / 86_400_000)
    const weekday = new Date(now).getUTCDay()
    const startMin = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes() - 10
    await addRecurring(HH, {
      icon: '🧹', label: 'Cleaner', days: [weekday], everyNWeeks: 1,
      startMin, endMin: startMin + 60, alertIfMissed: false, startNextWeek: false,
    })
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()
    expect(c!.lane).toBe('expected')
    expect(c!.checkMode).toBeUndefined()   // recurring has no codeSecret
  })

  it('manual expected visit without codeSecret uses word mode (if passphrase set)', async () => {
    await setPlannedMode(HH, 'resident')
    const now = Date.now()
    await addExpected(HH, '🩺', 'Doctor', now - 60_000, now + 60_000, 'Dr. Rao', 'mango')
    const c = await ingestEvent(HH, { event_type: 'button_press' })
    expect(c).not.toBeNull()
    expect(c!.checkMode).toBe('word')
    expect(c!.checkWord).toBe('mango')
    expect(c!.checkAttempts).toBe(0)
  })
})
