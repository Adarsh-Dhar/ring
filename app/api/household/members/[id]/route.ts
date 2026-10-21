/**
 * PATCH /api/household/members/[id]
 *
 * Update membership settings including tier (Section 7).
 * Contact order may be changed by any helper or by the resident.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { getMembership } from '@/lib/db/memberships'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  tier: z.enum(['primary', 'backup', 'third']),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { tier } = p.data

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  const membership = await getMembership(params.id)
  if (!membership) {
    return fail('Membership not found', 404)
  }

  // Household check: membership must belong to the caller's household
  if (membership.householdId !== householdId) {
    return fail('Membership not in your household', 403)
  }

  const db = getDb()
  await db.membership.update({
    where: { id: params.id },
    data: { tier },
  })

  return NextResponse.json({ success: true })
}
