import { getDb } from "./client"
import type { ExpectedVisit, RecurringVisit } from '../doorbell/store'
import type { Prisma } from '@prisma/client'

/**
 * Visit repository functions.
 */

export async function createExpectedVisit(data: ExpectedVisit & { householdId: string }) {
  return getDb().expectedVisit.create({
    data: {
      id:          data.id,
      householdId: data.householdId,
      icon:        data.icon,
      label:       data.label,
      startsAt:    new Date(data.startsAt),
      endsAt:      new Date(data.endsAt),
      who:         data.who ?? null,
      passphrase:  data.passphrase ?? null,
      codeSecret:  data.codeSecret ?? null,
      requestId:   data.requestId  ?? null,
      singleUse:   !!data.singleUse,
      usedAt:      data.usedAt ? new Date(data.usedAt) : null,
    }
  })
}

export async function getExpectedVisitsForHousehold(householdId: string) {
  return getDb().expectedVisit.findMany({
    where: { householdId },
    orderBy: { startsAt: 'asc' }
  })
}

export async function getActiveExpectedVisits(householdId: string, now: number) {
  return getDb().expectedVisit.findMany({
    where: {
      householdId,
      startsAt: { lte: new Date(now) },
      endsAt:   { gt:  new Date(now) }
    }
  })
}

/** Scoped delete: requires both id AND householdId so one household can't delete another's visits. */
export async function deleteExpectedVisit(householdId: string, id: string) {
  return getDb().expectedVisit.deleteMany({ where: { id, householdId } })
}

export async function deleteOldExpectedVisits(householdId: string) {
  return getDb().expectedVisit.deleteMany({
    where: {
      householdId,
      endsAt: { lt: new Date() }
    }
  })
}

export async function createRecurringVisit(data: RecurringVisit & { householdId: string }) {
  return getDb().recurringVisit.create({
    data: {
      id:            data.id,
      householdId:   data.householdId,
      icon:          data.icon,
      label:         data.label,
      days:          data.days as any,
      everyNWeeks:   data.everyNWeeks,
      anchorWeek:    data.anchorWeek,
      startMin:      data.startMin,
      endMin:        data.endMin,
      alertIfMissed: data.alertIfMissed,
      paused:        data.paused,
      lastArrived:   data.lastArrived,
      lastMissedAlert: data.lastMissedAlert,
      who:           data.who ?? null,
      passphrase:    data.passphrase ?? null,
    }
  })
}

export async function getRecurringVisitsForHousehold(householdId: string) {
  return getDb().recurringVisit.findMany({
    where: { householdId },
    orderBy: { createdAt: 'asc' }
  })
}

export async function updateRecurringVisit(id: string, data: Partial<RecurringVisit>) {
  const updateData: Prisma.RecurringVisitUpdateInput = {}

  if (data.paused          !== undefined) updateData.paused          = data.paused
  if (data.lastArrived     !== undefined) updateData.lastArrived     = data.lastArrived
  if (data.lastMissedAlert !== undefined) updateData.lastMissedAlert = data.lastMissedAlert
  if (data.who             !== undefined) updateData.who             = data.who ?? null
  if (data.passphrase      !== undefined) updateData.passphrase      = data.passphrase ?? null

  return getDb().recurringVisit.update({ where: { id }, data: updateData })
}

/** Scoped delete: requires both id AND householdId. */
export async function deleteRecurringVisit(householdId: string, id: string) {
  return getDb().recurringVisit.deleteMany({ where: { id, householdId } })
}

/** Mark a one-off visit as used (idempotent — only sets if not already set). */
export async function markExpectedUsed(id: string, usedAt: number) {
  return getDb().expectedVisit.updateMany({
    where: { id, usedAt: null },
    data:  { usedAt: new Date(usedAt) },
  })
}
