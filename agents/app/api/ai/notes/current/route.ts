import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { currentNote } from '@/lib/ai/agents/compressor'

/** Resident screen: the approved sentence + icon only. Never raw AI text, never drafts. */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  return NextResponse.json({ note: await currentNote(householdId) })
}
