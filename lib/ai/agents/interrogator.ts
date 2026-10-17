import { generateJson } from '@/lib/ai/client'
import { InterrogatorTurnOut, type InterrogatorTurnResult } from '@/lib/ai/schemas'
import { INTERROGATOR_SYSTEM } from '@/lib/ai/prompts/interrogator'
import { riskFlagsFor, semanticFlag } from './risk'
import { assessRisk } from './riskJudge'
import { liveAssessment } from '@/lib/ai/risk/combine'
import { setCaseAi, aiFlags, getCaseAi } from '@/lib/ai/caseAi'
import { pickTalkback, interrogatorLines, LISTEN_SECONDS } from '@/lib/ai/talkback'
import { clampWords, hasBannedPhrase, validQuestion, wrapUntrusted } from '@/lib/ai/guard'
import { wrapPcmAsWav, cachedLineAudio } from '@/lib/ai/tts'
import { getDb } from '@/lib/db/client'
import { isUnplannedVisit } from '../interrogation/gate'
import {
  MAX_TURNS,
  type PlanTurn,
  cleanObs,
  foldPlan,
  nextFocus,
  bankQuestion,
  isEchoOfName,
  coverageSummary,
  coverageFacts,
  coverageLines,
  type Slot,
} from '@/lib/ai/interrogation/plan'

export type InterrogatorState = 'idle' | 'asking' | 'listening' | 'done' | 'failed' | 'unsupported' | 'greeting'

interface InterrogationTurn {
  question: string      // the question this answer replies to
  transcript: string
  timestamp: number
  next?: string | null  // the follow-up we asked after this answer (becomes the next turn's question)
  obs?: any             // coverage from this turn (raw model output, cleaned by plan module)
  focus?: Slot | null   // the slot we asked about (next question's focus)
  claimsOrg?: boolean
  personalTie?: boolean
  echoTarget?: boolean
  riskHint?: 'none' | 'low' | 'medium' | 'high'
}

/** Entry point from the job. Checks the gate, then starts the interrogation. Never throws. */
export async function startInterrogator(householdId: string, caseId: string, deviceId: string | null) {
  try {
    const f = await aiFlags(householdId)
    if (!f.aiEnabled || !f.aiInterrogator) return

    // Server-side gate: re-read the case from DB and check
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, householdId: true },
    })
    if (!c) {
      console.error('[AI interrogator] Case not found:', caseId)
      return
    }
    if (!isUnplannedVisit(c)) {
      console.log('[AI interrogator] Skipped: planned visit')
      return
    }

    const tb = pickTalkback(deviceId)
    if (tb.name === 'ring' && !(await tb.serverDriven(householdId, deviceId))) {
      await setCaseAi(caseId, { interrogationState: 'unsupported' }); return
    }
    if (tb.name === 'sim') { await setCaseAi(caseId, { interrogationState: 'asking' }); return }   // browser drives it

    // Server-driven (Ring, once supported): ask → listen → up to MAX_TURNS turns
    const householdData = await aiFlags(householdId)
    await setCaseAi(caseId, { interrogationState: 'asking', maxTurns: MAX_TURNS, residentName: householdData.residentName })
    const opener = interrogatorLines(householdData.residentName).greet
    if (!(await tb.say(householdId, deviceId!, opener))) { await setCaseAi(caseId, { interrogationState: 'failed' }); return }
    await setCaseAi(caseId, { interrogationState: 'listening' })
  } catch (e) {
    console.error('[AI interrogator]', e)
    await setCaseAi(caseId, { interrogationState: 'failed' })
  }
}

/**
 * Process a visitor's answer and return the next question or close.
 * `answer` is the recorded audio (Buffer + mimeType) or, for the workspace simulator only, the typed text.
 * Typed text is wrapped as untrusted data exactly like everything else a visitor says.
 */
