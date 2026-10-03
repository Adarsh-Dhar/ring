// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { confirmCase } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (!a.ok) return a.res
  const p = await parse(req, z.object({ caseId: z.string().max(80), ok: z.boolean() }))
  if (!p.ok) return p.res
  const householdId = a.session!.householdId
  const c = await confirmCase(householdId, p.data.caseId, p.data.ok)
  if (!c) return fail('nothing to confirm', 404)
  return NextResponse.json({ ok: true })
}
