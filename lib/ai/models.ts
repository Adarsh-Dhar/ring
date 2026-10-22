/**
 * Role → model ID. IDs come from env because model names change and the display names in the
 * quota table could not be verified as API IDs. Set them in .env; the defaults are placeholders.
 */
export type ModelRole = 'workhorse' | 'quality' | 'fallback' | 'embedding' | 'tts'

export interface ModelLimits { rpm: number; rpd: number }

const env = (k: string, d: string) => (process.env[k] || d).trim()

export const MODEL_IDS: Record<ModelRole, () => string> = {
  workhorse: () => env('GEMINI_MODEL_WORKHORSE', 'gemini-3.5-flash-lite'),
  quality:   () => env('GEMINI_MODEL_QUALITY',   'gemini-3.5-flash-lite'),
  fallback:  () => env('GEMINI_MODEL_FALLBACK',  'gemma-4-26b'),
  embedding: () => env('GEMINI_MODEL_EMBEDDING', 'gemini-embedding-2'),
  tts:       () => env('GEMINI_MODEL_TTS',       'gemini-3.1-flash-tts'),
}

/** Fallback models for 503/unavailable errors, in order of preference */
export const FALLBACK_MODELS: string[] = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2-flash',
]

/** Free-tier defaults from the quota table. Override per role: GEMINI_LIMIT_<ROLE>_RPM / _RPD. */
const DEFAULT_LIMITS: Record<ModelRole, ModelLimits> = {
  workhorse: { rpm: 15,  rpd: 500 },
  quality:   { rpm: 5,   rpd: 20 },
  fallback:  { rpm: 30,  rpd: 14_400 },
  embedding: { rpm: 100, rpd: 1_000 },
  tts:       { rpm: 3,   rpd: 10 },
}

export function limitsFor(role: ModelRole): ModelLimits {
  const R = role.toUpperCase()
  const n = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d }
  return { rpm: n(`GEMINI_LIMIT_${R}_RPM`, DEFAULT_LIMITS[role].rpm), rpd: n(`GEMINI_LIMIT_${R}_RPD`, DEFAULT_LIMITS[role].rpd) }
}

/** Which roles to try, in order, when the first is out of budget. Audio/image work never falls back to Gemma (text only). */
export function chainFor(role: ModelRole, needsMedia: boolean): ModelRole[] {
  if (role === 'workhorse') return needsMedia ? ['workhorse'] : ['workhorse', 'fallback']
  if (role === 'quality')   return needsMedia ? ['quality', 'workhorse'] : ['quality', 'workhorse', 'fallback']
  return [role]
}

export const aiConfigured = () => !!(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS)
export const AI_GLOBAL_OFF = () => process.env.AI_DISABLED === '1'
