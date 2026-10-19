/**
 * Section 8: case lifecycle tests.
 * Pure rules (riskRules, caseRisk) first, then the database layer against a fake single-row database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── fake database ────────────────────────────────────────────────────────────
const row: any = {}
const labels: any[] = []
let pendingRequests = 0
let policyRow: any = { quietPeriodMin: 10, priorLookbackHours: 24 }
let otherCases: any[] = []

vi.mock('@/lib/doorbell/store', () => ({
  alertEmergency: vi.fn(async () => true), alertUrgent: vi.fn(async () => true), alertUnconfirmedEmergency: vi.fn(async () => true),
}))
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    case: {
      findUnique: async () => (row.id ? { ...row } : null),
      findMany: async ({ where }: any) => (where?.id?.not ? otherCases : row.id && !row.closedAt ? [{ ...row }] : []),
      update: async ({ data }: any) => { Object.assign(row, data) },
      updateMany: async ({ where, data }: any) => {
        if (where.closedAt === null && row.closedAt) return { count: 0 }
        if (where.deadlineAt && row.deadlineAt && where.deadlineAt.getTime() !== row.deadlineAt.getTime()) return { count: 0 }
        Object.assign(row, data); return { count: 1 }
      },
    },
    helperRequest: { count: async () => pendingRequests },
    membership: { findMany: async () => [] },
    household: { findUnique: async () => policyRow, update: async ({ data }: any) => { policyRow = { ...policyRow, ...data } } },
    correctionLabel: { create: async ({ data }: any) => { labels.push(data) } },
  }),
}))

import {
  SERIOUS_BEHAVIOURS, MINOR_BEHAVIOURS, HELPER_RESOLVABLE, BEHAVIOURS, scoreObservations, deriveLifecycleState,
  quietCloseDue, seriousFromLedger, newObsId, type Observation,
} from '@/lib/doorstep/riskRules'
import { readStored, mergeFresh, applyHelperAction, applyDispute, addResidentStatement, splitStored, type StoredRisk } from '@/lib/doorstep/caseRisk'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { attachEvent, markVisitorLeft, closeCaseByHelper, sweepQuietCases } from '@/lib/doorstep/caseLifecycle'
import { parseLifecyclePolicy, DEFAULT_QUIET_MINUTES, DEFAULT_LOOKBACK_HOURS } from '@/lib/doorstep/lifecyclePolicy'

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const helperObs = (code: Observation['code'], at = new Date().toISOString(), state: Observation['state'] = 'confirmed'): Observation =>
  ({ id: newObsId(), code, at, quotes: [`${code} ${at}`], source: 'helper', state, points: 0, debug: { eventId: `${code}-${at}` } })
const score = (o: Observation[]) => scoreObservations(o, { transcript: '', interviewState: { entryDeniedAt: ago(5), askedToLeaveAt: ago(5), respondingAt: ago(5) } })
const stored = (observations: Observation[]): StoredRisk => ({ observations, stamps: [], interviewState: {}, corrections: [] })

function freshRow(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(row)) delete row[k]
  labels.length = 0; pendingRequests = 0; otherCases = []; policyRow = { quietPeriodMin: 10, priorLookbackHours: 24 }
  Object.assign(row, {
    id: 'case-s8', householdId: 'hh-s8', status: 'answered', lifecycle: 'open', controlMode: 'ai_leads', riskScore: 0,
    deadlineAt: new Date(Date.now() + 60_000), createdAt: new Date(Date.now() - 3_600_000),
    lastActivityAt: new Date(Date.now() - 30 * 60_000), visitorLeftAt: null, closedAt: null, possibleNewVisitorAt: null,
    riskObservations: readStored(null), emergencyAlertedAt: null, urgentAlertedAt: null, unconfirmedAlertedAt: null, ...over,
  })
}

// ── 8.2 serious and minor sets ───────────────────────────────────────────────
describe('Section 8.2: serious and minor events', () => {
  it('serious set is exactly the spec list, minor set is the other four, and together they cover every behaviour', () => {
    expect([...SERIOUS_BEHAVIOURS].sort()).toEqual(['credential_request', 'door_wedge_or_follow_in', 'forced_entry_or_assault', 'hide_from_helper', 'immediate_threat', 'lock_manipulation', 'refuse_to_leave'])
    expect([...MINOR_BEHAVIOURS].sort()).toEqual(['extra_knock', 'pressure_after_boundary', 'pressure_after_rule', 'purpose_contradiction'])
    expect([...SERIOUS_BEHAVIOURS, ...MINOR_BEHAVIOURS].sort()).toEqual([...BEHAVIOURS].sort())
    expect([...HELPER_RESOLVABLE].sort()).toEqual([...SERIOUS_BEHAVIOURS].sort())
  })

  it('a serious event stays active, and keeps its floor, until a helper resolves it', () => {
    const o = helperObs('refuse_to_leave')
    const r = score([o])
    expect(r.activeSerious).toBe(1)
    expect(r.minMode).toBe('helper_only')
    const resolved = score([{ ...o, resolvedAt: new Date().toISOString(), resolvedBy: 'h1' }])
    expect(resolved.activeSerious).toBe(0)
    expect(resolved.minMode).toBe('ai_leads')
    expect(resolved.score).toBe(25) // points are kept
  })

  it('resolving one event does not lift the floor of another event with the same code', () => {
    const a = helperObs('credential_request', ago(4))
    const b = helperObs('credential_request', ago(2))
    const r = score([{ ...a, resolvedAt: new Date().toISOString(), resolvedBy: 'h1' }, b])
    expect(r.minMode).toBe('ai_assisted')
    expect(r.activeSerious).toBe(1)
  })

  it('an uncertain physical or threat event stays active until a helper resolves it', () => {
    const o = helperObs('lock_manipulation', undefined, 'uncertain')
    expect(score([o]).activeSerious).toBe(1)
    expect(score([o]).minMode).toBe('helper_only')
    const resolved = score([{ ...o, resolvedAt: new Date().toISOString(), resolvedBy: 'h1' }])
    expect(resolved.activeSerious).toBe(0)
    expect(resolved.minMode).toBe('ai_leads')
  })

  it('minor events are never counted as serious', () => {
    const r = score([helperObs('pressure_after_boundary'), helperObs('purpose_contradiction')])
    expect(r.activeSerious).toBe(0)
  })

  it('the ledger keeps a retracted entry marked with who, when and why', () => {
    const o = { ...helperObs('credential_request'), retracted: true, retractedAt: '2026-10-19T10:00:00Z', retractedBy: 'h1', retractReason: 'misheard' }
    const e = score([o]).ledger[0]
    expect(e).toMatchObject({ retracted: true, retractedBy: 'h1', retractReason: 'misheard', points: 0, serious: true })
    expect(score([o]).activeSerious).toBe(0)
  })
})

// ── 8.1 states ───────────────────────────────────────────────────────────────
describe('Section 8.1: states', () => {
  it('open by default', () => expect(deriveLifecycleState({ activeSerious: 0 })).toBe('open'))
  it('helper_review when a request is pending, the mode is helper-led, or a serious event is active', () => {
    expect(deriveLifecycleState({ activeSerious: 0, helperRequestPending: true })).toBe('helper_review')
    expect(deriveLifecycleState({ activeSerious: 0, helperLedMode: true })).toBe('helper_review')
    expect(deriveLifecycleState({ activeSerious: 1 })).toBe('helper_review')
  })
  it('visitor_left when departure is recorded and nothing needs the helper', () => {
    expect(deriveLifecycleState({ activeSerious: 0, visitorLeftAt: new Date() })).toBe('visitor_left')
  })
  it('an unresolved serious event keeps the case in helper_review after the visitor leaves', () => {
    expect(deriveLifecycleState({ activeSerious: 1, visitorLeftAt: new Date() })).toBe('helper_review')
  })
  it('closed wins over everything', () => {
    expect(deriveLifecycleState({ activeSerious: 2, helperRequestPending: true, closedAt: new Date() })).toBe('closed')
  })
})

describe('Section 8.2: closing after the quiet period', () => {
  const base = { lifecycle: 'open' as const, score: 5, activeSerious: 0, emergency: false, quietMinutes: 10, lastActivityAt: ago(11) }
  it('closes under 20 with no serious event once the quiet period has passed', () => expect(quietCloseDue(base)).toBe(true))
  it('does not close before the quiet period ends', () => expect(quietCloseDue({ ...base, lastActivityAt: ago(9) })).toBe(false))
  it('runs from the departure when one was recorded', () => {
    expect(quietCloseDue({ ...base, lastActivityAt: ago(1), visitorLeftAt: ago(11) })).toBe(true)
    expect(quietCloseDue({ ...base, lastActivityAt: ago(60), visitorLeftAt: ago(2) })).toBe(false)
  })
  it('never closes at 20 or more, with a serious event, in an emergency, or with a pending request or running answer flow', () => {
    expect(quietCloseDue({ ...base, score: 20 })).toBe(false)
    expect(quietCloseDue({ ...base, activeSerious: 1 })).toBe(false)
    expect(quietCloseDue({ ...base, emergency: true })).toBe(false)
    expect(quietCloseDue({ ...base, helperRequestPending: true })).toBe(false)
    expect(quietCloseDue({ ...base, answerFlowRunning: true })).toBe(false)
  })
  it('does not close a closed case again', () => expect(quietCloseDue({ ...base, lifecycle: 'closed' })).toBe(false))
})

describe('Section 8.2: earlier serious events for the helper', () => {
  const ledger = (code: string, at: string, over: any = {}) => ({ code, at, quote: '', source: 'helper', state: 'confirmed', points: 10, ...over })
  it('lists serious events inside the window, newest first, and skips minor, retracted and old ones', () => {
    const out = seriousFromLedger([
      { id: 'a', closedAt: ago(30), riskLedger: [ledger('credential_request', ago(120)), ledger('extra_knock', ago(100)), ledger('refuse_to_leave', ago(60), { retracted: true })] },
      { id: 'b', closedAt: null, riskLedger: [ledger('hide_from_helper', ago(40)), ledger('refuse_to_leave', ago(25 * 60))] },
    ], 24)
    expect(out.map(e => e.code)).toEqual(['hide_from_helper', 'credential_request'])
  })
})

// ── corrections (pure) ───────────────────────────────────────────────────────
describe('Section 8.2: corrections', () => {
  it('retract removes the points and records who, when and why', () => {
    const o = helperObs('credential_request')
    const r = applyHelperAction(stored([o]), 0, 'reject', 'h1', 'misheard', o.id)
    expect(r.observations[0]).toMatchObject({ retracted: true, retractedBy: 'h1', retractReason: 'misheard' })
    expect(r.observations[0].retractedAt).toBeTruthy()
    expect(score(r.observations).score).toBe(0)
  })

  it('only a serious event can be resolved', () => {
    const minor = helperObs('purpose_contradiction')
    expect(applyHelperAction(stored([minor]), 0, 'resolve', 'h1', 'ok', minor.id)._error).toMatch(/minor/)
    const serious = helperObs('refuse_to_leave')
    const r = applyHelperAction(stored([serious]), 0, 'resolve', 'h1', 'left calmly', serious.id)
    expect(r._error).toBeUndefined()
    expect(r.observations[0]).toMatchObject({ resolvedBy: 'h1', resolveReason: 'left calmly' })
  })

  it('a resident dispute is a flag only and never changes the score', () => {
    const o = helperObs('credential_request')
    const before = score([o]).score
    const r = applyDispute(stored([o]), o.id!, 'resident-1', 'I never said that')
    expect(r._error).toBeUndefined()
    expect(r.observations[0]).toMatchObject({ disputedBy: 'resident-1', disputeNote: 'I never said that' })
    expect(r.observations[0].retracted).toBeFalsy()
    expect(score(r.observations).score).toBe(before)
  })

  it('a resident statement is recorded and does not touch the observations or the score', () => {
    const o = helperObs('refuse_to_leave')
    const r = addResidentStatement(stored([o]), 'known', 'resident-1', 'my nephew')
    expect(r.statements).toHaveLength(1)
    expect(r.statements![0]).toMatchObject({ kind: 'known', who: 'resident-1' })
    expect(score(r.observations)).toEqual(score([o]))
  })

  it('mergeFresh matches corrections by id, so a re-extracted retracted quote never scores again', () => {
    const t: Observation = { id: 'obs-t', code: 'credential_request', at: ago(3), quotes: ['I need your PIN'], source: 'transcript', state: 'confirmed', points: 0, segment: 'I need your PIN' }
    const knock = helperObs('extra_knock')
    const s0 = stored([knock, t])
    const retracted = applyHelperAction(s0, 1, 'reject', 'h1', 'misheard', 'obs-t')
    // the same words arrive again in the next model pass, with a new id
    const again: Observation = { ...t, id: newObsId() }
    const merged = mergeFresh(retracted, [again])
    expect(merged.observations.filter(o => o.code === 'credential_request')).toHaveLength(1)
    expect(merged.observations.find(o => o.code === 'credential_request')!.retracted).toBe(true)
    // only the knock (1 point) still scores; the retracted credential request does not
    expect(scoreObservations(merged.observations, { transcript: '' }).score).toBe(1)
  })

  it('mergeFresh keeps a helper-touched event after the list is reordered', () => {
    const a: Observation = { id: 'obs-a', code: 'hide_from_helper', at: ago(5), quotes: ['keep it secret'], source: 'transcript', state: 'confirmed', points: 0, segment: 'keep it secret' }
    const b: Observation = { id: 'obs-b', code: 'credential_request', at: ago(4), quotes: ['your PIN'], source: 'transcript', state: 'confirmed', points: 0, segment: 'your PIN' }
    let s = applyHelperAction(stored([a, b]), 1, 'reject', 'h1', 'x', 'obs-b')
    s = { ...s, observations: [s.observations[1], s.observations[0]] } // reorder: idx 1 is now a different observation
    const merged = mergeFresh(s, [])
    expect(merged.observations.map(o => o.id)).toEqual(['obs-b'])
  })

  it('splitStored moves later observations and their corrections to the new case', () => {
    const first = helperObs('credential_request', ago(30))
    const later = helperObs('refuse_to_leave', ago(5))
    let s = applyHelperAction(stored([first, later]), 1, 'resolve', 'h1', 'ok', later.id)
    const { keep, moved } = splitStored(s, ago(10))
    expect(keep.observations.map(o => o.id)).toEqual([first.id])
    expect(moved.observations.map(o => o.id)).toEqual([later.id])
    expect(moved.corrections).toHaveLength(1)
    expect(moved.corrections[0].idx).toBe(0)
    expect(keep.corrections).toHaveLength(0)
    expect(moved.stamps).toEqual([])
  })
})

// ── database layer ───────────────────────────────────────────────────────────
describe('Section 8: store and lifecycle', () => {
  beforeEach(() => freshRow())

  it('saves the lifecycle state with the score', async () => {
    await applyRiskEdit('case-s8', { kind: 'append', observation: helperObs('refuse_to_leave') })
    expect(row.lifecycle).toBe('helper_review')
    expect(row.lastActivityAt.getTime()).toBeGreaterThan(Date.now() - 5_000)
  })

  it('a closed case refuses new events', async () => {
    freshRow({ closedAt: new Date(), lifecycle: 'closed' })
    const r = await applyRiskEdit('case-s8', { kind: 'append', observation: helperObs('refuse_to_leave') })
    expect(r).toEqual({ ok: false, error: 'case is closed' })
    expect(row.riskScore).toBe(0)
  })

  it('once the visitor has left, a late model pass or knock changes nothing', async () => {
    freshRow({ visitorLeftAt: new Date(), lifecycle: 'visitor_left' })
    const t: Observation = { id: 'obs-t', code: 'credential_request', at: ago(1), quotes: ['I need your PIN'], source: 'transcript', state: 'confirmed', points: 0, segment: 'I need your PIN' }
    expect(await applyRiskEdit('case-s8', { kind: 'fresh', observations: [t] })).toEqual({ ok: true })
    expect(await applyRiskEdit('case-s8', { kind: 'knock', at: new Date().toISOString() })).toEqual({ ok: true })
    expect(row.riskScore).toBe(0)
  })

  it('a new report after the visitor left reopens the case as a possible new visitor', async () => {
    freshRow({ visitorLeftAt: new Date(), lifecycle: 'visitor_left' })
    await applyRiskEdit('case-s8', { kind: 'append', observation: helperObs('door_wedge_or_follow_in') })
    expect(row.visitorLeftAt).toBeNull()
    expect(row.possibleNewVisitorAt).toBeInstanceOf(Date)
    expect(row.lifecycle).toBe('helper_review')
  })

  it('every correction is logged as labelled data', async () => {
    const o = helperObs('credential_request')
    freshRow({ riskObservations: stored([o]) })
    await applyRiskEdit('case-s8', { kind: 'helper', idx: 0, obsId: o.id, action: 'reject', who: 'h1', reason: 'misheard' })
    await applyRiskEdit('case-s8', { kind: 'dispute', obsId: o.id!, who: 'r1', note: 'wrong' })
    await applyRiskEdit('case-s8', { kind: 'statement', statementKind: 'known', who: 'r1' })
    await applyRiskEdit('case-s8', { kind: 'reset', who: 'h1', reason: 'test' })
    expect(labels.map(l => l.action)).toEqual(['retract', 'dispute', 'statement', 'reset'])
    expect(labels[0]).toMatchObject({ actorRole: 'helper', actorId: 'h1', reason: 'misheard', code: 'credential_request', scoreAfter: 0 })
    expect(labels[1].actorRole).toBe('resident')
  })

  it('reset records who, when and why on every observation it retracts', async () => {
    freshRow({ riskObservations: stored([helperObs('refuse_to_leave')]) })
    await applyRiskEdit('case-s8', { kind: 'reset', who: 'h9', reason: 'wrong door' })
    const o = readStored(row.riskObservations).observations[0]
    expect(o).toMatchObject({ retracted: true, retractedBy: 'h9' })
    expect(o.retractReason).toContain('wrong door')
    expect(row.riskScore).toBe(0)
  })

  it('a resident dispute does not change the stored score', async () => {
    const o = helperObs('credential_request')
    await applyRiskEdit('case-s8', { kind: 'append', observation: o })
    const before = row.riskScore
    await applyRiskEdit('case-s8', { kind: 'dispute', obsId: o.id!, who: 'r1' })
    expect(row.riskScore).toBe(before)
  })

  it('markVisitorLeft freezes the case; a serious event keeps it in helper_review', async () => {
    freshRow()
    expect((await markVisitorLeft('case-s8', { role: 'helper', id: 'h1' }) as any).lifecycle).toBe('visitor_left')
    freshRow()
    await applyRiskEdit('case-s8', { kind: 'append', observation: helperObs('refuse_to_leave') })
    expect((await markVisitorLeft('case-s8', { role: 'sensor' }) as any).lifecycle).toBe('helper_review')
    expect(row.visitorLeftAt).toBeInstanceOf(Date)
  })

  it('attachEvent restarts the quiet period and flags a possible new visitor after departure', async () => {
    freshRow({ visitorLeftAt: new Date(Date.now() - 120_000), status: 'waiting', lifecycle: 'visitor_left' })
    const r = await attachEvent('case-s8')
    expect(r).toMatchObject({ ok: true, possibleNewVisitor: true })
    expect(row.visitorLeftAt).toBeNull()
    expect(row.possibleNewVisitorAt).toBeInstanceOf(Date)
    // an event on a case still being answered is just part of the same visit
    freshRow({ status: 'waiting' })
    expect(await attachEvent('case-s8')).toMatchObject({ ok: true, possibleNewVisitor: false })
    expect(row.possibleNewVisitorAt).toBeNull()
  })

  it('attachEvent refuses a closed case', async () => {
    freshRow({ closedAt: new Date(), lifecycle: 'closed' })
    expect(await attachEvent('case-s8')).toMatchObject({ ok: false, status: 409 })
  })

  it('a helper closes with an outcome, once', async () => {
    expect(await closeCaseByHelper('case-s8', 'h1', 'nonsense')).toMatchObject({ ok: false, status: 400 })
    expect(await closeCaseByHelper('case-s8', 'h1', 'false_alarm', 'cat')).toMatchObject({ ok: true, outcome: 'false_alarm' })
    expect(row).toMatchObject({ lifecycle: 'closed', outcome: 'false_alarm', closedBy: 'h1' })
    expect(await closeCaseByHelper('case-s8', 'h2', 'resolved_safe')).toMatchObject({ ok: false, status: 409 })
    expect(labels.filter(l => l.action === 'close')).toHaveLength(1)
  })

  describe('quiet-period sweep', () => {
    it('closes an idle, low-score case after the resident-set quiet period', async () => {
      freshRow({ lastActivityAt: new Date(Date.now() - 11 * 60_000) })
      expect(await sweepQuietCases('hh-s8')).toEqual(['case-s8'])
      expect(row).toMatchObject({ lifecycle: 'closed', closedBy: 'system', closeReason: 'quiet_period' })
      expect(row.outcome ?? null).toBeNull()
    })
    it('uses the resident-set quiet period', async () => {
      freshRow({ lastActivityAt: new Date(Date.now() - 11 * 60_000) })
      policyRow = { quietPeriodMin: 30, priorLookbackHours: 24 }
      expect(await sweepQuietCases('hh-s8')).toEqual([])
    })
    it('does not close with an active serious event', async () => {
      freshRow({ lastActivityAt: new Date(Date.now() - 60 * 60_000), riskObservations: stored([helperObs('credential_request')]) })
      expect(await sweepQuietCases('hh-s8')).toEqual([])
    })
    it('closes once the serious event is resolved and the score is under 20', async () => {
      const o = { ...helperObs('hide_from_helper'), resolvedAt: new Date().toISOString(), resolvedBy: 'h1' } // 15 points, under 20
      freshRow({ lastActivityAt: new Date(Date.now() - 60 * 60_000), riskObservations: stored([o]) })
      expect(await sweepQuietCases('hh-s8')).toEqual(['case-s8'])
    })
    it('does not close at a score of 20 or more', async () => {
      freshRow({ lastActivityAt: new Date(Date.now() - 60 * 60_000), riskObservations: stored([{ ...helperObs('credential_request'), resolvedAt: new Date().toISOString(), resolvedBy: 'h1' }]) })
      expect(await sweepQuietCases('hh-s8')).toEqual([])
    })
    it('never closes an emergency case, or one with a pending helper request or a running answer flow', async () => {
      freshRow({ lastActivityAt: new Date(Date.now() - 60 * 60_000), controlMode: 'emergency' })
      expect(await sweepQuietCases('hh-s8')).toEqual([])
      freshRow({ lastActivityAt: new Date(Date.now() - 60 * 60_000) }); pendingRequests = 1
      expect(await sweepQuietCases('hh-s8')).toEqual([])
      freshRow({ lastActivityAt: new Date(Date.now() - 60 * 60_000), status: 'waiting' })
      expect(await sweepQuietCases('hh-s8')).toEqual([])
    })
  })
})

describe('Section 8.2: resident-set values', () => {
  it('defaults to a 10 minute quiet period and a 24 hour look-back', () => {
    expect(parseLifecyclePolicy(null)).toEqual({ quietMinutes: DEFAULT_QUIET_MINUTES, lookbackHours: DEFAULT_LOOKBACK_HOURS })
    expect(DEFAULT_QUIET_MINUTES).toBe(10)
    expect(DEFAULT_LOOKBACK_HOURS).toBe(24)
  })
  it('keeps stored values in range and falls back on junk', () => {
    expect(parseLifecyclePolicy({ quietPeriodMin: 5, priorLookbackHours: 48 })).toEqual({ quietMinutes: 5, lookbackHours: 48 })
    expect(parseLifecyclePolicy({ quietPeriodMin: 'abc', priorLookbackHours: 99999 })).toEqual({ quietMinutes: 10, lookbackHours: 168 })
  })
})
