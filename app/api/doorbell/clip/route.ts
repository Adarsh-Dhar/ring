import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { resolveDemoFile } from '@/lib/demo'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = authorize(req, 'helper')
  if (!a.ok) return a.res
  const name = req.nextUrl.searchParams.get('file') || ''
  const f = resolveDemoFile(name)
  if (!f) return NextResponse.json({ error: 'clip not found' }, { status: 404 })
  const buf = fs.readFileSync(f.full)
  const range = req.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] ? parseInt(m[1], 10) : 0
    const end = m && m[2] ? Math.min(parseInt(m[2], 10), buf.length - 1) : buf.length - 1
    return new Response(buf.subarray(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': f.mime,
        'Content-Range': `bytes ${start}-${end}/${buf.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
      },
    })
  }
  return new Response(buf, {
    headers: { 'Content-Type': f.mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(buf.length) },
  })
}
