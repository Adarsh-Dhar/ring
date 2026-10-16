import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail } from '@/lib/guard'
import { saveFrames, sanitiseDevice } from '@/lib/sim-videos/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// DEMO_MODE check
if (process.env.DEMO_MODE !== '1') {
  console.warn('[SIM VIDEOS FRAMES] Demo mode is not enabled. Simulator frame upload is disabled.')
}

const MAX_FRAMES = 6
const MAX_FRAME_SIZE = 500_000 // 500 KB per frame (decoded)
const MAX_TOTAL_SIZE = 3_000_000 // 3 MB total (decoded)

const RequestSchema = z.object({
  frames: z.array(z.string()).min(1).max(MAX_FRAMES),
})

const DATA_URL_PREFIX = 'data:image/jpeg;base64,'

/**
 * Validate a data URL is a valid JPEG image.
 */
function isValidDataURL(str: string): boolean {
  if (!str.startsWith(DATA_URL_PREFIX)) return false
  const base64 = str.slice(DATA_URL_PREFIX.length)
  try {
    // Check if it's valid base64
    const decoded = Buffer.from(base64, 'base64')
    // JPEG magic bytes: FF D8 FF
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
    await saveFrames(householdId, device, frames)
    return NextResponse.json({ ok: true, frameCount: frames.length })
  } catch (e) {
    console.error('[SIM VIDEOS FRAMES POST] Failed to save frames', e)
    return fail('Unable to save frames', 500)
  }
}
