// @ts-nocheck
import crypto from 'crypto'

const SECRET = process.env.AUTH_SECRET
export const IS_PROD = process.env.NODE_ENV === 'production'

export function makeToken(claims: { kind: string; sub: string; householdId: string; epoch: number; exp: number }): string | null {
  if (!SECRET) {
    if (IS_PROD) return null
    console.warn('[AUTH] No AUTH_SECRET set, using development mode')
  }
  const key = SECRET || 'dev-secret-do-not-use-in-production'
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const data = `${header}.${payload}`
  const sig = crypto.createHmac('sha256', key).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyToken(token: string | null): { ok: true; data: { kind: string; sub: string; householdId: string; epoch: number } } | { ok: false } {
  if (!token) return { ok: false }
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false }
  const [header, payload, sig] = parts

  const key = SECRET || 'dev-secret-do-not-use-in-production'
  const data = `${header}.${payload}`
  const expectedSig = crypto.createHmac('sha256', key).update(data).digest('base64url')
  if (sig !== expectedSig) return { ok: false }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return { ok: false }
    return { ok: true, data: { kind: claims.kind, sub: claims.sub, householdId: claims.householdId, epoch: claims.epoch } }
  } catch { return { ok: false } }
}

function encKey(): Buffer | null {
  const k = process.env.TOKEN_ENC_KEY
  if (!k) return null
  try {
    return Buffer.from(k, 'base64url')
  } catch { return null }
}

// @ts-ignore - Buffer/Uint8Array compatibility issues with Node.js types
export function encrypt(plaintext: string): string | null {
  const key = encKey()
  if (!key || key.length !== 32) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key as any, iv as any)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url')
}

// @ts-ignore - Buffer/Uint8Array compatibility issues with Node.js types
export function decrypt(ciphertext: string): string | null {
  const key = encKey()
  if (!key || key.length !== 32) return null
  try {
    const buf = Buffer.from(ciphertext, 'base64url')
    if (buf.length < 28) return null // 12 iv + 16 tag + at least 1 byte data
    const iv = buf.subarray(0, 12)
    const authTag = buf.subarray(12, 28)
    const encrypted = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key as any, iv as any)
    decipher.setAuthTag(authTag as any)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch { return null }
}
