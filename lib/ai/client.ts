/**
 * Thin Gemini REST wrapper (no SDK dependency). `generateJson` NEVER throws: on budget, timeout,
 * HTTP error, bad JSON or a schema mismatch it logs an AiRun and returns null.
 */
import type { ZodTypeAny, infer as zInfer } from 'zod'
import { reserve } from './budget'
import { chainFor, aiConfigured, AI_GLOBAL_OFF, MODEL_IDS, FALLBACK_MODELS, type ModelRole } from './models'
import { extractJson } from './guard'
import { logRun } from './runs'
import { getCurrentKey, rotateKey, forceRotateKey, getKeyStatus } from './keyRotation'

const BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta'
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20_000)

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

export interface GenArgs<S extends ZodTypeAny> {
  agent: string
  householdId: string
  caseId?: string | null
  role: ModelRole
  system: string
  parts: Part[]
  schema: S
  maxOutputTokens?: number
}

async function post(path: string, body: unknown, signal: AbortSignal) {
  const apiKey = getCurrentKey()
  return fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  })
}

/** Try a specific model with retries. Returns the result or throws an error. */
async function tryModel<S extends ZodTypeAny>(
  model: string,
  a: GenArgs<S>,
  maxRetries: number = 2
): Promise<{ success: boolean; data: zInfer<S> | null; lastError: Error | null }> {
  const base = { householdId: a.householdId, agent: a.agent, caseId: a.caseId }
  const started = Date.now()
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await post(`models/${model}:generateContent`, {
        systemInstruction: { parts: [{ text: a.system }] },
        contents: [{ role: 'user', parts: a.parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: a.maxOutputTokens ?? 400, responseMimeType: 'application/json' },
      }, ctl.signal)
      
      // Retry on 429 or 5xx errors
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries - 1) {
          const body = (await res.text().catch(() => '')).slice(0, 300)
          console.warn(`[AI] Gemini HTTP ${res.status} model=${model} (retry ${attempt + 1}/${maxRetries}): ${body}`)

          // If it's a 429 quota error, try rotating the key
          if (res.status === 429) {
            const rotated = rotateKey(new Error(`HTTP ${res.status}: ${body}`))
            if (rotated) {
              console.log(`[AI] Rotated to new key for retry ${attempt + 1}/${maxRetries}`)
            }
          }

          await new Promise(r => setTimeout(r, 600))
          continue
        }
      }
      
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300)
        console.warn(`[AI] Gemini HTTP ${res.status} model=${model}: ${body}`)
        await logRun({ ...base, model, status: 'error', latencyMs: Date.now() - started, error: `HTTP ${res.status}: ${body}` })
        throw new Error(`HTTP ${res.status}: ${body}`)
      }
      
      const j: any = await res.json()
      const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
      const usage = j?.usageMetadata ?? {}
      const parsed = a.schema.safeParse(extractJson(text))
      await logRun({
        ...base, model, status: parsed.success ? 'ok' : 'invalid',
        tokensIn: usage.promptTokenCount ?? 0, tokensOut: usage.candidatesTokenCount ?? 0, latencyMs: Date.now() - started,
        error: parsed.success ? undefined : `Schema validation failed. Response: ${text.slice(0, 500)}`
      })
      if (parsed.success) return { success: true, data: parsed.data, lastError: null }
      console.error(`[AI] Schema validation failed for ${a.agent}. Response:`, text.slice(0, 1000))
      throw new Error('Schema validation failed')
    } catch (e) {
      lastError = e as Error
      if (attempt === maxRetries - 1) {
        await logRun({ ...base, model, status: 'error', latencyMs: Date.now() - started, error: lastError?.message || String(lastError) })
      }
    } finally { clearTimeout(timer) }
  }
  
  return { success: false, data: null, lastError }
}

export async function generateJson<S extends ZodTypeAny>(a: GenArgs<S>): Promise<zInfer<S> | null> {
  const base = { householdId: a.householdId, agent: a.agent, caseId: a.caseId }
  if (AI_GLOBAL_OFF() || !aiConfigured()) { await logRun({ ...base, model: '-', status: 'disabled' }); return null }

  const needsMedia = a.parts.some(p => 'inlineData' in p)
  
  // Try the normal chain first
  for (const role of chainFor(a.role, needsMedia)) {
    const model = await reserve(role)
    if (!model) continue
    
    const result = await tryModel(model, a, 2)
    if (result.success) return result.data
    
    // If model is 404 (missing), skip to next tier
    if (result.lastError?.message.includes('404')) continue
    
    // If 503/unavailable, try fallback models
    if (result.lastError?.message.includes('503') || result.lastError?.message.includes('high demand') || result.lastError?.message.includes('UNAVAILABLE')) {
      console.log(`[AI] Primary model ${model} unavailable, trying fallback models...`)
      for (const fallbackModel of FALLBACK_MODELS) {
        console.log(`[AI] Trying fallback model: ${fallbackModel}`)
        const fallbackResult = await tryModel(fallbackModel, a, 1)
        if (fallbackResult.success) {
          console.log(`[AI] Successfully used fallback model: ${fallbackModel}`)
          return fallbackResult.data
        }
      }
    }
    
    // If we tried fallbacks and they all failed, return null
    return null
  }
  
  await logRun({ ...base, model: MODEL_IDS[a.role](), status: 'budget' })
  return null
}

/** Embeddings for semantic scam-phrase matching. Returns null on any problem. */
export async function embed(householdId: string, texts: string[]): Promise<number[][] | null> {
  if (AI_GLOBAL_OFF() || !aiConfigured() || texts.length === 0) return null
  const model = await reserve('embedding')
  if (!model) return null
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await post(`models/${model}:batchEmbedContents`, {
      requests: texts.map(t => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })),
    }, ctl.signal)
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      await logRun({ householdId, agent: 'embed', model, status: 'error', latencyMs: Date.now() - started, error: `HTTP ${res.status}: ${body}` })
      return null
    }
    const j: any = await res.json()
    const out = (j?.embeddings ?? []).map((e: any) => e?.values as number[])
    await logRun({ householdId, agent: 'embed', model, status: 'ok', latencyMs: Date.now() - started })
    return out.length === texts.length ? out : null
  } catch (e) {
    await logRun({ householdId, agent: 'embed', model, status: 'error', latencyMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) })
    return null
  } finally { clearTimeout(timer) }
}

/** Gemini TTS: returns raw 16-bit PCM @24kHz as base64, or null. */
export async function synthesize(householdId: string, text: string): Promise<string | null> {
  if (AI_GLOBAL_OFF() || !aiConfigured()) return null
  const model = await reserve('tts')
  if (!model) return null
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await post(`models/${model}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'] },
    }, ctl.signal)
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      await logRun({ householdId, agent: 'tts', model, status: 'error', latencyMs: Date.now() - started, error: `HTTP ${res.status}: ${body}` })
      return null
    }
    const j: any = await res.json()
    const data = j?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData)?.inlineData?.data
    await logRun({ householdId, agent: 'tts', model, status: data ? 'ok' : 'invalid', latencyMs: Date.now() - started })
    return data || null
  } catch (e) {
    await logRun({ householdId, agent: 'tts', model, status: 'error', latencyMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) })
    return null
  } finally { clearTimeout(timer) }
}
