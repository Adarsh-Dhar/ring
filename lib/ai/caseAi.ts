import { getDb } from '@/lib/db/client'
import type { Prisma } from '@prisma/client'
import { getApprovedMemberships } from '@/lib/db/memberships'
import { pushToMembership } from '@/lib/doorbell/notify'

export type CaseAiData = {
  id: string
  kind: string
  lane: string | null
  expectedId: string | null
  recurringId: string | null
  visitorSummary: string | null
  riskFlags: string[]
  interrogationState: string | null
  interrogationTurns: any
  interrogationVerdict: string | null
  interrogationClaims: any
  riskLevel: string | null
  riskAssessment: any
  riskScore?: number | null
  riskLedger?: any
  riskObservations?: any // P7: Contains { observations: [], interviewState: {} }
  controlMode?: string | null
  maxTurns?: number
  residentName?: string | null
  aiStatus: AiStatus
}

/** AI fields live on Case but are written ONLY here, never through the escalation store. */
export async function setCaseAi(caseId: string, data: {
  visitorSummary?: string | null; riskFlags?: string[]; interrogationState?: string | null;
  interrogationTurns?: any; interrogationVerdict?: string | null; interrogationClaims?: any
  riskLevel?: string | null; riskAssessment?: any; riskScore?: number | null; riskLedger?: any; riskObservations?: any; controlMode?: string | null; maxTurns?: number; residentName?: string | null
}) {
  try {
    // Read existing case before updating to detect first result
    const existing = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, householdId: true, interrogationState: true },
    })

    if (!existing) {
      console.error('[AI] Case not found for setCaseAi:', caseId)
      return
    }

    // First time this case reaches 'done' (risk flags are now written live, so they can no longer signal "first").
    const isFirstResult = existing.interrogationState !== 'done'

    const d: any = {}
    if ('visitorSummary' in data) d.visitorSummary = data.visitorSummary
    if ('riskFlags' in data) d.riskFlags = data.riskFlags
    if ('interrogationState' in data) d.interrogationState = data.interrogationState
    if ('interrogationTurns' in data) d.interrogationTurns = data.interrogationTurns
    if ('interrogationVerdict' in data) d.interrogationVerdict = data.interrogationVerdict
    if ('interrogationClaims' in data) d.interrogationClaims = data.interrogationClaims
    if ('riskLevel' in data) d.riskLevel = data.riskLevel
    if ('riskAssessment' in data) d.riskAssessment = data.riskAssessment
    if ('riskScore' in data) d.riskScore = data.riskScore
    if ('riskLedger' in data) d.riskLedger = data.riskLedger
    if ('riskObservations' in data) d.riskObservations = data.riskObservations
    if ('controlMode' in data) d.controlMode = data.controlMode
    // maxTurns and residentName are runtime-only, not persisted
    await getDb().case.update({ where: { id: caseId }, data: d })

    // Push notification to helpers when interrogation completes (state === 'done')
    if (isFirstResult && data.interrogationState === 'done' && data.visitorSummary && existing.householdId) {
      const memberships = await getApprovedMemberships(existing.householdId)
      const helperMemberships = memberships.filter(m => m.role === 'helper')
      const verdict = data.interrogationVerdict || 'unclear'
      const risk = data.riskLevel ?? 'none'
      const title = risk === 'high' ? '⚠️ Doorbell: high-risk visitor' : risk === 'medium' ? '⚠️ Doorbell: check this visitor' : '🎙️ Doorbell AI update'
      const idn = data.interrogationClaims?.identity
      const who = idn ? `${idn.name ?? 'Name not given'}${idn.forWhom ? `, says they know ${idn.forWhom}`: ''}.` : ''
      const body = `${who}Visitor claims: ${data.visitorSummary.slice(0, 80)}${data.visitorSummary.length > 80 ? '...' : ''}. Verdict: ${verdict}.${risk !== 'none' ? ` Risk: ${risk}.` : ''}`
      for (const m of helperMemberships) {
        // In-app notification (separate from web push; failure must not block the push or the save)
        await getDb().notification.create({
          data: {
            type: 'alert',
            title,
            message: body,
            toUserId: m.userId,
            metadata: { householdId: existing.householdId, caseId, url: '/helper', source: 'ai' },
          },
        }).catch(e => console.error('[AI] in-app notification failed', e))
        await pushToMembership(m.id, {
          title,
          body,
          tag: `case:${caseId}`,
          url: '/helper'
        }).catch(e => console.error('[AI] push failed', e))
      }
    }
  } catch (e) { console.error('[AI] setCaseAi failed', e) }
}

export async function aiFlags(householdId: string) {
  const h = await getDb().household.findUnique({ where: { id: householdId }, select: { aiEnabled: true, aiInterrogator: true, residentName: true } })
  return { aiEnabled: !!h?.aiEnabled, aiInterrogator: !!h?.aiInterrogator, residentName: h?.residentName ?? null }
}

export async function getCaseAi(householdId: string, caseId: string): Promise<CaseAiData | null> {
  const c = await getDb().case.findFirst({
    where: { id: caseId, householdId },
    select: {
      id: true,
      kind: true,
      lane: true,
      expectedId: true,
      recurringId: true,
      visitorSummary: true,
      riskFlags: true,
      interrogationState: true,
      interrogationTurns: true,
      interrogationVerdict: true,
      interrogationClaims: true,
      riskLevel: true,
      riskAssessment: true,
      riskScore: true,
      riskLedger: true,
      riskObservations: true,
      controlMode: true,
    } as Prisma.CaseSelect,
  })
  if (!c) return null
  const householdData = await aiFlags(householdId)
  return { ...c, residentName: householdData.residentName, aiStatus: await getAiStatus(householdId, caseId, c) } as CaseAiData
}

export type AiStatus = 'succeeded' | 'processing' | 'disabled' | 'not_enabled' | 'failed' | 'not_applicable'

/** Derives a status from household flags + the latest AiRun rows for this case. No schema change needed. */
async function getAiStatus(householdId: string, caseId: string, c: {
  visitorSummary: string | null; kind: string; lane?: string | null; expectedId?: string | null; recurringId?: string | null
}): Promise<AiStatus> {
  // Planned visits are not applicable to interrogation
  if (c.kind === 'visitor' && c.lane === 'expected') return 'not_applicable'
  if (c.expectedId || c.recurringId) return 'not_applicable'

  if (c.visitorSummary) return 'succeeded'
  if (process.env.AI_DISABLED === '1' || !process.env.GEMINI_API_KEY) return 'disabled'
  const f = await aiFlags(householdId)
  if (!f.aiEnabled) return 'not_enabled'
  const runs = await getDb().aiRun.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' }, take: 5, select: { status: true } })
  if (runs.some(r => ['error', 'invalid', 'budget', 'disabled', 'skipped'].includes(r.status))) return 'failed'
  return 'processing'
}