export async function processAnswer(
  householdId: string, caseId: string, answer: Buffer | string, mimeType?: string
): Promise<{ question: string | null; final: boolean; close: string | null }> {
  try {
    // Server-side gate: re-check the case
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, householdId: true },
    })
    if (!c || !isUnplannedVisit(c)) {
      return { question: null, final: true, close: null }
    }

    // Load existing turns and resident name
    const existing = await getCaseAi(householdId, caseId)
    const turns: InterrogationTurn[] = Array.isArray(existing?.interrogationTurns) ? existing.interrogationTurns : []
    const householdData = await aiFlags(householdId)
    const residentName = householdData.residentName ?? null

    // Stop conditions from DB state
    if (turns.length >= MAX_TURNS) {
      await finishInterrogation(householdId, caseId, turns, 'max_turns')
      return { question: null, final: true, close: interrogatorLines(null).close }
    }

    const consecutiveNotUnderstood = turns.slice(-2).filter(t => !t.transcript).length >= 2
    if (consecutiveNotUnderstood) {
      await finishInterrogation(householdId, caseId, turns, 'evasive')
      return { question: null, final: true, close: interrogatorLines(null).close }
    }

    // Build conversation history for the model
    const history = turns.map(t => `Q: ${t.question}\nA: ${t.transcript}`).join('\n\n')

    // Fold the current plan state to tell the model what we know so far
    const planTurns: PlanTurn[] = turns.map(t => ({
      obs: cleanObs(t.obs),
      focus: t.focus,
      claimsOrg: t.claimsOrg,
      personalTie: t.personalTie,
      echoTarget: t.echoTarget,
      riskHint: t.riskHint,
    }))
    const state = foldPlan(planTurns)
    const slotsInfo = Object.entries(state.status)
      .map(([k, v]) => `${k}: ${v} (asked ${state.asks[k as Slot]} times)`)
      .join(', ')

    const out = await generateJson({
      agent: 'interrogator', householdId, caseId, role: 'workhorse', schema: InterrogatorTurnOut, maxOutputTokens: 500,
      system: INTERROGATOR_SYSTEM,
      parts: [
        typeof answer === 'string'
          ? { text: `The visitor typed this reply (no audio):\n${wrapUntrusted('visitor_answer', answer, 500)}` }
          : { inlineData: { mimeType: mimeType ?? 'audio/webm', data: answer.toString('base64') } },
        { text: `Previous Q&A:\n${history}\n\nCurrent interview state (what we know so far):\n${slotsInfo}\n\nCurrent answer: Transcribe and decide the next step.` },
      ],
    })

    if (!out) {
      // Model call failed: use the plan to decide what to do
      const next = nextFocus(state, turns.length)
      if (next) {
        const q = bankQuestion(next, state.asks[next])
        const newTurn: InterrogationTurn = {
          question: turns.length > 0 ? (turns[turns.length - 1].next ?? interrogatorLines(null).greet) : interrogatorLines(null).greet,
          transcript: '',
          timestamp: Date.now(),
          next: q,
          obs: {},
          focus: next,
        }
        const updatedTurns = [...turns, newTurn]
        await setCaseAi(caseId, {
          interrogationTurns: updatedTurns as any, interrogationState: 'asking',
        })
        return { question: q, final: false, close: null }
      }
      await finishInterrogation(householdId, caseId, turns, 'model_failed')
      return { question: null, final: true, close: interrogatorLines(null).close }
    }

    // Validate the question if the model generated one. If invalid, fall back to the plan.
    let nextQuestion = out.nextQuestion
    let nextFocusSlot: Slot | null = out.nextFocus ? (out.nextFocus as Slot) : null
    if (nextQuestion && !validQuestion(nextQuestion)) {
      console.warn('[AI interrogator] Model generated invalid question, using scripted fallback:', nextQuestion)
      nextQuestion = null
    }
    if (nextQuestion && hasBannedPhrase(nextQuestion)) {
      console.warn('[AI interrogator] Question contains banned words, using scripted fallback:', nextQuestion)
      nextQuestion = null
    }

    // If the model's question is invalid or missing, use the plan to decide
    if (!nextQuestion) {
      const next = nextFocus(state, turns.length)
      if (next) {
        nextQuestion = bankQuestion(next, state.asks[next])
        nextFocusSlot = next
      }
    }

    // Clean the model's coverage output
    const obs = cleanObs(out.coverage)
    const echoTarget = isEchoOfName(out.claims?.forWhom, residentName)

    // Save the turn. The question it answers is the follow-up we asked last time (or the greeting on turn 1).
    const asked = turns.length > 0 ? (turns[turns.length - 1].next ?? interrogatorLines(null).greet) : interrogatorLines(null).greet
    const newTurn: InterrogationTurn = {
      question: asked,
      transcript: out.transcript,
      timestamp: Date.now(),
      next: nextQuestion,
      obs,
      focus: nextFocusSlot,
      claimsOrg: out.claimsOrganisation,
      personalTie: out.claimsPersonalTie,
      echoTarget,
      riskHint: out.riskHint,
    }
    const updatedTurns = [...turns, newTurn]

    // No next question from plan or model: we're done
    if (!nextQuestion) {
      await finishInterrogation(householdId, caseId, updatedTurns, 'done', out)
      return { question: null, final: true, close: interrogatorLines(null).close }
    }

    // Save the turn and continue. Risk is updated live so helpers see it while the visitor is still at the door.
    const live = liveAssessment(riskFlagsFor(updatedTurns.map(t => t.transcript).join(' ')), out.riskHint)
    await setCaseAi(caseId, {
      interrogationTurns: updatedTurns as any, interrogationState: 'asking',
      riskLevel: live.level, riskFlags: live.labels, riskAssessment: live as any,
    })
    return { question: nextQuestion, final: false, close: null }
  } catch (e) {
    console.error('[AI interrogator] processAnswer failed', e)
    return { question: null, final: true, close: null }
  }
}

