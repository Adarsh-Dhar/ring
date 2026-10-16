import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail } from '@/lib/guard'
import { describeClip } from '@/lib/ai/agents/videoDescriber'
import { aiFlags } from '@/lib/ai/caseAi'
import { hit } from '@/lib/ratelimit'
import { getDb } from '@/lib/db/client'
import { MAX_FRAMES, validateFrames } from '@/lib/ai/frameLimits'
import { readFrames, sanitiseDevice } from '@/lib/sim-videos/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Either send the frames, or set useStored to analyse the frames saved when the clip was uploaded for this case's simulator device.
const RequestSchema = z
  .object({
    caseId: z.string().min(1).max(100),
    frames: z.array(z.string()).min(1).max(MAX_FRAMES).optional(),
    useStored: z.boolean().optional(),
  })
  .refine((v) => (v.frames ? 1 : 0) + (v.useStored ? 1 : 0) === 1, { message: 'Send either frames or useStored' })

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper', 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  const flags = await aiFlags(householdId)
  if (!flags.aiEnabled) return fail('AI is disabled for this household', 409)

  if (!hit(`ai:video:${householdId}`, 10, 60_000)) return fail('Too many video description requests. Please wait.', 429)

  const body = await req.json().catch(() => ({}))
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return fail(`Invalid request: ${parsed.error.issues.map((i) => i.message).join(', ')}`, 400)
  const { caseId, useStored } = parsed.data

  const caseData = await getDb().case.findFirst({ where: { id: caseId, householdId }, select: { id: true, deviceId: true } })
  if (!caseData) return fail('Case not found or does not belong to this household', 404)

  let frames = parsed.data.frames
  if (useStored) {
    const device = caseData.deviceId ?? ''
    if (!sanitiseDevice(device)) return fail('This case has no simulator device with a stored clip', 400)
    frames = (await readFrames(householdId, device)) ?? undefined
    if (!frames || frames.length === 0) return fail('No stored frames for this device. Upload a clip in the simulator first.', 404)
  }

  const check = validateFrames(frames)
  if (check.ok === false) return fail(check.error, 400)

  try {
    const result = await describeClip(householdId, caseId, frames!)
    if (!result) return fail('Video description failed (AI unavailable or the reply was rejected)', 502)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[AI DESCRIBE VIDEO] Failed', e)
    return fail('Unable to describe video', 500)
  }
}
