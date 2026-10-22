/**
 * The case file: everything the interviewer knows about this visitor, rebuilt from the stored turns on every call
 * (event-sourced, so there is nothing extra to migrate and nothing to get out of sync).
 *
 *  - commitments: what the visitor has asserted, with the verbatim words. The ledger the consistency checks run against.
 *  - strategy trail: avoidance / denial / forthcoming / counter-tactic per answer, from what they SAID (never body language).
 *  - belief state: what the visitor has been given reason to think we know. We disclose nothing about the household,
 *    so this only moves when we state a visitor-side fact (what the doorbell camera sees).
 *  - phase: where we are in the SUE flow (free recall -> probing -> commitment -> challenge).
 *
 * Pure functions, no imports from the app.
 */
import {
  type Commitment, type Inconsistency, type Behaviour, type Move, type Strategy, type CounterTactic,
} from './schemas'
import { SLOT_KEYS, type Slot, type PlanState, type Status, cleanObs } from './plan'

export type Phase = 'free_recall' | 'probing' | 'commitment' | 'challenge' | 'closure'

export interface GuardrailLog {
  verdict: 'pass' | 'fail' | 'structural_only'
  attempts: number
  violations: { rule: string; reason: string }[]
}

/** What we keep per answered turn, under turn.analysis in Case.interrogationTurns. */
export interface StoredAnalysis {
  understood: boolean
  strategy: Strategy
  counterTactic: CounterTactic | null
  commitments: Commitment[]
  inconsistencies: Inconsistency[]
  behaviours: Behaviour[]
  wellbeing: { vulnerable: boolean; needsHelp: boolean; note: string | null }
  claimsOrganisation: boolean
  claimsPersonalTie: boolean
  claimsAppointment: boolean
  evasive: boolean
  satisfied: boolean
  riskHint: 'none' | 'low' | 'medium' | 'high'
  transcriptQuality?: 'high' | 'medium' | 'low'
  /** What the visitor said about themselves in this answer, for the helper card. */
  claims?: { name: string | null; organisation: string | null; reason: string | null; forWhom: string | null; time: string | null; relation?: string | null }
  summary?: string | null
  verdict?: 'consistent' | 'inconsistent' | 'evasive' | 'unclear'
  /** The move chosen for the question asked AFTER this answer. */
  move?: Move | null
  moveNote?: string
  guardrail?: GuardrailLog
  /** Evidence ids stated to the visitor in the question asked after this answer. */
  disclosed?: string[]
}

export interface InterrogationTurn {
  question: string
  transcript: string
  timestamp: number
  next?: string | null
  analysis?: StoredAnalysis
  modelFailed?: boolean
  // legacy fields (turns written before the agent rewrite)
  obs?: unknown
  focus?: Slot | null
  claimsOrg?: boolean
  claimsOrganisation?: boolean
  personalTie?: boolean
  claimsPersonalTie?: boolean
  riskHint?: 'none' | 'low' | 'medium' | 'high'
}

export interface CaseFile {
  answered: number
  commitments: Commitment[]
  latest: Partial<Record<Slot, Commitment>>
  asks: Record<Slot, number>
  inconsistencies: Inconsistency[]
  /** Material (not peripheral) inconsistencies no question has asked about yet. */
  open: Inconsistency[]
  strategies: Strategy[]
  counterTactics: CounterTactic[]
  /** Trailing answers in which the visitor declined or deflected. Drives autonomy support and the stop rule. */
  consecutiveDeclines: number
  moves: Move[]
  disclosed: string[]
  belief: { estimatedKnowledge: 'low' | 'moderate' | 'high'; perceivedEvidence: string }
  phase: Phase
  flags: { claimsOrg: boolean; personalTie: boolean; claimsAppointment: boolean; riskHint: 'none' | 'low' | 'medium' | 'high' }
}

const LEVEL_RANK = ['none', 'low', 'medium', 'high'] as const
const blank = <T,>(v: T) => Object.fromEntries(SLOT_KEYS.map(k => [k, v])) as Record<Slot, T>

/** Turns written before the rewrite only have per-slot statuses. Keep them readable. */
function legacyCommitments(t: InterrogationTurn, turn: number): Commitment[] {
  const out: Commitment[] = []
  for (const [k, v] of Object.entries(cleanObs(t.obs))) {
    if (k === 'recheck' || v === 'missing') continue
    out.push({ topic: k as Slot, value: '', specificity: v as Exclude<Status, 'missing'>, checkable: false, quote: '', count: null, turn })
  }
  return out
}

