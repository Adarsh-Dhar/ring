/**
 * Agent 4: Visit Intake.
 * The LLM only (a) extracts what the visitor CLAIMS and (b) words one short follow-up question.
 * The read-only "tools" (calendar, known visits) are called by CODE from the claimed time, and the verdict
 * is computed deterministically. The visitor is never told what is or isn't expected.
 */
import { getDb } from '@/lib/db/client'
import { generateJson } from '@/lib/ai/client'
import { IntakeTurnOut, type IntakeTurn } from '@/lib/ai/schemas'
import { INTAKE_SYSTEM } from '@/lib/ai/prompts/intake'
import { sanitize, validQuestion, wrapUntrusted } from '@/lib/ai/guard'
import { aiFlags } from '@/lib/ai/caseAi'

export const MAX_TURNS = 3
export const FIRST_QUESTION = 'Which organisation are you visiting from, and what time is your visit?'
const TOOL_WINDOW_MS = 2 * 3_600_000

export interface Claims { organisation: string | null; purpose: string | null; time: string | null; startsAt: string | null }
type Turn = { q: string; a?: string }

// ── read-only tools (minimal data, only near the claimed window) ─────────────
export async function getCalendarEvents(householdId: string, from: Date, to: Date) {
  const { getApprovedMemberships } = await import('@/lib/db/memberships')
  const { listCalendarEvents } = await import('@/lib/google-calendar/eventsApi')
  const members = (await getApprovedMemberships(householdId)).filter((m: any) => m.role === 'guardian')
  const seen = new Set<string>(); const out: { start: number; end: number; text: string }[] = []
  let anyConnected = false
  for (const m of members) {
    if (seen.has(m.userId)) continue; seen.add(m.userId)
    const items = await listCalendarEvents(m.userId, from, to)
    if (items === null) continue
    anyConnected = true
    for (const e of items) {
      const s = Date.parse(e.start?.dateTime || e.start?.date || ''); const en = Date.parse(e.end?.dateTime || e.end?.date || '')
      if (Number.isFinite(s)) out.push({ start: s, end: Number.isFinite(en) ? en : s, text: sanitize(`${e.summary ?? ''}`, 60).toLowerCase() })
    }
  }
  return { anyConnected, events: out }
}

export async function getKnownVisits(householdId: string, from: Date, to: Date) {
  const rows = await getDb().expectedVisit.findMany({
    where: { householdId, startsAt: { lte: to }, endsAt: { gte: from } },
    select: { startsAt: true, endsAt: true, label: true, who: true },
    take: 20,
  })
  return rows.map(r => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime(), text: sanitize(`${r.label} ${r.who ?? ''}`, 60).toLowerCase() }))
}

// ── deterministic verdict ────────────────────────────────────────────────────
const STOP = new Set(['the', 'and', 'from', 'for', 'clinic', 'centre', 'center', 'ltd', 'limited', 'services', 'service', 'visit', 'a', 'of'])
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w))
const overlapsText = (claim: string | null, text: string) => !!claim && words(claim).some(w => text.includes(w))

export async function evaluate(householdId: string, claims: Claims, requested: { startsAt: Date }) {
  const mismatches: string[] = []
  const claimed = claims.startsAt ? new Date(claims.startsAt) : null
  const at = claimed && Number.isFinite(claimed.getTime()) ? claimed : null
  if (!claims.organisation) mismatches.push('No organisation given')
  if (!at) mismatches.push('No clear time given')
  if (at && Math.abs(at.getTime() - requested.startsAt.getTime()) > 60 * 60_000) mismatches.push('Time differs from the time on the request')
  if (!at) return { verdict: 'unclear' as const, mismatches }

  const from = new Date(at.getTime() - TOOL_WINDOW_MS), to = new Date(at.getTime() + TOOL_WINDOW_MS)
  const [cal, known] = await Promise.all([getCalendarEvents(householdId, from, to), getKnownVisits(householdId, from, to)])
  const pool = [...cal.events, ...known]
  if (!cal.anyConnected && known.length === 0) { mismatches.push('No calendar connected to check against'); return { verdict: 'unclear' as const, mismatches } }
  if (pool.length === 0) { mismatches.push('No matching event near that time'); return { verdict: 'no_match' as const, mismatches } }
  const hit = pool.some(p => overlapsText(claims.organisation, p.text) || overlapsText(claims.purpose, p.text))
  if (!hit) { mismatches.push('Events near that time do not match the organisation or purpose'); return { verdict: 'unclear' as const, mismatches } }
  return { verdict: mismatches.length ? 'unclear' as const : 'match' as const, mismatches }
}

