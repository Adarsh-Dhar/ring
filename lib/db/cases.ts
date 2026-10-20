import { getDb } from "./client"
import type { Prisma } from '@prisma/client'
import type { DoorCase } from '../doorbell/store'

/**
 * Case repository functions.
 * These replace the in-memory case storage with database persistence.
 */

export async function createCase(data: DoorCase & { householdId: string }) {
  return getDb().case.create({
    data: {
      id:          data.id,
      householdId: data.householdId,
      kind: data.kind,
      eventType: data.eventType,
      createdAt: new Date(data.createdAt),
      helperIndex: data.helperIndex,
      deadlineAt: new Date(data.deadlineAt),
      deadlineKind: data.deadlineKind ?? null,
      timerDeadlines: data.timerDeadlines ?? {},
      status: data.status,
      answer: data.answer,
      answeredBy: data.answeredBy,
      resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : null,
      log: data.log as any,
      visitor: data.visitor,
      confirmedAt: data.confirmedAt ? new Date(data.confirmedAt) : null,
      declinedAt: data.declinedAt ? new Date(data.declinedAt) : null,
      chain: data.chain as any,
      deviceId: data.deviceId,
      ackedBy: data.ackedBy,
      ackedAt: data.ackedAt ? new Date(data.ackedAt) : null,
      lane: data.lane,
      recurringId: data.recurringId,
      visitIcon: data.visitIcon,
      visitLabel: data.visitLabel,
      checkWho: data.checkWho ?? null,
      checkWord: data.checkWord ?? null,
      checkMode: data.checkMode ?? null,
      checkAttempts: data.checkAttempts ?? 0,
      expectedId: data.expectedId ?? null,
      selfVerifiedAt: data.selfVerifiedAt ? new Date(data.selfVerifiedAt) : null,
      regularId: data.regularId ?? null,
      noticeStatus: data.noticeStatus ?? null,
      lastActivityAt: new Date(data.createdAt),
      splitFromId: data.splitFromId ?? null,
    }
  })
}

export async function getCase(caseId: string) {
  return getDb().case.findUnique({
    where: { id: caseId }
  })
}

export async function getCasesForHousehold(householdId: string, limit = 10) {
  return getDb().case.findMany({
    where: { householdId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      helperRequests: {
        select: {
          id: true,
          kind: true,
          state: true,
          membershipId: true,
          sentAt: true,
        },
        orderBy: { sentAt: 'desc' },
      },
    },
  })
}

