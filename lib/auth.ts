import crypto from 'crypto'

/**
 * Signed, revocable access tokens. Format:  base64url("role:id:epoch") + "." + base64url(HMAC-SHA256)
 * Revoke by bumping the epoch stored on the server (helper.tokenEpoch / residentEpoch).
 */
export type TokenRole = 'helper' | 'resident'
export interface TokenClaims { role: TokenRole; id: string; epoch: number }

export const IS_PROD = process.env.NODE_ENV === 'production'

function secret(): string | null {
  const s = process.env.AUTH_SECRET
  if (s && s.length >= 16) return s
  if (!IS_PROD) return 'dev-only-insecure-secret-change-me' // local development only
  return null // production without AUTH_SECRET: nothing authenticates (fail closed)
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (payload: string, key: string) => crypto.createHmac('sha256', key).update(payload).digest()

export function makeToken(c: TokenClaims): string | null {
  const key = secret()
  if (!key) return null
  const payload = b64(`${c.role}:${c.id}:${c.epoch}`)
  return `${payload}.${b64(mac(payload, key))}`
}

export function verifyToken(token: string | null | undefined): TokenClaims | null {
  const key = secret()
  if (!key || !token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const want = mac(payload, key)
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !crypto.timingSafeEqual(got as unknown as Uint8Array, want as unknown as Uint8Array)) return null
  const [role, id, epoch] = Buffer.from(payload, 'base64url').toString().split(':')
  if ((role !== 'helper' && role !== 'resident') || !id || !Number.isInteger(Number(epoch))) return null
  return { role, id, epoch: Number(epoch) }
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x as unknown as Uint8Array, y as unknown as Uint8Array)
}

/** Guardian/admin PIN. In production an unset PIN means nobody is admin. */
export function adminPinOk(provided: string | null): boolean {
  const pin = process.env.ADMIN_PIN || process.env.SETUP_PIN
  if (!pin) return !IS_PROD // dev convenience only
  return !!provided && safeEqual(provided, pin)
}
