import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { decideNote } from '@/lib/ai/agents/compressor'
import { getDb } from '@/lib/db/client'

const Body = z.object({
  action: z.enum(['approve', 'reject', 'retract']),
  text:   z.string().trim().max(120).optional(),
  icon:   z.string().max(20).optional(),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await authorize(req, 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const { id } = await ctx.params
  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  // Handle retract action - remove the approved note
  if (p.data.action === 'retract') {
    await getDb().residentNote.update({
      where: { id },
      data: { status: 'draft' }
    })
    return NextResponse.json({ ok: true })
  }

  const r = await decideNote(householdId, id, a.session.userId, { action: p.data.action, text: p.data.text, icon: p.data.icon })
  if (r === null) return fail('Draft not found or already decided', 404)
  if (r === 'invalid') return fail('That wording is not allowed', 422)
  return NextResponse.json({ ok: true, status: r.status })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await authorize(req, 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const { id } = await ctx.params

  await getDb().residentNote.delete({
    where: { id, householdId }
  })
  return NextResponse.json({ ok: true })
}
