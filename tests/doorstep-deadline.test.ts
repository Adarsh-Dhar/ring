/**
 * Section 5.3: Timer tests
 * Tests the production timer functions: timersFor, activeTimer, and shortenDeadline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { timersFor, activeTimer, DEFAULT_APPROVAL_SECONDS, RISK_TIMER_BASE, TAKEOVER_CAP_SECONDS } from '@/lib/doorstep/collaborationController'
import { shortenDeadline } from '@/lib/doorstep/deadline'

const row: any = {}
const syncCaseDeadline = vi.fn()

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    case: {
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: any) => {
        if (where.deadlineAt && where.deadlineAt.getTime() !== row.deadlineAt.getTime()) return { count: 0 }
        Object.assign(row, data); return { count: 1 }
      },
    },
  }),
}))

vi.mock('@/lib/doorbell/store', () => ({
  syncCaseDeadline,
}))

describe('Section 5.3: Timer formulas', () => {
  it('risk_decision = 120 - S_eff for 1 <= S_eff <= 99', () => {
    expect(timersFor(1).riskDecisionSec).toBe(119)
    expect(timersFor(20).riskDecisionSec).toBe(100)
    expect(timersFor(50).riskDecisionSec).toBe(70)
    expect(timersFor(99).riskDecisionSec).toBe(21)
  })

  it('no risk timer at 0 or 100', () => {
    expect(timersFor(0).riskDecisionSec).toBeNull()
    expect(timersFor(100).riskDecisionSec).toBeNull()
  })

  it('takeover = min(120 - S_eff, 60) when helper-led', () => {
    expect(timersFor(60, 'helper_only').takeoverSec).toBe(60)
    expect(timersFor(80, 'helper_urgent').takeoverSec).toBe(40)
    expect(timersFor(90, 'helper_urgent').takeoverSec).toBe(30)
  })

  it('takeover null below helper-led', () => {
    expect(timersFor(40, 'helper_leads').takeoverSec).toBeNull()
    expect(timersFor(20, 'ai_assisted').takeoverSec).toBeNull()
    expect(timersFor(0, 'ai_leads').takeoverSec).toBeNull()
  })

  it('approval timer defaults to 120s unless specified', () => {
    expect(timersFor(0).approvalSec).toBe(DEFAULT_APPROVAL_SECONDS)
    expect(timersFor(50).approvalSec).toBe(DEFAULT_APPROVAL_SECONDS)
    expect(timersFor(50, null, 30).approvalSec).toBe(30)
  })

  it('timersFor selects the shortest non-null timer as governing kind', () => {
    // At S_eff=70 with approval=30s, approval wins
    expect(timersFor(70, null, 30).kind).toBe('approval')
    // At S_eff=70 with default approval, takeover (50s) wins over risk-decision (50s) on tie-break
    expect(timersFor(70).kind).toBe('takeover')
    // At S_eff=80 helper-led, takeover (40s) wins
    expect(timersFor(80, 'helper_only').kind).toBe('takeover')
  })
})

describe('Section 5.3: activeTimer selection', () => {
  it('shortest active timer wins', () => {
    const timers = timersFor(70, 'helper_only', 30)
    const result = activeTimer(timers, { needsApproval: true, riskDecisionNeeded: true })
    expect(result?.kind).toBe('approval')
    expect(result?.seconds).toBe(30)
  })

  it('emergency returns null seconds', () => {
    const result = activeTimer(timersFor(0), { emergency: true })
    expect(result?.kind).toBe('emergency')
    expect(result?.seconds).toBeNull()
  })

  it('needsApproval flag enables approval timer', () => {
    const timers = timersFor(0)
    expect(activeTimer(timers, { needsApproval: false })).toBeNull()
    expect(activeTimer(timers, { needsApproval: true })?.kind).toBe('approval')
  })

  it('riskDecisionNeeded flag enables risk-decision timer', () => {
    const timers = timersFor(50)
    expect(activeTimer(timers, { riskDecisionNeeded: false })?.kind).not.toBe('risk_decision')
    expect(activeTimer(timers, { riskDecisionNeeded: true })?.kind).toBe('risk_decision')
  })

  it('takeover timer is always active when helper-led and non-null', () => {
    const timers = timersFor(70, 'helper_only')
    expect(activeTimer(timers)?.kind).toBe('takeover')
  })
})

describe('Section 5.3: shortenDeadline behavior', () => {
  beforeEach(() => {
    Object.assign(row, {
      id: 'test-case-id',
      householdId: 'test-household',
      status: 'waiting',
      deadlineAt: new Date(Date.now() + 120000), // 2 minutes from now
      timerDeadlines: {},
    })
    syncCaseDeadline.mockClear()
  })

  it('earlier target updates deadline and writes metadata', async () => {
    const now = Date.now()
    const target = now + 30000 // 30 seconds from now
    const result = await shortenDeadline('test-household', 'test-case-id', target, 'risk_decision', 'test reason')

    expect(result).toBe(true)
    expect(row.deadlineAt.getTime()).toBe(target)
    expect(row.deadlineKind).toBe('risk_decision')
    expect(row.timerDeadlines.risk_decision).toBe(target)
    expect(syncCaseDeadline).toHaveBeenCalledWith('test-household', 'test-case-id', target)
  })

  it('later target does not update (compare-and-set)', async () => {
    const now = Date.now()
    const originalDeadline = row.deadlineAt.getTime()
    const target = now + 180000 // 3 minutes from now (later than current)
    const result = await shortenDeadline('test-household', 'test-case-id', target, 'risk_decision', 'test reason')

    expect(result).toBe(false)
    expect(row.deadlineAt.getTime()).toBe(originalDeadline)
    expect(syncCaseDeadline).not.toHaveBeenCalled()
  })

  it('merges timer deadlines without overwriting existing ones', async () => {
    const now = Date.now()
    row.timerDeadlines = { approval: now + 60000 }
    const target = now + 30000
    await shortenDeadline('test-household', 'test-case-id', target, 'risk_decision', 'test reason')

    expect(row.timerDeadlines.approval).toBe(now + 60000)
    expect(row.timerDeadlines.risk_decision).toBe(target)
  })

  it('non-waiting case returns false without update', async () => {
    row.status = 'closed'
    const result = await shortenDeadline('test-household', 'test-case-id', Date.now() + 1000, 'risk_decision', 'test reason')

    expect(result).toBe(false)
    expect(syncCaseDeadline).not.toHaveBeenCalled()
  })
})
