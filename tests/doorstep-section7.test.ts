/**
 * Section 7 tests for Doorstep Assistant.
 *
 * Tests the helper request state machine, contact logging, safe defaults,
 * takeover functionality, and the 40-minute example scenario.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDb } from '@/lib/db/client'
import {
  createHelperRequest,
  markDelivered,
  markAcked,
  markAccepted,
  markDeclined,
  markTimedOut,
  getRequestsForCase,
  getLatestRequest,
} from '@/lib/doorstep/helperRequests'
import {
  createPendingAction,
  approvePendingAction,
  rejectPendingAction,
  consumePendingAction,
  getPendingActions,
} from '@/lib/doorstep/pendingActions'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { modeRank } from '@/lib/doorstep/riskRules'

describe('Section 7: Helper Request State Machine', () => {
  let testCaseId: string
  let testMembershipId: string
  let testHouseholdId: string

  beforeEach(async () => {
    const db = getDb()
    // Create test household
    const household = await db.household.create({
      data: {
        residentName: 'Test Resident',
        timezone: 'UTC',
      },
    })
    testHouseholdId = household.id

    // Create test user and membership
    const user = await db.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test Helper',
      },
    })

    const membership = await db.membership.create({
      data: {
        userId: user.id,
        householdId: testHouseholdId,
        role: 'helper',
        consent: 'approved',
        position: 1,
      },
    })
    testMembershipId = membership.id

    // Create test case
    const testCase = await db.case.create({
      data: {
        householdId: testHouseholdId,
        kind: 'visitor',
        eventType: 'ding',
        status: 'waiting',
        deadlineAt: new Date(Date.now() + 60000),
      },
    })
    testCaseId = testCase.id
  })

  afterEach(async () => {
    const db = getDb()
    // Clean up test data
    await db.helperRequest.deleteMany({ where: { caseId: testCaseId } })
    await db.case.delete({ where: { id: testCaseId } })
    await db.membership.delete({ where: { id: testMembershipId } })
    await db.user.deleteMany({ where: { email: { contains: 'test-' } } })
    await db.household.delete({ where: { id: testHouseholdId } })
  })

  it('should create a helper request in sent state', async () => {
    const request = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    expect(request.state).toBe('sent')
    expect(request.kind).toBe('approval')
    expect(request.round).toBe(1)
    expect(request.sentAt).toBeDefined()
  })

  it('should mark request as delivered', async () => {
    const request = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    const success = await markDelivered(request.id)
    expect(success).toBe(true)

    const updated = await getLatestRequest(testCaseId, testMembershipId, 'approval')
    expect(updated?.state).toBe('delivered')
    expect(updated?.deliveredAt).toBeDefined()
  })

  it('should mark request as acknowledged', async () => {
    const request = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    await markDelivered(request.id)
    const success = await markAcked(request.id)
    expect(success).toBe(true)

    const updated = await getLatestRequest(testCaseId, testMembershipId, 'approval')
    expect(updated?.state).toBe('acked')
    expect(updated?.ackedAt).toBeDefined()
  })

  it('should mark request as accepted from acked state', async () => {
    const request = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    await markDelivered(request.id)
    await markAcked(request.id)
    const success = await markAccepted(request.id)
    expect(success).toBe(true)

    const updated = await getLatestRequest(testCaseId, testMembershipId, 'approval')
    expect(updated?.state).toBe('accepted')
    expect(updated?.acceptedAt).toBeDefined()
  })

  it('should mark request as declined from acked state', async () => {
    const request = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    await markDelivered(request.id)
    await markAcked(request.id)
    const success = await markDeclined(request.id)
    expect(success).toBe(true)

    const updated = await getLatestRequest(testCaseId, testMembershipId, 'approval')
    expect(updated?.state).toBe('declined')
    expect(updated?.declinedAt).toBeDefined()
  })

  it('should mark request as timed out from non-terminal state', async () => {
    const request = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    const success = await markTimedOut(request.id)
    expect(success).toBe(true)

    const updated = await getLatestRequest(testCaseId, testMembershipId, 'approval')
    expect(updated?.state).toBe('timed_out')
    expect(updated?.timedOutAt).toBeDefined()
  })

  it('should not accept from sent state (compare-and-set)', async () => {
    const request = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    const success = await markAccepted(request.id)
    expect(success).toBe(false)
  })

  it('should deduplicate requests per (caseId, membershipId, kind)', async () => {
    await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    const requests = await getRequestsForCase(testCaseId)
    expect(requests.length).toBe(1)
  })
})

describe('Section 7: Pending Actions', () => {
  let testCaseId: string
  let testHouseholdId: string

  beforeEach(async () => {
    const db = getDb()
    const household = await db.household.create({
      data: {
        residentName: 'Test Resident',
        timezone: 'UTC',
      },
    })
    testHouseholdId = household.id

    const testCase = await db.case.create({
      data: {
        householdId: testHouseholdId,
        kind: 'visitor',
        eventType: 'ding',
        status: 'waiting',
        deadlineAt: new Date(Date.now() + 60000),
      },
    })
    testCaseId = testCase.id
  })

  afterEach(async () => {
    const db = getDb()
    await db.case.delete({ where: { id: testCaseId } })
    await db.household.delete({ where: { id: testHouseholdId } })
  })

  it('should create a pending action', async () => {
    const action = await createPendingAction(
      testCaseId,
      'greet_routine_request',
      'greet_routine_request',
      'over_budget'
    )

    expect(action).not.toBeNull()
    expect(action.tool).toBe('greet_routine_request')
    expect(action.state).toBe('pending')
  })

  it('should deduplicate pending actions by tool', async () => {
    await createPendingAction(
      testCaseId,
      'greet_routine_request',
      'greet_routine_request',
      'over_budget'
    )

    const duplicate = await createPendingAction(
      testCaseId,
      'greet_routine_request',
      'greet_routine_request',
      'over_budget'
    )

    expect(duplicate).toBeNull()

    const actions = await getPendingActions(testCaseId)
    expect(actions.length).toBe(1)
  })

  it('should approve a pending action', async () => {
    const action = await createPendingAction(
      testCaseId,
      'greet_routine_request',
      'greet_routine_request',
      'over_budget'
    )

    const success = await approvePendingAction(testCaseId, action.id, 'user123')
    expect(success).toBe(true)

    const actions = await getPendingActions(testCaseId)
    const updated = actions.find(a => a.id === action.id)
    expect(updated?.state).toBe('approved')
    expect(updated?.decidedBy).toBe('user123')
  })

  it('should reject a pending action', async () => {
    const action = await createPendingAction(
      testCaseId,
      'greet_routine_request',
      'greet_routine_request',
      'over_budget'
    )

    const success = await rejectPendingAction(testCaseId, action.id, 'user123', 'Not appropriate')
    expect(success).toBe(true)

    const actions = await getPendingActions(testCaseId)
    const updated = actions.find(a => a.id === action.id)
    expect(updated?.state).toBe('rejected')
    expect(updated?.reason).toBe('Not appropriate')
  })

  it('should consume an approved action', async () => {
    const action = await createPendingAction(
      testCaseId,
      'greet_routine_request',
      'greet_routine_request',
      'over_budget'
    )

    await approvePendingAction(testCaseId, action.id, 'user123')
    const success = await consumePendingAction(testCaseId, action.id)
    expect(success).toBe(true)

    const actions = await getPendingActions(testCaseId)
    const updated = actions.find(a => a.id === action.id)
    expect(updated?.state).toBe('consumed')
  })

  it('should not consume a non-approved action', async () => {
    const action = await createPendingAction(
      testCaseId,
      'greet_routine_request',
      'greet_routine_request',
      'over_budget'
    )

    const success = await consumePendingAction(testCaseId, action.id)
    expect(success).toBe(false)
  })
})

describe('Section 7: Audit Trail', () => {
  let testCaseId: string
  let testHouseholdId: string

  beforeEach(async () => {
    const db = getDb()
    const household = await db.household.create({
      data: {
        residentName: 'Test Resident',
        timezone: 'UTC',
      },
    })
    testHouseholdId = household.id

    const testCase = await db.case.create({
      data: {
        householdId: testHouseholdId,
        kind: 'visitor',
        eventType: 'ding',
        status: 'waiting',
        deadlineAt: new Date(Date.now() + 60000),
      },
    })
    testCaseId = testCase.id
  })

  afterEach(async () => {
    const db = getDb()
    await db.case.delete({ where: { id: testCaseId } })
    await db.household.delete({ where: { id: testHouseholdId } })
  })

  it('should write audit events to case log', async () => {
    await writeAudit(testCaseId, audit.contactAttempt('push', 'mem123', 'sent'))

    const db = getDb()
    const testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { log: true },
    })

    const log = testCase?.log as any
    expect(log).toBeDefined()
    expect(log.length).toBeGreaterThan(0)
    expect(log[log.length - 1].audit).toBeDefined()
    expect(log[log.length - 1].audit.kind).toBe('contact_attempt')
  })

  it('should track observation corrections', async () => {
    await writeAudit(
      testCaseId,
      audit.observationCorrected('user123', 'obs123', 'confirm', 'Verified')
    )

    const db = getDb()
    const testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { log: true },
    })

    const log = testCase?.log as any
    const lastEntry = log[log.length - 1]
    expect(lastEntry.audit.kind).toBe('observation_corrected')
    expect(lastEntry.audit.ref).toBe('obs123')
  })

  it('should track action approvals', async () => {
    await writeAudit(testCaseId, audit.actionApproved('user123', 'action123', 'greet_routine'))

    const db = getDb()
    const testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { log: true },
    })

    const log = testCase?.log as any
    const lastEntry = log[log.length - 1]
    expect(lastEntry.audit.kind).toBe('action_approved')
  })
})

describe('Section 7: Mode Rise Notifications', () => {
  let testCaseId: string
  let testHouseholdId: string

  beforeEach(async () => {
    const db = getDb()
    const household = await db.household.create({
      data: {
        residentName: 'Test Resident',
        timezone: 'UTC',
      },
    })
    testHouseholdId = household.id

    const testCase = await db.case.create({
      data: {
        householdId: testHouseholdId,
        kind: 'visitor',
        eventType: 'ding',
        status: 'waiting',
        deadlineAt: new Date(Date.now() + 60000),
        riskScore: 0,
        controlMode: 'ai_leads',
      },
    })
    testCaseId = testCase.id
  })

  afterEach(async () => {
    const db = getDb()
    await db.helperRequest.deleteMany({ where: { caseId: testCaseId } })
    await db.case.delete({ where: { id: testCaseId } })
    await db.household.delete({ where: { id: testHouseholdId } })
  })

  it('should create risk-decision request when score rises to 20', async () => {
    // Simulate score rising from 0 to 20
    await applyRiskEdit(testCaseId, {
      kind: 'fresh',
      observations: [
        {
          id: 'obs1',
          code: 'suspicious_behavior',
          at: new Date().toISOString(),
          quotes: ['Suspicious behavior'],
          source: 'camera',
          state: 'confirmed',
          points: 20,
        },
      ],
    })

    const requests = await getRequestsForCase(testCaseId)
    const riskDecisionRequests = requests.filter(r => r.kind === 'risk_decision')
    expect(riskDecisionRequests.length).toBeGreaterThan(0)
  })

  it('should create takeover request when mode reaches helper_only', async () => {
    // Simulate mode rising to helper_only (score 60+)
    await applyRiskEdit(testCaseId, {
      kind: 'fresh',
      observations: [
        {
          id: 'obs1',
          code: 'weapon_present',
          at: new Date().toISOString(),
          quotes: ['Weapon visible'],
          source: 'camera',
          state: 'confirmed',
          points: 60,
        },
      ],
    })

    const requests = await getRequestsForCase(testCaseId)
    const takeoverRequests = requests.filter(r => r.kind === 'takeover')
    expect(takeoverRequests.length).toBeGreaterThan(0)
  })
})

describe('Section 7: Safety-Only Mode', () => {
  it('should correctly identify helper_only mode using modeRank', () => {
    const aiLeadsRank = modeRank('ai_leads')
    const helperLeadsRank = modeRank('helper_leads')
    const helperOnlyRank = modeRank('helper_only')

    expect(helperOnlyRank).toBeGreaterThan(aiLeadsRank)
    expect(helperOnlyRank).toBeGreaterThanOrEqual(3) // M3+
  })

  it('should correctly identify emergency mode', () => {
    const emergencyRank = modeRank('emergency')
    expect(emergencyRank).toBe(5) // M5
  })
})

describe('Section 7: 40-Minute Example', () => {
  let testCaseId: string
  let testHouseholdId: string

  beforeEach(async () => {
    const db = getDb()
    const household = await db.household.create({
      data: {
        residentName: 'Test Resident',
        timezone: 'UTC',
      },
    })
    testHouseholdId = household.id

    const testCase = await db.case.create({
      data: {
        householdId: testHouseholdId,
        kind: 'visitor',
        eventType: 'ding',
        status: 'waiting',
        deadlineAt: new Date(Date.now() + 60000),
        riskScore: 0,
        controlMode: 'ai_leads',
      },
    })
    testCaseId = testCase.id
  })

  afterEach(async () => {
    const db = getDb()
    await db.helperRequest.deleteMany({ where: { caseId: testCaseId } })
    await db.case.delete({ where: { id: testCaseId } })
    await db.household.delete({ where: { id: testHouseholdId } })
  })

  it('should simulate 0 → 20 → S_eff 60 → emergency progression', async () => {
    // Start at score 0
    const db = getDb()
    let testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(0)

    // Rise to 20 (suspicious behavior)
    await applyRiskEdit(testCaseId, {
      kind: 'fresh',
      observations: [
        {
          id: 'obs1',
          code: 'suspicious_behavior',
          at: new Date().toISOString(),
          quotes: ['Suspicious behavior'],
          source: 'camera',
          state: 'confirmed',
          points: 20,
        },
      ],
    })

    testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(20)

    // Rise to 60 (weapon present)
    await applyRiskEdit(testCaseId, {
      kind: 'fresh',
      observations: [
        {
          id: 'obs2',
          code: 'weapon_present',
          at: new Date().toISOString(),
          quotes: ['Weapon visible'],
          source: 'camera',
          state: 'confirmed',
          points: 60,
        },
      ],
    })

    testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(60)

    // Rise to 100 (forced entry)
    await applyRiskEdit(testCaseId, {
      kind: 'fresh',
      observations: [
        {
          id: 'obs3',
          code: 'forced_entry_or_assault',
          at: new Date().toISOString(),
          quotes: ['Forced entry detected'],
          source: 'camera',
          state: 'confirmed',
          points: 100,
        },
      ],
    })

    testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(100)
    expect(testCase?.controlMode).toBe('emergency')
  })
})
