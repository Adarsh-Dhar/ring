/**
 * Server-computed ResidentView
 * Pure function: (state, household) → ResidentView
 * Priority is fixed in code for fail-closed behavior
 */

import { Household } from '@prisma/client'

export type ResidentViewState =
  | 'CLOSED_KEEP_SHUT'      // Connection lost, offline, or night lock - keep door closed
  | 'WAITING'              // Ring received, waiting for helper response
  | 'HELPER_CHECKING'      // Helper responded, verifying
  | 'SAFE_CONFIRM'         // Helper confirmed safe
  | 'NOT_SAFE'             // Helper confirmed not safe
  | 'ALL_CLEAR'            // No active cases, all quiet

export interface ResidentView {
  state: ResidentViewState
  message: string
  backgroundColor: string
  textColor: string
  showVideo: boolean
  showFaces: boolean
  canOpen: boolean
  helperName?: string
  helperEmoji?: string
  timeSince?: string
  caseId?: string
}

export interface CaseInfo {
  id: string
  status: string
  kind: string
  createdAt: Date
  helperIndex: number
  deadlineAt: Date
  answer?: string
  answeredBy?: string
  visitor?: string
  visitIcon?: string
  visitLabel?: string
  checkWho?: string
  checkWord?: string
  expectedId?: string
  regularId?: string
}

export interface StateInfo {
  cases: CaseInfo[]
  deviceOnline: boolean
  lastHeartbeat: Date | null
  timezone: string
  quietEnabled: boolean
  quietStartHour: number
  quietEndHour: number
  nightLockActive: boolean
}

/**
 * Compute ResidentView from state and household
 * This is a pure function with fixed priority order for fail-closed behavior
 */
export function computeResidentView(state: StateInfo, household: Household): ResidentView {
  const now = new Date()
  const householdTime = getHouseholdTime(now, household.timezone)

  // Priority 1: Night lock (highest priority - keeps door closed)
  if (household.quietEnabled && isInQuietHours(householdTime, household.quietStartHour, household.quietEndHour)) {
    return {
      state: 'CLOSED_KEEP_SHUT',
      message: 'Night lock active - keep door closed',
      backgroundColor: '#1a1a2e',
      textColor: '#ffffff',
      showVideo: false,
      showFaces: false,
      canOpen: false,
    }
  }

  // Priority 2: Connection lost (no heartbeat in 30 seconds)
  const HEARTBEAT_TIMEOUT_MS = 30 * 1000
  if (state.lastHeartbeat && (now.getTime() - state.lastHeartbeat.getTime() > HEARTBEAT_TIMEOUT_MS)) {
    return {
      state: 'CLOSED_KEEP_SHUT',
      message: 'Connection lost - keep door closed',
      backgroundColor: '#2d1b1b',
      textColor: '#ffffff',
      showVideo: false,
      showFaces: false,
      canOpen: false,
    }
  }

  // Priority 3: Device offline
  if (!state.deviceOnline) {
    return {
      state: 'CLOSED_KEEP_SHUT',
      message: 'Device offline - keep door closed',
      backgroundColor: '#2d1b1b',
      textColor: '#ffffff',
      showVideo: false,
      showFaces: false,
      canOpen: false,
    }
  }

  // Priority 4: Active cases
  const activeCases = state.cases.filter(c =>
    c.status === 'waiting' || c.status === 'open' || c.status === 'helper_checking'
  )

  if (activeCases.length > 0) {
    // Get the most recent active case
    const activeCase = activeCases.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

    // Case-specific states
    if (activeCase.status === 'helper_checking') {
      return {
        state: 'HELPER_CHECKING',
        message: `${activeCase.answeredBy || 'Helper'} is checking...`,
        backgroundColor: '#ff9800',
        textColor: '#000000',
        showVideo: true,
        showFaces: true,
        canOpen: false,
        helperName: activeCase.answeredBy,
        timeSince: formatTimeSince(activeCase.createdAt),
        caseId: activeCase.id,
      }
    }

    if (activeCase.answer === 'safe') {
      return {
        state: 'SAFE_CONFIRM',
        message: `${activeCase.answeredBy || 'Helper'} confirmed: OK to open`,
        backgroundColor: '#4caf50',
        textColor: '#ffffff',
        showVideo: true,
        showFaces: true,
        canOpen: true,
        helperName: activeCase.answeredBy,
        timeSince: formatTimeSince(activeCase.createdAt),
        caseId: activeCase.id,
      }
    }

    if (activeCase.answer === 'not_safe') {
      return {
        state: 'NOT_SAFE',
        message: `${activeCase.answeredBy || 'Helper'} confirmed: NOT SAFE`,
        backgroundColor: '#f44336',
        textColor: '#ffffff',
        showVideo: true,
        showFaces: true,
        canOpen: false,
        helperName: activeCase.answeredBy,
        timeSince: formatTimeSince(activeCase.createdAt),
        caseId: activeCase.id,
      }
    }

    // Waiting for helper response
    const visitorInfo = activeCase.visitor ? activeCase.visitor :
                      activeCase.visitLabel ? activeCase.visitLabel :
                      activeCase.checkWho ? activeCase.checkWho :
                      'Unknown'

    return {
      state: 'WAITING',
      message: `Waiting for helper response...`,
      backgroundColor: '#2196f3',
      textColor: '#ffffff',
      showVideo: true,
      showFaces: true,
      canOpen: false,
      timeSince: formatTimeSince(activeCase.createdAt),
      caseId: activeCase.id,
    }
  }

  // Priority 5: All clear (no active cases)
  return {
    state: 'ALL_CLEAR',
    message: 'All quiet',
    backgroundColor: '#1a1a2e',
    textColor: '#ffffff',
    showVideo: false,
    showFaces: false,
    canOpen: false,
  }
}

