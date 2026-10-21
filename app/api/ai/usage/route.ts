import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { getDb } from '@/lib/db/client'
import { usageSnapshot } from '@/lib/ai/budget'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const since = new Date(Date.now() - 24 * 3_600_000)
  const runs = await getDb().aiRun.groupBy({ by: ['agent', 'status'], where: { householdId, createdAt: { gte: since } }, _count: { _all: true }, _sum: { tokensIn: true, tokensOut: true } })
  return NextResponse.json({
    last24h: runs.map(r => ({ agent: r.agent, status: r.status, calls: r._count._all, tokensIn: r._sum.tokensIn ?? 0, tokensOut: r._sum.tokensOut ?? 0 })),
    quotas: await usageSnapshot(),   // process-wide model budgets, not per household
  })
}