/** Finalize the interrogation: save summary, verdict, claims, flags, and notify helpers. */
async function finishInterrogation(
  householdId: string,
  caseId: string,
  turns: InterrogationTurn[],
  reason: 'done' | 'max_turns' | 'evasive' | 'invalid_question' | 'banned_question' | 'model_failed',
  modelResult?: InterrogatorTurnResult
) {
  const finalTurn = turns[turns.length - 1]
  const allTranscripts = turns.map(t => t.transcript).join(' ')

  // Build the interview plan state from the turns
  const planTurns: PlanTurn[] = turns.map(t => ({
    obs: cleanObs(t.obs),
    focus: t.focus,
    claimsOrg: t.claimsOrg,
    personalTie: t.personalTie,
    echoTarget: t.echoTarget,
    riskHint: t.riskHint,
  }))
  const state = foldPlan(planTurns)
  const coverage = coverageSummary(state, turns.length)
  const facts = coverageFacts(state, turns.length)
  const checklistLines = coverageLines(coverage)

  // Layer 1: deterministic keyword rules (+ optional embedding match). Always runs, never fails.
  const ruleFlags = riskFlagsFor(allTranscripts)
  if (!ruleFlags.length) { const s = await semanticFlag(householdId, allTranscripts); if (s) ruleFlags.push(s) }

  // Layer 2: the AI risk judge reads the whole conversation. Layer 3 (in code) combines both and checks the model's quotes.
  const risk = await assessRisk({
    householdId, caseId,
    turns: turns.map(t => ({ question: t.question, transcript: t.transcript })),
    ruleFlags,
    inconsistencies: modelResult?.inconsistencies ?? [],
    evasive: !!modelResult?.evasive || reason === 'evasive',
    liveHint: modelResult?.riskHint ?? 'none',
    coverageLines: checklistLines,
    coverage: facts,
  })
  const flags = risk.labels

  const summary = modelResult?.realReasonSummary || clampWords(finalTurn.transcript || 'Visitor spoke but the reason is unclear.', 30)
  const verdict = modelResult?.verdict || 'unclear'
  const claims = modelResult?.claims || { name: null, organisation: null, reason: null, forWhom: null, time: null }

  await setCaseAi(caseId, {
    visitorSummary: summary,
    riskFlags: flags,
    riskLevel: risk.level,
    riskAssessment: risk as any,
    interrogationTurns: turns as any,
    interrogationVerdict: verdict,
    interrogationClaims: { ...claims, checklist: coverage } as any,
    interrogationState: 'done',
  })
}

/** Fixed lines (+ cached TTS audio when available) for the device/sim to play. */
export async function interrogatorScript(householdId: string, residentName: string | null) {
  const lines = interrogatorLines(residentName)
  const audio: Record<string, string | null> = {}
  for (const id of Object.keys(lines) as (keyof typeof lines)[]) audio[id] = await cachedLineAudio(householdId, id, lines[id])
  return { lines, audio, listenSeconds: LISTEN_SECONDS, maxTurns: MAX_TURNS }
}
export { wrapPcmAsWav }
