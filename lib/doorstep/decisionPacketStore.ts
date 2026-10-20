/**
 * Decision packet loading (spec 10).
 *
 * Read-only API for loading decision packets from the database.
 * Provides GET /api/doorbell/packet?caseId= endpoint.
 */

import { getDb } from '@/lib/db/client'
import { buildDecisionPacket, type DecisionPacket } from './decisionPacket'

/**
 * Load a decision packet for a case.
 *
 * Returns null if the case doesn't exist.
 */
export async function loadDecisionPacket(caseId: string): Promise<DecisionPacket | null> {
  const db = getDb()
  const c = await db.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      householdId: true,
      createdAt: true,
      riskScore: true,
      controlMode: true,
      riskObservations: true,
      log: true,
    },
  })

  if (!c) return null

  return buildDecisionPacket({
    id: c.id,
    householdId: c.householdId,
    createdAt: c.createdAt,
    riskScore: c.riskScore,
    controlMode: c.controlMode as any,
    riskObservations: c.riskObservations,
    log: c.log,
  })
}

/**
 * API handler for GET /api/doorbell/packet?caseId=
 */
export async function getDecisionPacketApi(caseId: string) {
  const packet = await loadDecisionPacket(caseId)

  if (!packet) {
    return { error: 'Case not found', status: 404 }
  }

  return { packet, status: 200 }
}
