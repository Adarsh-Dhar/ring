import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { readVideo, statVideo, sanitiseDevice } from '@/lib/sim-videos/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ device: string }> }
) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId
  if (!householdId) return fail('No household selected', 400)

  const { device } = await params

  // Validate device is in allowlist
  if (!sanitiseDevice(device)) {
    return fail('Invalid device name', 400)
  }

  try {
    const stats = await statVideo(householdId, device)
    if (!stats) return fail('Video not found', 404)

    const buffer = await readVideo(householdId, device)
    if (!buffer) return fail('Video not found', 404)

    // Handle Range requests for video streaming
    const range = req.headers.get('range')
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : buffer.length - 1
      const chunkSize = end - start + 1

      if (start >= buffer.length || end >= buffer.length || start > end || start < 0) {
        return new NextResponse('Requested range not satisfiable', { 
          status: 416,
          headers: {
            'Content-Range': `bytes */${buffer.length}`,
          }
        })
      }

      const chunk = buffer.slice(start, end + 1)

      return new NextResponse(chunk, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${buffer.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': stats.contentType,
          'Cache-Control': 'private, no-store',
        },
      })
    }

    // Full file response
    return new NextResponse(buffer, {
      headers: {
        'Content-Length': buffer.length.toString(),
        'Content-Type': stats.contentType,
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'bytes',
      },
    })
  } catch (e) {
    console.error('[SIM VIDEOS DEVICE GET] Failed to serve video', e)
    return fail('Unable to serve video', 500)
  }
}
