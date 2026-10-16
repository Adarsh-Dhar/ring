/** Agent 5: facts are computed in code/SQL; the model only writes ~80 words of prose from them. */
import { getDb } from '@/lib/db/client'
import { generateJson } from '@/lib/ai/client'
import { DigestOut } from '@/lib/ai/schemas'
import { DIGEST_SYSTEM } from '@/lib/ai/prompts/digest'
import { clampWords, hasBannedPhrase } from '@/lib/ai/guard'
import type { Prisma } from '@prisma/client'

type CaseWithRiskFlags = Prisma.CaseGetPayload<{ select: { visitor: true; status: true; riskFlags: true; regularId: true } }>

export interface DigestFacts {
  from: string; to: string
  totalRings: number
  byVisitor: Record<string, number>
  noResponse: number
  flaggedRings: number
  topFlags: { flag: string; count: number }[]
  repeatVisitors: number
}

export const weekStartFor = (now = new Date()) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - 7)
  return d
}

export async function computeFacts(householdId: string, weekStart: Date): Promise<DigestFacts> {
  const to = new Date(weekStart.getTime() + 7 * 86_400_000)
  const cases = await getDb().case.findMany({
    where: { householdId, kind: 'visitor', createdAt: { gte: weekStart, lt: to } },
    select: { visitor: true, status: true, riskFlags: true, regularId: true } as Prisma.CaseSelect,
  })
  const byVisitor: Record<string, number> = {}
  const flagCount = new Map<string, number>()
  const regulars = new Map<string, number>()
  let noResponse = 0, flagged = 0
  for (const c of cases as any) {
    byVisitor[c.visitor ?? 'unknown'] = (byVisitor[c.visitor ?? 'unknown'] ?? 0) + 1
    if (c.status === 'no_response') noResponse++
    const flags = Array.isArray(c.riskFlags) ? (c.riskFlags as string[]) : []
    if (flags.length) flagged++
    for (const f of flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1)
    if (c.regularId) regulars.set(c.regularId, (regulars.get(c.regularId) ?? 0) + 1)
  }
  return {
    from: weekStart.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    totalRings: cases.length, byVisitor, noResponse, flaggedRings: flagged,
    topFlags: [...flagCount].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([flag, count]) => ({ flag, count })),
    repeatVisitors: [...regulars.values()].filter(n => n > 1).length,
  }
}

/** Plain-text version used when the model is unavailable, so a digest still exists. */
export function templateText(f: DigestFacts): string {
  if (f.totalRings === 0) return 'No visitors rang the doorbell this week.'
  const parts = [`${f.totalRings} ring${f.totalRings === 1 ? '' : 's'} this week.`]
  if (f.noResponse) parts.push(`${f.noResponse} went unanswered.`)
  if (f.flaggedRings) parts.push(`${f.flaggedRings} had warning signs${f.topFlags[0] ? ` (most common: ${f.topFlags[0].flag.toLowerCase()})` : ''}.`)
  if (f.byVisitor.unknown) parts.push(`${f.byVisitor.unknown} were unknown visitors.`)
  return parts.join(' ')
}

export async function runDigest(householdId: string, now = new Date(), force = false) {
  const weekStart = weekStartFor(now)
  const existing = await getDb().weeklyDigest.findUnique({ where: { householdId_weekStart: { householdId, weekStart } } })
  if (existing && !force) return existing

  const facts = await computeFacts(householdId, weekStart)
  let text = templateText(facts)
  if (facts.totalRings > 0) {
    const out = await generateJson({
      agent: 'digest', householdId, role: 'workhorse', schema: DigestOut, maxOutputTokens: 250, system: DIGEST_SYSTEM,
      parts: [{ text: `FACTS (JSON):\n${JSON.stringify(facts)}` }],
    })
    if (out) { const t = clampWords(out.text, 100); if (!hasBannedPhrase(t)) text = t }
  }
  return getDb().weeklyDigest.upsert({
    where: { householdId_weekStart: { householdId, weekStart } },
    create: { householdId, weekStart, facts: facts as any, text },
    update: { facts: facts as any, text, createdAt: new Date() },
  })
}

/** Cron: stagger households so the quality model's daily quota is never hit in one burst. */
export async function householdsForDigest(): Promise<string[]> {
  const rows = await getDb().household.findMany({ where: { aiEnabled: true }, select: { id: true } })
  return rows.map(r => r.id)
}
