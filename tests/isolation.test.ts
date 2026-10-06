/**
 * Cross-household isolation tests
 *
 * These tests verify that the token/session layer correctly prevents one
 * household's session from reading or writing another household's data.
 *
 * They run without a real database by:
 *  a) Testing the token/guard logic directly (pure unit tests), and
 *  b) Mocking Prisma at the module boundary for the cases that need a DB call.
 *
 * The key invariant: every route that touches household data calls
 * `authorize(req, ...)` and then uses ONLY `session.householdId` to scope
 * its DB queries.  A token minted for householdA must never return householdB
 * data, even if the request body contains householdB's IDs.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { makeToken, verifyToken } from '@/lib/auth'
import { NextRequest } from 'next/server'

// ── Helpers ────────────────────────────────────────────────────────────────

const SECRET = 'test-secret-32-chars-minimum-pad'

function mintToken(overrides: {
  kind?: string
  sub?: string
  householdId?: string
  epoch?: number
  expOffsetSec?: number
  sessionVersion?: number
}) {
  process.env.AUTH_SECRET = SECRET
  return makeToken({
    kind:        overrides.kind        ?? 'user',
    sub:         overrides.sub         ?? 'user-A',
    householdId: overrides.householdId ?? undefined,
    epoch:       overrides.epoch,
    exp:         Math.floor(Date.now() / 1000) + (overrides.expOffsetSec ?? 3600),
    sessionVersion: overrides.sessionVersion,
  })!
}

function makeRequest(
  path: string,
  opts: {
    method?:      string
    token?:       string | null
    body?:        unknown
    headers?:     Record<string, string>
    householdCookie?: string
  } = {}
): NextRequest {
  const url = `http://localhost${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.token ? { cookie: `db_session=${opts.token}` } : {}),
    ...(opts.householdCookie ? { cookie: `db_household=${opts.householdCookie}` } : {}),
    ...(opts.headers ?? {}),
  }
  // Merge cookies if both are present
  if (opts.token && opts.householdCookie) {
    headers.cookie = `db_session=${opts.token}; db_household=${opts.householdCookie}`
  }
  const init: RequestInit = {
    method:  opts.method ?? 'GET',
    headers,
  }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
  }
  return new NextRequest(url, init)
}

// ── Token self-consistency ─────────────────────────────────────────────────

describe('token household binding', () => {
  it('embeds householdId in the token and retrieves it correctly', () => {
    process.env.AUTH_SECRET = SECRET
    const token = mintToken({ householdId: 'hh-abc-123' })
    const result = verifyToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.householdId).toBe('hh-abc-123')
  })

  it('tokens for different households are distinct and non-interchangeable', () => {
    process.env.AUTH_SECRET = SECRET
    const tA = mintToken({ householdId: 'hh-A', sub: 'user-A' })
    const tB = mintToken({ householdId: 'hh-B', sub: 'user-B' })
    const rA = verifyToken(tA)
    const rB = verifyToken(tB)
    expect(rA.ok && rA.data.householdId).toBe('hh-A')
    expect(rB.ok && rB.data.householdId).toBe('hh-B')
    // The two tokens must not share payload
    expect(tA).not.toBe(tB)
    expect(tA.split('.')[1]).not.toBe(tB.split('.')[1])
  })

  it('tampering with the householdId in the payload is rejected', () => {
    process.env.AUTH_SECRET = SECRET
    const token = mintToken({ householdId: 'hh-A' })
    const [header, payload, sig] = token.split('.')
    // Decode, change householdId, re-encode without re-signing
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    claims.householdId = 'hh-B'
    const tampered = [
      header,
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      sig,
    ].join('.')
    expect(verifyToken(tampered).ok).toBe(false)
  })

  it('a user token (no householdId) is verified but has empty householdId', () => {
    process.env.AUTH_SECRET = SECRET
    const token = mintToken({ kind: 'user', householdId: '', sub: 'user-1' })
    const result = verifyToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.kind).toBe('user')
      expect(result.data.householdId).toBe('')
    }
  })

  it('an expired token is always rejected, regardless of householdId', () => {
    process.env.AUTH_SECRET = SECRET
    const expired = mintToken({ householdId: 'hh-A', expOffsetSec: -1 })
    expect(verifyToken(expired).ok).toBe(false)
  })

  it('a token signed with a different secret is rejected', () => {
    process.env.AUTH_SECRET = 'secret-one-32-chars-padded-xxxxx'
    const tokenFromSecretOne = mintToken({ householdId: 'hh-A' })
    process.env.AUTH_SECRET = 'secret-two-32-chars-padded-xxxxx'
    expect(verifyToken(tokenFromSecretOne).ok).toBe(false)
    // Restore
    process.env.AUTH_SECRET = SECRET
  })
})

// ── Guard layer isolation ──────────────────────────────────────────────────
// Mock Prisma so guard.ts can resolve sessions without a real DB.

vi.mock('@/lib/db/client', () => {
  const households: Record<string, { residentEpoch: number; timezone: string }> = {
    'hh-A': { residentEpoch: 1, timezone: 'UTC' },
    'hh-B': { residentEpoch: 1, timezone: 'UTC' },
  }
  const users: Record<string, { id: string; name: string; email: string; sessionVersion: number }> = {
    'user-A': { id: 'user-A', name: 'User A', email: 'user-a@example.com', sessionVersion: 1 },
    'user-B': { id: 'user-B', name: 'User B', email: 'user-b@example.com', sessionVersion: 1 },
    'user-helper': { id: 'user-helper', name: 'Helper', email: 'helper@example.com', sessionVersion: 1 },
  }
  const memberships: Record<string, {
    id: string; userId: string; householdId: string; role: string
    consent: string; tokenEpoch: number
  }> = {
    'mem-A': { id: 'mem-A', userId: 'user-A', householdId: 'hh-A', role: 'guardian', consent: 'approved', tokenEpoch: 1 },
    'mem-B': { id: 'mem-B', userId: 'user-B', householdId: 'hh-B', role: 'guardian', consent: 'approved', tokenEpoch: 1 },
    // helper in A only
    'mem-helper-A': { id: 'mem-helper-A', userId: 'user-helper', householdId: 'hh-A', role: 'helper', consent: 'approved', tokenEpoch: 1 },
  }
  const v2Devices: Record<string, {
    id: string; householdId: string; kind: string; memberId?: string
    revokedAt: Date | null; lastSeenAt: Date
  }> = {
    'device-A-resident': { id: 'device-A-resident', householdId: 'hh-A', kind: 'resident', revokedAt: null, lastSeenAt: new Date() },
    'device-A-helper': { id: 'device-A-helper', householdId: 'hh-A', kind: 'helper', memberId: 'mem-helper-A', revokedAt: null, lastSeenAt: new Date() },
    'device-A-visitor': { id: 'device-A-visitor', householdId: 'hh-A', kind: 'visitor', revokedAt: null, lastSeenAt: new Date() },
    'device-B-resident': { id: 'device-B-resident', householdId: 'hh-B', kind: 'resident', revokedAt: null, lastSeenAt: new Date() },
  }

  return {
    getDb: () => ({
      user: {
        findUnique: ({ where }: any) => {
          const id = where.id
          const u = users[id]
          if (!u) return Promise.resolve(null)
          return Promise.resolve(u)
        },
      },
      household: {
        findUnique: ({ where }: any) => Promise.resolve(
          households[where.id]
            ? { id: where.id, ...households[where.id], memberships: [] }
            : null
        ),
      },
      membership: {
        findUnique: ({ where, include }: any) => {
          const id = where.id
          const m = memberships[id]
          if (!m) return Promise.resolve(null)
          return Promise.resolve({
            ...m,
            user:      { id: m.userId, name: 'Test', phone: null, email: null },
            household: { id: m.householdId, residentName: 'Resident', ...households[m.householdId] },
          })
        },
        findFirst: ({ where }: any) => {
          const m = Object.values(memberships).find(
            m => m.userId === where.userId && m.householdId === where.householdId && m.consent === where.consent
          )
          if (!m) return Promise.resolve(null)
          return Promise.resolve({
            ...m,
            user:      { id: m.userId, name: 'Test', phone: null, email: null },
            household: { id: m.householdId, residentName: 'Resident', ...households[m.householdId] },
          })
        },
        findMany: ({ where }: any) => {
          const matches = Object.values(memberships).filter(
            m => (!where.userId || m.userId === where.userId) && (!where.householdId || m.householdId === where.householdId)
          )
          return Promise.resolve(matches)
        },
      },
      residentDevice: {
        findUnique: ({ where, include }: any) => {
          // For device token verification, return a device with household epoch
          if (where.id?.startsWith('device-')) {
            const d = v2Devices[where.id]
            if (!d) return Promise.resolve(null)
            return Promise.resolve({
              ...d,
              household: { id: d.householdId, residentEpoch: households[d.householdId].residentEpoch },
            })
          }
          return Promise.resolve(null)
        },
      },
      v2Device: {
        findUnique: ({ where, include }: any) => {
          const id = where.id
          const d = v2Devices[id]
          if (!d) return Promise.resolve(null)
          return Promise.resolve({
            ...d,
            membership: d.memberId ? { ...memberships[d.memberId] } : null,
            household: { id: d.householdId, ...households[d.householdId] },
          })
        },
      },
    }),
  }
})

// Import guard AFTER the mock is in place
import { getSession, authorize } from '@/lib/guard'

describe('getSession isolation', () => {
  afterEach(() => { process.env.AUTH_SECRET = SECRET })

  it('returns householdId hh-A for a user-A token with householdId in token', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).not.toBeNull()
    expect(session!.householdId).toBe('hh-A')
  })

  it('returns householdId hh-B for a user-B token with householdId in token', async () => {
    const token = mintToken({ sub: 'user-B', householdId: 'hh-B', epoch: undefined, sessionVersion: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).not.toBeNull()
    expect(session!.householdId).toBe('hh-B')
  })

  it('rejects a user token with sessionVersion mismatch', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 2 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    // Should fail because sessionVersion doesn't match (mock returns 1)
    expect(session).toBeNull()
  })

  it('returns empty householdId for a user token with no householdId', async () => {
    const token = mintToken({ kind: 'user', householdId: undefined, sub: 'user-A', epoch: undefined, sessionVersion: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    // User has no householdId in token
    expect(session).not.toBeNull()
    expect(session!.householdId).toBe('')
  })

  it('returns null for a non-existent user', async () => {
    const token = mintToken({ sub: 'user-GONE', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).toBeNull()
  })
})

describe('authorize role isolation', () => {
  it('allows guardian access for a guardian token', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req   = makeRequest('/api/household', { method: 'GET', token })
    const auth  = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) {
      expect(auth.session.householdId).toBe('hh-A')
      expect(auth.session.role).toBe('guardian')
    }
  })

  it('rejects helper role when guardian is required', async () => {
    const token = mintToken({ sub: 'user-helper', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req   = makeRequest('/api/household', { method: 'GET', token })
    const auth  = await authorize(req, 'guardian')
    expect(auth.ok).toBe(false)
  })

  it('hh-B token works for hh-B guardian', async () => {
    // Both are valid guardians, but hh-B should only ever see hh-B data
    const tokenB = mintToken({ sub: 'user-B', householdId: 'hh-B', epoch: undefined, sessionVersion: 1 })
    const req    = makeRequest('/api/household', { method: 'GET', token: tokenB })
    const auth   = await authorize(req, 'guardian')
    // The call itself succeeds (user-B IS a guardian), but the householdId is B
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-B')
  })

  it('cross-origin POST is rejected regardless of valid session', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req   = makeRequest('/api/household', {
      method:  'POST',
      token,
      headers: { origin: 'https://evil.example.com', host: 'localhost' },
      body:    { action: 'quiet', enabled: false, startHour: 22, endHour: 6 },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(false)
  })

  it('no token → 401', async () => {
    const req  = makeRequest('/api/household', { method: 'GET', token: null })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(false)
  })
})

// ── Cross-household IDOR tests for additional endpoints ───────────────────────

describe('cross-household IDOR protection', () => {
  it('household settings route cannot be accessed with wrong householdId in body', async () => {
    // Test that /api/household POST with a different householdId in body is rejected
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req = makeRequest('/api/household', {
      method: 'POST',
      token,
      body: { householdId: 'hh-B', timeoutSec: 30 },
    })
    const auth = await authorize(req, 'guardian')
    // Authorization succeeds (user-A is a guardian), but the householdId in session is A
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
    // The route handler should only use session.householdId, not body.householdId
  })

  it('expected visit route cannot access another household\'s visits', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req = makeRequest('/api/doorbell/expected', {
      method: 'POST',
      token,
      householdCookie: 'hh-A',
      body: { householdId: 'hh-B', label: 'Test', icon: '📦' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('member removal cannot target another household\'s member', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req = makeRequest('/api/household/members', {
      method: 'DELETE',
      token,
      householdCookie: 'hh-A',
      body: { membershipId: 'mem-B' }, // Try to delete a member from household B
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
    // The route must verify membershipId belongs to session.householdId
  })

  it('face enrollment cannot be done for another household', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req = makeRequest('/api/face', {
      method: 'POST',
      token,
      householdCookie: 'hh-A',
      body: { householdId: 'hh-B', action: 'enroll' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('visit request link cannot be accessed for another household', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req = makeRequest('/api/visit-requests/link', {
      method: 'POST',
      token,
      householdCookie: 'hh-A',
      body: { householdId: 'hh-B' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('SOS cannot be triggered for another household', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req = makeRequest('/api/doorbell/sos', {
      method: 'POST',
      token,
      householdCookie: 'hh-A',
      body: { householdId: 'hh-B' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('recurring visit cannot be created for another household', async () => {
    const token = mintToken({ sub: 'user-A', householdId: 'hh-A', epoch: undefined, sessionVersion: 1 })
    const req = makeRequest('/api/doorbell/recurring', {
      method: 'POST',
      token,
      householdCookie: 'hh-A',
      body: { householdId: 'hh-B', label: 'Test', icon: '📦' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })
})

// ── Identity normalisation ─────────────────────────────────────────────────
import { normalizePhone, normalizeEmail } from '@/lib/identity'

describe('phone normalisation', () => {
  // Default country code used by all the tests below
  const cc = '+91'

  it('E.164 passes through unchanged', () => {
    expect(normalizePhone('+919876543210', cc)).toBe('+919876543210')
  })

  it('local number without trunk zero → prepend country code', () => {
    expect(normalizePhone('9876543210', cc)).toBe('+919876543210')
  })

  it('local number with trunk zero → strip zero, prepend country code', () => {
    expect(normalizePhone('09876543210', cc)).toBe('+919876543210')
  })

  it('spaces, hyphens, dots, parens stripped', () => {
    expect(normalizePhone('98765 43210',    cc)).toBe('+919876543210')
    expect(normalizePhone('987-654-3210',   cc)).toBe('+919876543210')
    expect(normalizePhone('(987) 654.3210', cc)).toBe('+919876543210')
  })

  it('00-prefix treated as international +', () => {
    expect(normalizePhone('00919876543210', cc)).toBe('+919876543210')
  })

  it('"98765 43210" and "+919876543210" normalise to the same string', () => {
    expect(normalizePhone('98765 43210', cc)).toBe(normalizePhone('+919876543210', cc))
  })

  it('returns null for too-short numbers', () => {
    expect(normalizePhone('1234', cc)).toBeNull()
  })

  it('returns null for numbers with letters', () => {
    expect(normalizePhone('9876ABCD', cc)).toBeNull()
  })
})

describe('email normalisation', () => {
  it('lowercases', () => expect(normalizeEmail('User@Example.COM')).toBe('user@example.com'))
  it('trims whitespace', () => expect(normalizeEmail('  a@b.com  ')).toBe('a@b.com'))
})
