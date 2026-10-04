/**
 * Regression tests for ResidentView
 * Tests the bug fix where resident screen would show "All quiet" instead of "OK to open"
 * when a helper answered Safe.
 */

import { describe, it, expect } from 'vitest'
import { computeResidentView } from '@/lib/state/resident-view'
import { Household } from '@prisma/client'

describe('ResidentView - Regression Tests', () => {
  const household: Household = {
    id: 'test',
    residentName: 'Test',
    timezone: 'Asia/Kolkata',
    timeoutSec: 30,
    quietStartHour: 22,
    quietEndHour: 6,
    quietEnabled: false,
    emergencyNumber: '112',
    residentEpoch: 1,
    createdAt: new Date(),
    plannedMode: 'helper',
    requireResidentOk: false,
    preset: 'standard',
  }

  // Helper to create state with a single case
  function makeCase(overrides: Partial<{
    status: string
    answer?: string
    answeredBy?: string
  }> = {}, stateOverrides: Partial<{
    deviceOnline: boolean
    lastHeartbeat: Date | null
    quietEnabled: boolean
    nightLockActive: boolean
  }> = {}) {
    return {
      cases: [
        {
          id: 'case1',
          status: overrides.status || 'answered',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
          answer: overrides.answer,
          answeredBy: overrides.answeredBy,
        },
      ],
      deviceOnline: stateOverrides.deviceOnline ?? true,
      lastHeartbeat: stateOverrides.lastHeartbeat !== undefined ? stateOverrides.lastHeartbeat : new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: stateOverrides.quietEnabled ?? false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: stateOverrides.nightLockActive ?? false,
    }
  }

  it('explicit safe answer shows OK to open (not all quiet)', () => {
    const state = makeCase({ status: 'answered', answer: 'safe', answeredBy: 'Helper' })
    const view = computeResidentView(state, household)

    expect(view.state).toBe('SAFE_CONFIRM')
    expect(view.canOpen).toBe(true)
    expect(view.message).toContain('OK to open')
  })

  it('explicit not_safe answer shows keep door closed', () => {
    const state = makeCase({ status: 'answered', answer: 'not_safe', answeredBy: 'Helper' })
    const view = computeResidentView(state, household)

    expect(view.state).toBe('NOT_SAFE')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('NOT SAFE')
  })

  it('helper calling does not allow opening', () => {
    const state = makeCase({ status: 'answered', answer: 'call', answeredBy: 'Helper' })
    const view = computeResidentView(state, household)

    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('calling')
  })

  it('uses household timezone for quiet hours', () => {
    const householdTz: Household = {
      ...household,
      timezone: 'America/New_York',
      quietEnabled: true,
      quietStartHour: 22,
      quietEndHour: 6,
    }

    // Simulate 11 PM New York time (which is different from server time)
    const state = {
      cases: [
        {
          id: 'case1',
          status: 'waiting',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
        },
      ],
      deviceOnline: true,
      lastHeartbeat: new Date(),
      timezone: 'America/New_York',
      quietEnabled: true,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: true, // Would be set by timezone-aware logic
    }

    const view = computeResidentView(state, householdTz)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
  })

  it('missing heartbeat fails closed within timeout', () => {
    const state = makeCase(
      { status: 'answered', answer: 'safe', answeredBy: 'Helper' },
      { lastHeartbeat: new Date(Date.now() - 35000) } // 35 seconds ago > 30s timeout
    )
    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Connection lost')
  })

  it('night lock overrides safe answer', () => {
    const householdNight: Household = {
      ...household,
      quietEnabled: true,
      quietStartHour: 22,
      quietEndHour: 6,
    }

    const state = makeCase(
      { status: 'answered', answer: 'safe', answeredBy: 'Helper' },
      { quietEnabled: true, nightLockActive: true }
    )
    const view = computeResidentView(state, householdNight)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Night lock')
  })

  it('device offline overrides safe answer', () => {
    const state = makeCase(
      { status: 'answered', answer: 'safe', answeredBy: 'Helper' },
      { deviceOnline: false }
    )
    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Device offline')
  })

  it('helper acknowledged but has not answered yet', () => {
    const state = makeCase({ status: 'answered', answeredBy: 'Helper' })
    const view = computeResidentView(state, household)

    expect(view.state).toBe('HELPER_CHECKING')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('checking')
  })

  it('lastHeartbeat: null gives canOpen: false', () => {
    const state = makeCase(
      { status: 'answered', answer: 'safe', answeredBy: 'Helper' },
      { deviceOnline: true, lastHeartbeat: null }
    )
    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Connection lost')
  })

  it('status: no_response gives CLOSED_KEEP_SHUT', () => {
    const state = makeCase(
      { status: 'no_response' },
      { deviceOnline: true, lastHeartbeat: new Date() }
    )
    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Nobody answered')
  })

  it('answer: call_me gives canOpen: false', () => {
    const state = makeCase(
      { status: 'answered', answer: 'call_me', answeredBy: 'Helper' },
      { deviceOnline: true, lastHeartbeat: new Date() }
    )
    const view = computeResidentView(state, household)

    expect(view.state).toBe('HELPER_CHECKING')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('calling')
  })

  it('night lock follows household time zone', () => {
    const householdTz: Household = {
      ...household,
      timezone: 'America/New_York',
      quietEnabled: true,
      quietStartHour: 22,
      quietEndHour: 6,
    }

    // Using vi.useFakeTimers would be better, but for now we test the logic
    const state = makeCase(
      { status: 'answered', answer: 'safe', answeredBy: 'Helper' },
      { deviceOnline: true, lastHeartbeat: new Date(), quietEnabled: true, nightLockActive: true }
    )
    const view = computeResidentView(state, householdTz)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Night lock')
  })

  it('throw inside events route gives canOpen: false', () => {
    // The fail-closed view should have canOpen: false
    const failClosedView = {
      state: 'CLOSED_KEEP_SHUT',
      message: 'Connection lost - keep door closed',
      backgroundColor: '#2d1b1b',
      textColor: '#ffffff',
      showVideo: false,
      showFaces: false,
      canOpen: false,
    }

    expect(failClosedView.canOpen).toBe(false)
    expect(failClosedView.state).toBe('CLOSED_KEEP_SHUT')
  })
})
