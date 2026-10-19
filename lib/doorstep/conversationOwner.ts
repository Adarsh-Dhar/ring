/**
 * Atomic takeover and release of a conversation (spec 7). One conditional UPDATE each, so two helpers racing for
 * the same conversation cannot both win: exactly one updateMany matches `conversationOwner IS NULL`.
 */
import { getDb } from '@/lib/db/client'

/** Returns true only for the single caller that got ownership (or who already owned it). */
export async function claimConversation(caseId: string, householdId: string, membershipId: string): Promise<{ ok: boolean; owner: string | null }> {
  const db = getDb()
  const r = await db.case.updateMany({
    where: { id: caseId, householdId, status: 'waiting', conversationOwner: null },
    data: { conversationOwner: membershipId },
  })
  if (r.count === 1) return { ok: true, owner: membershipId }
  const row = await db.case.findFirst({ where: { id: caseId, householdId }, select: { conversationOwner: true } })
  return { ok: row?.conversationOwner === membershipId, owner: row?.conversationOwner ?? null }
}

/** Only the current owner can release. */
export async function releaseConversation(caseId: string, householdId: string, membershipId: string): Promise<boolean> {
  const db = getDb()
  const r = await db.case.updateMany({
    where: { id: caseId, householdId, conversationOwner: membershipId },
    data: { conversationOwner: null },
  })
  return r.count === 1
}
