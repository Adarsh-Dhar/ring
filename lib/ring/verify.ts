import crypto from 'crypto'

/** Verifies Ring's `X-Signature: sha256=<hex>` header over the RAW request body. */
export function verifyRingSignature(signingKey: string, rawBody: string, header: string | null): boolean {
  if (!header) return false
  const received = header.startsWith('sha256=') ? header.slice(7) : header
  const expected = crypto.createHmac('sha256', signingKey).update(rawBody, 'utf8').digest()
  if (!/^[0-9a-fA-F]+$/.test(received) || received.length !== expected.length * 2) return false
  return crypto.timingSafeEqual(Buffer.from(received, 'hex'), expected)
}
