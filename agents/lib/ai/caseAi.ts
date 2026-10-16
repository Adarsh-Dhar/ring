import { getDb } from '@/lib/db/client'

/** AI fields live on Case but are written ONLY here, never through the escalation store. */
export async function setCaseAi(caseId: string, data: {
  visitorSummary?: string | null; riskFlags?: string[]; clipDescription?: string | null
  clipTags?: unknown; greeterState?: string | null
}) {
  try {
    const d: any = {}
    if ('visitorSummary' in data) d.visitorSummary = data.visitorSummary
    if (data.riskFlags) d.riskFlags = data.riskFlags
    if ('clipDescription' in data) d.clipDescription = data.clipDescription
    if ('clipTags' in data) d.clipTags = data.clipTags ?? null
    if ('greeterState' in data) d.greeterState = data.greeterState
    await getDb().case.update({ where: { id: caseId }, data: d })
  } catch (e) { console.error('[AI] setCaseAi failed', e) }
}

export async function getCaseAi(householdId: string, caseId: string) {
  const c = await getDb().case.findFirst({
    where: { id: caseId, householdId },
    select: { id: true, visitorSummary: true, riskFlags: true, clipDescription: true, clipTags: true, greeterState: true },
  })
  return c
}

export async function aiFlags(householdId: string) {
  const h = await getDb().household.findUnique({ where: { id: householdId }, select: { aiEnabled: true, aiGreeter: true, residentName: true } })
  return { aiEnabled: !!h?.aiEnabled, aiGreeter: !!h?.aiGreeter, residentName: h?.residentName ?? null }
}
