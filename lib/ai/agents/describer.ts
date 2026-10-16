import { generateJson } from '@/lib/ai/client'
import { DescriberOut, type DescriberResult } from '@/lib/ai/schemas'
import { DESCRIBER_SYSTEM } from '@/lib/ai/prompts/describer'
import { setCaseAi } from '@/lib/ai/caseAi'
import { clampWords, hasBannedPhrase } from '@/lib/ai/guard'
import { readFrames } from '@/lib/sim-videos/store'
import { describeClip } from './videoDescriber'

/** Agent 2. Vision only; describes clothing and objects. Evidence for the helper, never a decision. */
export async function describeSnapshot(
  householdId: string, caseId: string | null, image: Buffer, mimeType = 'image/jpeg'
): Promise<DescriberResult | null> {
  if (image.length === 0 || image.length > 4_000_000) return null
  const out = await generateJson({
    agent: 'describer', householdId, caseId, role: 'workhorse', schema: DescriberOut, maxOutputTokens: 150,
    system: DESCRIBER_SYSTEM,
    parts: [{ inlineData: { mimeType, data: image.toString('base64') } }, { text: 'Describe this snapshot.' }],
  })
  if (!out) return null
  const description = clampWords(out.description, 15)
  if (hasBannedPhrase(description)) return null
  const result = { description, tags: out.tags }
  if (caseId) await setCaseAi(caseId, { clipDescription: description, clipTags: out.tags })
  return result
}

/** Used by the job: fetch the Ring snapshot (or skip for sim devices) and describe it. */
export async function describeForCase(householdId: string, caseId: string, deviceId: string | null) {
  if (!deviceId) return null

  // For simulator devices, check if stored frames exist and use video describer
  if (deviceId.startsWith('sim-')) {
    const frames = await readFrames(householdId, deviceId)
    if (frames && frames.length > 0) {
      console.log('[DESCRIBER] Using stored frames for sim device')
      return describeClip(householdId, caseId, frames)
    }
    // No stored frames, fall through to null
    return null
  }

  // Real Ring device: fetch snapshot
  const { fetchRingSnapshot } = await import('@/face/camera')
  const buf = await fetchRingSnapshot(householdId, deviceId)
  if (!buf) {
    console.log('[DESCRIBER] Ring snapshot unavailable, no fallback - helper will see no description')
    return null
  }
  return describeSnapshot(householdId, caseId, buf)
}
