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
  /** Minimum mode while the event is only UNCERTAIN (spec 4.3: uncertain physical or threat events raise it to helper-led). */
  uncertainFloor?: ControlMode
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
    uncertainFloor: 'helper_leads',
  },
  door_wedge_or_follow_in: {
    label: 'Wedged the door or tried to follow in',
    points: 40,
    cap: 40,
    floor: 'helper_leads', // P11: Section 6.3 placeholder
    sources: HUMAN_OR_SENSOR,
    uncertainFloor: 'helper_leads',
  },
  immediate_threat: {
    label: 'Made an immediate threat',
    points: 0,
    cap: null,
    floor: 'emergency', // P11: Section 6.3 placeholder
    sources: SPEECH_OR_HELPER,
    uncertainFloor: 'helper_leads',
    minScore: 80,
  },
  forced_entry_or_assault: {
    label: 'Forced entry or assault',
    points: 0,
    cap: null,
    floor: 'emergency',
    sources: HUMAN_OR_SENSOR,
    uncertainFloor: 'helper_leads',
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
  /** The transcript segment the quote came from. The quality check runs on this, never on the bare quote. */
  segment?: string
  /** A helper rejected this event. It never scores again, and a re-score never brings it back. */
  retracted?: boolean
}

/** P11: Interview state stamp - a separate type from Observation, no longer a workaround. */
export interface InterviewStamp {
  /** The interview state milestone this represents. */
  type: keyof InterviewState
  /** ISO timestamp when this milestone was reached. */
  at: string
  /** Marked as a stamp for type safety. */
  isStamp: true
}