export function analysisOf(t: InterrogationTurn, i: number): StoredAnalysis | null {
  if (t.analysis) return t.analysis
  if (t.modelFailed) return null
  return {
    understood: !!t.transcript, strategy: 'unclear', counterTactic: null, commitments: legacyCommitments(t, i), inconsistencies: [], behaviours: [],
    wellbeing: { vulnerable: false, needsHelp: false, note: null },
    claimsOrganisation: !!(t.claimsOrganisation ?? t.claimsOrg), claimsPersonalTie: !!(t.claimsPersonalTie ?? t.personalTie), claimsAppointment: false,
    evasive: false, satisfied: false, riskHint: t.riskHint ?? 'none', move: t.focus ? { tactic: 'probe_specifics', objective: t.focus, rationale: '' } : null,
  }
}

export function foldCaseFile(turns: InterrogationTurn[]): CaseFile {
  const f: CaseFile = {
    answered: 0, commitments: [], latest: {}, asks: blank(0), inconsistencies: [], open: [], strategies: [], counterTactics: [],
    consecutiveDeclines: 0, moves: [], disclosed: [],
    belief: { estimatedKnowledge: 'low', perceivedEvidence: 'Visitor has been told nothing about what is known' },
    phase: 'free_recall', flags: { claimsOrg: false, personalTie: false, claimsAppointment: false, riskHint: 'none' },
  }
  let clarifiedUpTo = -1
  turns.forEach((t, i) => {
    const a = analysisOf(t, i)
    if (!a) return                                   // the model could not grade this turn: it adds nothing
    f.answered += 1
    for (const c of a.commitments) {
      f.commitments.push(c)
      f.latest[c.topic] = c
    }
    f.inconsistencies.push(...a.inconsistencies)
    f.strategies.push(a.strategy)
    if (a.counterTactic) f.counterTactics.push(a.counterTactic)
    const declined = !!a.counterTactic || a.commitments.some(c => c.specificity === 'refused')
    f.consecutiveDeclines = declined ? f.consecutiveDeclines + 1 : 0
    if (a.move) {
      f.moves.push(a.move)
      if (a.move.objective) f.asks[a.move.objective] += 1
      if (a.move.tactic === 'consistency_clarify') clarifiedUpTo = i
    }
    if (a.disclosed?.length) f.disclosed.push(...a.disclosed)
    f.flags.claimsOrg ||= a.claimsOrganisation
    f.flags.personalTie ||= a.claimsPersonalTie
    f.flags.claimsAppointment ||= a.claimsAppointment
    if (LEVEL_RANK.indexOf(a.riskHint) > LEVEL_RANK.indexOf(f.flags.riskHint)) f.flags.riskHint = a.riskHint
  })
  f.open = f.inconsistencies.filter(x => !x.peripheral && x.turn > clarifiedUpTo)
  const n = new Set(f.disclosed).size
  f.belief = n === 0 ? f.belief : {
    estimatedKnowledge: n === 1 ? 'moderate' : 'high',
    perceivedEvidence: `Visitor has been told ${n} visitor-side fact${n === 1 ? '' : 's'} (what the doorbell camera sees)`,
  }
  f.phase = phaseOf(f)
  return f
}

export function phaseOf(f: Pick<CaseFile, 'answered' | 'commitments' | 'open'>): Phase {
  if (f.answered === 0) return 'free_recall'
  if (f.open.length > 0) return 'challenge'
  return f.commitments.length >= 3 ? 'commitment' : 'probing'
}

/** The coverage state the helper checklist is built from, derived from the case file. */
export function planStateOf(f: CaseFile): PlanState {
  const status = blank<Status>('missing')
  for (const k of SLOT_KEYS) { const c = f.latest[k]; if (c) status[k] = c.specificity }
  if (f.open.length || f.inconsistencies.some(x => !x.peripheral)) status.recheck = 'vague'
  else if (f.answered >= 2) status.recheck = 'specific'
  return { status, asks: { ...f.asks }, claimsOrg: f.flags.claimsOrg, personalTie: f.flags.personalTie, claimsAppointment: f.flags.claimsAppointment, riskHint: f.flags.riskHint }
}

/** Non-coercive stop rule: two declines in a row after we have offered autonomy support means we stop asking and hand over. */
export const MAX_CONSECUTIVE_DECLINES = 2
export const isStalled = (f: CaseFile) => f.consecutiveDeclines >= MAX_CONSECUTIVE_DECLINES
