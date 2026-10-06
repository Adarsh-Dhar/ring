import crypto from 'crypto'
import os from 'os'

export const IS_PROD = process.env.NODE_ENV === 'production'

// Module-level constant for dev secret (stable per process)
const DEV_SECRET = `dev-${os.hostname()}`
let devSecretWarned = false

// ---------------------------------------------------------------------------
// JWT-like tokens (hand-rolled HS256, no third-party JWT library)
// ---------------------------------------------------------------------------

/** Throws at startup in production when AUTH_SECRET is missing. */
function getSecret(): string {
  const s = process.env.AUTH_SECRET
  if (!s) {
    if (IS_PROD) {
      throw new Error('AUTH_SECRET environment variable must be set in production')
    }
    if (!devSecretWarned) {
      console.warn(`[AUTH] No AUTH_SECRET set – using development placeholder for ${os.hostname()}. NEVER use in production.`)
      devSecretWarned = true
    }
    return DEV_SECRET
  }
  return s
}

export type TokenClaims = {
  kind: string
  sub: string
  householdId?: string
  membershipId?: string
  userId?: string
  epoch?: number
  sessionVersion?: number
  exp: number   // required – Unix seconds
}

export function makeToken(claims: TokenClaims): string | null {
  let key: string
  try { key = getSecret() } catch { return null }
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const data    = `${header}.${payload}`
  const sig     = crypto.createHmac('sha256', key).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyToken(
  token: string | null
): { ok: true; data: TokenClaims } | { ok: false } {
  if (!token) return { ok: false }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false }
  const [header, payload, sig] = parts

  let key: string
  try { key = getSecret() } catch { return { ok: false } }

  const data        = `${header}.${payload}`
  const expectedSig = crypto.createHmac('sha256', key).update(data).digest('base64url')

  // Constant-time comparison to prevent timing attacks
  const sigBuf      = Buffer.from(sig,         'base64url') as unknown as Uint8Array
  const expectedBuf = Buffer.from(expectedSig, 'base64url') as unknown as Uint8Array
  if (sigBuf.length !== expectedBuf.length) return { ok: false }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return { ok: false }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>

    // exp is REQUIRED – tokens without an expiry are rejected
    if (typeof claims.exp !== 'number') return { ok: false }
    if (claims.exp < Math.floor(Date.now() / 1000)) return { ok: false }

    const kind = claims.kind
    const sub = claims.sub
    const householdId = claims.householdId
    const epoch = claims.epoch
    const membershipId = claims.membershipId
    const userId = claims.userId as string | undefined
    const sessionVersion = claims.sessionVersion

    if (typeof kind !== 'string') return { ok: false }
    if (typeof sub !== 'string') return { ok: false }
    if (householdId !== undefined && typeof householdId !== 'string') return { ok: false }
    if (epoch !== undefined && typeof epoch !== 'number') return { ok: false }
    if (membershipId !== undefined && typeof membershipId !== 'string') return { ok: false }
    if (userId !== undefined && typeof userId !== 'string') return { ok: false }
    if (sessionVersion !== undefined && typeof sessionVersion !== 'number') return { ok: false }

    return { ok: true, data: { kind, sub, householdId: householdId as string | undefined, epoch: epoch as number | undefined, membershipId: membershipId as string | undefined, userId, sessionVersion: sessionVersion as number | undefined, exp: claims.exp as number } }
  } catch {
    return { ok: false }
  }
}

export function sign(claims: TokenClaims): string | null {
  return makeToken(claims)
}

export function createSession(userId: string, kind: 'user' | 'helper' | 'resident', householdId: string = '', membershipId?: string, sessionVersion: number = 1): TokenClaims {
  return {
    kind,
    sub: userId,
    householdId: householdId || undefined,
    membershipId,
    userId,
    epoch: kind === 'resident' ? 0 : undefined,
    sessionVersion: kind === 'user' ? sessionVersion : undefined,
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30), // 30 days
  }
}

// ---------------------------------------------------------------------------
// AES-256-GCM envelope encryption (for Ring OAuth tokens at rest)
// ---------------------------------------------------------------------------

function encKey(): Buffer | null {
  const k = process.env.TOKEN_ENC_KEY
  if (!k) return null
  try {
    const buf = Buffer.from(k, 'base64url')
    return buf.length === 32 ? buf : null
  } catch {
    return null
  }
}

export function encrypt(plaintext: string): string | null {
  const key = encKey()
  if (!key) return null
  const iv        = crypto.randomBytes(12)
  const cipher    = crypto.createCipheriv('aes-256-gcm', key as unknown as Uint8Array, iv as unknown as Uint8Array)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8') as unknown as Uint8Array, cipher.final() as unknown as Uint8Array])
  const authTag   = cipher.getAuthTag()
  return Buffer.concat([iv as unknown as Uint8Array, authTag as unknown as Uint8Array, encrypted as unknown as Uint8Array]).toString('base64url')
}

export function decrypt(ciphertext: string): string | null {
  const key = encKey()
  if (!key) return null
  try {
    const buf = Buffer.from(ciphertext, 'base64url')
    if (buf.length < 29) return null   // 12 iv + 16 tag + 1 byte minimum
    const iv        = buf.subarray(0, 12)
    const authTag   = buf.subarray(12, 28)
    const encrypted = buf.subarray(28)
    const decipher  = crypto.createDecipheriv('aes-256-gcm', key as unknown as Uint8Array, iv as unknown as Uint8Array)
    decipher.setAuthTag(authTag as unknown as Uint8Array)
    return Buffer.concat([decipher.update(encrypted as unknown as Uint8Array) as unknown as Uint8Array, decipher.final() as unknown as Uint8Array]).toString('utf8')
  } catch {
    return null
  }
}
