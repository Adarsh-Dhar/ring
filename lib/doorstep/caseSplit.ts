/**
 * Section 8.2: "New event during the quiet period" is attached to the same case and shown as "possible new visitor".
 * A helper or the resident can split it into a new case. The new case starts at 0: observations from the split point
 * move across, and nothing is matched by face or appearance.
 */
import { getDb } from '@/lib/db/client'
import { readStored, splitStored } from './caseRisk'
import { applyRiskEdit } from './caseRiskStore'
import { logCorrectionLabel } from './correctionLabels'

export type SplitResult = { ok: true; newCaseId: string; moved: number } | { ok: false; error: string; status: number }

export async function splitCase(
  caseId: string,
  by: { role: 'helper' | 'resident'; id: string },
  /** Opens the new case through the normal alert path (store.openSplitCase). Injected so this file has no store import. */
  openNewCase: (householdId: string, from: { id: string; eventType: string; deviceId: string | null }) => Promise<{ id: string } | null>,
): Promise<SplitResult> {
  const db = getDb()
  const c: any = await db.case.findUnique({
    where: { id: caseId },
    select: { id: true, householdId: true, eventType: true, deviceId: true, closedAt: true, possibleNewVisitorAt: true, riskObservations: true, riskScore: true },
  })
  if (!c) return { ok: false, error: 'case not found', status: 404 }
  if (c.closedAt) return { ok: false, error: 'case is closed', status: 409 }
  if (!c.possibleNewVisitorAt) return { ok: false, error: 'no possible new visitor to split', status: 409 }

  const { keep, moved } = splitStored(readStored(c.riskObservations), new Date(c.possibleNewVisitorAt).toISOString())
  const fresh = await openNewCase(c.householdId, { id: c.id, eventType: c.eventType, deviceId: c.deviceId ?? null })
  if (!fresh) return { ok: false, error: 'could not open the new case', status: 503 }

  await db.case.update({ where: { id: fresh.id }, data: { splitFromId: c.id, lastActivityAt: new Date() } })
  // Re-score both sides. The original forgets the split point; the new case starts from the moved observations only.
  const a = await applyRiskEdit(c.id, { kind: 'replace', stored: keep })
  if (a.ok === false) return { ok: false, error: a.error, status: 409 }
  const b = await applyRiskEdit(fresh.id, { kind: 'replace', stored: moved })
  if (b.ok === false) return { ok: false, error: b.error, status: 409 }
  await db.case.update({ where: { id: c.id }, data: { possibleNewVisitorAt: null } })

  await logCorrectionLabel({ householdId: c.householdId, caseId: c.id, action: 'split', actorRole: by.role, actorId: by.id, reason: `new case ${fresh.id}, ${moved.observations.length} observations moved`, scoreBefore: c.riskScore ?? 0 })
  return { ok: true, newCaseId: fresh.id, moved: moved.observations.length }
}
