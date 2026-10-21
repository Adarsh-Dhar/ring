/**
 * Coverage bookkeeping for the door interview. Pure functions, no app imports, so it can be unit-tested
 * without a model or a database.
 *
 * WHAT THIS IS (AND IS NOT)
 * This module does NOT decide what to ask. It used to: it held a priority order, a "keep pressing" rule and a
 * bank of five scripted phrasings per slot. All of that is gone. What to ask next is now planned by the interviewer
 * agent (lib/ai/interrogation/interviewer.ts) from the case file, validated against the playbook
 * (playbook.ts) and checked by the guardrails (guardrails.ts).
 *
 * What remains is the helper-facing ledger: which things did the visitor give us (specific / vague / declined),
 * how often did we ask, and the two facts the risk assessor may use. Vague or declined answers are shown to the
 * carers as notes. They are never evidence of wrongdoing: shy, anxious and non-native speakers are often vague.
 */

export const SLOT_KEYS = ['purpose', 'organisation', 'detail', 'name', 'relation', 'target', 'proof', 'companions', 'spatial', 'appointment', 'recheck'] as const
export type Slot = (typeof SLOT_KEYS)[number]

export const STATUSES = ['missing', 'vague', 'specific', 'refused'] as const
export type Status = (typeof STATUSES)[number]
export type Obs = Partial<Record<Slot, Status>>

/** What we remember about each answered turn (stored inside Case.interrogationTurns, no migration needed). */
export interface PlanTurn {
  obs?: Obs
  /** The topic the question asked AFTER this answer was about. */
  focus?: Slot | null
  claimsOrg?: boolean
  personalTie?: boolean
  claimsAppointment?: boolean
  riskHint?: 'none' | 'low' | 'medium' | 'high'
}

export interface PlanState {
  status: Record<Slot, Status>
  asks: Record<Slot, number>
  claimsOrg: boolean
  personalTie: boolean
  claimsAppointment: boolean
  riskHint: 'none' | 'low' | 'medium' | 'high'
}

const LEVEL_RANK = ['none', 'low', 'medium', 'high'] as const
const blank = <T,>(v: T) => Object.fromEntries(SLOT_KEYS.map(k => [k, v])) as Record<Slot, T>

export const isSlot = (s: unknown): s is Slot => typeof s === 'string' && (SLOT_KEYS as readonly string[]).includes(s)
export const isStatus = (s: unknown): s is Status => typeof s === 'string' && (STATUSES as readonly string[]).includes(s)

/** Keep only known slots with known statuses (the model's JSON is untrusted). */
export function cleanObs(raw: unknown): Obs {
  const out: Obs = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isSlot(k) && isStatus(v)) out[k] = v
  }
  return out
}

/** Fold every answered turn into the current state. The latest NON-missing observation wins. */
export function foldPlan(turns: PlanTurn[]): PlanState {
  const s: PlanState = {
    status: blank<Status>('missing'), asks: blank(0),
    claimsOrg: false, personalTie: false, claimsAppointment: false, riskHint: 'none',
  }
  for (const t of turns) {
    for (const [k, v] of Object.entries(t.obs ?? {})) if (isSlot(k) && isStatus(v) && v !== 'missing') s.status[k] = v
    if (t.focus && isSlot(t.focus)) s.asks[t.focus] += 1
    s.claimsOrg ||= !!t.claimsOrg
    s.personalTie ||= !!t.personalTie
    s.claimsAppointment ||= !!t.claimsAppointment
    if (t.riskHint && LEVEL_RANK.indexOf(t.riskHint) > LEVEL_RANK.indexOf(s.riskHint)) s.riskHint = t.riskHint
  }
  return s
}

/** The topics a visitor with a genuine errand could normally answer, given what they have claimed so far. */
export function requiredSlots(s: PlanState, answered: number): Slot[] {
  const need = new Set<Slot>(['purpose', 'name', 'detail', 'proof', 'companions', 'spatial', 'target'])
  if (s.claimsOrg) need.add('organisation')
  if (s.personalTie) need.add('relation')
  if (s.claimsAppointment) need.add('appointment')
  if (answered >= 3) need.add('recheck')
  return SLOT_KEYS.filter(k => need.has(k))
}

/** Every required topic is specific. Code-side half of "satisfied". */
export function isSatisfied(s: PlanState, answered: number): boolean {
  return requiredSlots(s, answered).every(k => s.status[k] === 'specific')
}

// ── helper-facing summary ─────────────────────────────────────────────────────

export const SLOT_LABEL: Record<Slot, string> = {
  purpose: 'Specific reason for the visit',
  organisation: 'Organisation named',
  detail: 'Gave concrete detail about the errand',
  name: 'Gave a name',
  relation: 'Explained how they know the resident',
  target: 'Named who they want to see',
  proof: 'Showed ID or gave a reference',
  companions: 'Said whether anyone is with them',
  spatial: 'Answered how/when they got here',
  appointment: 'Said what was arranged, with whom and when',
  recheck: 'Repeated their earlier answers consistently',
}

export interface CoverageItem { slot: Slot; label: string; status: Status; asked: number; note?: string }

/** Statuses as the helper should see them: "missing" after we asked means they dodged. */
export const effective = (s: PlanState, k: Slot): Status =>
  s.status[k] === 'missing' && s.asks[k] > 0 ? 'vague' : s.status[k]

export function coverageSummary(s: PlanState, answered: number): CoverageItem[] {
  const items: CoverageItem[] = []
  const required = new Set(requiredSlots(s, answered))
  for (const k of SLOT_KEYS) {                     // display in natural order
    const st = effective(s, k)
    if (!required.has(k) && st === 'missing') continue
    // Purpose is part of the opening question, so "missing" after an answer means it was not given.
    const shown: Status = k === 'purpose' && st === 'missing' && answered > 0 ? 'vague' : st
    items.push({ slot: k, label: SLOT_LABEL[k], status: shown, asked: s.asks[k] })
  }
  return items
}

/** Facts the risk assessor may use. Derived by code from what the interview observed. */
export interface CoverageFacts { purposeVague: boolean; unverifiable: boolean }

export function coverageFacts(s: PlanState, answered: number): CoverageFacts {
  if (answered === 0) return { purposeVague: false, unverifiable: false }
  const bad = (k: Slot) => { const e = effective(s, k); return e === 'vague' || e === 'refused' }
  const purposeMissing = s.status.purpose === 'missing'
  const relationBad = s.personalTie && bad('relation')
  const purposeVague = bad('purpose') || bad('detail') || purposeMissing || relationBad
  const unverifiable = s.claimsOrg && (bad('proof') || bad('organisation'))
  return { purposeVague, unverifiable }
}

/** Plain lines for the risk judge's prompt (trusted, computed by code, never visitor text). */
export function coverageLines(items: CoverageItem[]): string[] {
  const word: Record<Status, string> = { specific: 'given', vague: 'vague or not given', refused: 'declined', missing: 'not asked' }
  return items.map(i => `${i.label}: ${word[i.status]}${i.asked ? ` (asked ${i.asked}x)`: ''}${i.note ?`. ${i.note}` : ''}`)
}
