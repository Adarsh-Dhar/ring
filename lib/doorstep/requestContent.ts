/**
 * Build helper request content (Section 7.2 step 1).
 *
 * Constructs the payload for push notifications and SMS, including:
 * - S_eff and mode
 * - Top ledger entries with quotes
 * - Resident's rule (notice status and delegation)
 * - AI recommendation
 * - Exact action needing approval
 */
import { type Observation, type ControlMode, riskLabelFor } from './riskRules'
import { MODE_LABEL } from './modeCopy'
import { getRecommendation } from './recommendation'
import { evaluateNotice, type NoticeStatus } from './noticePolicy'
import { type Preferences } from './residentPreferences'

export interface HelperRequestContent {
  effectiveScore: number
  mode: ControlMode
  modeLabel: string
  topObservations: Array<{ code: string; points: number; quotes: string[]; state: string }>
  noticeStatus?: NoticeStatus
  delegation: string
  recommendation: {
    say: string
    why: string
    tool?: string
  }
  actionNeeded?: {
    tool: string
    text: string
    reason?: string
  }
  caseUrl: string
}

/**
 * Build the helper request content for a case.
 */
export function buildHelperRequest(
  observations: Observation[],
  mode: ControlMode,
  effectiveScore: number,
  noticeStatus: NoticeStatus | undefined,
  prefs: Preferences,
  actionNeeded?: { tool: string; text: string; reason?: string }
): HelperRequestContent {
  // Top 5 confirmed observations by points
  const confirmed = observations.filter(o => o.state === 'confirmed')
  const topObservations = confirmed
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map(o => ({
      code: o.code,
      points: o.points,
      quotes: o.quotes || [],
      state: o.state,
    }))

  // Delegation status
  const delegation = prefs.delegations?.length > 0
    ? `Delegated to: ${prefs.delegations.map(d => d.to).join(', ')}`
    : 'No active delegations'

  // AI recommendation
  const recommendation = getRecommendation(observations, mode, effectiveScore)

  // Case URL
  const caseUrl = `/helper?case=${actionNeeded?.caseId || ''}`

  return {
    effectiveScore,
    mode,
    modeLabel: MODE_LABEL[mode] || 'M0',
    topObservations,
    noticeStatus,
    delegation,
    recommendation: {
      say: recommendation.say,
      why: recommendation.why,
      tool: recommendation.tool,
    },
    actionNeeded,
    caseUrl,
  }
}

/**
 * Format for push notification.
 */
export function formatPushNotification(content: HelperRequestContent): {
  title: string
  body: string
  url: string
} {
  const { modeLabel, effectiveScore, recommendation, actionNeeded } = content

  let title = `${modeLabel} (Score ${effectiveScore})`
  let body = recommendation.say

  if (actionNeeded) {
    title = `Action needed: ${actionNeeded.tool}`
    body = `${actionNeeded.text}. ${recommendation.say}`
  }

  return {
    title,
    body,
    url: content.caseUrl,
  }
}

/**
 * Format for SMS (short version).
 */
export function formatSms(content: HelperRequestContent): string {
  const { modeLabel, effectiveScore, recommendation, actionNeeded } = content

  let msg = `${modeLabel} (Score ${effectiveScore}): ${recommendation.say}`

  if (actionNeeded) {
    msg = `Action needed: ${actionNeeded.text}. ${msg}`
  }

  msg += ` Check: ${content.caseUrl}`

  return msg.substring(0, 160) // SMS limit
}
