/**
 * Output schemas for the interviewer agent. The model's JSON is untrusted: enums are accepted as plain strings
 * here and cleaned in code (clean* below), so one unknown value drops that item instead of failing the whole turn.
 * A failed parse used to end the interview, so the schema is deliberately tolerant and the code strict.
 */
import { z } from 'zod'
import { RISK_CATEGORIES, LEVELS } from '@/lib/ai/risk/combine'
import { SLOT_KEYS, type Slot } from './plan'

export const TACTICS = [
  'probe_specifics',          // narrow an open account to who / what / where / when without revealing what we know
  'commit_closed',            // lock the visitor to an explicit yes/no on one of their own claims
  'unanticipated_logistics',  // how / when / where they got here. Hard to rehearse, so it loads working memory
  'reverse_order',            // recount the last hour backwards. Honest memory copes, scripts do not
  'verification_request',     // ask for something independently checkable (reference, supervisor, call-back, ID to camera)
  'consistency_clarify',      // neutral: quote two of their own statements and ask which is right
  'evidence_frame',           // state one visitor-side fact (what the doorbell camera sees) and invite an explanation
  'autonomy_support',         // they declined or deflected: restate it is their choice, leave the door open, do not press
  'confirm_summary',          // restate their account and ask them to confirm or correct it
  'clarify_audio',            // could not understand them: ask them to repeat
  'close',                    // we have what the carers need
] as const
export type Tactic = (typeof TACTICS)[number]

export const STRATEGIES = ['forthcoming', 'avoidance', 'denial', 'counter_tactic', 'unclear'] as const
export type Strategy = (typeof STRATEGIES)[number]

export const COUNTER_TACTICS = ['no_comment', 'deflect', 'hostile', 'question_back', 'pressure'] as const
export type CounterTactic = (typeof COUNTER_TACTICS)[number]

export const isTactic = (s: unknown): s is Tactic => typeof s === 'string' && (TACTICS as readonly string[]).includes(s)
const isStrategy = (s: unknown): s is Strategy => typeof s === 'string' && (STRATEGIES as readonly string[]).includes(s)
const isCounter = (s: unknown): s is CounterTactic => typeof s === 'string' && (COUNTER_TACTICS as readonly string[]).includes(s)
const isTopic = (s: unknown): s is Slot => typeof s === 'string' && (SLOT_KEYS as readonly string[]).includes(s) && s !== 'recheck'

export const TurnAnalysisOut = z.object({
  /** Verbatim as far as the audio allows. "" if nothing intelligible. */
  transcript: z.string().max(700).default(''),
  understood: z.boolean().default(true),
  transcriptQuality: z.number().min(0).max(1).nullable().default(null),
  /** What the visitor says about themselves. Kept for the helper card. */
  claims: z.object({
    name: z.string().max(80).nullable().default(null),
    organisation: z.string().max(80).nullable().default(null),
    reason: z.string().max(120).nullable().default(null),
    forWhom: z.string().max(80).nullable().default(null),
    time: z.string().max(40).nullable().default(null),
  }).default({ name: null, organisation: null, reason: null, forWhom: null, time: null }),
  /** Every checkable assertion in this answer. The case file is built from these. */
  commitments: z.array(z.object({
    topic: z.string(), value: z.string().max(160).default(''), specificity: z.string(),
    checkable: z.boolean().default(false), quote: z.string().max(200).default(''),
    count: z.number().int().min(0).max(20).nullable().default(null),
  })).max(10).default([]),
  /** Within-statement contradictions against EARLIER answers, each backed by two verbatim quotes. */
  inconsistencies: z.array(z.object({
    topic: z.string().default('purpose'), earlierQuote: z.string().max(200), nowQuote: z.string().max(200),
    summary: z.string().max(140), peripheral: z.boolean().default(false),
  })).max(5).default([]),
  /** Risk behaviours seen in the words (any phrasing, any language), each with a verbatim quote that code verifies. */
  behaviours: z.array(z.object({ category: z.string(), quote: z.string().max(200) })).max(6).default([]),
  strategy: z.string().default('unclear'),
  counterTactic: z.string().nullable().default(null),
  /** Wellbeing of the VISITOR (Mendez principle 3). Distress, confusion, a child, a medical problem. */
  wellbeing: z.object({
    vulnerable: z.boolean().default(false), needsHelp: z.boolean().default(false), note: z.string().max(120).nullable().default(null),
  }).default({ vulnerable: false, needsHelp: false, note: null }),
  claimsOrganisation: z.boolean().default(false),
  claimsPersonalTie: z.boolean().default(false),
  claimsAppointment: z.boolean().default(false),
  evasive: z.boolean().default(false),
  satisfied: z.boolean().default(false),
  riskHint: z.string().default('none'),
  verdict: z.string().default('unclear'),
  realReasonSummary: z.string().max(250).nullable().default(null),
  /** The agent's PROPOSED next move. Code validates it against the playbook and may override it. */
  move: z.object({ tactic: z.string(), objective: z.string().nullable().default(null), rationale: z.string().max(200).default('') }).nullable().default(null),
  /** The words for that move. Optional: if it is missing or the move is overridden, the speaker writes it. */
  utterance: z.string().max(260).nullable().default(null),
})
export type TurnAnalysisRaw = z.infer<typeof TurnAnalysisOut>

