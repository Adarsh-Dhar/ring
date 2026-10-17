/**
 * Interview plan for the door interrogator. Pure functions, no imports from the app, so it can be
 * unit-tested without a model or a database.
 *
 * WHY THIS EXISTS
 * Before this module the model alone decided when it had "enough" and any invalid or failed model reply ended
 * the interview with the closing line. One vague answer ("I need to discuss something with <name>") was enough
 * to finish. Now CODE owns the flow and the model only (a) listens and (b) grades each answer.
 *
 * THE METHOD (from doorstep-crime guidance and investigative-interviewing research, see the docs)
 *  - Doorstep offenders (bogus officials / workmen / distraction burglars / door-knockers checking a house)
 *    rely on plausible but VAGUE pretexts. Genuine visitors can say who they are, who they want, why, and can
 *    show ID or a reference. So we collect checkable specifics and record what is missing.
 *  - Truthful people tend to give more checkable detail; questions a visitor could not have rehearsed
 *    (how/when/where they got here) are more revealing than the obvious ones. Nervousness is NOT evidence.
 *  - The interview never judges or accuses. It produces a checklist and the risk judge turns that into advice
 *    for the carers. A vague visitor is "could not be verified", not "a criminal".
 */

export const SLOT_KEYS = ['purpose', 'organisation', 'name', 'relation', 'target', 'proof', 'companions', 'spatial'] as const
export type Slot = (typeof SLOT_KEYS)[number]

export const STATUSES = ['missing', 'vague', 'specific', 'refused'] as const
export type Status = (typeof STATUSES)[number]
export type Obs = Partial<Record<Slot, Status>>

/**
 * Priority order. Ties on "times asked" are broken by this order. Checks that are hardest to fake (something
 * checkable, a practical question they could not rehearse) come before cheap ones (name, who else is with them),
 * because a stubborn visitor can use up every follow-up.
 */
export const ORDER: readonly Slot[] = ['purpose', 'organisation', 'proof', 'relation', 'spatial', 'name', 'target', 'companions']

export const MAX_ASKS_PER_SLOT = 2
export const clampTurns = (n: number) => (Number.isFinite(n) ? Math.min(8, Math.max(3, Math.round(n))) : 6)
export const MAX_TURNS = clampTurns(Number(process.env.AI_INTERROGATOR_MAX_TURNS || 6))

/** What we remember about each answered turn (stored inside Case.interrogationTurns, no migration needed). */
export interface PlanTurn {
  obs?: Obs
  /** Focus of the question asked AFTER this answer. */
  focus?: Slot | null
  claimsOrg?: boolean
  personalTie?: boolean
  echoTarget?: boolean
  riskHint?: 'none' | 'low' | 'medium' | 'high'
}

export interface PlanState {
  status: Record<Slot, Status>
  asks: Record<Slot, number>
  claimsOrg: boolean
  personalTie: boolean
  echoTarget: boolean
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
    claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
  }
  for (const t of turns) {
    for (const [k, v] of Object.entries(t.obs ?? {})) if (isSlot(k) && isStatus(v) && v !== 'missing') s.status[k] = v
    if (t.focus && isSlot(t.focus)) s.asks[t.focus] += 1
    s.claimsOrg ||= !!t.claimsOrg
    s.personalTie ||= !!t.personalTie
    s.echoTarget ||= !!t.echoTarget
    if (t.riskHint && LEVEL_RANK.indexOf(t.riskHint) > LEVEL_RANK.indexOf(s.riskHint)) s.riskHint = t.riskHint
  }
  return s
}

/** Is the stated target just the resident's first name that the doorbell itself said? (parroting a cue) */
export function isEchoOfName(forWhom: string | null | undefined, residentName: string | null | undefined): boolean {
  if (!forWhom || !residentName) return false
  const first = residentName.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!first || first.length < 2) return false
  const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mister', 'sir', 'madam', 'the', 'and'])
  const toks = forWhom.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !TITLES.has(t))
  return toks.length > 0 && toks.every(t => t === first)
}

/** The slots we still care about, given what the visitor has claimed so far. */
export function requiredSlots(s: PlanState, answered: number): Slot[] {
  const need = new Set<Slot>(['purpose', 'name'])
  if (!s.echoTarget) need.add('target')            // if they only echoed the cued name, "relation" replaces it
  if (s.claimsOrg) { need.add('organisation'); need.add('proof') }
  if (s.personalTie || s.echoTarget) need.add('relation')
  const heightened = s.claimsOrg || s.riskHint !== 'none' || [...need].some(k => s.status[k] === 'vague' || s.status[k] === 'refused')
  if (heightened) {
    need.add('companions')                         // distraction burglars often work in pairs
    if (answered >= 2) need.add('spatial')         // one question they could not have rehearsed
  }
  return ORDER.filter(k => need.has(k))
}

