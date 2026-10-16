import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { greeterScript } from '@/lib/ai/agents/greeter'
import { aiFlags } from '@/lib/ai/caseAi'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'device', 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const f = await aiFlags(householdId)
  if (!f.aiEnabled || !f.aiGreeter) return NextResponse.json({ enabled: false })
  return NextResponse.json({ enabled: true, ...(await greeterScript(householdId, f.residentName)) })
}
