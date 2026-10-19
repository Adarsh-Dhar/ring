/**
 * Notify the right helper when a NEW pending action is created (spec 7.2 step 1).
 *
 * The pending action is the thing the helper must approve, so creating it must itself produce an actionable alert:
 * case context, the exact proposed words, the resident's rule and the reason. Deduplicated per helper by the
 * open-request check in createHelperRequest, and the real delivery result is recorded by contactHelper.
 * Resident-approver actions are shown on the resident screen instead; a helper is not asked to decide them.
 */
import { getDb } from '@/lib/db/client'
import { getPreferences } from '@/lib/db/preferences'
import { createHelperRequest } from './helperRequests'
import { contactHelper } from './contactLog'
import { buildHelperRequest, formatPushNotification, formatSms } from './requestContent'
import { readStored } from './caseRisk'
import { effectiveModeFor, effectiveScore } from './collaborationController'
import { createAuditEvent, writeAudit } from './audit'
import type { PendingAction } from './pendingActions'
import type { ControlMode } from './riskRules'

export async function notifyPendingAction(i: { householdId: string; caseId: string; action: PendingAction }): Promise<{ notified: string | null }> {
  if (i.action.approver === 'resident') return { notified: null }
  const c = await getDb().case.findUnique({
    where: { id: i.caseId },
    select: { chain: true, helperIndex: true, riskScore: true, controlMode: true, riskObservations: true, noticeStatus: true, conversationOwner: true },
  })
  if (!c) return { notified: null }
  const chain = Array.isArray(c.chain) ? (c.chain as string[]) : []
  // The helper who owns the conversation decides; otherwise whoever the escalation is currently on.
  const target = c.conversationOwner || chain[c.helperIndex] || chain[0]
  if (!target) return { notified: null }

  const minMode = (c.controlMode as ControlMode | null) ?? null
  const eff = effectiveScore(c.riskScore ?? 0, minMode)
  const mode = effectiveModeFor(c.riskScore ?? 0, minMode)
  const req = await createHelperRequest({
    caseId: i.caseId, membershipId: target, kind: 'approval',
    snapshot: { effectiveScore: eff, mode, actionId: i.action.id, tool: i.action.tool, text: i.action.text, reason: i.action.reason },
  })
  await writeAudit(i.caseId, createAuditEvent('ai', 'approval_requested', { tool: i.action.tool, text: i.action.text, reason: i.action.reason, helperRequestId: req?.id ?? null }, i.action.id)).catch(() => {})
  if (!req) return { notified: null } // this helper already has a live approval request

  const prefs = await getPreferences(i.householdId)
  const content = buildHelperRequest(
    readStored(c.riskObservations as any).observations, mode, eff, (c.noticeStatus as any) ?? undefined, prefs,
    { tool: i.action.tool, text: i.action.text, reason: i.action.reason }, i.caseId,
  )
  await contactHelper(i.caseId, target, { push: formatPushNotification(content), sms: formatSms(content) }, req.id)
  return { notified: target }
}
