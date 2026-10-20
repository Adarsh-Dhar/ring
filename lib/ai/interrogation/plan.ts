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
 * WP4: Removed all turn limits - no arbitrary total-question cap, no minimum turns.
 * The interview runs until the plan state indicates completion or state-based exit conditions are met.
 * The interview ends when:
 * 1. All required slots are specific (verified)
 * 2. Visitor goes silent (stall detection in processAnswer)
 * 3. Model is down (error handling in processAnswer)
 * 4. State-based stall detection (isStalled)
 * 5. Explicit safety condition triggered
 * 6. Helper takeover
 * 7. Authority limit reached
 */

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
 * What to ask next, or null when nothing is open.
 * Core slots (reason, organisation, proof) are pressed until specific. Otherwise fewest-asks-first.
 * Pure and deterministic: the model cannot end the interview early.
 * WP4: Removed max parameter - no arbitrary total-question cap.
 */
export function nextFocus(s: PlanState, answered: number): Slot | null {
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
 * WP5: Removed pressure-based language; questions are neutral and purpose-specific.
 */
export const QUESTION_BANK: Record<Slot, readonly string[]> = {
  purpose: [
    'What is the reason for your visit?',
    'Could you tell me what you are here for?',
    'What would you like to discuss?',
    'How can I help you today?',
    'What brings you to this address?',
  ],
  organisation: [
    'Which company or organisation are you from?',
    'What is the name of your organisation?',
    'Who sent you here today?',
    'Which organisation do you represent?',
    'Who is your employer?',
  ],
  detail: [
    'What work would you like to do?',
    'What is the specific purpose of your visit?',
    'What service are you offering?',
    'What would you like to do today?',
    'What is the nature of your visit?',
  ],
  name: [
    'What is your name, please?',
    'Could you tell me your name?',
    'May I have your name?',
    'Who should I say is here?',
    'What is your name?',
  ],
  relation: [
    'How do you know the resident?',
    'What is your connection to them?',
    'How are you related to them?',
    'Who are you visiting today?',
    'Which resident are you here to see?',
  ],
  target: [
    'Who are you here to see?',
    'Which resident are you visiting?',
    'Who should I ask for?',
    'Who lives at this address?',
    'Whose doorbell is this?',
  ],
  proof: [
    'Do you have any identification?',
    'Can you show me your ID?',
    'Do you have a work order or reference?',
    'Is there any paperwork I can see?',
    'Can you provide a reference number?',
  ],
  companions: [
    'Is anyone with you?',
    'Are you alone today?',
    'Did anyone come with you?',
    'Is there anyone else outside?',
    'Are you working with anyone?',
  ],
  spatial: [
    'How did you get here today?',
    'Where did you park?',
    'Did you drive or walk here?',
    'Which street did you come from?',
    'Where is your vehicle?',
  ],
  recheck: [
    'Could you confirm your name and purpose?',
    'What was your name again?',
    'What did you say you are here for?',
    'Could you repeat the reason for your visit?',
    'What organisation are you with again?',
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