/**
 * What to ask next, or null to finish. Fewest-asks-first so we never hammer one slot while others are untouched.
 * Pure and deterministic: the model cannot end the interview early and cannot loop forever.
 */
export function nextFocus(s: PlanState, answered: number, max = MAX_TURNS): Slot | null {
  if (answered >= max) return null
  const open = requiredSlots(s, answered).filter(k => s.status[k] !== 'specific' && s.asks[k] < MAX_ASKS_PER_SLOT)
  if (!open.length) return null
  return open.sort((a, b) => s.asks[a] - s.asks[b] || ORDER.indexOf(a) - ORDER.indexOf(b))[0]
}

/**
 * Scripted questions, two phrasings per slot (second ask is a rephrase, never a repeat).
 * Every line is <= 20 words, neutral and passes validQuestion(). No accusations, no resident details,
 * never says what is "expected", never asks whether anyone is home.
 */
export const QUESTION_BANK: Record<Slot, readonly [string, string]> = {
  purpose:      ['What exactly is the reason for your visit?', 'Sorry, I need a bit more detail. What is it about, specifically?'],
  organisation: ['Which company or organisation are you from?', 'What is the full name of your company or organisation?'],
  name:         ['What is your name, please?', 'Could you give me your first and last name?'],
  relation:     ['How do you know them?', 'How long have you known them, and how did you meet?'],
  target:       ['Who exactly are you here to see?', 'Could you give me the full name of the person you want?'],
  proof:        ['Please hold your ID card or work order up to the camera.', 'Do you have a reference number, or the name of whoever sent you?'],
  companions:   ['Is anyone with you today?', 'Is there anybody else with you, perhaps in a vehicle nearby?'],
  spatial:      ['Where did you park, or how did you get here today?', 'What time did you set off today, and from where?'],
}
export const bankQuestion = (slot: Slot, asked: number): string => QUESTION_BANK[slot][Math.min(Math.max(asked, 0), 1)]

// ── helper-facing summary ─────────────────────────────────────────────────────

export const SLOT_LABEL: Record<Slot, string> = {
  purpose: 'Specific reason for the visit',
  organisation: 'Organisation named',
  name: 'Gave a name',
  relation: 'Explained how they know the resident',
  target: 'Named who they want to see',
  proof: 'Showed ID or gave a reference',
  companions: 'Said whether anyone is with them',
  spatial: 'Answered how/when they got here',
}

export interface CoverageItem { slot: Slot; label: string; status: Status; asked: number; note?: string }

/** Statuses as the helper should see them: "missing" after we asked means they dodged. */
export const effective = (s: PlanState, k: Slot): Status =>
  s.status[k] === 'missing' && s.asks[k] > 0 ? 'vague' : s.status[k]

export function coverageSummary(s: PlanState, answered: number): CoverageItem[] {
  const items: CoverageItem[] = []
  const required = new Set(requiredSlots(s, answered))
  for (const k of SLOT_KEYS) {                     // display in natural order, not priority order
    const echoed = k === 'target' && s.echoTarget
    const st = effective(s, k)
    if (!required.has(k) && st === 'missing' && !echoed) continue
    // Purpose is part of the opening question, so "missing" after an answer means it was not given.
    const shown: Status = k === 'purpose' && st === 'missing' && answered > 0 ? 'vague' : st
    const item: CoverageItem = { slot: k, label: SLOT_LABEL[k], status: shown, asked: s.asks[k] }
    if (echoed) { item.status = 'vague'; item.note = 'Only repeated the name the doorbell said' }
    items.push(item)
  }
  return items
}

/** Facts the risk assessor may use. Derived by code from what the interview observed. */
export interface CoverageFacts { purposeVague: boolean; unverifiable: boolean }

export function coverageFacts(s: PlanState, answered: number): CoverageFacts {
  if (answered === 0) return { purposeVague: false, unverifiable: false }
  const bad = (k: Slot) => { const e = effective(s, k); return e === 'vague' || e === 'refused' }
  const purposeMissing = s.status.purpose === 'missing'
  const relationBad = (s.personalTie || s.echoTarget) && bad('relation')
  const purposeVague = bad('purpose') || purposeMissing || relationBad
  const unverifiable = s.claimsOrg && (bad('proof') || bad('organisation'))
  return { purposeVague, unverifiable }
}

/** Plain lines for the risk judge's prompt (trusted, computed by code, never visitor text). */
export function coverageLines(items: CoverageItem[]): string[] {
  const word: Record<Status, string> = { specific: 'given', vague: 'vague or not given', refused: 'declined', missing: 'not asked' }
  return items.map(i => `${i.label}: ${word[i.status]}${i.asked ? ` (asked ${i.asked}x)`: ''}${i.note ?`. ${i.note}` : ''}`)
}
