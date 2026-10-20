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

export const SLOT_KEYS = ['purpose', 'organisation', 'detail', 'name', 'relation', 'target', 'proof', 'companions', 'spatial', 'recheck'] as const
export type Slot = (typeof SLOT_KEYS)[number]

export const STATUSES = ['missing', 'vague', 'specific', 'refused'] as const
export type Status = (typeof STATUSES)[number]
export type Obs = Partial<Record<Slot, Status>>

/**
 * Priority order. Ties on "times asked" are broken by this order. Checks that are hardest to fake (something
 * checkable, a practical question they could not rehearse) come before cheap ones (name, who else is with them),
 * because a stubborn visitor can use up every follow-up.
 */
export const ORDER: readonly Slot[] = ['purpose', 'organisation', 'detail', 'proof', 'relation', 'spatial', 'name', 'target', 'recheck', 'companions']

/**
 * Slots that must be pressed until they are specific. While one of these is open and has been asked at least once,
 * we keep pressing it instead of rotating to easy questions: every other answer is moot until the core story is checkable.
 */
export const PRESS_FIRST: readonly Slot[] = ['purpose', 'organisation', 'proof']

/**
 * NO per-slot cap and NO default turn cap: the interview runs until the plan state indicates completion.
 * AI_INTERROGATOR_MAX_TURNS is an optional operator ceiling (a positive number). Unset or 0 = unlimited.
 * The interview ends when:
 * 1. All required slots are specific (verified)
 * 2. Visitor goes silent (stall detection in processAnswer)
 * 3. Model is down (error handling in processAnswer)
 * 4. Operator ceiling is hit (AI_INTERROGATOR_MAX_TURNS)
 * 5. Explicit safety condition triggered (threat detection)
 */
export const clampTurns = (n: number) => (Number.isFinite(n) && n > 0 ? Math.max(3, Math.round(n)) : Infinity)
export const MAX_TURNS = clampTurns(Number(process.env.AI_INTERROGATOR_MAX_TURNS || 0))

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
  // Everyone unplanned must give a reason, a name, something checkable, and concrete detail about the errand.
  const need = new Set<Slot>(['purpose', 'name', 'detail', 'proof', 'companions', 'spatial'])
  if (!s.echoTarget) need.add('target')            // if they only echoed the cued name, "relation" replaces it
  if (s.claimsOrg) need.add('organisation')
  if (s.personalTie || s.echoTarget) need.add('relation')
  if (answered >= 3) need.add('recheck')           // re-ask an earlier fact in different words and compare
  return ORDER.filter(k => need.has(k))
}

/**
 * State-based stall detection: interview is stalled if the same slot has been asked 3+ times
 * and the visitor keeps giving vague or refused answers.
 */
export function isStalled(s: PlanState, answered: number): boolean {
  if (answered < 5) return false  // Not enough data to detect stall
  for (const slot of PRESS_FIRST) {
    if (s.asks[slot] >= 3 && (s.status[slot] === 'vague' || s.status[slot] === 'refused')) {
      return true
    }
  }
  return false
}

/** Every required slot is specific, nothing was refused. Code-side half of "satisfied". */
export function isSatisfied(s: PlanState, answered: number): boolean {
  return requiredSlots(s, answered).every(k => s.status[k] === 'specific')
}

/**
 * What to ask next, or null when nothing is open (or an operator ceiling is hit).
 * Core slots (reason, organisation, proof) are pressed until specific. Otherwise fewest-asks-first.
 * Pure and deterministic: the model cannot end the interview early.
 */
export function nextFocus(s: PlanState, answered: number, max = MAX_TURNS): Slot | null {
  if (answered >= max) return null
  const open = requiredSlots(s, answered).filter(k => s.status[k] !== 'specific')
  if (!open.length) return null
  const press = PRESS_FIRST.find(k => open.includes(k) && s.asks[k] > 0)
  if (press) return press
  return open.sort((a, b) => s.asks[a] - s.asks[b] || ORDER.indexOf(a) - ORDER.indexOf(b))[0]
}

