// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { getConnectionForHousehold, ringConfiguredForHousehold } from '@/lib/ring/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId

  const connection = await getConnectionForHousehold(householdId)
  const configured = await ringConfiguredForHousehold(householdId)

  return NextResponse.json({
    ok: true,
    configured,
    connection: connection ? {
      id: connection.id,
      ringAccountId: connection.ringAccountId,
      status: connection.status,
      linkedByUserId: connection.linkedByUserId,
      expiresAt: connection.expiresAt,
    } : null,
  })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disconnect') }),
  z.object({ action: z.literal('revoke') }),
])

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId

  const p = await parse(req, Body)
  if (!p.ok) return p.res
  const b = p.data

  const db = getDb()
  const connection = await db.ringConnection.findFirst({
    where: { householdId, status: 'linked' }
  })

  if (!connection) {
    return fail('No Ring connection found', 404)
  }

  switch (b.action) {
    case 'disconnect':
      // Just mark as revoked locally
      await db.ringConnection.update({
        where: { id: connection.id },
        data: { status: 'revoked' }
      })
      return NextResponse.json({ ok: true })
    case 'revoke':
      // Mark as revoked locally AND call Ring to revoke
      await db.ringConnection.update({
        where: { id: connection.id },
        data: { status: 'revoked' }
      })
      // TODO: Call Ring API to revoke the integration
      return NextResponse.json({ ok: true })
  }
}
