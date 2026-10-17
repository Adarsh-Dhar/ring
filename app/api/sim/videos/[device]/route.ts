import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail, HOUSEHOLD_COOKIE } from '@/lib/guard'
import { statVideo, streamVideo, sanitiseDevice, saveVideo } from '@/lib/sim-videos/store'
import { parseRange } from '@/lib/sim-videos/range'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ device: string }> }

const BASE_HEADERS = {
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

async function resolve(req: NextRequest, ctx: Ctx) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return { res: a.res } as const

  // Resolve householdId from session or cookie
  let householdId = a.session!.householdId
  if (!householdId) {
    const householdCookie = req.cookies.get(HOUSEHOLD_COOKIE)?.value
    if (householdCookie) {
      householdId = householdCookie
    }
  }
  if (!householdId) return { res: fail('No household selected', 400) } as const

  const { device } = await ctx.params
  if (!sanitiseDevice(device)) return { res: fail('Invalid device name', 400) } as const
  const stats = await statVideo(householdId, device)
  if (!stats) return { res: fail('Video not found', 404) } as const
  return { householdId, device, stats } as const
}

/**
 * HEAD = "is there an uploaded clip?" (200 + headers, or 404). The player uses it instead of downloading the file.
 */
export async function HEAD(req: NextRequest, ctx: Ctx) {
  try {
    const r = await resolve(req, ctx)
    if ('res' in r) return new NextResponse(null, { status: r.res.status })
    return new NextResponse(null, {
      status: 200,
      headers: { ...BASE_HEADERS, 'Content-Length': String(r.stats.size), 'Content-Type': r.stats.contentType },
    })
  } catch (e) {
    console.error('[SIM VIDEOS DEVICE HEAD]', e)
    return new NextResponse(null, { status: 500 })
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const r = await resolve(req, ctx)
    if ('res' in r) return r.res
    const { householdId, device, stats } = r

    const range = parseRange(req.headers.get('range'), stats.size)
    if (range === 'unsatisfiable') {
      return new NextResponse('Requested range not satisfiable', {
        status: 416,
        headers: { ...BASE_HEADERS, 'Content-Range': `bytes */${stats.size}` },
      })
    }

    const start = range ? range.start : 0
    const end = range ? range.end : stats.size - 1
    const body = await streamVideo(householdId, device, start, end)
    if (!body) return fail('Video not found', 404)

    return new NextResponse(body, {
      status: range ? 206 : 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': stats.contentType,
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stats.size}` } : {}),
      },
    })
  } catch (e) {
    console.error('[SIM VIDEOS DEVICE GET] Failed to serve video', e)
    return fail('Unable to serve video', 500)
  }
}

/**
 * POST = upload a video for this device
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const a = await authorize(req, 'any')
    if (a.ok === false) return a.res

    // Resolve householdId from session or cookie
    let householdId = a.session!.householdId
    if (!householdId) {
      const householdCookie = req.cookies.get(HOUSEHOLD_COOKIE)?.value
      if (householdCookie) {
        householdId = householdCookie
      }
    }
    if (!householdId) return fail('No household selected', 400)

    const { device } = await ctx.params
    if (!sanitiseDevice(device)) return fail('Invalid device name', 400)

    const formData = await req.formData()
    const file = formData.get('video') as File | null
    if (!file) return fail('No video file provided', 400)

    // Validate file size (max 50 MB)
    const MAX_SIZE = 50 * 1024 * 1024
    if (file.size > MAX_SIZE) return fail('Video file too large (max 50 MB)', 400)

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/webm', 'video/ogg']
    if (!allowedTypes.includes(file.type)) return fail('Invalid file type (must be MP4, WebM, or OGG)', 400)

    // Convert File to Buffer
    const buffer = Buffer.from(await file.arrayBuffer())

    // Save the video with the correct content type
    await saveVideo(householdId, device, buffer, file.type)

    return NextResponse.json({ ok: true, message: 'Video uploaded successfully' })
  } catch (e) {
    console.error('[SIM VIDEOS DEVICE POST] Failed to upload video', e)
    return fail('Unable to upload video', 500)
  }
}
