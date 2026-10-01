/**
 * One clock for the whole server. In production it is just Date.now().
 * With ENABLE_SIM=1 (never in production) the simulator can move it forward,
 * so check-ins, quiet hours and recurring visits can be tested without waiting.
 */
const simOk = process.env.ENABLE_SIM === '1' && process.env.NODE_ENV !== 'production'
const g = globalThis as unknown as { __clockOffset?: number }
g.__clockOffset ??= 0

export const now = () => Date.now() + (g.__clockOffset ?? 0)
export const clockOffset = () => g.__clockOffset ?? 0
export function advanceClock(ms: number) { if (simOk) g.__clockOffset = (g.__clockOffset ?? 0) + ms }
export function resetClock() { g.__clockOffset = 0 }
