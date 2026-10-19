import { describe, it, expect } from 'vitest'
import { computeControl, effectiveScore, timersFor, activeTimer, compareForDashboard, MODE_FLOOR_SCORE, riskDecisionNeeded } from '@/lib/doorstep/collaborationController'
import { gateAction } from '@/lib/doorstep/actionGate'
import { AUTHORITY_COST } from '@/lib/doorstep/authorityCosts'
import { DEFAULT_PREFERENCES as P, permittedActions } from '@/lib/doorstep/residentPreferences'
import { backupTimeoutSec } from '@/lib/doorstep/helperEscalation'

const AI_PREFS = { ...P, delegation: { ...P.delegation, tell_visitor_to_leave: 'ai' as const } }

describe('S_eff (spec 5)', () => {
  it('with no serious event S_eff equals S', () => { for (const s of [0, 7, 50, 99, 100]) expect(effectiveScore(s)).toBe(s) })
  it('an event floor cannot be diluted by a low total, and never lowers a high one', () => {
    expect(effectiveScore(5, 'helper_only')).toBe(MODE_FLOOR_SCORE.helper_only)
    expect(effectiveScore(90, 'ai_assisted')).toBe(90)
    expect(effectiveScore(10, 'emergency')).toBe(100)
  })
  it('every control value comes from S_eff', () => {
    const c = computeControl({ score: 5, minMode: 'helper_only', prefs: P })
    expect(c.effectiveScore).toBe(60); expect(c.rawScore).toBe(5)
    expect(c.aiAutonomyBudget).toBe(40); expect(c.humanOversightIndex).toBe(60); expect(c.timers.riskDecisionSec).toBe(60)
  })
})

describe('5.1 table', () => {
  const rows: [number, number, number, number | null][] = [
    [0, 100, 0, null], [1, 99, 1, 119], [19, 81, 19, 101], [20, 80, 20, 100], [21, 79, 21, 99], [39, 61, 39, 81],
    [40, 60, 40, 80], [59, 41, 59, 61], [60, 40, 60, 60], [79, 21, 79, 41], [80, 20, 80, 40], [99, 1, 99, 21], [100, 0, 100, null],
  ]
  it.each(rows)('S_eff %i -> budget %i, oversight %i, risk timer %s', (s, budget, oversight, timer) => {
    const c = computeControl({ score: s, prefs: P })
    expect(c.aiAutonomyBudget).toBe(budget); expect(c.humanOversightIndex).toBe(oversight); expect(c.timers.riskDecisionSec).toBe(timer)
  })
})

describe('5.3 timers', () => {
  it('approval timer applies at score 0 and defaults to 120 s; the resident can set it', () => {
    expect(timersFor(0).approvalSec).toBe(120); expect(timersFor(0, null, 45).approvalSec).toBe(45)
    expect(activeTimer(timersFor(0), { needsApproval: true })).toEqual({ kind: 'approval', seconds: 120 })
  })
  it('takeover timer is min(120 - S_eff, 60) from S_eff 60, or when an event minimum is helper_only or higher (Section 6)', () => {
    expect(timersFor(59).takeoverSec).toBeNull(); expect(timersFor(60).takeoverSec).toBe(60); expect(timersFor(80).takeoverSec).toBe(40); expect(timersFor(99).takeoverSec).toBe(21)
    // Section 6: takeover timer applies at M3 (helper_only) and above, not M2 (helper_leads)
    expect(timersFor(40, 'helper_leads').takeoverSec).toBeNull()
    expect(timersFor(60, 'helper_only').takeoverSec).toBe(60)
    expect(timersFor(100).takeoverSec).toBeNull()
  })
  it('emergency has no timer', () => { expect(activeTimer(timersFor(100), { emergency: true })).toEqual({ kind: 'emergency', seconds: null }) })
  it('the shortest applicable timer governs', () => {
    expect(activeTimer(timersFor(30), { riskDecisionNeeded: true, needsApproval: true })).toEqual({ kind: 'risk_decision', seconds: 90 })
    expect(activeTimer(timersFor(70), { riskDecisionNeeded: true })).toMatchObject({ seconds: 50 })
    expect(activeTimer(timersFor(30), {})).toBeNull()
  })
})

describe('5.4 action gate', () => {
  const edges: [keyof typeof AUTHORITY_COST, number][] = [
    ['greet_routine_request', 19], ['offer_approved_alternative', 39], ['neutral_verification_question', 59],
    ['restate_rule_refuse', 79], ['boundary_statement', 99], ['end_conversation', 99], ['safety_script', 100], ['alert_helper', 100],
  ]
  it.each(edges)('%s runs alone up to S_eff %i and not one point above', (tool, max) => {
    expect(gateAction(tool, max).decision).toBe('allow')
    if (max < 100) expect(gateAction(tool, max + 1).decision).toBe('ask_helper')
  })
  it('S_eff 20 and 21 differ in budget but permit the same tools (tools switch only at the edges)', () => {
    for (const t of Object.keys(AUTHORITY_COST)) expect(gateAction(t, 20).decision).toBe(gateAction(t, 21).decision)
    expect(gateAction('greet_routine_request', 19).decision).toBe('allow'); expect(gateAction('greet_routine_request', 20).decision).toBe('ask_helper')
  })
  it('prohibited tools are denied at every score and helper-only tools never run alone', () => {
    for (let s = 0; s <= 100; s++) {
      for (const t of ['unlock_door', 'disclose_access_credentials', 'grant_entry']) expect(gateAction(t, s, P).decision).toBe('deny')
      expect(gateAction('policy_exception', s, P).decision).toBe('ask_helper')
    }
  })
  it('a resident restriction overrides a budget that would allow the tool', () => {
    expect(gateAction('greet_routine_request', 0, { ...P, delegation: { ...P.delegation, greet_visitor: 'helper' } }).reason).toBe('resident_restriction:greet_visitor')
  })
  it('unknown tools are denied', () => { expect(gateAction('make_coffee', 0).decision).toBe('deny') })
})

