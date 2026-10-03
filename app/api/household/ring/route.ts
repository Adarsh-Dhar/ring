import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { getConnectionForHousehold, ringConfiguredForHousehold, ringFetchForConnection } from '@/lib/ring/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId

  const connection = await getConnectionForHousehold(householdId)
  const configured = await ringConfiguredForHousehold(householdId)

  return NextResponse.json({
    ok: true,
    configured,
    connection: connection ? {
      id:             connection.id,
      ringAccountId:  connection.ringAccountId,
      status:         connection.status,
      linkedByUserId: connection.linkedByUserId,
      expiresAt:      connection.expiresAt,
    } : null,
  })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disconnect') }),
  z.object({ action: z.literal('revoke') }),
])

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const db         = getDb()
  const connection = await db.ringConnection.findFirst({
    where: { householdId, status: 'linked' },
  })

  if (!connection) return fail('No Ring connection found', 404)

  switch (p.data.action) {
    case 'disconnect':
      // Local-only: mark revoked without calling Ring
      await db.ringConnection.update({
        where: { id: connection.id },
        data:  { status: 'revoked' },
      })
      return NextResponse.json({ ok: true })

    case 'revoke': {
      // 1. Call Ring's API to revoke our app's access on their side
      const clientId = process.env.RING_CLIENT_ID
      try {
        if (clientId) {
          await ringFetchForConnection(connection.id, '/v1/oauth/revoke', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({ client_id: clientId }),
          })
        }
      } catch (e) {
        // Log but continue – we still revoke locally so the user isn't stuck
        console.error('[RING REVOKE] Ring API call failed (continuing with local revoke)', e)
      }

      // 2. Mark revoked locally regardless of Ring API result
      await db.ringConnection.update({
        where: { id: connection.id },
        data:  { status: 'revoked' },
      })
      return NextResponse.json({ ok: true })
    }
  }
}
