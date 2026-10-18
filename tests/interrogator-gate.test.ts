import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isUnplannedVisit } from '@/lib/ai/interrogation/gate'

// Mock database and preferences for gate tests
const mockDb = {
  case: {
    findUnique: vi.fn(),
  },
}
const mockPrefs = {
  delegation: {
    greet_visitor: 'ai',
    ask_purpose: 'ai',
    ask_for_id: 'ai',
    tell_visitor_to_leave: 'helper',
    accept_parcel: 'helper',
    approve_short_notice: 'helper',
  },
}

vi.mock('@/lib/db/client', () => ({ getDb: () => mockDb }))
vi.mock('@/lib/db/preferences', () => ({ getPreferences: async () => mockPrefs }))
vi.mock('@/lib/doorstep/caseRiskStore', () => ({
  requestHelperDecision: vi.fn().mockResolvedValue(undefined),
}))

import { allowedLines, gateOrAsk } from '@/lib/ai/agents/interrogator'
import { requestHelperDecision } from '@/lib/doorstep/caseRiskStore'

describe('isUnplannedVisit gate', () => {
  it('returns false for planned expected visits', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'expected', expectedId: null, recurringId: null })).toBe(false)
  })

  it('returns false when expectedId is set', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: 'some-id', recurringId: null })).toBe(false)
  })

  it('returns false when recurringId is set', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: null, recurringId: 'some-id' })).toBe(false)
  })

  it('returns true for normal lane without expectedId or recurringId', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: null, recurringId: null })).toBe(true)
  })

  it('returns false for non-visitor kinds', () => {
    expect(isUnplannedVisit({ kind: 'sos', lane: 'normal', expectedId: null, recurringId: null })).toBe(false)
  })

  it('returns true for a demoted case (lane: normal, no expectedId/recurringId)', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: null, recurringId: null })).toBe(true)
  })
})

describe('patch 6: allowedLines and over-budget behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('S_eff 25 with default preferences: greet is blocked, reprompt and close are allowed', async () => {
    mockDb.case.findUnique.mockResolvedValue({
      riskScore: 25,
      controlMode: 'ai_assisted',
      noticeStatus: null,
      status: 'waiting',
    })
    const allowed = await allowedLines('hh1', 'case1')
    expect(allowed.greet).toBe(false)
    expect(allowed.reprompt).toBe(true)
    expect(allowed.close).toBe(true)
  })

  it('S_eff 60: reprompt is blocked, boundary and close are allowed', async () => {
    mockDb.case.findUnique.mockResolvedValue({
      riskScore: 60,
      controlMode: 'helper_only',
      noticeStatus: null,
      status: 'waiting',
    })
    const allowed = await allowedLines('hh1', 'case1')
    expect(allowed.reprompt).toBe(false)
    expect(allowed.boundary_stated).toBe(true)
    expect(allowed.close).toBe(true)
  })

  it('over-budget greeting calls requestHelperDecision once and shortens deadline', async () => {
    mockDb.case.findUnique.mockResolvedValue({
      riskScore: 25,
      controlMode: 'ai_assisted',
      noticeStatus: null,
      status: 'waiting',
      deadlineAt: new Date(Date.now() + 120000),
    })
    await gateOrAsk('hh1', 'case1', 'greet_routine_request')
    expect(requestHelperDecision).toHaveBeenCalledTimes(1)
  })

  it('within-budget greeting does not call requestHelperDecision', async () => {
    mockDb.case.findUnique.mockResolvedValue({
      riskScore: 0,
      controlMode: 'ai_leads',
      noticeStatus: null,
      status: 'waiting',
    })
    await gateOrAsk('hh1', 'case1', 'greet_routine_request')
    expect(requestHelperDecision).not.toHaveBeenCalled()
  })

  it('short_notice waiting allows only cost 0 lines: close is true, boundary is false', async () => {
    mockDb.case.findUnique.mockResolvedValue({
      riskScore: 25,
      controlMode: 'ai_assisted',
      noticeStatus: 'short_notice',
      status: 'waiting',
    })
    const allowed = await allowedLines('hh1', 'case1')
    expect(allowed.close).toBe(true)
    expect(allowed.boundary_stated).toBe(false)
  })
})
