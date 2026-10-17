import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'
import { getDb } from '@/lib/db/client'
import * as dbr from '@/lib/db/visit-requests'
import { createVisitRequestForLink, decideRequest } from '@/lib/doorbell/requests'
import { sweepRequests } from '@/lib/doorbell/request-lifecycle'
import { startIntake, answerIntake } from '@/lib/ai/agents/intake'
import { newToken, hashToken } from '@/lib/visit-tokens'
import { PURPOSE_KEYS } from '@/lib/doorbell/purposes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const demoOff = () => process.env.DEMO_MODE !== '1'

const Body = z.discriminatedUnion('action', [
  // 1. The simulated visitor fills in the public visit form
  z.object({
    action:        z.literal('apply'),
    name:          z.string().trim().min(1).max(40).transform(s => s.replace(/[\u0000-\u001f]/g, '')),
    purpose:       z.enum(PURPOSE_KEYS),
    note:          z.string().trim().max(120).optional(),
    startsInMin:   z.number().int().min(0).max(60 * 24 * 7).default(5),
    durationMin:   z.number().int().min(15).max(240).default(60),
  }),
  // 2. The visitor answers the intake agent's follow-up questions (no answer = start)
  z.object({ action: z.literal('intake'), requestId: z.string().min(1).max(80), answer: z.string().trim().max(300).optional() }),
  // 3. A helper approves or declines (simulated with the signed-in guardian's membership)
  z.object({ action: z.literal('decide'), requestId: z.string().min(1).max(80), decision: z.enum(['approve', 'decline']) }),
])

/** GET: the helper-side list for the Simulation tab (pending first, then the latest decided). Guardian only. */
export async function GET(req: NextRequest) {
  if (demoOff()) return fail('Simulator is disabled. Set DEMO_MODE=1 and restart.', 403)
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)

  await sweepRequests(householdId).catch(() => {})
  const rows = await dbr.listRequests(householdId, ['pending', 'approved', 'declined', 'expired'], 15)
  const intakes = await getDb().visitIntake.findMany({
    where: { requestId: { in: rows.map((r: any) => r.id) } },
    select: { requestId: true, status: true, verdict: true, claims: true, turns: true },
  })
  const byReq = new Map((intakes as any[]).map(i => [i.requestId as string, i]))
  return NextResponse.json({
    requests: rows.map((r: any) => {
      const i = byReq.get(r.id)
      return {
        id: r.id, name: r.name, purpose: r.purpose, note: r.note, status: r.status,
        riskNote: r.riskNote ?? null,
        startsAt: r.startsAt.getTime(), endsAt: r.endsAt.getTime(), createdAt: r.createdAt.getTime(),
        intake: i ? { status: i.status, verdict: i.verdict, claims: i.claims, turns: i.turns } : null,
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  if (demoOff()) return fail('Simulator is disabled. Set DEMO_MODE=1 and restart.', 403)
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const s = a.session
  const householdId = s.householdId
  if (!householdId) return fail('No household', 400)
  if (!hit(`sim:vr:${householdId}`, 30, 60_000)) return fail('Too many requests', 429)

  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const b = p.data

  // ── 1. apply ───────────────────────────────────────────────────────────────
  if (b.action === 'apply') {
    // Use the household's active visit link; make one if none exists (the raw token is never needed here).
    let link: any = await dbr.findActiveLink(householdId)
    if (!link) {
      try { link = await dbr.createLink(householdId, s.userId, hashToken(newToken())) }
      catch { return fail('No active visit link. Create one first in Visitors → visit link.', 409) }
    }
    const now = Date.now()
    const startsAt = now + b.startsInMin * 60_000
    const r = await createVisitRequestForLink(link, {
      name: b.name, purpose: b.purpose, note: b.note,
      // .invalid never resolves, so the "visitor" notification on approve/decline goes nowhere.
      contactRaw: `sim-${Date.now().toString(36)}@sim.invalid`,
      startsAt, endsAt: startsAt + b.durationMin * 60_000,
      ip: `sim:${householdId}`,
    })
    if (r.ok === false) return fail(r.error, r.status)
    const row: any = await dbr.getRequestByToken(r.statusToken)
    return NextResponse.json({ ok: true, requestId: row?.id ?? null })
  }

  // Everything below must target a request that belongs to THIS household.
  const row: any = await dbr.getRequest(householdId, b.requestId)
  if (!row) return fail('Request not found', 404)

  // ── 2. intake ──────────────────────────────────────────────────────────────
  if (b.action === 'intake') {
    if (row.status !== 'pending') return NextResponse.json({ question: null, done: true })
    const r = b.answer === undefined
      ? await startIntake(householdId, row.id)
      : await answerIntake(householdId, row.id, b.answer)
    if (!r) return NextResponse.json({ question: null, done: true, aiOff: true })   // AI off: request continues without intake
    return NextResponse.json({ question: r.question, done: r.status !== 'open' })
  }

  // ── 3. decide ───────────────────────────────────────────────────────────────
  const d = await decideRequest(householdId, row.id, { kind: 'helper', membershipId: s.membershipId }, b.decision)
  if (d.ok === false) return fail(d.error, d.status)
  return NextResponse.json(d)
}
