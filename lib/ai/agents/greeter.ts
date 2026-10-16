import { generateJson } from '@/lib/ai/client'
import { GreeterOut, type GreeterResult } from '@/lib/ai/schemas'
import { GREETER_SYSTEM } from '@/lib/ai/prompts/greeter'
import { riskFlagsFor, semanticFlag } from './risk'
import { setCaseAi, aiFlags, getCaseAi } from '@/lib/ai/caseAi'
import { pickTalkback, greeterLines, LISTEN_SECONDS } from '@/lib/ai/talkback'
import { clampWords, hasBannedPhrase, wrapUntrusted } from '@/lib/ai/guard'
import { wrapPcmAsWav, cachedLineAudio } from '@/lib/ai/tts'
import type { Prisma } from '@prisma/client'

export type GreeterState = 'idle' | 'greeting' | 'listening' | 'done' | 'failed' | 'unsupported'

/** Entry point from the job. Decides who drives the speaker and sets greeterState. Never throws. */
export async function startGreeter(householdId: string, caseId: string, deviceId: string | null) {
  try {
    const f = await aiFlags(householdId)
    if (!f.aiEnabled || !f.aiGreeter) return
    const tb = pickTalkback(deviceId)
    if (tb.name === 'ring' && !(await tb.serverDriven(householdId, deviceId))) {
      await setCaseAi(caseId, { greeterState: 'unsupported' }); return
    }
    if (tb.name === 'sim') { await setCaseAi(caseId, { greeterState: 'greeting' }); return }   // browser drives it

    // Server-driven (Ring, once supported): greet → listen → one reprompt → close.
    await setCaseAi(caseId, { greeterState: 'greeting' })
    if (!(await tb.say(householdId, deviceId!, 'greet'))) { await setCaseAi(caseId, { greeterState: 'failed' }); return }
    await setCaseAi(caseId, { greeterState: 'listening' })
    for (let attempt = 0; attempt < 2; attempt++) {
      const clip = await tb.listen(householdId, deviceId!, LISTEN_SECONDS)
      if (clip) {
        const r = await processReply(householdId, caseId, clip.data, clip.mimeType, attempt === 1)
        if (r.final) { await tb.say(householdId, deviceId!, 'close'); return }
      }
      if (attempt === 0) await tb.say(householdId, deviceId!, 'reprompt')
    }
    await setCaseAi(caseId, { greeterState: 'failed' })
  } catch (e) {
    console.error('[AI greeter]', e)
    await setCaseAi(caseId, { greeterState: 'failed' })
  }
}

/** Analyse the visitor's reply. `final` = stop asking (understood, or this was the second try). */
export async function processReply(
  householdId: string, caseId: string, audio: Buffer, mimeType: string, lastTry: boolean
): Promise<{ final: boolean; reprompt: boolean; result: GreeterResult | null }> {
  const existing = await getCaseAi(householdId, caseId) as any
  const tags = existing?.clipTags as { uniform?: boolean; parcel?: boolean; vehicle?: boolean } | null
  const hint = tags && typeof tags === 'object'
    ? `uniform=${!!tags.uniform}, parcel=${!!tags.parcel}, vehicle=${!!tags.vehicle}` : 'unknown'

  const out = await generateJson({
    agent: 'greeter', householdId, caseId, role: 'workhorse', schema: GreeterOut, maxOutputTokens: 350,
    system: GREETER_SYSTEM,
    parts: [
      { inlineData: { mimeType, data: audio.toString('base64') } },
      { text: `Camera hints (not from the visitor):\n${wrapUntrusted('camera_hints', hint, 100)}\nTranscribe and summarise the audio.` },
    ],
  })

  if (!out) {
    await setCaseAi(caseId, { greeterState: lastTry ? 'failed' : 'listening' })
    return { final: lastTry, reprompt: !lastTry, result: null }
  }
  if (!out.understood && !lastTry) {
    await setCaseAi(caseId, { greeterState: 'listening' })
    return { final: false, reprompt: true, result: out }
  }

  let summary = clampWords(out.visitorSummary, 25)
  if (hasBannedPhrase(summary)) summary = clampWords(out.transcript || 'Visitor spoke but the reply could not be summarised.', 25)
  const flags = riskFlagsFor(out.transcript, existing && tags ? !!tags.uniform : out.uniformVisible)
  if (!flags.length) { const s = await semanticFlag(householdId, out.transcript); if (s) flags.push(s) }

  await setCaseAi(caseId, { visitorSummary: out.understood ? summary : null, riskFlags: flags, greeterState: 'done' })
  return { final: true, reprompt: false, result: out }
}

/** Fixed lines (+ cached TTS audio when available) for the device/sim to play. */
export async function greeterScript(householdId: string, residentName: string | null) {
  const lines = greeterLines(residentName)
  const audio: Record<string, string | null> = {}
  for (const id of Object.keys(lines) as (keyof typeof lines)[]) audio[id] = await cachedLineAudio(householdId, id, lines[id])
  return { lines, audio, listenSeconds: LISTEN_SECONDS }
}
export { wrapPcmAsWav }
