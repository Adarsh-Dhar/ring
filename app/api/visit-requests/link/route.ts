import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { findActiveLink, revokeActiveLinks, createLink } from '@/lib/db/visit-requests'
import { getHousehold } from '@/lib/db/households'
import { notifyVisitor, msgs, firstName } from '@/lib/visitor-notify'
import { newToken, hashToken } from '@/lib/visit-tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function notifyCancelled(householdId: string, cancelled: any[]) {
  if (!cancelled.length) return
  const hh = await getHousehold(householdId)
  const who = firstName(hh?.residentName)
  for (const r of cancelled) {
    notifyVisitor(r, msgs.cancelled(who)).catch(() => {})
  }
}

/** GET — is a link active? */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const l = await findActiveLink(a.session.householdId)
  return NextResponse.json({
    active:    !!l,
    createdAt: l?.createdAt.getTime() ?? null,
  })
}

/** POST — create (rotates any existing link; returns the raw token once). */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const hid = a.session.householdId
  const cancelled = await revokeActiveLinks(hid)
  notifyCancelled(hid, cancelled)
  const token = newToken()
  await createLink(hid, a.session.userId, hashToken(token))
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return NextResponse.json({ url: `${appUrl}/visit/${token}` })
}

/** DELETE — revoke without creating a new one. */
export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const hid = a.session.householdId
  notifyCancelled(hid, await revokeActiveLinks(hid))
  return NextResponse.json({ ok: true })
}