describe('permissions follow the same gate', () => {
  it('ask-a-question is allowed through S_eff 59 and not at 60', () => {
    expect(permittedActions(P, 'helper_leads', 59).allowed).toContain('ask_purpose')
    expect(permittedActions(P, 'helper_only', 60).allowed).not.toContain('ask_purpose')
  })
  it('no budget ever permits unlocking', () => { for (let s = 0; s <= 100; s++) expect(JSON.stringify(permittedActions(AI_PREFS, 'ai_leads', s).allowed)).not.toMatch(/unlock|credential/) })
})

describe('dashboard order', () => {
  it('sorts by S_eff, then event severity, then the most recent event', () => {
    const a = { effectiveScore: 60, eventSeverity: 3, lastEventAt: 100 }
    const b = { effectiveScore: 60, eventSeverity: 2, lastEventAt: 900 }
    const c = { effectiveScore: 60, eventSeverity: 3, lastEventAt: 500 }
    const d = { effectiveScore: 80, eventSeverity: 0, lastEventAt: 1 }
    expect([a, b, c, d].sort(compareForDashboard)).toEqual([d, c, a, b])
  })
})

describe('approval timer settings', () => {
  it('parseNoticeSettings keeps a sane resident value and falls back to 120', async () => {
    const { parseNoticeSettings } = await import('@/lib/doorstep/noticePolicy')
    expect(parseNoticeSettings({}).approvalTimerSec).toBe(120)
    expect(parseNoticeSettings({ approvalTimerSec: 45 }).approvalTimerSec).toBe(45)
    expect(parseNoticeSettings({ approvalTimerSec: 5 }).approvalTimerSec).toBe(120)
    expect(parseNoticeSettings({ approvalTimerSec: 'x' }).approvalTimerSec).toBe(120)
  })
  it('holdOnly lets the AI use only zero-cost tools while an approval is pending', () => {
    expect(gateAction('safety_script', 0, P, { holdOnly: true }).decision).toBe('allow')
    expect(gateAction('neutral_verification_question', 0, P, { holdOnly: true }).reason).toBe('approval_pending')
  })
})

describe('patches 3 and 4', () => {
  it('a helper decision is needed from S_eff 20, the first edge where the AI loses a routine tool', () => {
    expect(riskDecisionNeeded(19)).toBe(false)
    expect(riskDecisionNeeded(20)).toBe(true)
  })
  it('backup helper timeout is the spec 5.3 timer (not capped by household value)', () => {
    expect(backupTimeoutSec(null, null, 60)).toEqual({ seconds: 60, kind: 'household' })    // no risk data: household value
    expect(backupTimeoutSec(10, null, 60)).toEqual({ seconds: 60, kind: 'household' })      // S_eff 10: no risk timer
    expect(backupTimeoutSec(50, null, 60)).toEqual({ seconds: 70, kind: 'risk_decision' })      // 120 - 50 = 70, NOT capped by household 60
    expect(backupTimeoutSec(90, null, 60)).toEqual({ seconds: 30, kind: 'takeover' })      // score 90 is helper-led, takeover wins tie-break
    expect(backupTimeoutSec(5, 'helper_only', 60)).toEqual({ seconds: 60, kind: 'takeover' })  // event floor 60 -> takeover 60
  })
})

describe('patch 5: resident restriction by delegation', () => {
  const noId = { ...P, delegation: { ...P.delegation, ask_for_id: 'helper' as const } }
  it('ask_for_id restriction blocks the verification question when the caller names it', () => {
    expect(gateAction('neutral_verification_question', 0, noId, { decision: 'ask_for_id' }).reason).toBe('resident_restriction:ask_for_id')
    expect(gateAction('neutral_verification_question', 0, noId).decision).toBe('allow')   // ask_purpose is still delegated
  })
  it('tell_visitor_to_leave restriction applies to a boundary statement only when named', () => {
    const noLeave = { ...P, delegation: { ...P.delegation, tell_visitor_to_leave: 'helper' as const } }
    expect(gateAction('end_conversation', 0, noLeave, { decision: 'tell_visitor_to_leave' }).decision).toBe('ask_helper')
    expect(gateAction('end_conversation', 0, noLeave).decision).toBe('allow')   // safety action stays free
  })
})
