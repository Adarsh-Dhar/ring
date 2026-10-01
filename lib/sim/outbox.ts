/** Every push and SMS the app tries to send (real or mock), newest first. Shown on /sim. Dev only. */
export interface OutboxItem { t: number; kind: 'push' | 'sms'; to: string; text: string; live: boolean; ok: boolean }
const g = globalThis as unknown as { __outbox?: OutboxItem[] }
const box = (g.__outbox ??= [])
export function record(i: OutboxItem) {
  if (process.env.NODE_ENV === 'production') return
  box.unshift(i)
  if (box.length > 100) box.pop()
}
export const getOutbox = () => box
export const clearOutbox = () => { box.length = 0 }
