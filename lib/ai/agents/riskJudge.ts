/**
 * Risk judge: a dedicated Gemini call that reads the whole interrogation and decides how worrying it is.
 * It is advisory and helper-only. The model only EXTRACTS evidence (a category plus a verbatim quote). Code turns that
 * evidence and the keyword matches into a score (lib/doorstep/riskRules.ts), so a model failure still gives a rule-based
 * result and a model hallucination cannot invent a score.
 */
import { generateJson } from '@/lib/ai/client'
import { riskMatchesFor } from './risk'
import { RiskJudgeOut } from '@/lib/ai/schemas'
import { RISK_SYSTEM } from '@/lib/ai/prompts/risk'
import { sanitize, wrapUntrusted } from '@/lib/ai/guard'
import { buildAssessment, type Assessment, type JudgeResult } from '@/lib/ai/risk/combine'
import { type InterviewState } from '@/lib/doorstep/riskRules'

export interface RiskInput {
  householdId: string
  caseId: string
  turns: { question: string; transcript: string }[]
  /** Flag strings from the regex rules (+ optional embedding match). */
  ruleFlags: string[]
  inconsistencies: string[]
  evasive: boolean
  /** Interview checklist computed by code (trusted text) and the facts derived from it. */
  coverageLines?: string[]
  coverage?: { purposeVague: boolean; unverifiable: boolean }
  /** P7: Interview state stamps for conditional codes. */
  interviewState?: InterviewState
  /** Behaviours the interviewer agent already heard, each with a quote. Re-grounded against the transcript before use. */
  agentEvidence?: { category: string; quote: string }[]
}

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  let t: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([p, new Promise<null>(r => { t = setTimeout(() => r(null), ms) })]) }
  finally { if (t) clearTimeout(t) }
}

export async function assessRisk(i: RiskInput): Promise<Assessment> {
  const transcript = i.turns.map(t => t.transcript).filter(Boolean).join(' ')
  let judge: JudgeResult | null = null

  const enabled = process.env.AI_RISK_JUDGE !== '0'
  if (enabled && transcript.trim().length >= 3) {
    const convo = i.turns
      .map(t => `Q: ${sanitize(t.question, 200)}\n${wrapUntrusted('visitor_answer', t.transcript || '(not understood)', 400)}`)
      .join('\n')
    const noted = i.inconsistencies.length ? `\nInconsistencies noted by the interviewer:\n${wrapUntrusted('interviewer_notes', i.inconsistencies.join('; '), 400)}` : ''
    const checklist = i.coverageLines?.length ? `\nInterview checklist (computed by the system, reliable):\n- ${i.coverageLines.join('\n- ')}` : ''
    const rules = i.ruleFlags.length ? `\nAutomatic keyword checks matched: ${i.ruleFlags.join(', ')} (these can be wrong).` : ''
    const out = await withTimeout(
      generateJson({
        agent: 'risk', householdId: i.householdId, caseId: i.caseId, role: 'workhorse', schema: RiskJudgeOut, maxOutputTokens: 450,
        system: RISK_SYSTEM,
        parts: [{ text: `Visit context: unplanned. Nobody was expected.${rules}${checklist}\n\nConversation:\n${convo}${noted}` }],
      }),
      Number(process.env.AI_RISK_TIMEOUT_MS || 6000),
    )
    if (out) judge = out
  }

  return buildAssessment({
    transcript, ruleFlags: i.ruleFlags, ruleMatches: riskMatchesFor(transcript), judge,
    inconsistent: i.inconsistencies.length > 0, evasive: i.evasive, coverage: i.coverage, interviewState: i.interviewState,
    agentEvidence: i.agentEvidence as any,
  })
}
