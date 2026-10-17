/**
 * Risk rules (spec sections 1, 4 and 6): deterministic points, caps and event floors.
 *
 * Pure, no imports. The language model only EXTRACTS observations (a behaviour plus a quote).
 * This file decides what each one is worth. The model never supplies a score.
 *
 * Principles enforced here:
 *  - Risk comes only from observed behaviour. There is no input for appearance, accent, nervousness,
 *    an unfamiliar face, a blurry camera, or arriving without notice.
 *  - A transcript observation counts only if its quote really appears in the transcript.
 *  - Behaviours that need a physical fact (lock tampering, forced entry) cannot be confirmed by the model.
 *  - Every behaviour has a cap, so repeating one thing cannot run the score up (two contradictions never exceed the cap).
 *  - A serious event sets a MINIMUM control mode, so the same total cannot hide different situations.
 *
 * ALL NUMBERS ARE PILOT STARTING VALUES. They are operational priorities, not probabilities of danger.
 */

export const CONTROL_MODES = ['ai_leads', 'ai_assisted', 'helper_leads', 'helper_only', 'emergency'] as const
export type ControlMode = (typeof CONTROL_MODES)[number]
export const modeRank = (m: ControlMode) => CONTROL_MODES.indexOf(m)
export const maxMode = (...ms: ControlMode[]): ControlMode => ms.reduce((a, b) => (modeRank(b) > modeRank(a) ? b : a), 'ai_leads' as ControlMode)

export type Source = 'transcript' | 'sensor' | 'resident' | 'helper'

export const BEHAVIOURS = [
  'pressure', 'credential_request', 'refusal_to_leave', 'lock_tampering', 'threat', 'forced_entry',
  'contradiction', 'impersonation_claim', 'entry_request', 'home_probing', 'manipulation_attempt',
] as const
export type Behaviour = (typeof BEHAVIOURS)[number]

export interface BehaviourRule {
  label: string
  /** Points for each confirmed observation. */
  points: number
  /** Most this behaviour can ever add in total. */
  cap: number
  /** Minimum control mode once this behaviour is confirmed, whatever the total. */
  floor: ControlMode | null
  /** Which kinds of source may confirm it. */
  sources: readonly Source[]
}

const ALL: readonly Source[] = ['transcript', 'sensor', 'resident', 'helper']
const HUMAN_OR_SENSOR: readonly Source[] = ['sensor', 'resident', 'helper']

/** Helper-facing labels avoid words on the shared banned-phrase list. */
export const RISK_RULES: Record<Behaviour, BehaviourRule> = {
  pressure:             { label: 'Pressure to act quickly',        points: 10, cap: 20, floor: null,           sources: ALL },
  credential_request:   { label: 'Asked for money, card or PIN',   points: 25, cap: 25, floor: 'helper_leads', sources: ['transcript', 'resident', 'helper'] },
  refusal_to_leave:     { label: 'Did not leave when asked',       points: 20, cap: 20, floor: 'helper_leads', sources: ALL },
  lock_tampering:       { label: 'Handled the lock or door',       points: 35, cap: 35, floor: 'helper_only',  sources: HUMAN_OR_SENSOR },
  threat:               { label: 'Made a threat',                  points: 45, cap: 45, floor: 'helper_only',  sources: ['transcript', 'resident', 'helper'] },
  forced_entry:         { label: 'Tried to force entry',           points: 70, cap: 70, floor: 'emergency',    sources: HUMAN_OR_SENSOR },
  contradiction:        { label: 'Answers contradict each other',  points: 8,  cap: 16, floor: null,           sources: ['transcript', 'helper'] },
  impersonation_claim:  { label: 'Claims to be an official',       points: 8,  cap: 8,  floor: null,           sources: ['transcript', 'helper'] },
  entry_request:        { label: 'Wants to come inside',           points: 10, cap: 10, floor: null,           sources: ['transcript', 'resident', 'helper'] },
  home_probing:         { label: 'Asked who else is at home',      points: 12, cap: 12, floor: null,           sources: ['transcript', 'resident', 'helper'] },
  manipulation_attempt: { label: 'Tried to steer the assistant',   points: 10, cap: 10, floor: 'ai_assisted',  sources: ['transcript'] },
}

/** Combinations that together set a minimum mode (they carry over the old "classic distraction pattern" rule). */
export const COMBO_FLOORS: { all: Behaviour[]; floor: ControlMode; why: string }[] = [
  { all: ['entry_request', 'impersonation_claim', 'pressure'], floor: 'helper_leads', why: 'official + pressure + wants to come in' },
  { all: ['home_probing', 'entry_request'],                    floor: 'helper_leads', why: 'asked who is home and wants to come in' },
]

export type EvidenceState = 'confirmed' | 'unconfirmed' | 'retracted'

export interface Observation {
  behaviour: string
  source: Source
  /** Verbatim words from the visitor. Required for source 'transcript'. */
  quote?: string
  /** A helper or the resident withdrew it (case lifecycle, correction). */
  retracted?: boolean
}

