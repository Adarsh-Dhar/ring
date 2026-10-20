/**
 * Section 8 case lifecycle: database side. The pure rules are in riskRules.ts (deriveLifecycleState, quietCloseDue,
 * seriousFromLedger) and the score logic in caseRisk.ts. This file only reads and writes Case rows.
 *
 * A case is one visitor episode at one door. `Case.status` is the doorbell answer flow and is untouched here.
 * `Case.lifecycle` is the episode: open, helper_review, visitor_left, closed.
 */
import { getDb } from '@/lib/db/client'
import { reportError } from '@/lib/errors'
import {
  CASE_OUTCOMES, deriveLifecycleState, quietCloseDue, scoreObservations, seriousFromLedger, modeRank,
  type CaseOutcome, type LifecycleState, type PriorSeriousEvent, type ControlMode,
} from './riskRules'
import { readStored } from './caseRisk'
import { effectiveModeFor } from './collaborationController'
import { getLifecyclePolicy } from './lifecyclePolicy'
import { logCorrectionLabel } from './correctionLabels'

const OPEN_REQUEST = ['sent', 'delivered', 'acked']

/** A helper request is live (sent, delivered or acked) for this case. A read failure counts as "none". */
export async function hasPendingHelperRequest(caseId: string): Promise<boolean> {
  try {
    const db: any = getDb()
    if (!db.helperRequest?.count) return false
    return (await db.helperRequest.count({ where: { caseId, state: { in: OPEN_REQUEST } } })) > 0
  } catch {
    return false
  }
}

export type LifecycleResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string; status: number }

const caseSelect = {
  id: true, householdId: true, status: true, lifecycle: true, visitorLeftAt: true, closedAt: true, lastActivityAt: true,
  possibleNewVisitorAt: true, riskScore: true, controlMode: true, emergencyAlertedAt: true, riskObservations: true,
} as any

/** Recompute the lifecycle state from the stored observations and write it if it changed. */
export async function refreshLifecycle(caseId: string): Promise<LifecycleState | null> {
  const db = getDb()
  const c: any = await db.case.findUnique({ where: { id: caseId }, select: caseSelect })
  if (!c) return null
  const risk = scoreObservations(readStored(c.riskObservations).observations, { transcript: '', interviewState: readStored(c.riskObservations).interviewState })
  const next = deriveLifecycleState({
    closedAt: c.closedAt,
    visitorLeftAt: c.visitorLeftAt,
    activeSerious: risk.activeSerious,
    helperRequestPending: await hasPendingHelperRequest(caseId),
    helperLedMode: modeRank(effectiveModeFor(risk.score, risk.minMode)) >= modeRank('helper_leads'),
  })
  if (next !== c.lifecycle) await db.case.update({ where: { id: caseId }, data: { lifecycle: next } })
  return next
}

/**
 * Door or camera evidence (or a helper) says the visitor has left. The score is frozen from here.
 * If a serious event is unresolved the case stays in helper_review (deriveLifecycleState decides).
 */
export async function markVisitorLeft(caseId: string, by: { role: 'helper' | 'sensor' | 'camera'; id?: string }, at: Date = new Date()): Promise<LifecycleResult<{ lifecycle: LifecycleState | null }>> {
  const db = getDb()
  const c: any = await db.case.findUnique({ where: { id: caseId }, select: caseSelect })
  if (!c) return { ok: false, error: 'case not found', status: 404 }
  if (c.closedAt) return { ok: false, error: 'case is closed', status: 409 }
  if (!c.visitorLeftAt) await db.case.update({ where: { id: caseId }, data: { visitorLeftAt: at, lastActivityAt: at } })
  const lifecycle = await refreshLifecycle(caseId)
  await logCorrectionLabel({ householdId: c.householdId, caseId, action: 'visitor_left', actorRole: by.role === 'helper' ? 'helper' : 'system', actorId: by.id ?? null, reason: `evidence: ${by.role}`, scoreBefore: c.riskScore ?? 0, scoreAfter: c.riskScore ?? 0 })
  return { ok: true, lifecycle }
}

/**
 * Attach a new door event to a case that is not closed (section 8.2: the system cannot reliably tell visitors apart).
 * Restarts the quiet period. If the visitor had left, or the earlier visit was already dealt with, the dashboard shows
 * "possible new visitor" and a helper or resident can split it into a new case. Returns whether it was flagged.
 */
export async function attachEvent(caseId: string, now: Date = new Date()): Promise<LifecycleResult<{ possibleNewVisitor: boolean }>> {
  const db = getDb()
  const c: any = await db.case.findUnique({ where: { id: caseId }, select: caseSelect })
  if (!c) return { ok: false, error: 'case not found', status: 404 }
  if (c.closedAt) return { ok: false, error: 'case is closed', status: 409 }
  const possibleNewVisitor = !!c.visitorLeftAt || c.status !== 'waiting'
  await db.case.update({
    where: { id: caseId },
    data: {
      lastActivityAt: now,
      visitorLeftAt: null, // a new event means the visitor may be back, so the freeze ends
      ...(possibleNewVisitor && !c.possibleNewVisitorAt ? { possibleNewVisitorAt: now } : {}),
    },
  })
  await refreshLifecycle(caseId)
  return { ok: true, possibleNewVisitor }
}

