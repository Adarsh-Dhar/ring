import { generateJson, type Part } from '@/lib/ai/client'
import { VideoDescriberOut, type VideoDescriberResult } from '@/lib/ai/schemas'
import { VIDEO_DESCRIBER_SYSTEM } from '@/lib/ai/prompts/videoDescriber'
import { setCaseAi } from '@/lib/ai/caseAi'
import { clampWords, hasBannedPhrase } from '@/lib/ai/guard'
import { validateFrames, FRAME_DATA_URL_PREFIX } from '@/lib/ai/frameLimits'

/**
 * Agent: describes a video clip from multiple frames.
 * Evidence for the helper, never a decision.
 */
export async function describeClip(
  householdId: string,
  caseId: string,
  frames: string[] // base64-encoded JPEG frames
): Promise<VideoDescriberResult | null> {
  // Same rules as the API routes (decoded bytes). Invalid input returns null; it never throws.
  const check = validateFrames(frames)
  if (check.ok === false) {
    console.warn('[VIDEO DESCRIBER] rejected frames:', check.error)
    return null
  }

  // Build parts: text prompt followed by each frame as inline data
  const parts: Part[] = [
    {
      text: [
        'The following images are frames from one doorbell video.',
        'They are supplied in chronological order.',
        'Summarize visible actions, clothing and objects.',
        'Do not infer identity, intent, or whether the visitor is safe.',
      ].join(' '),
    },
    ...frames.map((frame) => ({
      inlineData: { mimeType: 'image/jpeg', data: frame.slice(FRAME_DATA_URL_PREFIX.length) },
    })),
  ]

  const out = await generateJson({
    agent: 'videoDescriber',
    householdId,
    caseId,
    role: 'workhorse',
    schema: VideoDescriberOut,
    maxOutputTokens: 200,
    system: VIDEO_DESCRIBER_SYSTEM,
    parts,
  })

  if (!out) return null

  const summary = clampWords(out.summary, 25)
  if (hasBannedPhrase(summary)) return null

  const result = { summary, actions: out.actions, tags: out.tags }

  if (caseId) {
    await setCaseAi(caseId, {
      clipDescription: summary,
      clipTags: {
        uniform: out.tags.uniform,
        parcel: out.tags.parcel,
        vehicle: out.tags.vehicle,
      },
      clipActions: out.actions,
      clipPeopleCount: out.tags.peopleCount,
      clipApproachedDoor: out.tags.approachedDoor,
    })
  }

  return result
}
