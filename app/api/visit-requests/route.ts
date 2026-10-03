import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { getHousehold } from '@/lib/db/households'
import { listRequests } from '@/lib/db/visit-requests'
import { decideRequest } from '@/lib/doorbell/requests'
import { sweepRequests } from '@/lib/doorbell/request-lifecycle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res
  const s = a.session
  const hh = await getHousehold(s.householdId)
  await sweepRequests(s.householdId)
  const rows = await listRequests(s.householdId, ['pending'])

  const shape = (r: any) => ({
    id:          r.id,
    name:        r.name,
    purpose:     r.purpose,
    note:        r.note,
    contactKind: r.contactKind,
    startsAt:    r.startsAt.getTime(),
    endsAt:      r.endsAt.getTime(),
    createdAt:   r.createdAt.getTime(),
    helperOk:    !!r.helperOkAt,
    // contact details are NEVER returned to any client
  })

  if (s.kind === 'resident') {
    // Resident sees only requests that are waiting for their approval
    if (!(hh as any)?.requireResidentOk) return NextResponse.json({ requests: [] })
    return NextResponse.json({
      requests: rows
        .filter(r => r.helperOkAt && !r.residentOkAt)
        .map(r => ({ ...shape(r), note: null })),   // strip note for resident
    })
  }

  return NextResponse.json({
    requests:          rows.map(shape),
    requireResidentOk: !!(hh as any)?.requireResidentOk,
  })
}

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res
  const p = await parse(req, z.object({
    id:       z.string().max(80),
    decision: z.enum(['approve', 'decline']),
  }))
  if (p.ok === false) return p.res
  const s = a.session
  const r = await decideRequest(
    s.householdId,
    p.data.id,
    { kind: s.kind === 'resident' ? 'resident' : 'helper', membershipId: s.membershipId },
    p.data.decision,
  )
  return r.ok === false ? fail(r.error, r.status) : NextResponse.json(r)
}