export async function getOpenCasesForHousehold(householdId: string) {
  return getDb().case.findMany({
    where: {
      householdId,
      status: 'waiting',
      closedAt: null
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Section 8: the case a new door event attaches to, if any: the newest case for this household that is not closed.
 * Replaces the old "newest WAITING case" lookup, because a case whose answer flow has finished still belongs to the
 * same visitor episode until its quiet period ends or a helper closes it.
 */
export async function getActiveLifecycleCase(householdId: string) {
  return getDb().case.findFirst({
    where: { householdId, closedAt: null },
    orderBy: { createdAt: 'desc' },
  })
}

export async function updateCase(caseId: string, data: Partial<DoorCase>) {
  const updateData: Prisma.CaseUpdateInput = {}

  if (data.status !== undefined) updateData.status = data.status
  if (data.answer !== undefined) updateData.answer = data.answer
  if (data.answeredBy !== undefined) updateData.answeredBy = data.answeredBy
  if (data.resolvedAt !== undefined) updateData.resolvedAt = data.resolvedAt ? new Date(data.resolvedAt) : null
  if (data.log !== undefined) updateData.log = data.log as Prisma.JsonArray
  if (data.visitor !== undefined) updateData.visitor = data.visitor
  if (data.confirmedAt !== undefined) updateData.confirmedAt = data.confirmedAt ? new Date(data.confirmedAt) : null
  if (data.declinedAt !== undefined) updateData.declinedAt = data.declinedAt ? new Date(data.declinedAt) : null
  if (data.chain !== undefined) updateData.chain = data.chain as Prisma.JsonArray
  if (data.ackedBy !== undefined) updateData.ackedBy = data.ackedBy
  if (data.ackedAt !== undefined) updateData.ackedAt = data.ackedAt ? new Date(data.ackedAt) : null
  if (data.lane !== undefined) updateData.lane = data.lane
  if (data.helperIndex !== undefined) updateData.helperIndex = data.helperIndex
  if (data.deadlineAt !== undefined) updateData.deadlineAt = new Date(data.deadlineAt)
  if (data.deadlineKind !== undefined) updateData.deadlineKind = data.deadlineKind ?? null
  if (data.timerDeadlines !== undefined) updateData.timerDeadlines = data.timerDeadlines as Prisma.JsonValue
  if (data.selfVerifiedAt !== undefined) updateData.selfVerifiedAt = data.selfVerifiedAt ? new Date(data.selfVerifiedAt) : null
  if ('checkWord'      in data) updateData.checkWord      = data.checkWord      ?? null
  if ('checkMode'      in data) updateData.checkMode      = data.checkMode      ?? null
  if (data.checkAttempts !== undefined) updateData.checkAttempts = data.checkAttempts
  if ('regularId'      in data) updateData.regularId      = data.regularId      ?? null
  if ('visitIcon'      in data) updateData.visitIcon      = data.visitIcon      ?? null
  if ('visitLabel'     in data) updateData.visitLabel     = data.visitLabel     ?? null

  return getDb().case.update({
    where: { id: caseId },
    data: updateData,
  })
}

export async function deleteOldCases(householdId: string, olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
  return getDb().case.deleteMany({
    where: {
      householdId,
      createdAt: { lt: cutoff },
      status: { in: ['answered', 'no_response'] }
    }
  })
}

export async function deleteAllCasesForHousehold(householdId: string) {
  return getDb().case.deleteMany({
    where: { householdId }
  })
}

/**
 * Atomically move a waiting case to its next escalation step.
 *
 * The WHERE clause only matches if nobody has moved the case since the caller read it
 * (same helperIndex, deadline and lane, still 'waiting'). Postgres runs this as one
 * UPDATE, so of any number of callers racing for the same step exactly one gets count = 1.
 * That caller, and only that caller, may send the alert for the step.
 */
export async function claimEscalationStep(
  caseId: string,
  expect: { helperIndex: number; deadlineAt: number; deadlineKind?: string | null; lane?: string | null; timerDeadlines?: { [kind: string]: number } },
  change: { helperIndex: number; deadlineAt: number; deadlineKind?: string; timerDeadlines?: { [kind: string]: number }; status: 'waiting' | 'no_response'; lane?: string | null; resolvedAt?: number },
  log: { t: number; msg: string }[],
): Promise<boolean> {
  const where: any = {
    id:          caseId,
    status:      'waiting',
    closedAt:    null,   // section 8: a closed case never escalates
    helperIndex: expect.helperIndex,
    deadlineAt:  new Date(expect.deadlineAt),
    lane:        expect.lane ?? null,
  }
  if ('deadlineKind' in expect) where.deadlineKind = expect.deadlineKind ?? null
  // Note: JSONB comparison is complex; for now we skip timerDeadlines in the compare-and-set
  // and rely on the other fields (helperIndex, deadlineAt, deadlineKind) for concurrency safety
  // This is acceptable because timerDeadlines is metadata and the governing deadlineAt/deadlineKind
  // already ensure the correct timer behavior.

  const r = await getDb().case.updateMany({
    where,
    data: {
      helperIndex: change.helperIndex,
      deadlineAt:  new Date(change.deadlineAt),
      deadlineKind: change.deadlineKind ?? null,
      timerDeadlines: change.timerDeadlines ?? undefined,
      status:      change.status,
      lane:        change.lane ?? null,
      resolvedAt:  change.resolvedAt !== undefined ? new Date(change.resolvedAt) : undefined,
      // Spec 11.1: the audit log is append-only. With a real database the new lines are APPENDED below, never written over the
      // column, so an audit entry another writer added a moment ago cannot be lost. Test doubles without raw SQL keep the old write.
      ...(typeof (getDb() as any).$executeRaw === 'function' ? {} : { log: log as unknown as Prisma.JsonArray }),
    },
  })
  if (r.count === 1 && typeof (getDb() as any).$executeRaw === 'function' && log.length) {
    const lines = JSON.stringify(log)
    await (getDb() as any).$executeRaw`UPDATE "Case" SET "log" = COALESCE("log", '[]'::jsonb) || COALESCE((
      SELECT jsonb_agg(e) FROM jsonb_array_elements(${lines}::jsonb) AS e
      WHERE NOT (COALESCE("log", '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('t', e->'t', 'msg', e->'msg')))
    ), '[]'::jsonb) WHERE "id" = ${caseId}`
  }
  return r.count === 1
}

/** Waiting cases whose deadline passed more than `graceMs` ago (used by the worker sweep).
 * Section 7: Also returns no_response cases within the TTL window for approval retry. */
export async function getOverdueCases(graceMs: number, limit = 100) {
  const now = Date.now()
  const NO_RESPONSE_TTL_MS = 30 * 60_000 // 30 minutes
  // Spec 7.2 step 4: an unanswered short-notice approval keeps being retried at the resident's interval,
  // so those cases stay in the sweep for the full retry window instead of the short TTL.
  const APPROVAL_RETRY_WINDOW_MS = 24 * 3_600_000
  return getDb().case.findMany({
    where: {
      closedAt: null, // section 8: a closed case is out of the sweep
      OR: [
        // Only actual timers are swept. NULL remains eligible for backward compatibility with
        // pre-deadlineKind rows; explicit `none`/`emergency` states are timerless.
        { status: 'waiting', deadlineAt: { lt: new Date(now - graceMs) }, deadlineKind: null },
        { status: 'waiting', deadlineAt: { lt: new Date(now - graceMs) }, deadlineKind: { notIn: ['none', 'emergency'] } },
        { status: 'no_response', noticeStatus: 'short_notice', resolvedAt: { gte: new Date(now - APPROVAL_RETRY_WINDOW_MS) } },
        { status: 'no_response', resolvedAt: { gte: new Date(now - NO_RESPONSE_TTL_MS) } },
      ],
    },
    orderBy: { deadlineAt: 'asc' },
    take:    limit,
  })
}
