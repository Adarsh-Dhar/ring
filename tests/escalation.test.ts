import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { escalateDueCase, type EscalationDeps } from '@/lib/doorbell/escalation'
import { claimEscalationStep, getCase } from '@/lib/db/cases'
import { getDb } from '@/lib/db/client'
import type { DoorCase } from '@/lib/doorbell/store'

const T0 = 1_000_000
const CFG = { timeoutSec: 30, expectedTimeoutSec: 60, decisionSec: 45, noResponseSec: 90 }

describe('escalation steps with real database', () => {
  const testHouseholdId = 'test-escalation-hh'

  beforeAll(async () => {
    // Ensure database is connected
    await getDb()
    
    // Find or create a test household
    const existing = await getDb().household.findFirst({
      where: { id: testHouseholdId },
    })
    
    if (!existing) {
      await getDb().household.create({
        data: {
          id: testHouseholdId,
          residentName: 'Test Resident',
        },
      })
    }
  })

  afterAll(async () => {
    // Cleanup test cases
    await getDb().case.deleteMany({
      where: { householdId: testHouseholdId },
    })
  })

  it('asks the next helper once the deadline passes and pushes the deadline out', async () => {
    const caseId = `test-escalation-${Date.now()}`
    const alerts: string[] = []
    
    // Create a test case with timer map to use new escalation logic
    await getDb().case.create({
      data: {
        id: caseId,
        kind: 'visitor',
        eventType: 'button_press',
        createdAt: new Date(T0),
        helperIndex: 0,
        deadlineAt: new Date(T0 + 30_000),
        deadlineKind: 'household',
        timerDeadlines: { household: T0 + 30_000 },
        status: 'waiting',
        lane: 'normal',
        log: [],
        chain: ['a', 'b', 'c'],
        householdId: testHouseholdId,
      },
    })

    const c: DoorCase = {
      id: caseId,
      kind: 'visitor',
      eventType: 'button_press',
      createdAt: T0,
      helperIndex: 0,
      deadlineAt: T0 + 30_000,
      deadlineKind: 'household',
      timerDeadlines: { household: T0 + 30_000 },
      status: 'waiting',
      log: [],
      chain: ['a', 'b', 'c'],
      lane: 'normal',
      householdId: testHouseholdId,
    }

    const deps: EscalationDeps = {
      claim: async (id, expect, change, log) => {
        return await claimEscalationStep(id, expect, change, log)
      },
      reload: async (id) => {
        const row = await getCase(id)
        if (!row) return null
        return {
          helperIndex: row.helperIndex,
          deadlineAt: row.deadlineAt.getTime(),
          status: row.status as any,
          lane: row.lane,
          deadlineKind: (row as any).deadlineKind,
          timerDeadlines: (row as any).timerDeadlines,
          log: row.log as any,
        }
      },
      nameOf: async (id) => id ? id.toUpperCase() : undefined,
      onStep: (_c, s) => { alerts.push(`A:${s.kind}:${s.toId ?? '-'}`) },
    }

    expect(await escalateDueCase(c, T0 + 30_000, CFG, deps)).toBe(1)
    expect(alerts).toEqual(['A:next_helper:b'])
    expect(c.helperIndex).toBe(1)
    expect(c.deadlineAt).toBe(T0 + 60_000)

    // Cleanup
    await getDb().case.delete({ where: { id: caseId } })
  })

  it('does not escalate early when cached deadlineAt is stale but independent timers are still in the future', async () => {
    const caseId = `test-escalation-${Date.now()}`
    const alerts: string[] = []
    
    await getDb().case.create({
      data: {
        id: caseId,
        kind: 'visitor',
        eventType: 'button_press',
        createdAt: new Date(T0),
        helperIndex: 0,
        deadlineAt: new Date(T0 - 1), // Stale, past deadline
        deadlineKind: 'risk_decision',
        timerDeadlines: { risk_decision: T0 + 60_000 }, // Future deadline
        status: 'waiting',
        lane: 'normal',
        log: [],
        chain: ['a', 'b', 'c'],
        householdId: testHouseholdId,
      },
    })

    const c: DoorCase = {
      id: caseId,
      kind: 'visitor',
      eventType: 'button_press',
      createdAt: T0,
      helperIndex: 0,
      deadlineAt: T0 - 1,
      deadlineKind: 'risk_decision',
      timerDeadlines: { risk_decision: T0 + 60_000 },
      status: 'waiting',
      log: [],
      chain: ['a', 'b', 'c'],
      lane: 'normal',
      householdId: testHouseholdId,
    }

    const deps: EscalationDeps = {
      claim: async (id, expect, change, log) => {
        return await claimEscalationStep(id, expect, change, log)
      },
      reload: async (id) => {
        const row = await getCase(id)
        if (!row) return null
        return {
          helperIndex: row.helperIndex,
          deadlineAt: row.deadlineAt.getTime(),
          status: row.status as any,
          lane: row.lane,
          deadlineKind: (row as any).deadlineKind,
          timerDeadlines: (row as any).timerDeadlines,
          log: row.log as any,
        }
      },
      nameOf: async (id) => id ? id.toUpperCase() : undefined,
      onStep: (_c, s) => { alerts.push(`A:${s.kind}:${s.toId ?? '-'}`) },
    }

    expect(await escalateDueCase(c, T0 + 10_000, CFG, deps)).toBe(0)
    expect(alerts).toEqual([])
    expect(c.helperIndex).toBe(0)

    await getDb().case.delete({ where: { id: caseId } })
  })

  it('does not delay an expired independent timer because cached deadlineAt is later', async () => {
    const caseId = `test-escalation-${Date.now()}`
    const alerts: string[] = []
    
    await getDb().case.create({
      data: {
        id: caseId,
        kind: 'visitor',
        eventType: 'button_press',
        createdAt: new Date(T0),
        helperIndex: 0,
        deadlineAt: new Date(T0 + 90_000), // Stale, future deadline
        deadlineKind: 'risk_decision',
        timerDeadlines: { risk_decision: T0 + 10_000 }, // Actually expired
        status: 'waiting',
        lane: 'normal',
        log: [],
        chain: ['a', 'b', 'c'],
        householdId: testHouseholdId,
      },
    })

    const c: DoorCase = {
      id: caseId,
      kind: 'visitor',
      eventType: 'button_press',
      createdAt: T0,
      helperIndex: 0,
      deadlineAt: T0 + 90_000,
      deadlineKind: 'risk_decision',
      timerDeadlines: { risk_decision: T0 + 10_000 },
      status: 'waiting',
      log: [],
      chain: ['a', 'b', 'c'],
      lane: 'normal',
      householdId: testHouseholdId,
    }

    const deps: EscalationDeps = {
      claim: async (id, expect, change, log) => {
        return await claimEscalationStep(id, expect, change, log)
      },
      reload: async (id) => {
        const row = await getCase(id)
        if (!row) return null
        return {
          helperIndex: row.helperIndex,
          deadlineAt: row.deadlineAt.getTime(),
          status: row.status as any,
          lane: row.lane,
          deadlineKind: (row as any).deadlineKind,
          timerDeadlines: (row as any).timerDeadlines,
          log: row.log as any,
        }
      },
      nameOf: async (id) => id ? id.toUpperCase() : undefined,
      onStep: (_c, s) => { alerts.push(`A:${s.kind}:${s.toId ?? '-'}`) },
    }

    expect(await escalateDueCase(c, T0 + 11_000, CFG, deps)).toBe(1)
    expect(alerts).toEqual(['A:next_helper:b'])
    expect(c.helperIndex).toBe(1)

    await getDb().case.delete({ where: { id: caseId } })
  })

  it('does not run an acknowledgement timer for an explicit emergency timerless case', async () => {
    const caseId = `test-escalation-${Date.now()}`
    const alerts: string[] = []
    
    await getDb().case.create({
      data: {
        id: caseId,
        kind: 'visitor',
        eventType: 'button_press',
        createdAt: new Date(T0),
        helperIndex: 0,
        deadlineAt: new Date(T0 - 1),
        deadlineKind: 'emergency',
        timerDeadlines: {},
        status: 'waiting',
        lane: 'normal',
        log: [],
        chain: ['a', 'b', 'c'],
        householdId: testHouseholdId,
        riskScore: 85,
        controlMode: 'helper_urgent',
      },
    })

    const c: DoorCase = {
      id: caseId,
      kind: 'visitor',
      eventType: 'button_press',
      createdAt: T0,
      helperIndex: 0,
      deadlineAt: T0 - 1,
      deadlineKind: 'emergency',
      timerDeadlines: {},
      status: 'waiting',
      log: [],
      chain: ['a', 'b', 'c'],
      lane: 'normal',
      householdId: testHouseholdId,
      riskScore: 85,
      controlMode: 'helper_urgent',
    }

    const deps: EscalationDeps = {
      claim: async (id, expect, change, log) => {
        return await claimEscalationStep(id, expect, change, log)
      },
      reload: async (id) => {
        const row = await getCase(id)
        if (!row) return null
        return {
          helperIndex: row.helperIndex,
          deadlineAt: row.deadlineAt.getTime(),
          status: row.status as any,
          lane: row.lane,
          deadlineKind: (row as any).deadlineKind,
          timerDeadlines: (row as any).timerDeadlines,
          log: row.log as any,
        }
      },
      nameOf: async (id) => id ? id.toUpperCase() : undefined,
      onStep: (_c, s) => { alerts.push(`A:${s.kind}:${s.toId ?? '-'}`) },
    }

    expect(await escalateDueCase(c, T0 + 120_000, CFG, deps)).toBe(0)
    expect(alerts).toEqual([])
    expect(c.helperIndex).toBe(0)

    await getDb().case.delete({ where: { id: caseId } })
  })
})
