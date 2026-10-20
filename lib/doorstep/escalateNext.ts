/**
 * Shared escalation logic (N-03).
 *
 * Extracted from app/api/doorbell/escalate/route.ts to be used by both
 * the escalate route and controller tools.
 */

import { DEFAULT_ESCALATION_SECONDS } from '@/lib/doorbell/config'
import { backupTimeoutSec, timerDurationsFor } from '@/lib/doorstep/helperEscalation'
import { parseNoticeSettings } from '@/lib/doorstep/noticePolicy'
import { governingTimer, normalizeTimerDeadlines, NO_ACTIVE_TIMER_SENTINEL_MS, type TimerDeadlineMap, type TimerKind } from '@/lib/doorstep/deadline'
import type { ControlMode } from '@/lib/doorstep/riskRules'
import { effectiveScore, riskDecisionNeeded } from '@/lib/doorstep/collaborationController'
import { createHelperRequest, type HelperRequestKind } from '@/lib/doorstep/helperRequests'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { getApprovedMemberships } from '@/lib/db/memberships'
import { buildHelperRequest, formatPushNotification, formatSms } from '@/lib/doorstep/requestContent'
import { contactHelper } from '@/lib/doorstep/contactLog'
import { getPreferences } from '@/lib/db/preferences'
import { claimEscalationStep } from '@/lib/db/cases'
import { getDb } from '@/lib/db/client'

export interface EscalateNextParams {
  caseId: string
  householdId: string
  requestingMembershipId: string
}

export interface EscalateNextResult {
  success: boolean
  reason?: string
  nextMembershipId?: string
}

/**
 * Escalate to the next helper in the chain.
 *
 * This function contains the shared logic for manual escalation, used by both
 * the /api/doorbell/escalate route and controller tools.
 */
