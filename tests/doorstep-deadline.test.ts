/**
 * Section 5.3: Timer tests
 * Tests the production timer functions: timersFor, activeTimer, shortenDeadline, recordTimerDeadline, and checkExpiredTimers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { timersFor, activeTimer, DEFAULT_APPROVAL_SECONDS, RISK_TIMER_BASE, TAKEOVER_CAP_SECONDS } from '@/lib/doorstep/collaborationController'
import { shortenDeadline, recordTimerDeadline, checkExpiredTimers, expiryBehavior, type TimerKind } from '@/lib/doorstep/deadline'
import { timerDurationsFor } from '@/lib/doorstep/helperEscalation'

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
  it('matches the specified risk and takeover formula for every integer score 0–100', () => {
    for (let score = 0; score <= 100; score++) {
      const timers = timersFor(score, score >= 60 && score < 100 ? 'helper_only' : 'ai_leads')
      expect(timers.riskDecisionSec).toBe(score >= 1 && score <= 99 ? 120 - score : null)
      expect(timers.takeoverSec).toBe(score >= 60 && score <= 99 ? Math.min(120 - score, 60) : null)
    }
  })

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


  it('risk-decision and takeover retain distinct identities when durations tie', () => {
    const timers = timersFor(70, 'helper_only')
    expect(timers.riskDecisionSec).toBe(50)
    expect(timers.takeoverSec).toBe(50)
    // activeTimer is for choosing a governing wake-up only; an AI-budget request must explicitly
    // persist risk_decision rather than reusing this tie-break result.
    expect(activeTimer(timers, { riskDecisionNeeded: true })?.kind).toBe('takeover')
  })
})

describe('Section 5.3: Independent timer lifecycle', () => {
  beforeEach(() => {
    Object.assign(row, {
      id: 'test-case-id',
      householdId: 'test-household',
      status: 'waiting',
      deadlineAt: new Date(Date.now() + 120000),
      timerDeadlines: {},
    })
    syncCaseDeadline.mockClear()
  })

  it('recordTimerDeadline stores timer independently even if it does not shorten governing deadline', async () => {
    const now = Date.now()
    // Set initial deadline to 60s from now
    row.deadlineAt = new Date(now + 60000)
    row.timerDeadlines = { household: now + 60000 }

    // Record a risk-decision timer at 90s (later than governing)
    await recordTimerDeadline('test-household', 'test-case-id', 'risk_decision', now + 90000, 'test reason')

    // Timer should be recorded even though it doesn't shorten the deadline
    expect(row.timerDeadlines.risk_decision).toBe(now + 90000)
    expect(row.deadlineAt.getTime()).toBe(now + 60000) // Governing deadline unchanged
  })

  it('recordTimerDeadline shortens governing deadline if timer is earlier', async () => {
    const now = Date.now()
    row.deadlineAt = new Date(now + 120000)
    row.timerDeadlines = { household: now + 120000 }

    // Record a risk-decision timer at 30s (earlier than governing)
    await recordTimerDeadline('test-household', 'test-case-id', 'risk_decision', now + 30000, 'test reason')

    expect(row.timerDeadlines.risk_decision).toBe(now + 30000)
    expect(row.deadlineAt.getTime()).toBe(now + 30000) // Governing deadline shortened
    expect(row.deadlineKind).toBe('risk_decision')
  })

  it('recordTimerDeadline does not update if timer already has earlier deadline', async () => {
    const now = Date.now()
    row.deadlineAt = new Date(now + 60000)
    row.timerDeadlines = { risk_decision: now + 30000 }

    // Try to record same timer with later deadline
    await recordTimerDeadline('test-household', 'test-case-id', 'risk_decision', now + 90000, 'test reason')

    // Should not update
    expect(row.timerDeadlines.risk_decision).toBe(now + 30000)
  })

  it('checkExpiredTimers returns all expired timers', async () => {
    const now = Date.now()
    row.timerDeadlines = {
      approval: now - 10000, // expired
      risk_decision: now + 30000, // not expired
      takeover: now - 5000, // expired
    }

    const expired = await checkExpiredTimers('test-case-id', now)

    expect(expired).toHaveLength(2)
    expect(expired.find(e => e.kind === 'approval')).toBeDefined()
    expect(expired.find(e => e.kind === 'takeover')).toBeDefined()
    expect(expired.find(e => e.kind === 'risk_decision')).toBeUndefined()
  })

  it('expiryBehavior returns correct behavior for each timer kind', () => {
    expect(expiryBehavior('approval')).toBe('notify_backup')
    expect(expiryBehavior('risk_decision')).toBe('notify_backup')
    expect(expiryBehavior('takeover')).toBe('notify_backup_keep_primary')
    expect(expiryBehavior('emergency')).toBe('emergency')
    expect(expiryBehavior('household')).toBe('notify_backup')
  })
})

describe('Section 5.3: shortenDeadline behavior', () => {
  beforeEach(() => {
    Object.assign(row, {
      id: 'test-case-id',
      householdId: 'test-household',
      status: 'waiting',
      deadlineAt: new Date(Date.now() + 120000),
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
