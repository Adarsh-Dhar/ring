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

/** Interview state stamps for conditional codes. */
export interface InterviewState {
  /** Timestamp when rules were explained. */
  rulesExplainedAt?: string
  /** Timestamp when a boundary was stated. */
  boundaryStatedAt?: string
  /** Timestamp when visitor was asked to leave. */
  askedToLeaveAt?: string
  /** Timestamp when AI started responding (for extra_knock 30s window). */
  respondingAt?: string
}

export type EvidenceState = 'confirmed' | 'uncertain' | 'unavailable'

/**
 * Determine if a transcription passes quality check.
 * Combines engine confidence (if available) with heuristics.
 * Heuristics are checked first and can fail regardless of engine confidence.
 */
export function passesTranscriptionQuality(
  transcript: string,
  engineConfidence?: number | null
): boolean {
  // Heuristic 1: Empty or very short text
  if (!transcript || transcript.trim().length < 3) {
    return false
  }

  // Heuristic 2: Very short but might be valid if it's concrete
  const words = transcript.trim().split(/\s+/)
  if (words.length < 2) {
    return false
  }

  // Heuristic 3: Model says it could not understand (check for common phrases)
  const lowered = transcript.toLowerCase()
  const notUnderstood = [
    "not understand",
    "not clear",
    "unclear",
    "please repeat",
  ]
  if (notUnderstood.some(phrase => lowered.includes(phrase))) {
    return false
  }

  // Engine confidence check (if available and heuristics passed)
  if (engineConfidence !== null && engineConfidence !== undefined) {
    return engineConfidence >= TRANSCRIPT_QUALITY_THRESHOLD
  }

  // Default to passing if heuristics don't fail and no engine confidence
  return true
}

/** Minimum quality threshold for transcription to be considered reliable. */
export const TRANSCRIPT_QUALITY_THRESHOLD = 0.5

/** P11: Emergency timer value (seconds) - Section 5.3 */
export const EMERGENCY_TIMER_SECONDS = 60

export const BEHAVIOURS = [
  'extra_knock',
  'pressure_after_rule',
  'pressure_after_boundary',
  'purpose_contradiction',
  'hide_from_helper',
  'credential_request',
  'refuse_to_leave',
  'lock_manipulation',
  'door_wedge_or_follow_in',
  'immediate_threat',
  'forced_entry_or_assault',
] as const
export type Behaviour = (typeof BEHAVIOURS)[number]

export interface BehaviourRule {
  label: string
  /** Points for each confirmed observation. Use tiers for variable scoring. */
  points: number
  /** Tiered scoring: points[i] applies to the i-th occurrence. */
  tiers?: number[]
  /** Most this behaviour can ever add in total. n/a for score-override codes. */
  cap: number | null
  /** Minimum control mode once this behaviour is confirmed, whatever the total. */
  floor: ControlMode | null
  /** Which kinds of source may confirm it. */
  sources: readonly Source[]
  /** If true, this code sets the score to a minimum instead of adding points. */
  minScore?: number
}

const ALL: readonly Source[] = ['transcript', 'sensor', 'resident', 'helper']
const HUMAN_OR_SENSOR: readonly Source[] = ['sensor', 'resident', 'helper']
const SPEECH_OR_HELPER: readonly Source[] = ['transcript', 'resident', 'helper']

