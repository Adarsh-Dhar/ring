import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { interrogatorScript } from '@/lib/ai/agents/interrogator'
import { aiFlags } from '@/lib/ai/caseAi'
import { isUnplannedVisit } from '@/lib/ai/interrogation/gate'
import { getDb } from '@/lib/db/client'

const Query = z.object({ caseId: z.string() })

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'device', 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const f = await aiFlags(householdId)
  if (!f.aiEnabled || !f.aiInterrogator) return NextResponse.json({ enabled: false })

  // Check the unplanned gate if caseId is provided
  const caseId = req.nextUrl.searchParams.get('caseId')
  if (caseId) {
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true },
    })
    if (c && !isUnplannedVisit(c)) {
      return NextResponse.json({ enabled: false })
    }
  }

  return NextResponse.json({ enabled: true, ...(await interrogatorScript(householdId, f.residentName, caseId ?? undefined)) })
}
