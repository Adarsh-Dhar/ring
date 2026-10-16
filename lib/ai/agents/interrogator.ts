import { generateJson } from '@/lib/ai/client'
import { InterrogatorTurnOut, type InterrogatorTurnResult } from '@/lib/ai/schemas'
import { INTERROGATOR_SYSTEM } from '@/lib/ai/prompts/interrogator'
import { riskFlagsFor, semanticFlag } from './risk'
import { setCaseAi, aiFlags, getCaseAi } from '@/lib/ai/caseAi'
import { pickTalkback, interrogatorLines, LISTEN_SECONDS } from '@/lib/ai/talkback'
import { clampWords, hasBannedPhrase, validQuestion } from '@/lib/ai/guard'
import { wrapPcmAsWav, cachedLineAudio } from '@/lib/ai/tts'
import { getDb } from '@/lib/db/client'
import { isUnplannedVisit } from '../interrogation/gate'

const MAX_TURNS = 4

export type InterrogatorState = 'idle' | 'asking' | 'listening' | 'done' | 'failed' | 'unsupported' | 'greeting'

interface InterrogationTurn {
  question: string
  transcript: string
  timestamp: number
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

    // Server-driven (Ring, once supported): ask → listen → up to 4 turns
    await setCaseAi(caseId, { interrogationState: 'asking' })
    const opener = interrogatorLines(null).greet
    if (!(await tb.say(householdId, deviceId!, opener))) { await setCaseAi(caseId, { interrogationState: 'failed' }); return }
    await setCaseAi(caseId, { interrogationState: 'listening' })
  } catch (e) {
    console.error('[AI interrogator]', e)
    await setCaseAi(caseId, { interrogationState: 'failed' })
  }
}

/** Process a visitor's answer and return the next question or close. */
export async function processAnswer(
  householdId: string, caseId: string, audio: Buffer, mimeType: string
): Promise<{ question: string | null; final: boolean; close: string | null }> {
  try {
    // Server-side gate: re-check the case
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true },
    })
    if (!c || !isUnplannedVisit(c)) {
      return { question: null, final: true, close: null }
    }

    // Load existing turns
    const existing = await getCaseAi(householdId, caseId)
    const turns: InterrogationTurn[] = Array.isArray(existing?.interrogationTurns) ? (existing.interrogationTurns as any) : []

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
    const out = await generateJson({
      agent: 'interrogator', householdId, caseId, role: 'workhorse', schema: InterrogatorTurnOut, maxOutputTokens: 500,
      system: INTERROGATOR_SYSTEM,
      parts: [
        { inlineData: { mimeType, data: audio.toString('base64') } },
        { text: `Previous Q&A:\n${history}\n\nCurrent answer: Transcribe and decide the next step.` },
      ],
    })

    if (!out) {
      return { question: null, final: true, close: null }
    }

    // Validate the question if the model generated one
    if (out.nextQuestion && !validQuestion(out.nextQuestion)) {
      console.warn('[AI interrogator] Model generated invalid question, ending:', out.nextQuestion)
      await finishInterrogation(householdId, caseId, turns, 'invalid_question')
      return { question: null, final: true, close: interrogatorLines(null).close }
    }

    // Check for banned words in question
    if (out.nextQuestion && hasBannedPhrase(out.nextQuestion)) {
      console.warn('[AI interrogator] Question contains banned words, ending:', out.nextQuestion)
      await finishInterrogation(householdId, caseId, turns, 'banned_question')
      return { question: null, final: true, close: interrogatorLines(null).close }
    }

    // Save the turn
    const newTurn: InterrogationTurn = {
      question: turns.length > 0 ? turns[turns.length - 1].question : interrogatorLines(null).greet,
      transcript: out.transcript,
      timestamp: Date.now(),
    }
    const updatedTurns = [...turns, newTurn]

    // If no next question, we're done
    if (!out.nextQuestion) {
      await finishInterrogation(householdId, caseId, updatedTurns, 'done', out)
      return { question: null, final: true, close: interrogatorLines(null).close }
    }

    // Save the turn and continue
    await setCaseAi(caseId, { interrogationTurns: updatedTurns as any, interrogationState: 'asking' })
    return { question: out.nextQuestion, final: false, close: null }
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
  reason: 'done' | 'max_turns' | 'evasive' | 'invalid_question' | 'banned_question',
  modelResult?: InterrogatorTurnResult
) {
  const finalTurn = turns[turns.length - 1]
  const allTranscripts = turns.map(t => t.transcript).join(' ')
  const flags = riskFlagsFor(allTranscripts)
  if (!flags.length) { const s = await semanticFlag(householdId, allTranscripts); if (s) flags.push(s) }

  // Add inconsistency and evasive flags from model output
  if (modelResult) {
    if (modelResult.inconsistencies.length > 0) flags.push('Inconsistent answers')
    if (modelResult.evasive) flags.push('Evasive answers')
  }

  const summary = modelResult?.realReasonSummary || clampWords(finalTurn.transcript || 'Visitor spoke but the reason is unclear.', 30)
  const verdict = modelResult?.verdict || 'unclear'
  const claims = modelResult?.claims || { name: null, organisation: null, reason: null, forWhom: null, time: null }

  await setCaseAi(caseId, {
    visitorSummary: summary,
    riskFlags: flags,
    interrogationTurns: turns as any,
    interrogationVerdict: verdict,
    interrogationClaims: claims as any,
    interrogationState: 'done',
  })
}

/** Fixed lines (+ cached TTS audio when available) for the device/sim to play. */
export async function interrogatorScript(householdId: string, residentName: string | null) {
  const lines = interrogatorLines(residentName)
  const audio: Record<string, string | null> = {}
  for (const id of Object.keys(lines) as (keyof typeof lines)[]) audio[id] = await cachedLineAudio(householdId, id, lines[id])
  return { lines, audio, listenSeconds: LISTEN_SECONDS }
}
export { wrapPcmAsWav }
