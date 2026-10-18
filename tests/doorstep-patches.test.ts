import { describe, it, expect } from 'vitest'
import { DEFAULT_NOTICE_SETTINGS, evaluateNotice, helperMakesFirstContact, validateNoticeSettingsInput } from '@/lib/doorstep/noticePolicy'
import { resolveSensorHousehold } from '@/lib/doorstep/sensorRouting'
import { phraseMatches, riskLabelFor } from '@/lib/doorstep/riskRules'
import { gateAction } from '@/lib/doorstep/actionGate'
import { effectiveScore } from '@/lib/doorstep/collaborationController'

const ok = { minNoticeHours: 24, shortNoticePolicy: 'helper_approval', unknownVisitorPolicy: 'ai_first_contact', approvalTimerSec: 120 }

describe('patch 1: unknown-visitor policy decides first contact', () => {
  it('default is AI first contact', () => expect(helperMakesFirstContact(DEFAULT_NOTICE_SETTINGS)).toBe(false))
  it('helper_first hands first contact to a helper', () =>
    expect(helperMakesFirstContact({ ...DEFAULT_NOTICE_SETTINGS, unknownVisitorPolicy: 'helper_first' })).toBe(true))
  it('still adds zero risk points', () =>
    expect(evaluateNotice({}, { ...DEFAULT_NOTICE_SETTINGS, unknownVisitorPolicy: 'helper_first' }).riskPoints).toBe(0))
})

describe('patch 2: notice settings validation', () => {
  it('accepts valid input and null (rule off)', () => {
    expect(validateNoticeSettingsInput(ok).ok).toBe(true)
    expect(validateNoticeSettingsInput({ ...ok, minNoticeHours: null }).ok).toBe(true)
  })
  it.each([
    [{ ...ok, minNoticeHours: 0 }], [{ ...ok, minNoticeHours: 721 }], [{ ...ok, minNoticeHours: 1.5 }], [{ ...ok, minNoticeHours: '24' }],
    [{ ...ok, shortNoticePolicy: 'whatever' }], [{ ...ok, unknownVisitorPolicy: 'x' }],
    [{ ...ok, approvalTimerSec: 14 }], [{ ...ok, approvalTimerSec: 901 }], [{ ...ok, approvalTimerSec: undefined }], [null], ['x'],
  ])('rejects %j', (bad) => expect(validateNoticeSettingsInput(bad).ok).toBe(false))
})

describe('patch 3: short-notice approval holds the AI to zero-cost tools', () => {
  it('holding script and alert still allowed', () => {
    expect(gateAction('safety_script', 0, undefined, { holdOnly: true }).decision).toBe('allow')
    expect(gateAction('alert_helper', 0, undefined, { holdOnly: true }).decision).toBe('allow')
  })
  it('greeting and questions wait for the helper even at score 0', () => {
    expect(gateAction('greet_routine_request', 0, undefined, { holdOnly: true })).toMatchObject({ decision: 'ask_helper', reason: 'approval_pending' })
    expect(gateAction('neutral_verification_question', 0, undefined, { holdOnly: true }).decision).toBe('ask_helper')
  })
  it('short notice is detected when the visit was arranged late', () => {
    const H = 3_600_000, T = Date.UTC(2026, 9, 18, 9)
    expect(evaluateNotice({ arrangedAt: T - 2 * H, visitStartsAt: T }, { ...DEFAULT_NOTICE_SETTINGS, minNoticeHours: 24 }).status).toBe('short_notice')
  })
})

describe('patch 4: sensor events never go to a guessed household', () => {
  it('unknown device is dropped', () => expect(resolveSensorHousehold([])).toEqual({ ok: false, reason: 'unknown_device' }))
  it('one match routes', () => expect(resolveSensorHousehold([{ householdId: 'h1' }])).toEqual({ ok: true, householdId: 'h1' }))
  it('same id in two households is dropped, not guessed', () =>
    expect(resolveSensorHousehold([{ householdId: 'h1' }, { householdId: 'h2' }])).toEqual({ ok: false, reason: 'ambiguous_device' }))
  it('duplicate rows for one household still route', () =>
    expect(resolveSensorHousehold([{ householdId: 'h1' }, { householdId: 'h1' }]).ok).toBe(true))
})

describe('patch 5: refuse_to_leave wording and riskLabel', () => {
  it.each(["I'm not going anywhere", "I won't leave", 'I will not go', 'I refuse to leave', "I'm not leaving until you open up", 'never leaving'])(
    'matches %s', (q) => expect(phraseMatches('refuse_to_leave', q)).toBe(true))
  it.each(['I did not know where to go', "I'm not going to wait", 'I do not move parcels', 'sorry, I will go now', 'not a problem, I can leave it'])(
    'does not match %s', (q) => expect(phraseMatches('refuse_to_leave', q)).toBe(false))
  it('riskLabel follows the effective score, so a lock test (30 points, floor 60) is not "low"', () => {
    expect(riskLabelFor(30)).toBe('low')
    expect(riskLabelFor(effectiveScore(30, 'helper_only'))).toBe('medium')
    expect(riskLabelFor(effectiveScore(0, 'helper_urgent'))).toBe('high')
    expect(riskLabelFor(0)).toBe('none')
  })
})
