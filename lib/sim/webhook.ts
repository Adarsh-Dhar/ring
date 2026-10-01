import crypto from 'crypto'

/** Relative imports only: this file is also used by tools/fake-ring (outside Next.js). */
export interface BuildOpts { type: string; deviceId: string; accountId?: string; requestId?: string; extra?: Record<string, unknown> }

/** A Ring Webhook v1.1 body (same shape lib/schemas/webhook.ts parses). */
export function buildWebhook(o: BuildOpts) {
  const ts = Date.now()
  const requestId = o.requestId ?? `sim_${ts}_${Math.random().toString(36).slice(2, 8)}`
  return {
    requestId,
    raw: JSON.stringify({
      meta: { version: '1.1', time: new Date(ts).toISOString(), request_id: requestId, ...(o.accountId ? { account_id: o.accountId } : {}) },
      data: { id: `${o.deviceId}_${o.type}_${ts}`, type: o.type, attributes: { source: o.deviceId, source_type: 'devices', timestamp: ts, ...(o.extra ?? {}) } },
    }),
  }
}

export const sign = (key: string, raw: string) => 'sha256=' + crypto.createHmac('sha256', key).update(raw, 'utf8').digest('hex')

export type SigMode = 'valid' | 'bad' | 'missing'

/** POSTs one webhook the way Ring does. Resolves with the HTTP status (0 = timeout / unreachable). */
export async function postWebhook(url: string, raw: string, key: string | undefined, mode: SigMode = 'valid', timeoutMs = 5000) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (mode === 'valid' && key) headers['X-Signature'] = sign(key, raw)
  if (mode === 'bad') headers['X-Signature'] = sign('wrong-key', raw)
  try {
    const res = await fetch(url, { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(timeoutMs) })
    return { status: res.status, body: await res.text().catch(() => '') }
  } catch { return { status: 0, body: 'unreachable or timed out' } }
}