export function describeVerdict(name: string, claims: Claims, verdict: string, mismatches: string[]): string {
  const bits = [claims.organisation && `from ${claims.organisation}`, claims.time && `for ${claims.time}`].filter(Boolean).join(' ')
  const head = `${name} says visiting ${bits || 'with no details'}.`
  const tail = verdict === 'match' ? 'Looks consistent with a known event.' : verdict === 'no_match' ? 'No matching event found.' : 'Could not confirm.'
  return `${head} ${tail}`.slice(0, 220)
}

// ── turn handling ────────────────────────────────────────────────────────────
async function load(requestId: string) {
  return getDb().visitIntake.findUnique({ where: { requestId } })
}

export async function startIntake(householdId: string, requestId: string) {
  const f = await aiFlags(householdId)
  if (!f.aiEnabled) return null
  const existing = await load(requestId)
  if (existing) return { question: nextOpenQuestion(existing.turns as Turn[]), status: existing.status }
  const turns: Turn[] = [{ q: FIRST_QUESTION }]
  const row = await getDb().visitIntake.create({ data: { requestId, turns: turns as any } })
  await getDb().visitRequest.update({ where: { id: requestId }, data: { intakeId: row.id } })
  return { question: FIRST_QUESTION, status: 'open' as const }
}

const nextOpenQuestion = (turns: Turn[]) => { const t = turns[turns.length - 1]; return t && t.a === undefined ? t.q : null }

export async function answerIntake(householdId: string, requestId: string, answerRaw: string) {
  const row = await load(requestId)
  if (!row || row.status !== 'open') return row ? { question: null, status: row.status } : null
  const turns = row.turns as Turn[]
  const last = turns[turns.length - 1]
  if (!last || last.a !== undefined) return { question: null, status: row.status }
  last.a = sanitize(answerRaw, 300)

  const req = await getDb().visitRequest.findUnique({ where: { id: requestId }, select: { name: true, startsAt: true, householdId: true } })
  if (!req || req.householdId !== householdId) return null
  const transcript = turns.map(t => `Q: ${t.q}\n${t.a !== undefined ? wrapUntrusted('visitor_answer', t.a, 300) : ''}`).join('\n')

  const out: IntakeTurn | null = await generateJson({
    agent: 'intake', householdId, role: 'workhorse', schema: IntakeTurnOut, maxOutputTokens: 250, system: INTAKE_SYSTEM,
    parts: [{ text: `Reference time (ISO): ${new Date().toISOString()}\n${transcript}` }],
  })

  const claims: Claims = out?.claims ?? { organisation: null, purpose: null, time: null, startsAt: null }
  const asked = turns.length
  let question = out?.nextQuestion ?? null
  if (question && !validQuestion(question)) question = null            // model went off-script: stop asking
  const done = !question || asked >= MAX_TURNS

  if (!done) {
    turns.push({ q: question! })
    await getDb().visitIntake.update({ where: { requestId }, data: { turns: turns as any, claims: claims as any } })
    return { question, status: 'open' as const }
  }

  const { verdict, mismatches } = await evaluate(householdId, claims, { startsAt: req.startsAt })
  await getDb().visitIntake.update({ where: { requestId }, data: { turns: turns as any, claims: claims as any, verdict, mismatches: mismatches as any, status: 'done' } })
  await getDb().visitRequest.update({ where: { id: requestId }, data: { riskNote: describeVerdict(req.name.split(' ')[0], claims, verdict, mismatches) } })
  return { question: null, status: 'done' as const }
}
