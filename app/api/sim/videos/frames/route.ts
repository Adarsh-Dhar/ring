import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail } from '@/lib/guard'
import { saveFrames, sanitiseDevice } from '@/lib/sim-videos/store'
import { MAX_FRAMES, validateFrames } from '@/lib/ai/frameLimits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RequestSchema = z.object({
  frames: z.array(z.string()).min(1).max(MAX_FRAMES),
})

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE !== '1') {
    return fail('Simulator frame upload is disabled in production', 403)
  }

  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  const url = new URL(req.url)
  const device = url.searchParams.get('device')
  if (!device) return fail('Device parameter is required', 400)

  // Validate device is in allowlist
  if (!sanitiseDevice(device)) {
    return fail('Invalid device name. Allowed: sim-front-door, sim-back-door', 400)
  }

  const p = await req.json().catch(() => ({}))
  const parse = RequestSchema.safeParse(p)
  if (!parse.success) {
    return fail(`Invalid request: ${parse.error.issues.map(i => i.message).join(', ')}`, 400)
  }

  const { frames } = parse.data

  const check = validateFrames(frames)
  if (check.ok === false) return fail(check.error, 400)

  try {
    await saveFrames(householdId, device, frames)
    return NextResponse.json({ ok: true, frameCount: frames.length })
  } catch (e) {
    console.error('[SIM VIDEOS FRAMES POST] Failed to save frames', e)
    return fail('Unable to save frames', 500)
  }
}
