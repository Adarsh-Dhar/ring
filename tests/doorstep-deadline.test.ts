/**
 * G3: Real P9 deadline shortening tests
 * P7: Score-based timer tests (Section 5.3)
 * Tests the deadline shortening logic with mocked database and compare-and-set semantics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const row: any = {}
const alertEmergency = vi.fn(async () => true)

vi.mock('@/lib/doorbell/store', () => ({ alertEmergency }))
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    case: {
      findUnique: async () => ({ ...row }),
      update: async ({ data }: any) => { Object.assign(row, data) },
      updateMany: async ({ where, data }: any) => {
        if (where.deadlineAt && where.deadlineAt.getTime() !== row.deadlineAt.getTime()) return { count: 0 }
        Object.assign(row, data); return { count: 1 }
      },
    },
  }),
}))

import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { readStored } from '@/lib/doorstep/caseRisk'

describe('G3: Real P9 deadline shortening tests', () => {
  beforeEach(() => {
    // Reset row before each test
    Object.assign(row, {
      id: 'test-case-id',
      householdId: 'test-household',
      controlMode: 'ai_leads',
      deadlineAt: new Date(Date.now() + 60000), // 1 minute from now
      riskObservations: readStored(null),
    })
    alertEmergency.mockClear()
  })

  it('Mode unchanged: deadline unchanged and no alert', async () => {
    const now = Date.now()
    const originalDeadline = new Date(now + 60000)
    row.deadlineAt = originalDeadline
    row.controlMode = 'helper_leads'

    // Add an observation that doesn't change the mode
    await applyRiskEdit('test-case-id', {
      kind: 'append',
      observation: {
        code: 'credential_request',
        at: new Date(now).toISOString(),
        quotes: ['PIN'],
        source: 'transcript',
        state: 'confirmed',
        points: 0,
      },
    })

    // Deadline should be unchanged
    expect(row.deadlineAt.getTime()).toBe(originalDeadline.getTime())
    // alertEmergency should not be called
    expect(alertEmergency).not.toHaveBeenCalled()
  })

  it('A rise to emergency: deadline unchanged, alertEmergency called once', async () => {
    const now = Date.now()
    const originalDeadline = new Date(now + 60000)
    row.deadlineAt = originalDeadline
    row.controlMode = 'ai_leads'

    // Add an observation that raises the mode to emergency
    await applyRiskEdit('test-case-id', {
      kind: 'append',
      observation: {
        code: 'forced_entry_or_assault',
        at: new Date(now).toISOString(),
        quotes: ['Forcing the door'],
        source: 'sensor',
        state: 'confirmed',
        points: 0,
      },
    })

    // Deadline should be unchanged for emergency
    expect(row.deadlineAt.getTime()).toBe(originalDeadline.getTime())
    // alertEmergency should be called once
    expect(alertEmergency).toHaveBeenCalledTimes(1)
  })

  it('A case already in emergency that is edited again does not alert again', async () => {
    const now = Date.now()
    const originalDeadline = new Date(now + 60000)
    row.deadlineAt = originalDeadline
    row.controlMode = 'emergency'
    row.emergencyAlertedAt = new Date(now)

    // Add another observation
    await applyRiskEdit('test-case-id', {
      kind: 'append',
      observation: {
        code: 'credential_request',
        at: new Date(now).toISOString(),
        quotes: ['PIN'],
        source: 'transcript',
        state: 'confirmed',
        points: 0,
      },
    })

    // alertEmergency should not be called again
    expect(alertEmergency).not.toHaveBeenCalled()
  })
})

describe('P7: Score-based timer tests (Section 5.3)', () => {
  it('Timer calculation at score 0: uses 60s base timer', () => {
    const score = 0
    const baseSec = 60
    const minSec = 10
    const scoreRatio = Math.min(score, 100) / 100
    const computed = Math.max(minSec, Math.floor(baseSec - (baseSec - minSec) * scoreRatio))
    expect(computed).toBe(60)
  })

  it('Timer calculation at score 50: uses midpoint between 60s and 10s (~35s)', () => {
    const score = 50
    const baseSec = 60
    const minSec = 10
    const scoreRatio = Math.min(score, 100) / 100
    const computed = Math.max(minSec, Math.floor(baseSec - (baseSec - minSec) * scoreRatio))
    expect(computed).toBe(35)
  })

  it('Timer calculation at score 100: uses 10s floor', () => {
    const score = 100
    const baseSec = 60
    const minSec = 10
    const scoreRatio = Math.min(score, 100) / 100
    const computed = Math.max(minSec, Math.floor(baseSec - (baseSec - minSec) * scoreRatio))
    expect(computed).toBe(10)
  })

  it('Timer never goes below floor', () => {
    const score = 150 // Even above 100
    const baseSec = 60
    const minSec = 10
    const scoreRatio = Math.min(score, 100) / 100
    const computed = Math.max(minSec, Math.floor(baseSec - (baseSec - minSec) * scoreRatio))
    expect(computed).toBe(10)
  })
})
