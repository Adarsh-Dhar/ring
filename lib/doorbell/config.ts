export interface Helper {
  id: string
  name: string
  phone: string
  emoji: string
}

export const HELPERS: Helper[] = [
  { id: 'h1', name: 'Mom', phone: '+910000000001', emoji: '👩' },
  { id: 'h2', name: 'Brother', phone: '+910000000002', emoji: '👨' },
]

export const DEFAULT_ESCALATION_SECONDS = Number(process.env.ESCALATION_SECONDS || 30)
export const RESULT_TTL_MS = 60_000
export const NO_RESPONSE_TTL_MS = 5 * 60_000
