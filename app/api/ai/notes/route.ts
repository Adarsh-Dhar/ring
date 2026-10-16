import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { compressNote, currentNote } from '@/lib/ai/agents/compressor'
import { getDb } from '@/lib/db/client'
import { aiFlags } from '@/lib/ai/caseAi'

const Body = z.object({ note: z.string().trim().min(2).max(400) })

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)

  const db = getDb()
  const [draft, approved] = await Promise.all([
    db.residentNote.findFirst({
      where: { householdId, status: 'draft' },
      select: { id: true, draftText: true, icon: true }
    }),
    currentNote(householdId)
  ])

  return NextResponse.json({
    draft: draft ? { id: draft.id, text: draft.draftText, icon: draft.icon, fallback: false } : null,
    approved
  })
}

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  if (!hit(`ai:notes:${householdId}`, 15, 60_000)) return fail('Too many requests', 429)
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const f = await aiFlags(householdId)
  if (!f.aiEnabled) return fail('AI is off', 409)
  const h = await getDb().household.findUnique({ where: { id: householdId }, select: { residentName: true, timezone: true } })
  const when = new Date().toLocaleString('en-GB', { timeZone: h?.timezone || 'UTC', weekday: 'long', hour: '2-digit', minute: '2-digit' })
  const draft = await compressNote(householdId, p.data.note, h?.residentName ?? 'Resident', when)
  if (!draft) return fail('Could not make a draft from that note', 422)
  return NextResponse.json({ draft })
}
