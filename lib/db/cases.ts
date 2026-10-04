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
    take: limit
  })
}

export async function getOpenCasesForHousehold(householdId: string) {
  return getDb().case.findMany({
    where: {
      householdId,
      status: 'waiting'
    },
    orderBy: { createdAt: 'desc' }
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
