import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail } from '@/lib/guard'
import { describeClip } from '@/lib/ai/agents/videoDescriber'
import { aiFlags } from '@/lib/ai/caseAi'
import { hit } from '@/lib/ratelimit'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RequestSchema = z.object({
  caseId: z.string().min(1).max(100),
  frames: z.array(z.string()).min(1).max(6),
})

const DATA_URL_PREFIX = 'data:image/jpeg;base64,'
const MAX_FRAME_SIZE = 500_000 // 500 KB per frame (decoded)
const MAX_TOTAL_SIZE = 3_000_000 // 3 MB total (decoded)

/**
 * Validate a data URL is a valid JPEG image.
 */
function isValidDataURL(str: string): boolean {
  if (!str.startsWith(DATA_URL_PREFIX)) return false
  const base64 = str.slice(DATA_URL_PREFIX.length)
  try {
    const decoded = Buffer.from(base64, 'base64')
    return decoded.length >= 2 && decoded[0] === 0xFF && decoded[1] === 0xD8
  } catch {
    return false
  }
}

/**
 * Calculate decoded size from base64 string.
 */
function decodedSize(base64: string): number {
  return (base64.length * 3) / 4
}

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper', 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  // Check AI settings for this household
  const flags = await aiFlags(householdId)
  if (!flags.aiEnabled) {
    return fail('AI is disabled for this household', 409)
  }

  // Rate limit: 10 requests per minute per household
  if (!hit(`ai:video:${householdId}`, 10, 60_000)) {
    return fail('Too many video description requests. Please wait.', 429)
  }

  const p = await req.json().catch(() => ({}))
  const parse = RequestSchema.safeParse(p)
  if (!parse.success) {
    return fail(`Invalid request: ${parse.error.issues.map(i => i.message).join(', ')}`, 400)
  }

  const { caseId, frames } = parse.data

  // Verify case ownership
  const db = getDb()
  const caseData = await db.case.findFirst({
    where: {
      id: caseId,
      householdId,
    },
    select: { id: true, householdId: true },
  })

  if (!caseData) {
    return fail('Case not found or does not belong to this household', 404)
  }

  // Validate each frame
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    if (!isValidDataURL(frame)) {
      return fail(`Frame ${i + 1} is not a valid JPEG data URL`, 400)
    }
    const base64 = frame.slice(DATA_URL_PREFIX.length)
    const size = decodedSize(base64)
    if (size > MAX_FRAME_SIZE) {
      return fail(`Frame ${i + 1} too large. Maximum ${MAX_FRAME_SIZE / 1024} KB.`, 400)
    }
  }

  // Calculate total size
  let totalSize = 0
  for (const frame of frames) {
    const base64 = frame.slice(DATA_URL_PREFIX.length)
    totalSize += decodedSize(base64)
  }
  if (totalSize > MAX_TOTAL_SIZE) {
    return fail(`Total payload too large. Maximum ${MAX_TOTAL_SIZE / 1024 / 1024} MB.`, 400)
  }

  try {
    const result = await describeClip(householdId, caseId, frames)
    if (!result) {
      return fail('Video description failed (AI unavailable or error)', 500)
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('[AI DESCRIBE VIDEO] Failed', e)
    return fail('Unable to describe video', 500)
  }
}
