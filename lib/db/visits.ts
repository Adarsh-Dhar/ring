import { getDb } from "./client"
import type { ExpectedVisit, RecurringVisit } from '../doorbell/store'

/**
 * Visit repository functions.
 * These handle expected and recurring visits.
 */

export async function createExpectedVisit(data: Omit<ExpectedVisit, 'id'> & { householdId: string }) {
  return getDb().expectedVisit.create({
    data: {
      householdId: data.householdId,
      icon: data.icon,
      label: data.label,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
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
      endsAt: { gt: new Date(now) }
    }
  })
}

export async function deleteExpectedVisit(id: string) {
  return getDb().expectedVisit.delete({
    where: { id }
  })
}

export async function deleteOldExpectedVisits(householdId: string) {
  return getDb().expectedVisit.deleteMany({
    where: {
      householdId,
      endsAt: { lt: new Date() }
    }
  })
}

export async function createRecurringVisit(data: Omit<RecurringVisit, 'id' | 'createdAt' | 'updatedAt'> & { householdId: string }) {
  return getDb().recurringVisit.create({
    data: {
      householdId: data.householdId,
      icon: data.icon,
      label: data.label,
      days: data.days as any,
      everyNWeeks: data.everyNWeeks,
      anchorWeek: data.anchorWeek,
      startMin: data.startMin,
      endMin: data.endMin,
      alertIfMissed: data.alertIfMissed,
      paused: data.paused,
      lastArrived: data.lastArrived,
      lastMissedAlert: data.lastMissedAlert,
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
  const updateData: any = {}

  if (data.paused !== undefined) updateData.paused = data.paused
  if (data.lastArrived !== undefined) updateData.lastArrived = data.lastArrived
  if (data.lastMissedAlert !== undefined) updateData.lastMissedAlert = data.lastMissedAlert

  return getDb().recurringVisit.update({
    where: { id },
    data: updateData
  })
}

export async function deleteRecurringVisit(id: string) {
  return getDb().recurringVisit.delete({
    where: { id }
  })
}