export const SpeakerOut = z.object({ utterance: z.string().max(260) })

export const GuardOut = z.object({
  verdict: z.string(),
  violations: z.array(z.object({ rule: z.string(), reason: z.string().max(160).default('') })).max(8).default([]),
})

// ── cleaned, trusted shapes ───────────────────────────────────────────────────

export type Specificity = 'specific' | 'vague' | 'refused'
export interface Commitment {
  topic: Slot; value: string; specificity: Specificity; checkable: boolean; quote: string; count: number | null
  /** 0-based index of the answer it came from. */
  turn: number
}
export interface Inconsistency {
  kind: 'within_statement' | 'statement_evidence'
  topic: Slot; summary: string; earlierQuote: string; nowQuote: string
  /** A slip about a peripheral detail. Shown as a note, never treated as a deception cue. */
  peripheral: boolean
  turn: number
}
export interface Behaviour { category: (typeof RISK_CATEGORIES)[number]; quote: string }
export interface Move { tactic: Tactic; objective: Slot | null; rationale: string }

const SPECIFICITY: readonly string[] = ['specific', 'vague', 'refused']
const clip = (s: string, n: number) => s.trim().slice(0, n)

export function cleanCommitments(raw: TurnAnalysisRaw['commitments'], turn: number): Commitment[] {
  const out: Commitment[] = []
  for (const c of raw) {
    if (!isTopic(c.topic) || !SPECIFICITY.includes(c.specificity)) continue
    out.push({ topic: c.topic, value: clip(c.value, 160), specificity: c.specificity as Specificity, checkable: c.checkable, quote: clip(c.quote, 200), count: c.count, turn })
  }
  return out
}

export function cleanInconsistencies(raw: TurnAnalysisRaw['inconsistencies'], turn: number): Inconsistency[] {
  return raw.map(i => ({
    kind: 'within_statement' as const, topic: isTopic(i.topic) ? i.topic : 'purpose', summary: clip(i.summary, 140),
    earlierQuote: clip(i.earlierQuote, 200), nowQuote: clip(i.nowQuote, 200), peripheral: i.peripheral, turn,
  }))
}

export function cleanBehaviours(raw: TurnAnalysisRaw['behaviours']): Behaviour[] {
  return raw.filter(b => (RISK_CATEGORIES as readonly string[]).includes(b.category)).map(b => ({ category: b.category as Behaviour['category'], quote: clip(b.quote, 200) }))
}

export const cleanStrategy = (s: string): Strategy => (isStrategy(s) ? s : 'unclear')
export const cleanCounter = (s: string | null): CounterTactic | null => (isCounter(s) ? s : null)
export const cleanLevel = (s: string): (typeof LEVELS)[number] => ((LEVELS as readonly string[]).includes(s) ? (s as (typeof LEVELS)[number]) : 'none')
export const cleanVerdict = (s: string): 'consistent' | 'inconsistent' | 'evasive' | 'unclear' =>
  (['consistent', 'inconsistent', 'evasive', 'unclear'] as const).find(v => v === s) ?? 'unclear'
export const cleanMove = (m: TurnAnalysisRaw['move']): Move | null =>
  m && isTactic(m.tactic) ? { tactic: m.tactic, objective: isTopic(m.objective) ? m.objective : null, rationale: clip(m.rationale, 200) } : null