/**
 * Scripted questions, five phrasings per slot, getting firmer. Used when the model is unavailable or its question
 * fails validation. Every line is <= 20 words and passes validQuestion(): no accusations, no resident details,
 * never says what is "expected", never asks whether anyone is home. Past the last phrasing they cycle.
 */
export const QUESTION_BANK: Record<Slot, readonly string[]> = {
  purpose: [
    'What exactly is the reason for your visit?',
    'I need specifics. What exactly are you here to do or offer?',
    'Which product or service, exactly, and what does it cost?',
    'Who told you to come to this address, and why this one?',
    'I still have no clear reason. State it in one full sentence.',
  ],
  organisation: [
    'Which company or organisation are you from?',
    'Give me the full registered name of that company.',
    'What is the office phone number of your company?',
    'What is your supervisor\'s full name?',
    'Which street is your company based on?',
  ],
  detail: [
    'Describe exactly what you want to do or offer, step by step.',
    'What is the product called, and who makes it?',
    'How did you choose this address today?',
    'How many houses have you visited today, and on which streets?',
    'Walk me through exactly what would happen if I agreed.',
  ],
  name: [
    'What is your name, please?',
    'Could you give me your first and last name?',
    'Spell your surname for me, letter by letter.',
    'Is that the name on your ID? Say it again, slowly.',
    'I need your full legal name before anything else.',
  ],
  relation: [
    'How do you know them?',
    'How long have you known them, and how did you meet?',
    'When did you last see them, and where?',
    'Who else do you both know?',
    'What was the last thing you spoke about together?',
  ],
  target: [
    'Who exactly are you here to see?',
    'Could you give me the full name of the person you want?',
    'What is their full name, and how do you know it?',
    'Who gave you that name?',
    'State the full name of the person, not just a first name.',
  ],
  proof: [
    'Please hold your ID card or work order up to the camera.',
    'Do you have a reference number, or the name of whoever sent you?',
    'Read me the number on your card, slowly.',
    'What phone number can the household use to check you with your office?',
    'Without checkable ID I will record that you declined. Will you show it?',
  ],
  companions: [
    'Is anyone with you today?',
    'Is there anybody else with you, perhaps in a vehicle nearby?',
    'Does anyone work with you, and where are they right now?',
    'Who dropped you off, or did you come on your own?',
    'How many colleagues are working this street today?',
  ],
  spatial: [
    'Where did you park, or how did you get here today?',
    'What time did you set off today, and from where?',
    'Which street did you walk or drive down just before this door?',
    'What colour is your vehicle, and where is it now?',
    'Describe the last house you visited before this one.',
  ],
  recheck: [
    'Remind me: what is your name and reason for coming, in your own words?',
    'Earlier you gave me details. Repeat them exactly as you said them.',
    'Let me confirm: say again who sent you, and what for.',
    'Say your name and company once more, so I record it correctly.',
    'Please repeat your reason in full, from the beginning.',
  ],
}
export const bankQuestion = (slot: Slot, asked: number): string => {
  const q = QUESTION_BANK[slot]
  return q[Math.max(asked, 0) % q.length]
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
  recheck: 'Repeated their earlier answers consistently',
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
  const purposeVague = bad('purpose') || bad('detail') || purposeMissing || relationBad
  const unverifiable = s.claimsOrg && (bad('proof') || bad('organisation'))
  return { purposeVague, unverifiable }
}

/** Plain lines for the risk judge's prompt (trusted, computed by code, never visitor text). */
export function coverageLines(items: CoverageItem[]): string[] {
  const word: Record<Status, string> = { specific: 'given', vague: 'vague or not given', refused: 'declined', missing: 'not asked' }
  return items.map(i => `${i.label}: ${word[i.status]}${i.asked ? ` (asked ${i.asked}x)`: ''}${i.note ?`. ${i.note}` : ''}`)
}