export interface LedgerEntry {
  /** Position of this observation in the stored observation list. Confirm and reject use it. */
  idx: number
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

/**
 * Spec 4.3: a speech event is only confirmed when the words match the phrase category.
 * Deliberately narrow. A quote that fails this check is shown as uncertain and a helper can confirm it.
 * purpose_contradiction has no pattern: it needs two stored quotes instead.
 */
export const PHRASE_PATTERNS: Partial<Record<Behaviour, RegExp>> = {
  credential_request: /\b(pin|otp|passcode|password|access code|door code|entry code|security code|verification code|one[- ]time (code|password))\b/i,
  refuse_to_leave: /\b(not|won'?t|never|refuse[sd]?)\b[^.!?]{0,20}\b(leave|leaving|go|going|move|moving)\b|\brefuse[sd]?\b/i,
  immediate_threat: /\b(hurt|kill|stab|shoot|beat|smash|burn|harm|break (in|down|the|your)|(you'?ll|you will) (regret|pay))\b/i,
  hide_from_helper: /\b(don'?t|do not|no need to|without|never)\b[^.!?]{0,30}\b(tell|call|ask|involve|phone|helper|carer|family|son|daughter)\b|\b(secret|between us|just us)\b/i,
  // F6: Tightened pattern - requires access-demand wording, not just urgency words
  pressure_after_rule: /\b(let me (in|inside|through)|open up|open the door)\b/i,
  // F6: Tightened pattern - requires access-demand wording, not just urgency words
  pressure_after_boundary: /\b(let me (in|inside|through)|open up|open the door|i'?m not (going )?to wait|i won'?t wait)\b/i,
}

export function phraseMatches(code: Behaviour, quote: string): boolean {
  const re = PHRASE_PATTERNS[code]
  return re ? re.test(quote) : true
}

/** Identity of an event. Speech events with the same words are one event. Sensor and report events are told apart by time. */
export function observationKey(o: Pick<Observation, 'code' | 'quotes' | 'source' | 'at' | 'debug'>): string {
  return o.source === 'transcript' ? `${o.code}|${o.quotes.map(norm).join('|')}` : `${o.code}|${o.source}|${o.debug?.eventId ?? o.at}`
}

export function scoreObservations(observations: Observation[], ctx: { transcript: string; interviewState?: InterviewState }): RiskScore {
  const usedPoints = new Map<Behaviour, number>()
  const occurrences = new Map<Behaviour, number>()
  const seen = new Set<string>()
  const confirmed = new Set<Behaviour>()
  const uncertainCodes = new Set<Behaviour>()
  const ledger: LedgerEntry[] = []
  let total = 0
  let minScore = 0
  const interviewState = ctx.interviewState ?? {}

  observations.forEach((o, idx) => {
    const quote = o.quotes.join(' | ')
    const entry = (state: EvidenceState, points: number, debug?: Record<string, unknown>): LedgerEntry => ({
      idx, code: o.code, at: o.at, quote, source: o.source, state, points, debug: { ...o.debug, ...debug },
    })
    const reject = (state: EvidenceState, why: string) => { ledger.push(entry(state, 0, { why })) }

    if (!isBehaviour(o.code)) return reject('uncertain', 'unknown_code')
    const rule = RISK_RULES[o.code]

    if (o.retracted) return reject('uncertain', 'retracted_by_helper')
    if (o.state === 'unavailable') return reject('unavailable', 'evidence_unavailable')

    if (o.state === 'uncertain') {
      if (rule.uncertainFloor) uncertainCodes.add(o.code)
      return reject('uncertain', 'marked_uncertain')
    }

    // A helper's confirmation replaces the automatic checks. Everything else must pass them.
    const byHelper = o.source === 'helper'

    if (!byHelper) {
      if (o.code === 'pressure_after_rule' && !interviewState.rulesExplainedAt) return reject('uncertain', 'rules_not_explained_yet')
      if (o.code === 'pressure_after_boundary' && !interviewState.boundaryStatedAt) return reject('uncertain', 'boundary_not_stated_yet')
      if (o.code === 'refuse_to_leave' && !interviewState.askedToLeaveAt) return reject('uncertain', 'not_asked_to_leave_yet')
      if (o.code === 'extra_knock' && !interviewState.respondingAt) return reject('uncertain', 'ai_not_responding_yet')
    }
    if (!rule.sources.includes(o.source)) return reject('uncertain', 'source_not_allowed')

    if (o.source === 'transcript') {
      const needQuotes = o.code === 'purpose_contradiction' ? 2 : 1
      if (o.quotes.length < needQuotes) return reject('uncertain', 'needs_two_quotes')
      if (!o.quotes.every(q => quoteIsGrounded(q, ctx.transcript))) return reject('uncertain', 'quote_not_in_transcript')
      // Quality is judged on the segment the words came from. A one-word quote ("pin") must still be able to confirm.
      if (!passesTranscriptionQuality(o.segment ?? ctx.transcript, o.transcriptQuality)) return reject('uncertain', 'transcription_quality')
      if (!o.quotes.every(q => phraseMatches(o.code, q))) return reject('uncertain', 'wording_does_not_match')
    }

    // Count each distinct event once.
    const key = observationKey(o)
    if (seen.has(key)) return reject('confirmed', 'duplicate_event')
    seen.add(key)

    confirmed.add(o.code)

    if (rule.minScore !== undefined) {
      minScore = Math.max(minScore, rule.minScore)
      ledger.push(entry('confirmed', 0))
      return
    }

    const occ = occurrences.get(o.code) ?? 0
    occurrences.set(o.code, occ + 1)
    const wanted = rule.tiers ? (rule.tiers[occ] ?? rule.tiers[rule.tiers.length - 1]) : rule.points
    const spent = usedPoints.get(o.code) ?? 0
    const add = rule.cap === null ? wanted : Math.max(0, Math.min(wanted, rule.cap - spent))
    usedPoints.set(o.code, spent + add)
    total += add
    ledger.push(entry('confirmed', add))
  })

  let minMode: ControlMode = 'ai_leads'
  for (const b of confirmed) { const f = RISK_RULES[b].floor; if (f) minMode = maxMode(minMode, f) }
  // An event that is not yet confirmed still raises the mode when it is physical or a threat. It never lowers one.
  for (const b of uncertainCodes) { const f = RISK_RULES[b].uncertainFloor; if (f) minMode = maxMode(minMode, f) }
  for (const c of COMBO_FLOORS) if (c.all.every(b => confirmed.has(b))) minMode = maxMode(minMode, c.floor)

  // 100 is reserved for a confirmed forced entry or assault. Ordinary points stop at 99.
  const score = minScore >= 100 ? 100 : Math.min(99, Math.max(minScore, total))
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

export function observationsFromEvidence(
  evidence: { category: string; quote: string }[],
  opts?: { segment?: string; transcriptQuality?: number },
): { observations: Observation[]; notes: string[] } {
  const observations: Observation[] = []
  const notes: string[] = []
  const contradictionQuotes: string[] = []
  const base = (code: Behaviour, quotes: string[]): Observation => ({
    code, at: new Date().toISOString(), quotes, source: 'transcript',
    // The model only EXTRACTS. State here is the claim; scoreObservations applies the real checks (quote in transcript,
    // quality, wording, interview state) and records 'uncertain' in the ledger when one fails.
    state: 'confirmed', points: 0, segment: opts?.segment, transcriptQuality: opts?.transcriptQuality,
  })
  for (const e of evidence) {
    const b = CATEGORY_TO_BEHAVIOUR[e.category]
    if (!b) { if (!notes.includes(e.category)) notes.push(e.category); continue }
    if (b === 'purpose_contradiction') { contradictionQuotes.push(e.quote); continue }
    observations.push(base(b, [e.quote]))
  }
  // Spec 4.3: a contradiction needs BOTH quotes. Quotes are paired in the order the model found them.
  for (let i = 0; i < contradictionQuotes.length; i += 2) {
    observations.push(base('purpose_contradiction', contradictionQuotes.slice(i, i + 2)))
  }
  return { observations, notes }
}

/** Helper to create an interview state stamp. */
export function createInterviewStamp(type: keyof InterviewState, timestamp?: string): InterviewStamp {
  return {
    type,
    at: timestamp ?? new Date().toISOString(),
    isStamp: true,
  }
}
