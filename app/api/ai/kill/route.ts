import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { getDb } from '@/lib/db/client'

const Body = z.object({ aiEnabled: z.boolean().optional(), aiInterrogator: z.boolean().optional() })

/** Guardian kill switch. Turning AI off never affects alerts. */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const data: any = {}
  if (p.data.aiEnabled !== undefined) { data.aiEnabled = p.data.aiEnabled; if (!p.data.aiEnabled) data.aiInterrogator = false }
  if (p.data.aiInterrogator !== undefined && data.aiInterrogator === undefined) data.aiInterrogator = p.data.aiInterrogator
  const h = await getDb().household.update({ where: { id: householdId }, data, select: { aiEnabled: true, aiInterrogator: true } })
  return NextResponse.json(h)
}
