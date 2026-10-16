import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { saveVideo, listVideos, deleteVideo, statVideo } from '@/lib/sim-videos/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// DEMO_MODE check
if (process.env.DEMO_MODE !== '1') {
  console.warn('[SIM VIDEOS] Demo mode is not enabled. Simulator video upload is disabled.')
}

export async function GET(req: NextRequest) {
  if (process.env.DEMO_MODE !== '1') {
    return fail('Simulator video upload is disabled in production', 403)
  }

  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  try {
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

  try {
    const buffer = Buffer.from(await req.arrayBuffer())

    // Detect type from magic bytes
    const type = buffer[0] === 0x00 && buffer[4] === 0x66 ? 'mp4' : 'webm'

    await saveVideo(householdId, device, buffer, type)
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

  try {
    await deleteVideo(householdId, device)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[SIM VIDEOS DELETE] Failed to delete video', e)
    return fail('Unable to delete video', 500)
  }
}
