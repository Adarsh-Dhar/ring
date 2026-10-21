/**
 * The interviewer engine: one answered turn, end to end, with every model call injected so it can be tested
 * with fakes (no network, no database).
 *
 *   analyseTurn      hear the answer -> ground every claim in the transcript -> check it against the evidence in
 *                    silence -> fold into the case file
 *   composeQuestion  validate the proposed move against the playbook -> get the words -> vet them -> (regenerate once
 *                    or twice with the reasons) -> or hand over to a carer
 *
 * Between the two, the caller (agents/interrogator.ts) scores risk and runs the deterministic safety precedence
 * (respond.ts), because a safety event must be able to pre-empt the next question.
 */
import { quoteIsGrounded, passesTranscriptionQuality } from '@/lib/doorstep/riskRules'
import { sanitize } from '@/lib/ai/guard'
import type { Evidence } from '@/lib/ai/risk/combine'
import {
  cleanBehaviours, cleanCommitments, cleanCounter, cleanInconsistencies, cleanLevel, cleanMove, cleanStrategy, cleanVerdict,
  type Move, type TurnAnalysisRaw,
} from './schemas'
import { foldCaseFile, type CaseFile, type GuardrailLog, type InterrogationTurn, type StoredAnalysis } from './casefile'
import { alignWithEvidence, nextDisclosableFact, type EvidenceBundle, type EvidenceItem } from './evidence'
import { allowedTactics, chooseMove, type MoveContext } from './playbook'
import { vetUtterance } from './guardrails'
import { analyse, speak, type AnswerInput } from './llm'

export interface EngineDeps {
  analyse: typeof analyse
  speak: typeof speak
  vet: typeof vetUtterance
}
export const realDeps: EngineDeps = { analyse, speak, vet: vetUtterance }

/** Drafts we will write and vet for one question before handing over to a carer. */
export const MAX_DRAFTS = 3

/** Topics whose central inconsistencies are scored as a changed purpose (needs both quotes). */
const PURPOSE_TOPICS = new Set(['purpose', 'organisation', 'detail', 'appointment'])

/**
 * Grounded behaviours and central contradictions from stored analyses, in the shape the risk scorer takes.
 * Rebuilt from ALL turns every time, because the live score is recomputed from the whole conversation.
 */
export function riskEvidenceOf(analyses: StoredAnalysis[]): Evidence[] {
  const out: Evidence[] = []
  for (const a of analyses) {
    for (const b of a.behaviours) out.push({ category: b.category, quote: b.quote })
    for (const x of a.inconsistencies.filter(x => !x.peripheral)) {
      if (x.kind === 'statement_evidence') out.push({ category: x.topic === 'appointment' ? 'unverifiable_claims' : 'story_mismatch', quote: x.nowQuote })
      else if (PURPOSE_TOPICS.has(x.topic)) out.push({ category: 'purpose_contradiction', quote: x.earlierQuote }, { category: 'purpose_contradiction', quote: x.nowQuote })
      else out.push({ category: 'story_mismatch', quote: x.nowQuote })
    }
  }
  return out.filter(e => e.quote.trim().length >= 3)
}

export interface AnalyseTurnInput {
  householdId: string
  caseId: string
  answer: AnswerInput
  /** The question this answer replies to. */
  asked: string
  /** Stored turns BEFORE this answer. */
  turns: InterrogationTurn[]
  evidence: EvidenceBundle
  questionsLeft: number | null
}

export interface TurnResult {
  transcript: string
  understood: boolean
  claims: TurnAnalysisRaw['claims']
  verdict: 'consistent' | 'inconsistent' | 'evasive' | 'unclear'
  summary: string | null
  analysis: StoredAnalysis
  /** The case file including this answer. */
  file: CaseFile
  fact: EvidenceItem | null
  proposed: Move | null
  draft: string | null
  /** A central (not peripheral) inconsistency of either kind. */
  inconsistent: boolean
}