export async function escalateNext(params: EscalateNextParams): Promise<EscalateNextResult> {
  const { caseId, householdId, requestingMembershipId } = params

  const db = getDb()
  const c = await db.case.findFirst({
    where: { id: caseId, householdId },
    select: { id: true, householdId: true, kind: true, status: true, helperIndex: true, chain: true, deadlineAt: true, deadlineKind: true, timerDeadlines: true, lane: true, log: true, riskScore: true, controlMode: true, riskObservations: true, noticeStatus: true, closedAt: true },
  })

  if (!c) {
    return { success: false, reason: 'Case not found' }
  }

  if (c.closedAt) {
    return { success: false, reason: 'Case is closed' }
  }

  if (c.status !== 'waiting') {
    return { success: false, reason: 'Case is not waiting' }
  }

  // Emergency guard: refuse escalation for emergency cases
  if (c.deadlineKind === 'emergency' || c.kind === 'sos' || c.riskScore === 100 || c.controlMode === 'emergency') {
    return { success: false, reason: 'Emergency workflows do not use helper acknowledgement timers; all configured helpers are alerted together.' }
  }

  const chain = ((c.chain as unknown) as string[] | null) ?? []
  if (!chain.includes(requestingMembershipId)) {
    return { success: false, reason: 'You are not a helper on this case' }
  }

  // Work out the next helper BEFORE claiming
  const nextIndex = c.helperIndex + 1
  if (nextIndex >= chain.length) {
    return { success: false, reason: 'No more helpers in chain' }
  }

  const nextMembershipId = chain[nextIndex]
  const memberships = await getApprovedMemberships(c.householdId)
  const nextMembership = memberships.find(m => m.id === nextMembershipId)

  if (!nextMembership) {
    return { success: false, reason: 'Next helper not found' }
  }

  // Claim the escalation step
  const household = await db.household.findUnique({
    where: { id: c.householdId },
    select: {
      timeoutSec: true,
      minNoticeHours: true,
      shortNoticePolicy: true,
      approvalTimerSec: true,
      approvalRetrySec: true,
      unknownVisitorPolicy: true,
    },
  })
  const timeoutSec = household?.timeoutSec || DEFAULT_ESCALATION_SECONDS
  const notice = parseNoticeSettings(household)
  const needsApproval = c.noticeStatus === 'short_notice' && notice.shortNoticePolicy !== 'ai_handles'
  const mode = (c.controlMode as ControlMode | null) ?? null
  const durations = timerDurationsFor(c.riskScore, mode, timeoutSec, needsApproval, notice.approvalTimerSec)
  const sEff = effectiveScore(c.riskScore ?? 0, mode)
  const fallback = backupTimeoutSec(c.riskScore, mode, timeoutSec, needsApproval, notice.approvalTimerSec)
  const now = Date.now()

  const active = new Set(Object.keys(normalizeTimerDeadlines(c.timerDeadlines)) as Array<keyof TimerDeadlineMap>)
  if (needsApproval) active.add('approval')
  if (durations.risk_decision !== undefined && (active.has('risk_decision') || riskDecisionNeeded(sEff))) active.add('risk_decision')
  if (durations.takeover !== undefined) active.add('takeover')
  if (c.lane === 'expected') active.add('household')
  if (active.size === 0) {
    const fallbackKind = (fallback.kind === 'approval' || fallback.kind === 'risk_decision' || fallback.kind === 'takeover' || fallback.kind === 'household')
      ? fallback.kind as Exclude<TimerKind, 'emergency'>
      : 'household'
    active.add(fallbackKind)
  }

  const nextTimers: TimerDeadlineMap = {}
  for (const timerKind of active) {
    const seconds = durations[timerKind] ?? (timerKind === fallback.kind ? fallback.seconds : timeoutSec)
    if (Number.isFinite(seconds) && seconds > 0) nextTimers[timerKind] = now + seconds * 1000
  }
  const governing = governingTimer(nextTimers)
  const nextDeadlineAt = governing?.deadlineMs ?? now + NO_ACTIVE_TIMER_SENTINEL_MS
  const nextDeadlineKind = governing?.kind ?? 'none'
  const log = [...(((c.log as unknown) as { t: number; msg: string }[] | null) ?? []), { t: now, msg: `Escalated to the next helper; active timers: ${Object.keys(nextTimers).join(', ') || 'none'}.` }]
  const claimed = await claimEscalationStep(
    caseId,
    { helperIndex: c.helperIndex, deadlineAt: c.deadlineAt.getTime(), deadlineKind: c.deadlineKind ?? null, lane: c.lane ?? null, ...(c.timerDeadlines != null ? { timerDeadlines: normalizeTimerDeadlines(c.timerDeadlines) } : {}) },
    { helperIndex: nextIndex, deadlineAt: nextDeadlineAt, deadlineKind: nextDeadlineKind, timerDeadlines: nextTimers, status: 'waiting', lane: c.lane },
    log,
  )
  if (!claimed) {
    return { success: false, reason: 'Escalation step already claimed' }
  }

  // Create a new request
  const kind: HelperRequestKind = 'takeover'
  const created = await createHelperRequest({
    caseId,
    membershipId: nextMembershipId,
    kind,
    round: Math.floor(c.helperIndex / chain.length) + 1,
  })
  if (!created) {
    return { success: false, reason: 'A takeover request is already open for the next helper' }
  }

  // Build and send notification
  const prefs = await getPreferences(c.householdId)
  const observations = (((c.riskObservations as any)?.observations) as any[]) || []

  const content = buildHelperRequest(
    observations,
    (c.controlMode as any) || 'ai_leads',
    c.riskScore || 0,
    undefined,
    prefs,
    undefined,
    caseId
  )
  const pushNotif = formatPushNotification(content)
  const smsBody = formatSms(content)

  await contactHelper(caseId, nextMembershipId, { push: pushNotif, sms: smsBody }, created.id)

  await writeAudit(caseId, audit.escalate(requestingMembershipId, nextMembershipId))

  return { success: true, nextMembershipId }
}
