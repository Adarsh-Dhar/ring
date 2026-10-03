import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { caseDevice, isCaseOpenFor, logView } from '@/lib/doorbell/store'
import { startWhep, stopWhep, getConnectionForHousehold, ringConfiguredForHousehold } from '@/lib/ring/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Live view through OUR server so the Ring access token never reaches a browser.
 * The browser sends its WebRTC SDP offer here; we forward it to Ring (WHEP) and return the SDP answer.
 * Video itself then flows directly between Ring and the helper's browser.
 * Ring limits a session to 30 s (battery) or 60 s (wired), video only, with a Ring watermark.
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId!
  const caseId = req.nextUrl.searchParams.get('caseId') || ''
  if (!(await ringConfiguredForHousehold(householdId))) return fail('Ring is not connected', 503)
  if (!(await isCaseOpenFor(householdId, caseId, membershipId))) return fail('not allowed', 403)
  const device = caseDevice(householdId, caseId)
  if (!device || device.startsWith('sim-')) return fail('No Ring device for this case', 404)
  const connection = await getConnectionForHousehold(householdId)
  if (!connection) return fail('Ring connection not found', 404)
  const offer = await req.text()
  if (!offer.startsWith('v=0') || offer.length > 20_000) return fail('bad offer')
  try {
    const { answer, sessionId } = await startWhep(connection.id, device, offer)
    await logView(householdId, caseId, membershipId, 'opened live video')
    return new Response(answer, { status: 201, headers: { 'Content-Type': 'application/sdp', 'X-Session-Id': sessionId } })
  } catch (e) {
    console.error('[RING] live view failed', e)
    return fail('Could not start live video', 502)
  }
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId!
  const p = await parse(req, z.object({ caseId: z.string().max(80), sessionId: z.string().max(200) }))
  if (p.ok === false) return p.res
  if (!(await isCaseOpenFor(householdId, p.data.caseId, membershipId))) return fail('not allowed', 403)
  const device = caseDevice(householdId, p.data.caseId)
  const connection = await getConnectionForHousehold(householdId)
  if (device && connection) await stopWhep(connection.id, device, p.data.sessionId)
  return NextResponse.json({ ok: true })
}