export async function analyseTurn(i: AnalyseTurnInput, deps: EngineDeps = realDeps): Promise<TurnResult | null> {
  const before = foldCaseFile(i.turns)
  const factBefore = nextDisclosableFact(i.evidence.items, before.disclosed)
  const eligible = allowedTactics({ file: before, understood: true, counterTactic: null, fact: factBefore, questionsLeft: i.questionsLeft })

  const raw = await deps.analyse({
    householdId: i.householdId, caseId: i.caseId, answer: i.answer, asked: i.asked, file: before,
    history: i.turns.map(t => ({ question: t.question, transcript: t.transcript })),
    eligible, fact: factBefore?.fact ?? null, questionsLeft: i.questionsLeft,
  })
  if (!raw) return null

  const idx = before.answered
  // A typed reply is the ground truth. Audio is whatever the model heard.
  const transcript = sanitize('typed' in i.answer ? i.answer.typed : raw.transcript, 700)
  const understood = raw.understood && transcript.length > 0
  const priorText = i.turns.map(t => t.transcript).join(' ')

  // Ground everything: a claim without the visitor's own words behind it does not exist.
  const commitments = !understood ? [] : cleanCommitments(raw.commitments, idx)
    .filter(c => c.specificity === 'refused' || quoteIsGrounded(c.quote, transcript))
  const within = !understood ? [] : cleanInconsistencies(raw.inconsistencies, idx)
    .filter(x => quoteIsGrounded(x.nowQuote, transcript) && quoteIsGrounded(x.earlierQuote, priorText))
  const behaviours = !understood ? [] : cleanBehaviours(raw.behaviours).filter(b => quoteIsGrounded(b.quote, transcript))

  // Silent statement-evidence checks. Nothing here is ever said to the visitor.
  const statementEvidence = alignWithEvidence(commitments, [...before.commitments, ...commitments], i.evidence, idx)

  const counterTactic = cleanCounter(raw.counterTactic)
  const strategy = counterTactic ? 'counter_tactic' : cleanStrategy(raw.strategy)
  const quality = !passesTranscriptionQuality(transcript, raw.transcriptQuality) ? 'low' as const
    : raw.transcriptQuality !== null && raw.transcriptQuality < 0.7 ? 'medium' as const : 'high' as const

  const analysis: StoredAnalysis = {
    understood, strategy, counterTactic, commitments, inconsistencies: [...within, ...statementEvidence], behaviours,
    wellbeing: raw.wellbeing,
    claimsOrganisation: raw.claimsOrganisation, claimsPersonalTie: raw.claimsPersonalTie, claimsAppointment: raw.claimsAppointment,
    evasive: raw.evasive, satisfied: raw.satisfied, riskHint: cleanLevel(raw.riskHint), transcriptQuality: quality,
    claims: raw.claims, summary: raw.realReasonSummary, verdict: cleanVerdict(raw.verdict),
  }
  const file = foldCaseFile([...i.turns, { question: i.asked, transcript, timestamp: Date.now(), analysis }])

  return {
    transcript, understood, claims: raw.claims, verdict: cleanVerdict(raw.verdict), summary: raw.realReasonSummary,
    analysis, file, fact: nextDisclosableFact(i.evidence.items, file.disclosed),
    proposed: cleanMove(raw.move), draft: raw.utterance?.trim() || null,
    inconsistent: [...within, ...statementEvidence].some(x => !x.peripheral),
  }
}

// ── composing the question ────────────────────────────────────────────────────

export interface ComposeInput {
  householdId: string
  caseId: string
  result: TurnResult
  questionsLeft: number | null
  householdTerms: string[]
  /** Every line already spoken to this visitor. */
  spoken: string[]
  lastExchange: { question: string; answer: string } | null
}

export type Composed =
  | { kind: 'ask'; text: string; move: Move; note: string; guardrail: GuardrailLog; disclosed: string[] }
  | { kind: 'reprompt'; move: Move; note: string }
  | { kind: 'close'; move: Move; note: string }
  | { kind: 'handoff'; reason: 'guardrail' | 'speaker_unavailable'; move: Move; note: string; guardrail?: GuardrailLog }

export async function composeQuestion(i: ComposeInput, deps: EngineDeps = realDeps): Promise<Composed> {
  const { result: r } = i
  const ctx: MoveContext = { file: r.file, understood: r.understood, counterTactic: r.analysis.counterTactic, fact: r.fact, questionsLeft: i.questionsLeft }
  const chosen = chooseMove(r.proposed, ctx)
  const move = chosen.move
  if (move.tactic === 'close') return { kind: 'close', move, note: chosen.note }
  if (move.tactic === 'clarify_audio') return { kind: 'reprompt', move, note: chosen.note }

  const fact = move.tactic === 'evidence_frame' ? r.fact : null
  let text: string | null = chosen.overridden ? null : r.draft
  let review: { rule: string; reason: string }[] = []
  let log: GuardrailLog | undefined

  for (let attempt = 1; attempt <= MAX_DRAFTS; attempt++) {
    if (!text) {
      text = await deps.speak({ householdId: i.householdId, caseId: i.caseId, move, file: r.file, fact: fact?.fact ?? null, spoken: i.spoken, review })
      if (!text) return { kind: 'handoff', reason: 'speaker_unavailable', move, note: chosen.note, guardrail: log }
    }
    const vetted = await deps.vet({
      householdId: i.householdId, caseId: i.caseId, text, tactic: move.tactic, allowedFacts: fact ? [fact.fact] : [],
      lastExchange: i.lastExchange, householdTerms: i.householdTerms, attempts: attempt,
    })
    log = vetted.log
    // A repeat of an earlier line is a defect even if it is polite.
    const repeated = i.spoken.some(s => s.trim().toLowerCase() === text!.trim().toLowerCase())
    if (vetted.ok && !repeated) {
      return { kind: 'ask', text, move, note: chosen.note, guardrail: vetted.log, disclosed: fact ? [fact.id] : [] }
    }
    review = repeated && vetted.ok ? [{ rule: 'repeat', reason: 'This line was already spoken. Use different words.' }] : vetted.log.violations
    text = null
  }
  return { kind: 'handoff', reason: 'guardrail', move, note: chosen.note, guardrail: log }
}
