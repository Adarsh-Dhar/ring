import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, isAuthOk } from '@/lib/guard'
import { createPass, getPassesForHousehold } from '@/lib/visitor/pass'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createPassSchema = z.object({
  visitorName: z.string().min(1).max(100),
  windowStart: z.string().datetime(),
  windowEnd:   z.string().datetime(),
  recurrence:  z.any().optional(),
}).refine(v => new Date(v.windowEnd) > new Date(v.windowStart), { message: 'windowEnd must be after windowStart' })

/** GET /api/visitor/passes - list this household's passes (guardian only) */
export async function GET(request: NextRequest) {
  const a = await authorize(request, 'guardian')
  if (!isAuthOk(a)) return a.res
  try {
    return NextResponse.json({ passes: await getPassesForHousehold(a.session.householdId) })
  } catch (error) {
    console.error('[PASSES] Error listing passes:', error)
    return NextResponse.json({ error: 'Failed to list passes' }, { status: 500 })
  }
}

/**
 * POST /api/visitor/passes - create a pass (guardian only).
 * The response contains `link` once. It cannot be recovered later: only a hash is stored.
 */
export async function POST(request: NextRequest) {
  const a = await authorize(request, 'guardian')
  if (!isAuthOk(a)) return a.res
  try {
    const parsed = createPassSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })

    const { pass, secret } = await createPass({
      householdId: a.session.householdId,
      visitorName: parsed.data.visitorName,
      windowStart: new Date(parsed.data.windowStart),
      windowEnd:   new Date(parsed.data.windowEnd),
      recurrence:  parsed.data.recurrence,
    })
    const base = (process.env.APP_URL || '').replace(/\/$/, '')
    return NextResponse.json({ pass, link: `${base}/visit/p/${secret}` }, { status: 201 })
  } catch (error) {
    console.error('[PASSES] Error creating pass:', error)
    return NextResponse.json({ error: 'Failed to create pass' }, { status: 500 })
  }
}
