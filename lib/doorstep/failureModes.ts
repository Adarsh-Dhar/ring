/**
 * Failure behavior table (spec 11.3).
 *
 * Outage table, every row asserted. Defines the system behavior when
 * various components fail or become unavailable.
 */

export interface FailureMode {
  component: string
  failureType: string
  behavior: string
  fallback: string
  userVisible: boolean
}

/**
 * The failure mode table. Every row is asserted in tests.
 */
export const FAILURE_MODES: FailureMode[] = [
  {
    component: 'camera',
    failureType: 'offline',
    behavior: 'Mark camera unavailable in risk observations, add 0 points',
    fallback: 'Use audio-only analysis, request helper confirmation for visual events',
    userVisible: true,
  },
  {
    component: 'microphone',
    failureType: 'offline',
    behavior: 'Mark microphone unavailable in risk observations, add 0 points',
    fallback: 'Use camera-only analysis, request helper confirmation for speech events',
    userVisible: true,
  },
  {
    component: 'ai_analysis',
    failureType: 'unavailable',
    behavior: 'Mark AI unavailable, add 0 points, notify helper once',
    fallback: 'Helper-led mode for the case',
    userVisible: true,
  },
  {
    component: 'network',
    failureType: 'outage',
    behavior: 'Queue operations, retry with exponential backoff',
    fallback: 'Local caching, resume on reconnection',
    userVisible: false,
  },
  {
    component: 'database',
    failureType: 'outage',
    behavior: 'Reject new operations, maintain in-memory state for active cases',
    fallback: 'Queue writes, apply on recovery',
    userVisible: false,
  },
  {
    component: 'notification_service',
    failureType: 'outage',
    behavior: 'Queue notifications, retry with exponential backoff',
    fallback: 'In-app notification on next visit',
    userVisible: true,
  },
  {
    component: 'doorbell_sensor',
    failureType: 'offline',
    behavior: 'Log sensor offline, continue with other inputs',
    fallback: 'Manual resident trigger, audio trigger',
    userVisible: true,
  },
  {
    component: 'talkback',
    failureType: 'offline',
    behavior: 'Log talkback unavailable, use alternative communication',
    fallback: 'Push notification to resident, helper phone call',
    userVisible: true,
  },
]

/**
 * Get the failure mode for a component and failure type.
 */
export function getFailureMode(component: string, failureType: string): FailureMode | undefined {
  return FAILURE_MODES.find(fm => fm.component === component && fm.failureType === failureType)
}

/**
 * Assert that all failure modes are defined (for testing).
 */
export function assertFailureModesComplete(): boolean {
  const required = [
    ['camera', 'offline'],
    ['microphone', 'offline'],
    ['ai_analysis', 'unavailable'],
    ['network', 'outage'],
    ['database', 'outage'],
    ['notification_service', 'outage'],
    ['doorbell_sensor', 'offline'],
    ['talkback', 'offline'],
  ]

  for (const [component, failureType] of required) {
    if (!getFailureMode(component, failureType)) {
      return false
    }
  }

  return true
}
