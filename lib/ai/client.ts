/**
 * Thin Gemini REST wrapper (no SDK dependency). `generateJson` NEVER throws: on budget, timeout,
 * HTTP error, bad JSON or a schema mismatch it logs an AiRun and returns null.
 */
import type { ZodTypeAny, infer as zInfer } from 'zod'
import { reserve } from './budget'
import { chainFor, aiConfigured, AI_GLOBAL_OFF, MODEL_IDS, type ModelRole } from './models'
import { extractJson } from './guard'
import { logRun } from './runs'

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
  return fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY || '' },
    body: JSON.stringify(body),
    signal,
  })
}

export async function generateJson<S extends ZodTypeAny>(a: GenArgs<S>): Promise<zInfer<S> | null> {
  const base = { householdId: a.householdId, agent: a.agent, caseId: a.caseId }
  if (AI_GLOBAL_OFF() || !aiConfigured()) { await logRun({ ...base, model: '-', status: 'disabled' }); return null }

  const needsMedia = a.parts.some(p => 'inlineData' in p)
  for (const role of chainFor(a.role, needsMedia)) {
    const model = await reserve(role)
    if (!model) continue
    const started = Date.now()
    let modelMissing = false
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
      try {
        const res = await post(`models/${model}:generateContent`, {
          systemInstruction: { parts: [{ text: a.system }] },
          contents: [{ role: 'user', parts: a.parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: a.maxOutputTokens ?? 400, responseMimeType: 'application/json' },
        }, ctl.signal)
        if (res.status === 429 || res.status >= 500) { if (attempt === 0) { await new Promise(r => setTimeout(r, 600)); continue } }
        if (!res.ok) {
          const body = (await res.text().catch(() => '')).slice(0, 300)
          console.warn(`[AI] Gemini HTTP ${res.status} model=${model}: ${body}`)
          await logRun({ ...base, model, status: 'error', latencyMs: Date.now() - started })
          if (res.status === 404) modelMissing = true   // retired or misspelt model id: the next tier may still work
          break
        }
        const j: any = await res.json()
        const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
        const usage = j?.usageMetadata ?? {}
        const parsed = a.schema.safeParse(extractJson(text))
        await logRun({
          ...base, model, status: parsed.success ? 'ok' : 'invalid',
          tokensIn: usage.promptTokenCount ?? 0, tokensOut: usage.candidatesTokenCount ?? 0, latencyMs: Date.now() - started,
        })
        if (parsed.success) return parsed.data
        break
      } catch {
        if (attempt === 1) await logRun({ ...base, model, status: 'error', latencyMs: Date.now() - started })
      } finally { clearTimeout(timer) }
    }
    if (modelMissing) continue   // the model ID does not exist, so the input was never the problem: try the next tier
    return null   // a model was tried and failed: do not burn the next tier on the same bad input
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
    if (!res.ok) { await logRun({ householdId, agent: 'embed', model, status: 'error', latencyMs: Date.now() - started }); return null }
    const j: any = await res.json()
    const out = (j?.embeddings ?? []).map((e: any) => e?.values as number[])
    await logRun({ householdId, agent: 'embed', model, status: 'ok', latencyMs: Date.now() - started })
    return out.length === texts.length ? out : null
  } catch { return null } finally { clearTimeout(timer) }
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
    if (!res.ok) { await logRun({ householdId, agent: 'tts', model, status: 'error', latencyMs: Date.now() - started }); return null }
    const j: any = await res.json()
    const data = j?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData)?.inlineData?.data
    await logRun({ householdId, agent: 'tts', model, status: data ? 'ok' : 'invalid', latencyMs: Date.now() - started })
    return data || null
  } catch { return null } finally { clearTimeout(timer) }
}
