import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail } from '@/lib/guard'
import { describeClip } from '@/lib/ai/agents/videoDescriber'
import { saveFrames, readFrames } from '@/lib/sim-videos/store'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RequestSchema = z.object({
  caseId: z.string(),
  frames: z.array(z.string()).min(1).max(6),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  // Rate limit: 10 requests per minute per household
  if (!hit(`ai:video:${householdId}`, 10, 60_000)) {
    return fail('Too many video description requests. Please wait.', 429)
  }

  // Check AI flags
  if (process.env.AI_FLAGS?.includes('off')) {
    return fail('AI is disabled', 409)
  }

  const p = await req.json().catch(() => ({}))
  const parse = RequestSchema.safeParse(p)
  if (!parse.success) {
    return fail('Invalid request: frames array required (1-6 base64 images)', 400)
  }

  const { caseId, frames } = parse.data

  // Validate total size (approx 3 MB max)
  let totalSize = 0
  for (const frame of frames) {
    totalSize += frame.length
  }
  if (totalSize > 3_000_000) {
    return fail('Frames too large. Maximum 3 MB total.', 400)
  }

  try {
    const result = await describeClip(householdId, caseId, frames)
    if (!result) {
      return fail('Video description failed', 500)
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('[AI DESCRIBE VIDEO] Failed', e)
    return fail('Unable to describe video', 500)
  }
}
