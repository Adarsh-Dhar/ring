/**
 * Structured audit log (Section 7).
 *
 * Audit events track all significant actions: observation corrections, action decisions, takeover, escalation,
 * and contact attempts. Stored in Case.log as a structured array.
 */
import { getDb } from '@/lib/db/client'

export type AuditActor = 'ai' | 'helper' | 'resident' | 'system'

export interface AuditEvent {
  at: string // ISO timestamp
  actor: AuditActor
  actorId?: string // userId for helper/resident, or system identifier
  kind: string
  ref?: string // reference to related entity (observationId, requestId, etc.)
  detail?: any
}

/**
 * Append an audit event to a case's log.
 */
export async function writeAudit(caseId: string, event: AuditEvent): Promise<void> {
  const db = getDb()
  if (!db?.case?.findUnique || !db?.case?.update) return
  const c = await db.case.findUnique({ where: { id: caseId }, select: { log: true } })
  if (!c) return

  const log = (c.log as any) || []
  log.push({
    t: new Date(event.at).getTime(),
    msg: `[${event.actor.toUpperCase()}] ${event.kind}${event.ref ? `: ${event.ref}` : ''}`,
    audit: event,
  })

  await db.case.update({
    where: { id: caseId },
    data: { log },
  })
}

/**
 * Create an audit event helper.
 */
export function createAuditEvent(
  actor: AuditActor,
  kind: string,
  detail?: any,
  ref?: string,
  actorId?: string
): AuditEvent {
  return {
    at: new Date().toISOString(),
    actor,
    actorId,
    kind,
    ref,
    detail,
  }
}

/**
 * Common audit event creators.
 */
export const audit = {
  observationCorrected: (
    actorId: string,
    obsId: string,
    action: 'confirm' | 'reject' | 'restore',
    reason?: string
  ): AuditEvent =>
    createAuditEvent('helper', 'observation_corrected', { action, reason }, obsId, actorId),

  actionApproved: (actorId: string, actionId: string, tool: string): AuditEvent =>
    createAuditEvent('helper', 'action_approved', { tool }, actionId, actorId),

  actionRejected: (actorId: string, actionId: string, tool: string, reason?: string): AuditEvent =>
    createAuditEvent('helper', 'action_rejected', { tool, reason }, actionId, actorId),

  takeover: (actorId: string, previousOwner?: string): AuditEvent =>
    createAuditEvent('helper', 'takeover', { previousOwner }, undefined, actorId),

  release: (actorId: string, newOwner?: string): AuditEvent =>
    createAuditEvent('helper', 'release', { newOwner }, undefined, actorId),

  escalate: (actorId: string, toMembershipId: string): AuditEvent =>
    createAuditEvent('helper', 'escalate', { toMembershipId }, undefined, actorId),

  contactAttempt: (
    channel: 'push' | 'sms',
    membershipId: string,
    result: 'sent' | 'failed',
    reason?: string
  ): AuditEvent =>
    createAuditEvent('system', 'contact_attempt', { channel, result, reason }, membershipId),

  helperResponse: (actorId: string, requestId: string, response: 'accepted' | 'declined'): AuditEvent =>
    createAuditEvent('helper', `request_${response}`, { response }, requestId, actorId),

  aiAction: (tool: string, decision: 'executed' | 'blocked'): AuditEvent =>
    createAuditEvent('ai', 'ai_action', { tool, decision }),

  residentDecision: (decision: string, detail?: any): AuditEvent =>
    createAuditEvent('resident', 'resident_decision', { decision, detail }),

  caseCreated: (kind: string, eventType: string): AuditEvent =>
    createAuditEvent('system', 'case_created', { kind, eventType }),

  caseResolved: (answer: string, by: string): AuditEvent =>
    createAuditEvent('system', 'case_resolved', { answer, by }),
}
