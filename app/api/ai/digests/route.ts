import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { getDb } from '@/lib/db/client'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const rows = await getDb().weeklyDigest.findMany({ where: { householdId }, orderBy: { weekStart: 'desc' }, take: 12 })
  return NextResponse.json({ digests: rows.map(r => ({ id: r.id, weekStart: r.weekStart, text: r.text, facts: r.facts })) })
}
