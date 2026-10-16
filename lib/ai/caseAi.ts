import { getDb } from '@/lib/db/client'
import type { Prisma } from '@prisma/client'
import { getApprovedMemberships } from '@/lib/db/memberships'
import { pushToMembership } from '@/lib/doorbell/notify'

/** AI fields live on Case but are written ONLY here, never through the escalation store. */
export async function setCaseAi(caseId: string, data: {
  visitorSummary?: string | null; riskFlags?: string[]; clipDescription?: string | null
  clipTags?: unknown; greeterState?: string | null
  clipActions?: string[]; clipPeopleCount?: number; clipApproachedDoor?: boolean
}) {
  try {
    // Read existing case before updating to detect first result
    const existing = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, householdId: true, visitorSummary: true, clipDescription: true, riskFlags: true },
    })

    if (!existing) {
      console.error('[AI] Case not found for setCaseAi:', caseId)
      return
    }

    const isFirstResult = !existing.visitorSummary && !existing.clipDescription && 
                           (!existing.riskFlags || (Array.isArray(existing.riskFlags) && existing.riskFlags.length === 0))

    const d: any = {}
    if ('visitorSummary' in data) d.visitorSummary = data.visitorSummary
    if ('riskFlags' in data) d.riskFlags = data.riskFlags
    if ('clipDescription' in data) d.clipDescription = data.clipDescription
    if ('clipTags' in data) d.clipTags = data.clipTags
    if ('greeterState' in data) d.greeterState = data.greeterState
    if ('clipActions' in data) d.clipActions = data.clipActions
    if ('clipPeopleCount' in data) d.clipPeopleCount = data.clipPeopleCount
    if ('clipApproachedDoor' in data) d.clipApproachedDoor = data.clipApproachedDoor
    await getDb().case.update({ where: { id: caseId }, data: d })

    // Push notification to helpers when AI results arrive for the first time
    if (isFirstResult && (data.visitorSummary || data.clipDescription) && existing.householdId) {
      const memberships = await getApprovedMemberships(existing.householdId)
      const helperMemberships = memberships.filter(m => m.role === 'helper')
      for (const m of helperMemberships) {
        const body = data.visitorSummary
          ? `Visitor said: ${data.visitorSummary.slice(0, 100)}${data.visitorSummary.length > 100 ? '...' : ''}`
          : 'AI description available'
        await pushToMembership(m.id, {
          title: '🎙️ Doorbell AI update',
          body,
          tag: `case:${caseId}`,
          url: '/helper'
        }).catch(e => console.error('[AI] push failed', e))
      }
    }
  } catch (e) { console.error('[AI] setCaseAi failed', e) }
}

export async function getCaseAi(householdId: string, caseId: string) {
  const c = await getDb().case.findFirst({
    where: { id: caseId, householdId },
    select: {
      id: true,
      visitorSummary: true,
      riskFlags: true,
      clipDescription: true,
      clipTags: true,
      greeterState: true,
      clipActions: true,
      clipPeopleCount: true,
      clipApproachedDoor: true,
    } as Prisma.CaseSelect,
  })
  return c
}

export async function aiFlags(householdId: string) {
  const h = await getDb().household.findUnique({ where: { id: householdId }, select: { aiEnabled: true, aiGreeter: true, residentName: true } })
  return { aiEnabled: !!h?.aiEnabled, aiGreeter: !!h?.aiGreeter, residentName: h?.residentName ?? null }
}
