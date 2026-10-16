import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail } from '@/lib/guard'
import { saveFrames } from '@/lib/sim-videos/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RequestSchema = z.object({
  frames: z.array(z.string()).min(1).max(6),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  const url = new URL(req.url)
  const device = url.searchParams.get('device')
  if (!device) return fail('Device parameter is required', 400)

  const p = await req.json().catch(() => ({}))
  const parse = RequestSchema.safeParse(p)
  if (!parse.success) {
    return fail('Invalid request: frames array required (1-6 base64 images)', 400)
  }

  const { frames } = parse.data

  try {
    await saveFrames(householdId, device, frames)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[SIM VIDEOS FRAMES POST] Failed to save frames', e)
    return fail('Unable to save frames', 500)
  }
}
