/**
 * Pre-render the three fixed greeter lines ONCE per household and cache them (Gemini TTS is ~10 requests/day).
 * Falls back to null → the client uses browser speechSynthesis.
 */
import { createHash } from 'crypto'
import { getRedis } from '@/lib/redis'
import { synthesize } from './client'

export function wrapPcmAsWav(pcmB64: string, sampleRate = 24_000): Buffer {
  const pcm = Buffer.from(pcmB64, 'base64')
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  const result = Buffer.alloc(44 + pcm.length)
  h.copy(result as any, 0)
  pcm.copy(result as any, 44)
  return result
}

const key = (householdId: string, text: string) =>
  `ai:tts:${householdId}:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`

/** Returns a data: URL for a cached/new clip, or null. Never throws. */
export async function cachedLineAudio(householdId: string, _id: string, text: string): Promise<string | null> {
  if (!process.env.REDIS_URL || process.env.AI_TTS !== '1') return null
  try {
    const r = getRedis()
    const hit = await r.get(key(householdId, text))
    if (hit) return hit
    const pcm = await synthesize(householdId, text)
    if (!pcm) return null
    const url = `data:audio/wav;base64,${wrapPcmAsWav(pcm).toString('base64')}`
    await r.set(key(householdId, text), url, 'EX', 60 * 60 * 24 * 90)
    return url
  } catch { return null }
}
