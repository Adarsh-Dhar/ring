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
  const entry = {
    t: new Date(event.at).getTime(),
    msg: `[${event.actor.toUpperCase()}] ${event.kind}${event.ref ? `: ${event.ref}` : ''}`,
    audit: event,
  }
  // Atomic append: one UPDATE, so two concurrent writers can never overwrite each other's entry.
  if (typeof (db as any)?.$executeRaw === 'function') {
    await (db as any).$executeRaw`UPDATE "Case" SET "log" = COALESCE("log", '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb WHERE "id" = ${caseId}`
    return
  }
  // Fallback for test doubles without raw SQL.
  if (!db?.case?.findUnique || !db?.case?.update) return
  const c = await db.case.findUnique({ where: { id: caseId }, select: { log: true } })
  if (!c) return
  await db.case.update({ where: { id: caseId }, data: { log: [...((c.log as any) || []), entry] } })
}

/** Structured audit rows for the helper's audit panel (actor, action, time, reference, outcome). */
export function auditRows(log: unknown): { at: string; actor: string; kind: string; ref?: string; detail?: any }[] {
  return (Array.isArray(log) ? log : [])
    .filter((e: any) => e && e.audit)
    .map((e: any) => ({ at: e.audit.at, actor: e.audit.actor, kind: e.audit.kind, ref: e.audit.ref, detail: e.audit.detail }))
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
