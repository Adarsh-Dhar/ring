import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { makeToken, verifyToken } from '../lib/auth'
import { verifyRingSignature } from '../lib/ring/verify'

describe('tokens', () => {
  it('round-trips and rejects tampering', () => {
    process.env.AUTH_SECRET = 'a'.repeat(32)
    const t = makeToken({ kind: 'user', sub: 'u1', householdId: 'hh1', epoch: undefined, exp: Math.floor(Date.now() / 1000) + 3600, sessionVersion: 1 })!
    const verified = verifyToken(t)
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      expect(verified.data.kind).toBe('user')
      expect(verified.data.sub).toBe('u1')
      expect(verified.data.householdId).toBe('hh1')
      expect(verified.data.sessionVersion).toBe(1)
    }
    expect(verifyToken('garbage').ok).toBe(false)
    expect(verifyToken(null).ok).toBe(false)
  })
})

describe('Ring webhook signature', () => {
  const key = 'k'.repeat(32)
  const body = '{"meta":{},"data":{"type":"button_press"}}'
  const sig = 'sha256=' + crypto.createHmac('sha256', key).update(body).digest('hex')
  it('accepts a good signature', () => expect(verifyRingSignature(key, body, sig)).toBe(true))
  it('rejects a changed body', () => expect(verifyRingSignature(key, body + ' ', sig)).toBe(false))
  it('rejects missing, short or non-hex signatures', () => {
    expect(verifyRingSignature(key, body, null)).toBe(false)
    expect(verifyRingSignature(key, body, 'sha256=abcd')).toBe(false)
    expect(verifyRingSignature(key, body, 'sha256=' + 'z'.repeat(64))).toBe(false)
  })
})
