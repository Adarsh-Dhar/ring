/**
 * Section 7 gap fixes: holding gate after no_response, approval retry setting, emergency escalation claim order.
 * Pure tests, no database.
 */
import { describe, it, expect } from 'vitest'
import {
  isHoldingCase, validateNoticeSettingsInput, parseNoticeSettings, DEFAULT_APPROVAL_RETRY_SEC,
} from '@/lib/doorstep/noticePolicy'
import { escalateEmergencyCase, escalateDueCase, EMERGENCY_LOG_MARK, type EscalationDeps } from '@/lib/doorbell/escalation'

describe('7.2 step 4: the holding script survives a timeout', () => {
  it('stays on for an unanswered short-notice visit', () => {
    expect(isHoldingCase({ noticeStatus: 'short_notice', status: 'waiting' })).toBe(true)
    expect(isHoldingCase({ noticeStatus: 'short_notice', status: 'no_response' })).toBe(true)
  })
  it('is off once somebody answered, and for other notice statuses', () => {
    expect(isHoldingCase({ noticeStatus: 'short_notice', status: 'answered' })).toBe(false)
    expect(isHoldingCase({ noticeStatus: 'no_notice', status: 'no_response' })).toBe(false)
    expect(isHoldingCase({ noticeStatus: 'meets_minimum', status: 'no_response' })).toBe(false)
  })
})

describe('7.2/7.3: approval retry interval is a resident setting', () => {
  const base = { minNoticeHours: 24, shortNoticePolicy: 'helper_approval', unknownVisitorPolicy: 'ai_first_contact', approvalTimerSec: 120 }
  it('defaults to 300 s when missing', () => {
    const v = validateNoticeSettingsInput(base)
    expect(v.ok && v.value.approvalRetrySec).toBe(DEFAULT_APPROVAL_RETRY_SEC)
    expect(parseNoticeSettings({}).approvalRetrySec).toBe(300)
  })
  it('accepts 30 to 3600 and rejects the rest', () => {
    expect(validateNoticeSettingsInput({ ...base, approvalRetrySec: 900 }).ok).toBe(true)
    expect(validateNoticeSettingsInput({ ...base, approvalRetrySec: 10 }).ok).toBe(false)
    expect(validateNoticeSettingsInput({ ...base, approvalRetrySec: 99999 }).ok).toBe(false)
    expect(validateNoticeSettingsInput({ ...base, approvalRetrySec: 60.5 }).ok).toBe(false)
  })
  it('parses a stored value and falls back on a bad one', () => {
    expect(parseNoticeSettings({ approvalRetrySec: 600 }).approvalRetrySec).toBe(600)
    expect(parseNoticeSettings({ approvalRetrySec: 5 }).approvalRetrySec).toBe(300)
  })
})

function emergencyCase(): any {
  return { id: 'c1', kind: 'ring', createdAt: 0, helperIndex: 0, deadlineAt: 1000, status: 'waiting', chain: ['a', 'b', 'c'], log: [] }
}
function deps(claimResult: boolean, order: string[]): EscalationDeps {
  return {
    claim: async () => { order.push('claim'); return claimResult },
    reload: async () => null,
    nameOf: async id => id,
    onStep: async (_c, step) => { order.push(`step:${step.kind}`) },
  }
}

describe('7.2 emergency: claim first, one parallel alert, exactly once', () => {
  it('claims before it alerts, and alerts once with the emergency kind', async () => {
    const order: string[] = []
    const c = emergencyCase()
    expect(await escalateEmergencyCase(c, 2000, deps(true, order))).toBe(1)
    expect(order).toEqual(['claim', 'step:emergency'])
    expect(c.log.some((l: any) => l.msg === EMERGENCY_LOG_MARK)).toBe(true)
  })
  it('alerts nobody when the claim is lost to another server', async () => {
    const order: string[] = []
    expect(await escalateEmergencyCase(emergencyCase(), 2000, deps(false, order))).toBe(0)
    expect(order).toEqual(['claim'])
  })
  it('does not alert a second time once the emergency mark is in the log', async () => {
    const order: string[] = []
    const c = emergencyCase()
    c.log = [{ t: 1, msg: EMERGENCY_LOG_MARK }]
    expect(await escalateEmergencyCase(c, 5_000_000, deps(true, order))).toBe(0)
    expect(order).toEqual([])
  })
  it('never sends "your turn" next_helper steps for an emergency case', async () => {
    const order: string[] = []
    const c = emergencyCase(); c.controlMode = 'emergency'
    await escalateDueCase(c, 2000, { timeoutSec: 60, decisionSec: 180, noResponseSec: 300, expectedTimeoutSec: 60 }, deps(true, order))
    expect(order).toEqual(['claim', 'step:emergency'])
  })
})
