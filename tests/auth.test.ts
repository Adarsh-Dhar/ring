import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { makeToken, verifyToken } from '../lib/auth'
import { verifyRingSignature } from '../lib/ring/verify'

describe('tokens', () => {
  it('round-trips and rejects tampering', () => {
    const t = makeToken({ role: 'helper', id: 'h1', epoch: 1 })!
    expect(verifyToken(t)).toEqual({ role: 'helper', id: 'h1', epoch: 1 })
    const [p, s] = t.split('.')
    const forged = Buffer.from('helper:h2:1').toString('base64url') + '.' + s
    expect(verifyToken(forged)).toBeNull()
    expect(verifyToken(p + '.AAAA')).toBeNull()
    expect(verifyToken('garbage')).toBeNull()
    expect(verifyToken(null)).toBeNull()
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
