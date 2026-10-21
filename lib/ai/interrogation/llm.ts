/**
 * The model-facing half of the interviewer: prompt assembly and the two calls.
 *   analyse -> hears the answer (audio or typed), returns the case-file entry and a proposed move + draft line
 *   speak   -> writes (or rewrites) one line for an already-chosen move; text only, so any fallback model can run it
 * No decisions are made here. Whatever comes back is untrusted and is cleaned, grounded and validated in engine.ts.
 */
import { generateJson } from '@/lib/ai/client'
import { sanitize, wrapUntrusted } from '@/lib/ai/guard'
import { ANALYST_SYSTEM, SPEAKER_SYSTEM } from '@/lib/ai/prompts/interrogator'
import { TurnAnalysisOut, SpeakerOut, type Tactic, type TurnAnalysisRaw, type Move } from './schemas'
import { playbookText, TACTIC_INTENT } from './playbook'
import type { CaseFile } from './casefile'
import { SLOT_LABEL } from './plan'

export type AnswerInput = { typed: string } | { audio: Buffer; mimeType: string }

export interface AnalyseCall {
  householdId: string
  caseId: string
  answer: AnswerInput
  /** The question this answer replies to. */
  asked: string
  file: CaseFile
  history: { question: string; transcript: string }[]
  /** Tactics that could be allowed (the final check happens after the answer is understood). */
  eligible: Tactic[]
  /** The one visitor-side fact that may be stated next, if any. */
  fact: string | null
  questionsLeft: number | null
}

export interface SpeakCall {
  householdId: string
  caseId: string
  move: Move
  file: CaseFile
  fact: string | null
  /** Lines already spoken to this visitor. */
  spoken: string[]
  /** What the last draft did wrong. */
  review: { rule: string; reason: string }[]
}

/** Trusted structure first, visitor words last and fenced as data. */
export function caseFileDigest(f: CaseFile, history: { question: string; transcript: string }[]): string {
  const asked = Object.entries(f.asks).filter(([, n]) => n > 0).map(([k, n]) => `${k} x${n}`).join(', ') || 'nothing yet'
  const lines = [
    `Phase: ${f.phase}. Answers so far: ${f.answered}.`,
    `Strategy so far (from words only): ${f.strategies.join(', ') || 'none yet'}. Declined or deflected in a row: ${f.consecutiveDeclines}.`,
    `Topics already asked about: ${asked}.`,
    `What the visitor believes we know: ${f.belief.estimatedKnowledge}. ${f.belief.perceivedEvidence}.`,
  ]
  const said = f.commitments.map(c => `[answer ${c.turn + 1}] ${SLOT_LABEL[c.topic]} (${c.specificity}${c.checkable ? ', checkable' : ''}): ${c.value || '(no value)'}${c.quote ? ` | said: "${c.quote}"` : ''}`)
  const open = f.open.map(o => `${o.summary} | earlier: "${o.earlierQuote}" | now: "${o.nowQuote}"`)
  const convo = history.map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.transcript || '(not understood)'}`)
  return [
    lines.join('\n'),
    wrapUntrusted('visitor_words', ['COMMITMENTS', ...(said.length ? said : ['(none yet)']), 'UNRESOLVED CENTRAL INCONSISTENCIES', ...(open.length ? open : ['(none)']), 'CONVERSATION', ...(convo.length ? convo : ['(none yet)'])].join('\n'), 3500),
  ].join('\n')
}

export interface LlmDeps { generate: typeof generateJson }
export const realLlm: LlmDeps = { generate: generateJson }

export async function analyse(i: AnalyseCall, deps: LlmDeps = realLlm): Promise<TurnAnalysisRaw | null> {
  const answerPart = 'typed' in i.answer
    ? { text: `The visitor typed this reply (no audio):\n${wrapUntrusted('visitor_answer', i.answer.typed, 500)}` }
    : { inlineData: { mimeType: i.answer.mimeType, data: i.answer.audio.toString('base64') } }
  const budget = i.questionsLeft === null ? 'no fixed limit' : `${i.questionsLeft} more question${i.questionsLeft === 1 ? '' : 's'} allowed`
  const fact = i.fact ? `ALLOWED FACT (the only thing you may state, exactly as worded): ${sanitize(i.fact, 160)}` : 'ALLOWED FACT: none. Do not use evidence_frame.'
  const text = [
    `Question this answers: ${sanitize(i.asked, 200)}`,
    caseFileDigest(i.file, i.history),
    `Questions the doorbell may still ask: ${budget}.`,
    fact,
    `ALLOWED TACTICS (also: autonomy_support if this answer declines or deflects; clarify_audio if you cannot understand it):\n${playbookText(i.eligible)}\n- autonomy_support: ${TACTIC_INTENT.autonomy_support}\n- clarify_audio: ${TACTIC_INTENT.clarify_audio}`,
    'Now: record this answer, then choose and word the next move.',
  ].join('\n\n')
  return deps.generate({
    agent: 'interrogator', householdId: i.householdId, caseId: i.caseId, role: 'workhorse', schema: TurnAnalysisOut, maxOutputTokens: 1100,
    system: ANALYST_SYSTEM, parts: [answerPart, { text }],
  })
}

export async function speak(i: SpeakCall, deps: LlmDeps = realLlm): Promise<string | null> {
  const review = i.review.length ? `\nREVIEW NOTES (the last draft broke these rules; fix all of them):\n${i.review.map(r => `- ${r.rule}: ${sanitize(r.reason, 160)}`).join('\n')}` : ''
  const fact = i.fact ? `ALLOWED FACT (state exactly as worded, nothing more): ${sanitize(i.fact, 160)}` : 'ALLOWED FACT: none.'
  const spoken = i.spoken.length ? `Lines already spoken (never repeat):\n${i.spoken.map(s => `- ${sanitize(s, 200)}`).join('\n')}` : 'Lines already spoken: none.'
  const out = await deps.generate({
    agent: 'interrogator_speaker', householdId: i.householdId, caseId: i.caseId, role: 'workhorse', schema: SpeakerOut, maxOutputTokens: 200,
    system: SPEAKER_SYSTEM,
    parts: [{ text: [
      `Move: ${i.move.tactic}${i.move.objective ? ` (about: ${SLOT_LABEL[i.move.objective]})` : ''}\nIntent: ${TACTIC_INTENT[i.move.tactic]}\nWhy: ${sanitize(i.move.rationale, 200)}`,
      fact, spoken, caseFileDigest(i.file, []), review,
    ].join('\n\n') }],
  })
  const u = out?.utterance?.trim()
  return u ? u : null
}
