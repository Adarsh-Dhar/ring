/**
 * Property-based tests for ResidentView
 * Ensures fail-closed behavior is guaranteed
 */

import { describe, it, expect } from 'vitest'
import { computeResidentView, validateResidentView, ResidentViewState } from '@/lib/state/resident-view'
import { Household } from '@prisma/client'

describe('ResidentView - Fail-Closed Properties', () => {
  it('should always return canOpen: false for CLOSED_KEEP_SHUT', () => {
    const household: Household = {
      id: 'test',
      residentName: 'Test',
      timezone: 'Asia/Kolkata',
      timeoutSec: 30,
      quietStartHour: 22,
      quietEndHour: 6,
      quietEnabled: true,
      emergencyNumber: '112',
      residentEpoch: 1,
      createdAt: new Date(),
      plannedMode: 'helper',
      requireResidentOk: false,
      preset: 'standard',
    }

    const state = {
      cases: [],
      deviceOnline: true,
      lastHeartbeat: new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: true,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: true,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
    expect(validateResidentView(view)).toBe(true)
  })

  it('should prioritize night lock over waiting cases', () => {
    const household: Household = {
      id: 'test',
      residentName: 'Test',
      timezone: 'Asia/Kolkata',
      timeoutSec: 30,
      quietStartHour: 22,
      quietEndHour: 6,
      quietEnabled: true,
      emergencyNumber: '112',
      residentEpoch: 1,
      createdAt: new Date(),
      plannedMode: 'helper',
      requireResidentOk: false,
      preset: 'standard',
    }

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
      timezone: 'Asia/Kolkata',
      quietEnabled: true,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: true,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
  })

  it('should prioritize connection lost over waiting cases', () => {
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
      lastHeartbeat: new Date(Date.now() - 40000), // 40 seconds ago
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('CLOSED_KEEP_SHUT')
    expect(view.canOpen).toBe(false)
  })

  it('should prioritize device offline over waiting cases', () => {
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
  })

  it('should allow canOpen: true only for SAFE_CONFIRM', () => {
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

    const state = {
      cases: [
        {
          id: 'case1',
          status: 'answered',
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
  })

  it('should return ALL_CLEAR when no active cases', () => {
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

    const state = {
      cases: [],
      deviceOnline: true,
      lastHeartbeat: new Date(),
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('ALL_CLEAR')
    expect(view.canOpen).toBe(false)
  })

  it('should return NOT_SAFE with canOpen: false', () => {
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

    const state = {
      cases: [
        {
          id: 'case1',
          status: 'answered',
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
  })

  it('should return WAITING with canOpen: false', () => {
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
      timezone: 'Asia/Kolkata',
      quietEnabled: false,
      quietStartHour: 22,
      quietEndHour: 6,
      nightLockActive: false,
    }

    const view = computeResidentView(state, household)

    expect(view.state).toBe('WAITING')
    expect(view.canOpen).toBe(false)
  })

  it('should return HELPER_CHECKING with canOpen: false', () => {
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

    const state = {
      cases: [
        {
          id: 'case1',
          status: 'answered',
          kind: 'doorbell',
          createdAt: new Date(),
          helperIndex: 0,
          deadlineAt: new Date(Date.now() + 30000),
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

    expect(view.state).toBe('HELPER_CHECKING')
    expect(view.canOpen).toBe(false)
  })
})