/** Helper-facing labels avoid words on the shared banned-phrase list. */
export const RISK_RULES: Record<Behaviour, BehaviourRule> = {
  extra_knock: {
    label: 'Repeated knocking after the AI responded',
    points: 1,
    cap: 5,
    floor: null,
    sources: ['sensor', 'helper'],
  },
  pressure_after_rule: {
    label: 'Pressure after resident rules were explained',
    points: 5,
    cap: 5,
    floor: null,
    sources: SPEECH_OR_HELPER,
  },
  pressure_after_boundary: {
    label: 'Pressure after a clear boundary was stated',
    points: 1,
    cap: 10,
    floor: null,
    sources: SPEECH_OR_HELPER,
  },
  purpose_contradiction: {
    label: 'Contradicted their stated purpose',
    points: 15,
    tiers: [15, 10],
    cap: 25,
    floor: null,
    sources: SPEECH_OR_HELPER,
  },
  hide_from_helper: {
    label: 'Tried to hide from the helper',
    points: 15,
    cap: 15,
    floor: null,
    sources: SPEECH_OR_HELPER,
  },
  credential_request: {
    label: 'Asked for PIN, OTP, password or access code',
    points: 20,
    cap: 20,
    floor: null,
    sources: SPEECH_OR_HELPER,
  },
  refuse_to_leave: {
    label: 'Refused to leave when asked',
    points: 25,
    cap: 25,
    floor: 'helper_leads', // P11: Section 6.3 placeholder
    sources: SPEECH_OR_HELPER,
  },
  lock_manipulation: {
    label: 'Handled the lock or door',
    points: 30,
    cap: 30,
    floor: 'helper_leads', // P11: Section 6.3 placeholder
    sources: HUMAN_OR_SENSOR,
  },
  door_wedge_or_follow_in: {
    label: 'Wedged the door or tried to follow in',
    points: 40,
    cap: 40,
    floor: 'helper_leads', // P11: Section 6.3 placeholder
    sources: HUMAN_OR_SENSOR,
  },
  immediate_threat: {
    label: 'Made an immediate threat',
    points: 0,
    cap: null,
    floor: 'emergency', // P11: Section 6.3 placeholder
    sources: SPEECH_OR_HELPER,
    minScore: 80,
  },
  forced_entry_or_assault: {
    label: 'Forced entry or assault',
    points: 0,
    cap: null,
    floor: 'emergency',
    sources: HUMAN_OR_SENSOR,
    minScore: 100,
  },
}

/** Combinations that together set a minimum mode (none in the new spec, kept for future extensibility). */
export const COMBO_FLOORS: { all: Behaviour[]; floor: ControlMode; why: string }[] = []

export interface Observation {
  code: Behaviour
  /** ISO timestamp when the observation was made. */
  at: string
  /** Quotes supporting the observation (array for contradictions). */
  quotes: string[]
  /** Source of the observation. */
  source: Source
  /** State of the evidence. */
  state: EvidenceState
  /** Points awarded (0 for uncertain/unavailable). */
  points: number
  /** Optional debug object for model confidence (never used in scoring). */
  debug?: Record<string, unknown>
  /** Transcription quality (0-1) for transcript sources. */
  transcriptQuality?: number
  /** If true, this is an interview state stamp, not a real observation. */
  isStamp?: boolean
}

