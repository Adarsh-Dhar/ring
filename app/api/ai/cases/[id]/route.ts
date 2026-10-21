import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { getCaseAi } from '@/lib/ai/caseAi'

/** Helper card polls this for the AI fields. Kept separate so the core case state is untouched. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const { id } = await ctx.params

  try {
    const c = await getCaseAi(householdId, id)
    if (!c) return fail('Case not found', 404)
    return NextResponse.json({ ...c, label: 'AI description, may be wrong' })
  } catch (e: any) {
    console.error('[AI CASE GET]', e)
    return fail(`Unable to load AI info: ${e?.message || String(e)}`, 500)
  }
}
