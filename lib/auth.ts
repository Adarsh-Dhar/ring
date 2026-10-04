import crypto from 'crypto'

export const IS_PROD = process.env.NODE_ENV === 'production'

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
    console.warn('[AUTH] No AUTH_SECRET set – using development placeholder. NEVER use in production.')
    return 'dev-secret-do-not-use-in-production'
  }
  return s
}

export type TokenClaims = {
  kind: string
  sub: string
  householdId: string
  membershipId?: string
  userId?: string
  epoch: number
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
): { ok: true; data: Omit<TokenClaims, 'exp'> } | { ok: false } {
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

    const kind        = claims.kind
    const sub         = claims.sub
    const householdId = claims.householdId
    const epoch       = claims.epoch

    if (typeof kind !== 'string')        return { ok: false }
    if (typeof sub !== 'string')         return { ok: false }
    if (typeof householdId !== 'string') return { ok: false }
    if (typeof epoch !== 'number')       return { ok: false }

    return { ok: true, data: { kind, sub, householdId, epoch } }
  } catch {
    return { ok: false }
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