export interface LedgerEntry {
  code: Behaviour
  /** ISO timestamp when the observation was made. */
  at: string
  /** Supporting quote. */
  quote: string
  /** Source of the observation. */
  source: Source
  /** State of the evidence. */
  state: EvidenceState
  /** Points awarded. */
  points: number
  /** Optional debug object (never used in scoring). */
  debug?: Record<string, unknown>
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

export function scoreObservations(observations: Observation[], ctx: { transcript: string; interviewState?: InterviewState }): RiskScore {
  const used = new Map<Behaviour, number>()
  const confirmed = new Set<Behaviour>()
  const ledger: LedgerEntry[] = []
  let total = 0
  let minScore = 0
  const interviewState = ctx.interviewState ?? {}

  for (const o of observations) {
    // Skip interview state stamps (they don't contribute to scoring directly)
    if (o.isStamp) {
      ledger.push({
        code: o.code,
        at: o.at,
        quote: o.quotes[0] ?? '',
        source: o.source,
        state: 'confirmed',
        points: 0,
        debug: o.debug,
      })
      continue
    }

    const quote = o.quotes[0] ?? ''
    const entry = (state: EvidenceState, points: number): LedgerEntry => ({
      code: o.code,
      at: o.at,
      quote,
      source: o.source,
      state,
      points,
      debug: o.debug,
    })

    if (!isBehaviour(o.code)) { ledger.push(entry('uncertain', 0)); continue }

    const rule = RISK_RULES[o.code]

    // Unavailable state: zero points
    if (o.state === 'unavailable') {
      ledger.push(entry('unavailable', 0))
      continue
    }

    // Uncertain state: zero points, but may still set floor for physical/threat events
    if (o.state === 'uncertain') {
      ledger.push(entry('uncertain', 0))
      // Physical or threat events still set the floor even if uncertain
      if (rule.floor) {
        confirmed.add(o.code)
      }
      continue
    }

    // P7: Check interview state prerequisites for conditional codes
    if (o.code === 'pressure_after_rule' && !interviewState.rulesExplainedAt) {
      ledger.push(entry('uncertain', 0))
      continue
    }
    if (o.code === 'pressure_after_boundary' && !interviewState.boundaryStatedAt) {
      ledger.push(entry('uncertain', 0))
      continue
    }
    if (o.code === 'refuse_to_leave' && !interviewState.askedToLeaveAt) {
      ledger.push(entry('uncertain', 0))
      continue
    }
    if (o.code === 'extra_knock' && !interviewState.respondingAt) {
      ledger.push(entry('uncertain', 0))
      continue
    }

    // Confirmed state
    if (!rule.sources.includes(o.source)) {
      ledger.push(entry('uncertain', 0))
      continue
    }
    if (o.source === 'transcript' && !quoteIsGrounded(quote, ctx.transcript)) {
      ledger.push(entry('uncertain', 0))
      continue
    }
    // Check transcription quality for transcript sources
    if (o.source === 'transcript' && !passesTranscriptionQuality(quote, o.transcriptQuality)) {
      ledger.push(entry('uncertain', 0))
      continue
    }

    confirmed.add(o.code)

    // Handle score-override codes (immediate_threat, forced_entry_or_assault)
    if (rule.minScore !== undefined) {
      minScore = Math.max(minScore, rule.minScore)
      ledger.push(entry('confirmed', 0))
      continue
    }

    // Handle tiered scoring (purpose_contradiction)
    const count = (used.get(o.code) ?? 0)
    const points = rule.tiers ? (rule.tiers[count] ?? rule.tiers[rule.tiers.length - 1]) : rule.points

    // Handle cap
    if (rule.cap !== null) {
      const room = Math.max(0, rule.cap - count)
      const add = Math.min(points, room)
      used.set(o.code, count + add)
      total += add
      ledger.push(entry('confirmed', add))
    } else {
      used.set(o.code, count + points)
      total += points
      ledger.push(entry('confirmed', points))
    }
  }

  let minMode: ControlMode = 'ai_leads'
  for (const b of confirmed) { const f = RISK_RULES[b].floor; if (f) minMode = maxMode(minMode, f) }
  for (const c of COMBO_FLOORS) if (c.all.every(b => confirmed.has(b))) minMode = maxMode(minMode, c.floor)

  // Apply minScore from override codes
  const finalScore = Math.max(minScore, total)
  // Cap at 99 unless forced_entry_or_assault sets it to 100
  const score = minScore === 100 ? 100 : Math.min(99, finalScore)

  return { score, ledger, minMode }
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
  // Renamed and narrowed payment_request to credential_request
  payment_request: 'credential_request',
  // New categories
  pressure_after_rule: 'pressure_after_rule',
  pressure_after_boundary: 'pressure_after_boundary',
  purpose_contradiction: 'purpose_contradiction',
  hide_from_helper: 'hide_from_helper',
  refuse_to_leave: 'refuse_to_leave',
  spoken_threat: 'immediate_threat',
  // Note-only categories map to nothing (removed)
  // official_impersonation, entry_request, home_probing are now note-only
}

/**
 * Categories that are information for the helper but never points: they are about what the visitor did NOT
 * give, or are salesmanship, and "unknown" or "vague" must never be treated as "dangerous".
 */
export const NOTE_ONLY_CATEGORIES = [
  'vague_purpose',
  'unverifiable_claims',
  'evasive_answers',
  'unsolicited_work',
  'known_scam_wording',
  'other',
  'entry_request',
  'home_probing',
  'official_impersonation',
  'manipulation_attempt',
  'urgency_pressure',
  'story_mismatch',
] as const

export function observationsFromEvidence(evidence: { category: string; quote: string }[]): { observations: Observation[]; notes: string[] } {
  const observations: Observation[] = []
  const notes: string[] = []
  for (const e of evidence) {
    const b = CATEGORY_TO_BEHAVIOUR[e.category]
    if (b) {
      observations.push({
        code: b,
        at: new Date().toISOString(),
        quotes: [e.quote],
        source: 'transcript',
        state: 'uncertain', // Uncertain until confirmed by quality check or helper
        points: 0,
        transcriptQuality: undefined, // Will be set by caller if available
      })
    } else if (!notes.includes(e.category)) {
      notes.push(e.category)
    }
  }
  return { observations, notes }
}

/** Helper to create an interview state stamp. */
export function createInterviewStamp(type: keyof InterviewState, timestamp?: string): Observation {
  return {
    code: 'extra_knock' as any, // Stamp code (won't be scored, isStamp=true)
    at: timestamp ?? new Date().toISOString(),
    quotes: [`Interview state: ${type}`],
    source: 'transcript',
    state: 'confirmed',
    points: 0,
    isStamp: true,
  }
}
