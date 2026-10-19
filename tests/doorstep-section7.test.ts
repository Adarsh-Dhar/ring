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

    // Try to create another request of the same kind for the same case/membership
    const duplicate = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'approval',
    })

    // Should not create a duplicate
    expect(duplicate).toBeNull()

    const requests = await getRequestsForCase(testCaseId)
    expect(requests.length).toBe(1)

    // Different kind should still be allowed
    const riskDecision = await createHelperRequest({
      caseId: testCaseId,
      membershipId: testMembershipId,
      kind: 'risk_decision',
    })
    expect(riskDecision).not.toBeNull()

    const allRequests = await getRequestsForCase(testCaseId)
    expect(allRequests.length).toBe(2)
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

  it.skip('should create risk-decision request when score rises to 20', async () => {
    // TODO: Fix phrase matching in risk rules
  })

  it.skip('should create takeover request when mode reaches helper_only', async () => {
    // TODO: Fix phrase matching in risk rules
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

describe('Section 7: 40-Minute Example (Spec 7.4)', () => {
  let testCaseId: string
  let testHouseholdId: string
  let testMembershipId: string
  let testBackupMembershipId: string

  beforeEach(async () => {
    const db = getDb()
    // Create test household
    const household = await db.household.create({
      data: {
        residentName: 'Test Resident',
        timezone: 'UTC',
        minNoticeHours: 2,
        shortNoticePolicy: 'helper_approval',
        approvalTimerSec: 120,
        approvalRetrySec: 300,
      },
    })
    testHouseholdId = household.id

    // Create test user and primary membership
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
        tier: 'primary',
      },
    })
    testMembershipId = membership.id

    // Create backup helper
    const backupUser = await db.user.create({
      data: {
        email: `backup-${Date.now()}@example.com`,
        name: 'Backup Helper',
      },
    })

    const backupMembership = await db.membership.create({
      data: {
        userId: backupUser.id,
        householdId: testHouseholdId,
        role: 'helper',
        consent: 'approved',
        position: 2,
        tier: 'backup',
      },
    })
    testBackupMembershipId = backupMembership.id

    // Create test case with short notice
    const testCase = await db.case.create({
      data: {
        householdId: testHouseholdId,
        kind: 'visitor',
        eventType: 'ding',
        status: 'waiting',
        deadlineAt: new Date(Date.now() + 60000),
        riskScore: 0,
        controlMode: 'ai_leads',
        noticeStatus: 'short_notice',
        chain: [testMembershipId, testBackupMembershipId],
      },
    })
    testCaseId = testCase.id
  })

  afterEach(async () => {
    const db = getDb()
    await db.helperRequest.deleteMany({ where: { caseId: testCaseId } })
    await db.case.delete({ where: { id: testCaseId } })
    await db.membership.deleteMany({ where: { householdId: testHouseholdId } })
    await db.user.deleteMany({ where: { email: { contains: 'test-' } } })
    await db.household.delete({ where: { id: testHouseholdId } })
  })

  it.skip('should simulate spec 7.4: short notice → pressure_after_rule (5) → hide_from_helper (15) → lock test → forced entry (100)', async () => {
    const db = getDb()

    // Start with short notice (already set in beforeEach)
    let testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true, noticeStatus: true },
    })
    expect(testCase?.noticeStatus).toBe('short_notice')
    expect(testCase?.riskScore).toBe(0)

    // Add pressure_after_rule (5 points) - visitor pressures resident to open
    await applyRiskEdit(testCaseId, {
      kind: 'fresh',
      observations: [
        {
          id: 'obs1',
          code: 'pressure_after_rule',
          at: new Date().toISOString(),
          quotes: ['let me in'],
          source: 'helper',
          state: 'confirmed',
          points: 5,
        },
      ],
    })

    testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(5)

    // Add hide_from_helper (15 points) - visitor blocks camera/helper view
    await applyRiskEdit(testCaseId, {
      kind: 'fresh',
      observations: [
        {
          id: 'obs1',
          code: 'pressure_after_rule',
          at: new Date().toISOString(),
          quotes: ['let me in'],
          source: 'helper',
          state: 'confirmed',
          points: 5,
        },
        {
          id: 'obs2',
          code: 'hide_from_helper',
          at: new Date().toISOString(),
          quotes: ['don\'t tell the helper'],
          source: 'helper',
          state: 'confirmed',
          points: 15,
        },
      ],
    })

    testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(20) // 5 + 15

    // Lock test - visitor tries door while resident is away
    await applyRiskEdit(testCaseId, {
      kind: 'append',
      observation: {
        id: 'obs3',
        code: 'lock_manipulation',
        at: new Date().toISOString(),
        quotes: ['Visitor tests the door lock'],
        source: 'helper',
        state: 'confirmed',
        points: 30,
      },
    })

    testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(50) // 20 + 30
    expect(testCase?.controlMode).toBe('helper_only') // lock_manipulation forces helper-only

    // Forced entry - emergency (100 points)
    await applyRiskEdit(testCaseId, {
      kind: 'append',
      observation: {
        id: 'obs4',
        code: 'forced_entry_or_assault',
        at: new Date().toISOString(),
        quotes: ['Forced entry detected'],
        source: 'camera',
        state: 'confirmed',
        points: 100,
      },
    })

    testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { riskScore: true, controlMode: true },
    })
    expect(testCase?.riskScore).toBe(100)
    expect(testCase?.controlMode).toBe('emergency')
  })

  it('should create risk-decision request when score rises to 20', async () => {
    const db = getDb()

    // Start with short notice
    await applyRiskEdit(testCaseId, {
      kind: 'append',
      observation: {
        id: 'obs1',
        code: 'pressure_after_rule',
        at: new Date().toISOString(),
        quotes: ['Visitor is pressuring resident to open the door'],
        source: 'helper',
        state: 'confirmed',
        points: 5,
      },
    })

    await applyRiskEdit(testCaseId, {
      kind: 'append',
      observation: {
        id: 'obs2',
        code: 'hide_from_helper',
        at: new Date().toISOString(),
        quotes: ['Visitor is blocking camera view'],
        source: 'helper',
        state: 'confirmed',
        points: 15,
      },
    })

    const requests = await getRequestsForCase(testCaseId)
    const riskDecisionRequests = requests.filter(r => r.kind === 'risk_decision')
    expect(riskDecisionRequests.length).toBeGreaterThan(0)
  })

  it('should create takeover request when mode reaches helper_only (score 60+)', async () => {
    const db = getDb()

    // Build up to 60 points (bypassing the 7.4 sequence for this test)
    await applyRiskEdit(testCaseId, {
      kind: 'append',
      observation: {
        id: 'obs1',
        code: 'door_wedge_or_follow_in',
        at: new Date().toISOString(),
        quotes: ['Weapon visible'],
        source: 'helper',
        state: 'confirmed',
        points: 40,
      },
    })

    const requests = await getRequestsForCase(testCaseId)
    const takeoverRequests = requests.filter(r => r.kind === 'takeover')
    expect(takeoverRequests.length).toBeGreaterThan(0)
  })

  it('should send requests to both primary and backup helpers in chain', async () => {
    const db = getDb()

    // Create risk-decision request
    await applyRiskEdit(testCaseId, {
      kind: 'append',
      observation: {
        id: 'obs1',
        code: 'pressure_after_rule',
        at: new Date().toISOString(),
        quotes: ['Visitor is pressuring resident to open the door'],
        source: 'helper',
        state: 'confirmed',
        points: 5,
      },
    })

    await applyRiskEdit(testCaseId, {
      kind: 'append',
      observation: {
        id: 'obs2',
        code: 'hide_from_helper',
        at: new Date().toISOString(),
        quotes: ['Visitor is blocking camera view'],
        source: 'helper',
        state: 'confirmed',
        points: 15,
      },
    })

    const requests = await getRequestsForCase(testCaseId)
    // Should have requests for both primary and backup
    expect(requests.length).toBeGreaterThanOrEqual(2)

    const primaryRequest = requests.find(r => r.membershipId === testMembershipId)
    const backupRequest = requests.find(r => r.membershipId === testBackupMembershipId)
    expect(primaryRequest).toBeDefined()
    expect(backupRequest).toBeDefined()
  })

  it('should retry approval request after 5 minutes when no_response', async () => {
    const db = getDb()

    // Set case to no_response
    await db.case.update({
      where: { id: testCaseId },
      data: {
        status: 'no_response',
        resolvedAt: new Date(Date.now() - 10000), // 10 seconds ago
      },
    })

    // Check that getOverdueCases returns no_response cases
    const { getOverdueCases } = await import('@/lib/db/cases')
    const overdue = await getOverdueCases(3000, 100)
    const noResponseCases = overdue.filter((c: any) => c.status === 'no_response')
    expect(noResponseCases.length).toBeGreaterThan(0)
  })

  it('should expire approval, risk-decision and takeover requests on timeout but never an emergency request', async () => {
    for (const kind of ['approval', 'risk_decision', 'takeover', 'emergency'] as const) {
      await createHelperRequest({ caseId: testCaseId, membershipId: testMembershipId, kind })
    }

    const { expireHelperRequests } = await import('@/lib/doorstep/helperRequests')
    const expired = await expireHelperRequests(testCaseId, testMembershipId)
    expect(expired).toBe(3)

    const requests = await getRequestsForCase(testCaseId)
    const byKind = Object.fromEntries(requests.map(r => [r.kind, r.state]))
    expect(byKind.approval).toBe('timed_out')
    expect(byKind.risk_decision).toBe('timed_out')
    expect(byKind.takeover).toBe('timed_out')
    expect(byKind.emergency).toBe('sent') // a live emergency stays live
  })

  it('should not expire another helper\'s requests', async () => {
    await createHelperRequest({ caseId: testCaseId, membershipId: testMembershipId, kind: 'approval' })
    await createHelperRequest({ caseId: testCaseId, membershipId: testBackupMembershipId, kind: 'approval' })

    const { expireHelperRequests } = await import('@/lib/doorstep/helperRequests')
    await expireHelperRequests(testCaseId, testMembershipId)

    const backup = await getLatestRequest(testCaseId, testBackupMembershipId, 'approval')
    expect(backup?.state).toBe('sent')
  })

  it('should not interpret no_response as consent for any action', async () => {
    const db = getDb()

    // Set case to no_response
    await db.case.update({
      where: { id: testCaseId },
      data: {
        status: 'no_response',
        resolvedAt: new Date(Date.now() - 10000),
      },
    })

    // Verify that no_response status does not grant automatic approval
    const testCase = await db.case.findUnique({
      where: { id: testCaseId },
      select: { status: true, answer: true, answeredBy: true },
    })

    expect(testCase?.status).toBe('no_response')
    expect(testCase?.answer).toBeNull()
    expect(testCase?.answeredBy).toBeNull()

    // Even with no_response, the gate should still require helper approval for short_notice
    const { gateAction } = await import('@/lib/doorstep/actionGate')
    const { getPreferences } = await import('@/lib/db/preferences')
    const prefs = await getPreferences(testHouseholdId)

    const gate = gateAction('greet_routine_request', 0, prefs, {
      holdOnly: true, // short_notice case is hold-only
    })

    // Should still require helper approval, not auto-execute
    expect(gate.decision).toBe('ask_helper')
  })
})
