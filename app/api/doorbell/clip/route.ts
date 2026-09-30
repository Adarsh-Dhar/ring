import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { Readable } from 'stream'
import { resolveDemoFile } from '@/lib/demo'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Streams a file from videos/ with HTTP Range support (needed for seeking/looping in browsers, esp. Safari). */
export async function GET(req: NextRequest) {
  const a = authorize(req, 'helper')
  if (!a.ok) return a.res
  const f = resolveDemoFile(req.nextUrl.searchParams.get('file') || '')
  if (!f) return NextResponse.json({ error: 'clip not found' }, { status: 404 })

  const size = fs.statSync(f.full).size
  const base = { 'Content-Type': f.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' }
  const range = req.headers.get('range')
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null

  let start = 0
  let end = size - 1
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = parseInt(m[1], 10)
      if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1)
    } else {
      start = Math.max(0, size - parseInt(m[2], 10)) // "bytes=-N" = last N bytes
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
    }
    const body = Readable.toWeb(fs.createReadStream(f.full, { start, end })) as unknown as ReadableStream
    return new Response(body, {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    })
  }
  const body = Readable.toWeb(fs.createReadStream(f.full)) as unknown as ReadableStream
  return new Response(body, { headers: { ...base, 'Content-Length': String(size) } })
}
