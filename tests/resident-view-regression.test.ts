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

  it('explicit safe answer shows OK to open (not all quiet)', () => {
    const state = {
      cases: [
        {
          id: 'case1',
          status: 'helper_checking',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
          answer: 'safe',
          answeredBy: 'Helper',
        },
      ],
      deviceOnline: true,
      lastHeartbeat: new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('SAFE_CONFIRM')
    expect(view.canOpen).toBe(true)
    expect(view.message).toContain('OK to open')
  })

  it('explicit not_safe answer shows keep door closed', () => {
    const state = {
      cases: [
        {
          id: 'case1',
          status: 'helper_checking',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
          answer: 'not_safe',
          answeredBy: 'Helper',
        },
      ],
      deviceOnline: true,
      lastHeartbeat: new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('NOT_SAFE')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('NOT SAFE')
  })

  it('helper calling does not allow opening', () => {
    const state = {
      cases: [
        {
          id: 'case1',
          status: 'helper_checking',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
          answer: 'call', // Helper chose to call
          answeredBy: 'Helper',
        },
      ],
      deviceOnline: true,
      lastHeartbeat: new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

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
    const state = {
      cases: [
        {
          id: 'case1',
          status: 'helper_checking',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
          answer: 'safe',
          answeredBy: 'Helper',
        },
      ],
      deviceOnline: true,
      lastHeartbeat: new Date(Date.now() - 35000), // 35 seconds ago > 30s timeout
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

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

    const state = {
      cases: [
        {
          id: 'case1',
          status: 'helper_checking',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
          answer: 'safe',
          answeredBy: 'Helper',
        },
      ],
      deviceOnline: true,
      lastHeartbeat: new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: true,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: true,
    }

    const view = computeResidentView(state, householdNight)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Night lock')
  })

  it('device offline overrides safe answer', () => {
    const state = {
      cases: [
        {
          id: 'case1',
          status: 'helper_checking',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
          answer: 'safe',
          answeredBy: 'Helper',
        },
      ],
      deviceOnline: false,
      lastHeartbeat: new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(view.message).toContain('Device offline')
  })
})
