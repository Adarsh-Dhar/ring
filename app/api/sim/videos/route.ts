import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { saveVideo, listVideos, deleteVideo, statVideo, sanitiseDevice } from '@/lib/sim-videos/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (process.env.DEMO_MODE !== '1') {
    return fail('Simulator video upload is disabled in production', 403)
  }

  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  const url = new URL(req.url)
  const device = url.searchParams.get('device')

  try {
    if (device) {
      // Check if a specific device has an uploaded clip
      const metadata = await statVideo(householdId, device)
      if (!metadata) {
        return NextResponse.json({ exists: false })
      }
      return NextResponse.json({ exists: true, metadata })
    }

    // List all videos
    const videos = await listVideos(householdId)
    return NextResponse.json({ videos })
  } catch (e) {
    console.error('[SIM VIDEOS GET] Failed to list videos', e)
    return fail('Unable to list videos', 500)
  }
}

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE !== '1') {
    return fail('Simulator video upload is disabled in production', 403)
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

  try {
    // Check content-length header if available
    const contentLength = req.headers.get('content-length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      const maxSize = parseInt(process.env.SIM_VIDEO_MAX_MB || '50', 10) * 1024 * 1024
      if (size > maxSize) {
        return fail(`File too large. Maximum ${process.env.SIM_VIDEO_MAX_MB || 50} MB.`, 413)
      }
    }

    const buffer = Buffer.from(await req.arrayBuffer())

    await saveVideo(householdId, device, buffer)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[SIM VIDEOS POST] Failed to save video', e)
    const message = e instanceof Error ? e.message : 'Unable to save video'
    return fail(message, 400)
  }
}

export async function DELETE(req: NextRequest) {
  if (process.env.DEMO_MODE !== '1') {
    return fail('Simulator video upload is disabled in production', 403)
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
    return fail('Invalid device name', 400)
  }

  try {
    await deleteVideo(householdId, device)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[SIM VIDEOS DELETE] Failed to delete video', e)
    return fail('Unable to delete video', 500)
  }
}
