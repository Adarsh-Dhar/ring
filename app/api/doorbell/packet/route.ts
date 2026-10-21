import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { loadDecisionPacket } from '@/lib/doorstep/decisionPacketStore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/doorbell/packet?caseId=...
 * The structured decision packet for one case (spec section 10). Read-only. Shown to the resident's helpers and to the resident.
 * The packet is computed by the modules from stored evidence; nothing in it comes from a language model.
 */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res
  const caseId = req.nextUrl.searchParams.get('caseId')
  if (!caseId) return fail('caseId is required', 400)
  try {
    const packet = await loadDecisionPacket(a.session!.householdId, caseId)
    if (!packet) return fail('Case not found', 404)
    return NextResponse.json(packet, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[DOORBELL PACKET]', e)
    return fail('Could not build the decision packet', 503)
  }
}
