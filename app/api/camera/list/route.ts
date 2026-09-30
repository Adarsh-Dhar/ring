import { NextRequest, NextResponse } from 'next/server'
import { listDemoClips, LOCAL_VIDEO } from '@/lib/demo'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Names of the videos in videos/. Used by the helper screen's "switch camera" button. */
export async function GET(req: NextRequest) {
  const a = authorize(req, 'helper')
  if (!a.ok) return a.res
  return NextResponse.json({ enabled: LOCAL_VIDEO, clips: listDemoClips().map((c) => c.file) })
}