/**
 * A helper closes the case with an outcome (resolved_safe, resolved_incident or false_alarm). A case with an
 * unresolved serious event can still be closed this way: the helper's outcome is the resolution. Final score kept.
 */
export async function closeCaseByHelper(caseId: string, membershipId: string, outcome: string, reason?: string): Promise<LifecycleResult<{ outcome: CaseOutcome }>> {
  if (!(CASE_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: `outcome must be one of ${CASE_OUTCOMES.join(', ')}`, status: 400 }
  const db = getDb()
  const c: any = await db.case.findUnique({ where: { id: caseId }, select: caseSelect })
  if (!c) return { ok: false, error: 'case not found', status: 404 }
  if (c.closedAt) return { ok: false, error: 'case is already closed', status: 409 }
  const now = new Date()
  // Compare-and-set: of two helpers closing at once, one wins.
  const r = await db.case.updateMany({
    where: { id: caseId, closedAt: null },
    data: { lifecycle: 'closed', closedAt: now, closedBy: membershipId, outcome, closeReason: reason ?? 'helper', visitorLeftAt: c.visitorLeftAt ?? undefined },
  })
  if (r.count !== 1) return { ok: false, error: 'case is already closed', status: 409 }
  await logCorrectionLabel({ householdId: c.householdId, caseId, action: 'close', actorRole: 'helper', actorId: membershipId, reason: `${outcome}${reason ? `: ${reason}` : ''}`, scoreBefore: c.riskScore ?? 0, scoreAfter: c.riskScore ?? 0 })
  return { ok: true, outcome: outcome as CaseOutcome }
}

/**
 * Close every idle case whose quiet period has passed (section 8.2). Only a case with a confirmed score under 20,
 * no active serious event and no pending helper request closes by itself; an emergency case never does.
 * Returns the ids closed. Safe to run from any worker or from tick(): the close is a compare-and-set.
 */
export async function sweepQuietCases(householdId?: string, now: number = Date.now()): Promise<string[]> {
  const db = getDb()
  const rows: any[] = await db.case.findMany({
    where: { closedAt: null, ...(householdId ? { householdId } : {}) },
    select: caseSelect,
    take: 200,
  })
  const closed: string[] = []
  const policies = new Map<string, number>()
  for (const c of rows) {
    try {
      if (!policies.has(c.householdId)) policies.set(c.householdId, (await getLifecyclePolicy(c.householdId)).quietMinutes)
      const stored = readStored(c.riskObservations)
      const risk = scoreObservations(stored.observations, { transcript: '', interviewState: stored.interviewState })
      const mode = (c.controlMode as ControlMode | null) ?? risk.minMode
      const due = quietCloseDue({
        lifecycle: c.lifecycle,
        score: risk.score, // the CONFIRMED score S, so a minor event's floor cannot block closing
        activeSerious: risk.activeSerious,
        emergency: mode === 'emergency' || !!c.emergencyAlertedAt,
        helperRequestPending: await hasPendingHelperRequest(c.id),
        answerFlowRunning: c.status === 'waiting',
        visitorLeftAt: c.visitorLeftAt,
        lastActivityAt: c.lastActivityAt,
        quietMinutes: policies.get(c.householdId)!,
        now,
      })
      if (!due) continue
      const r = await db.case.updateMany({
        where: { id: c.id, closedAt: null },
        data: { lifecycle: 'closed', closedAt: new Date(now), closedBy: 'system', closeReason: 'quiet_period' },
      })
      if (r.count === 1) {
        closed.push(c.id)
        await logCorrectionLabel({ householdId: c.householdId, caseId: c.id, action: 'close', actorRole: 'system', reason: 'quiet_period', scoreBefore: risk.score, scoreAfter: risk.score })
      }
    } catch (e) {
      reportError(e, { fn: 'sweepQuietCases', caseId: c.id })
    }
  }
  return closed
}

/**
 * Earlier serious events inside the resident-set window, for the helper to read as information only.
 * Nothing carries into the score and nothing is matched by face or appearance: it is simply the same household's
 * recent cases, excluding this one.
 */
export async function getPriorSeriousEvents(householdId: string, excludeCaseId: string, now: number = Date.now()): Promise<PriorSeriousEvent[]> {
  const { lookbackHours } = await getLifecyclePolicy(householdId)
  const rows: any[] = await getDb().case.findMany({
    where: { householdId, id: { not: excludeCaseId }, createdAt: { gte: new Date(now - lookbackHours * 3_600_000) } },
    select: { id: true, closedAt: true, riskLedger: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return seriousFromLedger(rows, lookbackHours, now)
}