export interface LedgerEntry {
  behaviour: string
  source: Source
  quote: string
  state: EvidenceState
  /** Points actually added after the cap. */
  points: number
  note: string
}

export interface RiskScore {
  /** 0 to 100. */
  score: number
  ledger: LedgerEntry[]
  /** Minimum control mode set by confirmed events and combinations. */
  minMode: ControlMode
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9£$€%\s]/g, ' ').replace(/\s+/g, ' ').trim()
const isBehaviour = (b: string): b is Behaviour => (BEHAVIOURS as readonly string[]).includes(b)

/** True if the quote (3+ characters) really appears in the transcript. */
export function quoteIsGrounded(quote: string | undefined, transcript: string): boolean {
  const q = norm(quote ?? '')
  return q.length >= 3 && norm(transcript).includes(q)
}

export function scoreObservations(observations: Observation[], ctx: { transcript: string }): RiskScore {
  const used = new Map<Behaviour, number>()
  const confirmed = new Set<Behaviour>()
  const ledger: LedgerEntry[] = []
  let total = 0

  for (const o of observations) {
    const quote = (o.quote ?? '').trim().split(/\s+/).slice(0, 12).join(' ')
    const entry = (state: EvidenceState, points: number, note: string): LedgerEntry => ({ behaviour: o.behaviour, source: o.source, quote, state, points, note })

    if (!isBehaviour(o.behaviour)) { ledger.push(entry('unconfirmed', 0, 'Not a recognised behaviour.')); continue }
    if (o.retracted) { ledger.push(entry('retracted', 0, 'Withdrawn.')); continue }

    const rule = RISK_RULES[o.behaviour]
    if (!rule.sources.includes(o.source)) { ledger.push(entry('unconfirmed', 0, `A ${o.source} source cannot confirm this.`)); continue }
    if (o.source === 'transcript' && !quoteIsGrounded(o.quote, ctx.transcript)) { ledger.push(entry('unconfirmed', 0, 'Quote not found in the transcript.')); continue }

    confirmed.add(o.behaviour)
    const room = Math.max(0, rule.cap - (used.get(o.behaviour) ?? 0))
    const add = Math.min(rule.points, room)
    used.set(o.behaviour, (used.get(o.behaviour) ?? 0) + add)
    total += add
    ledger.push(entry('confirmed', add, add < rule.points ? 'Counted up to the cap.' : 'Counted.'))
  }

  let minMode: ControlMode = 'ai_leads'
  for (const b of confirmed) { const f = RISK_RULES[b].floor; if (f) minMode = maxMode(minMode, f) }
  for (const c of COMBO_FLOORS) if (c.all.every(b => confirmed.has(b))) minMode = maxMode(minMode, c.floor)

  return { score: Math.min(100, total), ledger, minMode }
}

/** The old four-level scale, so existing screens keep working. Derived from the score and floor, never from the model. */
export type LegacyLevel = 'none' | 'low' | 'medium' | 'high'
export function legacyLevel(score: number, minMode: ControlMode): LegacyLevel {
  const byScore: LegacyLevel = score <= 0 ? 'none' : score < 20 ? 'low' : score < 40 ? 'medium' : 'high'
  const byMode: LegacyLevel = modeRank(minMode) >= modeRank('helper_leads') ? 'high' : minMode === 'ai_assisted' ? 'medium' : 'none'
  const rank = (l: LegacyLevel) => ['none', 'low', 'medium', 'high'].indexOf(l)
  return rank(byMode) > rank(byScore) ? byMode : byScore
}

/** Judge categories that become scored behaviours. Everything else is shown to helpers as a note and never scores. */
export const CATEGORY_TO_BEHAVIOUR: Record<string, Behaviour> = {
  urgency_pressure: 'pressure',
  payment_request: 'credential_request',
  official_impersonation: 'impersonation_claim',
  entry_request: 'entry_request',
  home_probing: 'home_probing',
  story_mismatch: 'contradiction',
  manipulation_attempt: 'manipulation_attempt',
}

/**
 * Categories that are information for the helper but never points: they are about what the visitor did NOT
 * give, or are salesmanship, and "unknown" or "vague" must never be treated as "dangerous".
 */
export const NOTE_ONLY_CATEGORIES = ['vague_purpose', 'unverifiable_claims', 'evasive_answers', 'unsolicited_work', 'known_scam_wording', 'other'] as const

export function observationsFromEvidence(evidence: { category: string; quote: string }[]): { observations: Observation[]; notes: string[] } {
  const observations: Observation[] = []
  const notes: string[] = []
  for (const e of evidence) {
    const b = CATEGORY_TO_BEHAVIOUR[e.category]
    if (b) observations.push({ behaviour: b, source: 'transcript', quote: e.quote })
    else if (!notes.includes(e.category)) notes.push(e.category)
  }
  return { observations, notes }
}
