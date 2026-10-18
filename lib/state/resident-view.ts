/**
 * Server-computed ResidentView
 * Pure function: (state, household) → ResidentView
 * Priority is fixed in code for fail-closed behavior
 */

import { Household } from '@prisma/client'
import { residentScreenFor, type ControlMode } from '@/lib/doorstep/modeCopy'
import { maxMode, modeRank } from '@/lib/doorstep/riskRules'

export type ResidentViewState =
  | 'CLOSED_KEEP_SHUT'      // Connection lost, offline, or night lock - keep door closed
  | 'EMERGENCY'            // P11: Immediate threat or forced entry - keep door closed, move away
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
  riskScore?: number    // P11: For confirmed emergency detection
  controlMode?: string  // P11: For confirmed emergency detection
  /** P11: When the resident acknowledged the case (ackedAt is set). */
  ackedAt?: Date | null
  /** P11: Effective control mode for resident screen text. */
  effectiveMode?: ControlMode
  /** Spec 4.3: set when an uncertain forced_entry_or_assault has been observed (camera description alone).
   *  The resident must be shown the keep-closed message even before confirmation arrives. */
  unconfirmedAlertedAt?: Date | null
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
  if (state.nightLockActive || (household.quietEnabled &&
    isInQuietHours(householdTime, household.quietStartHour, household.quietEndHour))) {
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
  if (!state.lastHeartbeat || now.getTime() - state.lastHeartbeat.getTime() > HEARTBEAT_TIMEOUT_MS) {
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
    c.status === 'waiting' || c.status === 'open' || c.status === 'helper_checking' ||
    c.status === 'answered' || c.status === 'no_response'
  )

  if (activeCases.length > 0) {
    // Get the most recent active case
    const activeCase = activeCases.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]

    // P11 / Spec 4.3: Emergency detection — confirmed OR unconfirmed forced entry both trigger keep-closed.
    // Confirmed: riskScore===100 or controlMode==='emergency'.
    // Unconfirmed (spec 4.3 camera-description-alone path): unconfirmedAlertedAt is set.
    if (activeCase.riskScore === 100 || activeCase.controlMode === 'emergency' || activeCase.unconfirmedAlertedAt) {
      // Spec 6.2: confirmed emergency shows the exact M5 text. An unconfirmed (uncertain) alert shows the text of the
      // current mode, never lower than M3, and never claims help is coming before a helper accepts.
      const confirmedEmergency = activeCase.riskScore === 100 || activeCase.controlMode === 'emergency'
      const emergencyMode: ControlMode = confirmedEmergency
        ? 'emergency'
        : maxMode((activeCase.effectiveMode as ControlMode) ?? 'ai_leads', 'helper_only')
      return {
        state: 'EMERGENCY',
        message: residentScreenFor(emergencyMode, !!activeCase.ackedAt),
        backgroundColor: '#b71c1c',
        textColor: '#ffffff',
        showVideo: true,
        showFaces: true,
        canOpen: false,
        timeSince: formatTimeSince(activeCase.createdAt),
        caseId: activeCase.id,
      }
    }

    // Case-specific states - explicit answer wins
    // P12: Never set canOpen or show "OK to open" while the mode is M1 or higher
    const effectiveMode = (activeCase.effectiveMode as ControlMode) ?? 'ai_leads'
    const modeRankVal = ['ai_leads', 'ai_assisted', 'helper_leads', 'helper_only', 'helper_urgent', 'emergency'].indexOf(effectiveMode)
    const isM1OrHigher = modeRankVal >= 1
    const helperAcceptedEarly = !!activeCase.ackedAt

    if (activeCase.answer === 'safe') {
      return {
        state: 'SAFE_CONFIRM',
        // Spec 6.2: at M1 or higher the screen shows the mode text, never "OK to open".
        message: isM1OrHigher
          ? residentScreenFor(effectiveMode, helperAcceptedEarly)
          : `${activeCase.answeredBy || 'Helper'} confirmed: OK to open`,
        backgroundColor: '#4caf50',
        textColor: '#ffffff',
        showVideo: true,
        showFaces: true,
        canOpen: !isM1OrHigher, // P12: Can't open at M1 or higher
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

    if (activeCase.answer === 'call' || activeCase.answer === 'call_me') {
      return {
        state: 'HELPER_CHECKING',
        message: isM1OrHigher
          ? residentScreenFor(effectiveMode, true)
          : `${activeCase.answeredBy || 'Helper'} is calling you`,
        backgroundColor: '#2196f3',
        textColor: '#ffffff',
        showVideo: true,
        showFaces: true,
        canOpen: false,
        helperName: activeCase.answeredBy,
        timeSince: formatTimeSince(activeCase.createdAt),
        caseId: activeCase.id,
      }
    }

    // Helper acknowledged but hasn't answered yet
    if (activeCase.status === 'answered' && !activeCase.answer) {
      return {
        state: 'HELPER_CHECKING',
        message: isM1OrHigher
          ? residentScreenFor(effectiveMode, true) // a helper has actually answered, so the "accepted" wording is true
          : `${activeCase.answeredBy || 'Helper'} is checking...`,
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

    // Nobody answered - fail closed
    if (activeCase.status === 'no_response' && !activeCase.answer) {
      return {
        state: 'CLOSED_KEEP_SHUT',
        message: 'Nobody answered. Keep door closed and call your helper',
        backgroundColor: '#2d1b1b',
        textColor: '#ffffff',
        showVideo: false,
        showFaces: false,
        canOpen: false,
        timeSince: formatTimeSince(activeCase.createdAt),
        caseId: activeCase.id,
      }
    }

    // Waiting for helper response
    const visitorInfo = activeCase.visitor ? activeCase.visitor :
                      activeCase.visitLabel ? activeCase.visitLabel :
                      activeCase.checkWho ? activeCase.checkWho :
                      'Unknown'

    // P11: Use residentScreenFor for the screen text based on effective mode and ackedAt
    const helperAccepted = helperAcceptedEarly
    const screenText = residentScreenFor(effectiveMode, helperAccepted)

    return {
      state: 'WAITING',
      message: screenText,
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
  let hour = date.getHours()
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(date)
    hour = parseInt(h, 10) % 24
  } catch {}
  const d = new Date(date); d.setHours(hour); return d
}

/**
 * Check if current time is in quiet hours
 */
function isInQuietHours(date: Date, startHour: number, endHour: number): boolean {
  const hour = date.getHours()
  if (startHour === endHour) return false
  if (startHour < endHour) return hour >= startHour && hour < endHour
  return hour >= startHour || hour < endHour
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

  if (view.state === 'EMERGENCY' && view.canOpen) {
    console.error('FAIL-CLOSED VIOLATION: EMERGENCY has canOpen: true')
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