/**
 * Get current time in household timezone
 */
function getHouseholdTime(date: Date, timezone: string): Date {
  // Simple timezone handling - in production would use luxon or similar
  // For now, just return the date (assumes server is in same timezone)
  return date
}

/**
 * Check if current time is in quiet hours
 */
function isInQuietHours(date: Date, startHour: number, endHour: number): boolean {
  const hour = date.getHours()

  if (startHour < endHour) {
    // Same day, e.g., 22:00 - 06:00
    return hour >= startHour || hour < endHour
  } else {
    // Overnight, e.g., 22:00 - 06:00 (next day)
    return hour >= startHour || hour < endHour
  }
}

/**
 * Format time since a given date
 */
function formatTimeSince(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)

  if (diffSec < 60) {
    return `${diffSec}s ago`
  } else if (diffMin < 60) {
    return `${diffMin}m ago`
  } else {
    const diffHour = Math.floor(diffMin / 60)
    return `${diffHour}h ago`
  }
}

/**
 * Property-based test helper
 * Ensures that fail-closed states always have canOpen: false
 */
export function validateResidentView(view: ResidentView): boolean {
  if (view.state === 'CLOSED_KEEP_SHUT' && view.canOpen) {
    console.error('FAIL-CLOSED VIOLATION: CLOSED_KEEP_SHUT has canOpen: true')
    return false
  }

  if (view.state === 'NOT_SAFE' && view.canOpen) {
    console.error('FAIL-CLOSED VIOLATION: NOT_SAFE has canOpen: true')
    return false
  }

  if (view.state === 'WAITING' && view.canOpen) {
    console.error('FAIL-CLOSED VIOLATION: WAITING has canOpen: true')
    return false
  }

  if (view.state === 'HELPER_CHECKING' && view.canOpen) {
    console.error('FAIL-CLOSED VIOLATION: HELPER_CHECKING has canOpen: true')
    return false
  }

  return true
}
