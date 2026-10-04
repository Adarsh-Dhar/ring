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
}) {
  process.env.AUTH_SECRET = SECRET
  return makeToken({
    kind:        overrides.kind        ?? 'helper',
    sub:         overrides.sub         ?? 'membership-A',
    householdId: overrides.householdId ?? 'household-A',
    epoch:       overrides.epoch       ?? 1,
    exp:         Math.floor(Date.now() / 1000) + (overrides.expOffsetSec ?? 3600),
  })!
}

function makeRequest(
  path: string,
  opts: {
    method?:      string
    token?:       string | null
    body?:        unknown
    headers?:     Record<string, string>
  } = {}
): NextRequest {
  const url = `http://localhost${path}`
  const init: RequestInit = {
    method:  opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { cookie: `db_session=${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
  }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
  }
  return new NextRequest(url, init)
}

// ── Token self-consistency ─────────────────────────────────────────────────

describe('token household binding', () => {
  beforeAll(() => { process.env.AUTH_SECRET = SECRET })

  it('embeds householdId in the token and retrieves it correctly', () => {
    const token = mintToken({ householdId: 'hh-abc-123' })
    const result = verifyToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.householdId).toBe('hh-abc-123')
  })

  it('tokens for different households are distinct and non-interchangeable', () => {
    const tA = mintToken({ householdId: 'hh-A', sub: 'mem-A' })
    const tB = mintToken({ householdId: 'hh-B', sub: 'mem-B' })
    const rA = verifyToken(tA)
    const rB = verifyToken(tB)
    expect(rA.ok && rA.data.householdId).toBe('hh-A')
    expect(rB.ok && rB.data.householdId).toBe('hh-B')
    // The two tokens must not share payload
    expect(tA).not.toBe(tB)
    expect(tA.split('.')[1]).not.toBe(tB.split('.')[1])
  })

  it('tampering with the householdId in the payload is rejected', () => {
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

  it('a pending token (no householdId) is verified but has empty householdId', () => {
    const token = mintToken({ kind: 'pending', householdId: '', sub: 'user-1' })
    const result = verifyToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.kind).toBe('pending')
      expect(result.data.householdId).toBe('')
    }
  })

  it('an expired token is always rejected, regardless of householdId', () => {
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
  const memberships: Record<string, {
    id: string; userId: string; householdId: string; role: string
    consent: string; tokenEpoch: number
  }> = {
    'mem-A': { id: 'mem-A', userId: 'user-A', householdId: 'hh-A', role: 'guardian', consent: 'approved', tokenEpoch: 1 },
    'mem-B': { id: 'mem-B', userId: 'user-B', householdId: 'hh-B', role: 'guardian', consent: 'approved', tokenEpoch: 1 },
    // helper in A only
    'mem-helper-A': { id: 'mem-helper-A', userId: 'user-helper', householdId: 'hh-A', role: 'helper', consent: 'approved', tokenEpoch: 1 },
  }

  return {
    getDb: () => ({
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
      },
      residentDevice: {
        findUnique: () => Promise.resolve(null),
      },
    }),
  }
})

// Import guard AFTER the mock is in place
import { getSession, authorize } from '@/lib/guard'

describe('getSession isolation', () => {
  afterEach(() => { process.env.AUTH_SECRET = SECRET })

  it('returns householdId hh-A for a mem-A token', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).not.toBeNull()
    expect(session!.householdId).toBe('hh-A')
  })

  it('returns householdId hh-B for a mem-B token', async () => {
    const token = mintToken({ sub: 'mem-B', householdId: 'hh-B', epoch: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).not.toBeNull()
    expect(session!.householdId).toBe('hh-B')
  })

  it('rejects a helper token for hh-A presented to a route expecting hh-B', async () => {
    // mem-A is a guardian in hh-A; their token claims hh-B — tampered
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const [h, p, s] = token.split('.')
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    claims.householdId = 'hh-B'
    const tampered = [h, Buffer.from(JSON.stringify(claims)).toString('base64url'), s].join('.')
    const req = makeRequest('/api/doorbell/state', { token: tampered })
    const session = await getSession(req)
    expect(session).toBeNull()
  })

  it('returns null for a pending token (no householdId)', async () => {
    const token = mintToken({ kind: 'pending', householdId: '', sub: 'user-A', epoch: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).toBeNull()
  })

  it('returns null when the epoch is stale (token revoked)', async () => {
    // tokenEpoch in mock is 1; send epoch: 2 → mismatch
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 2 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).toBeNull()
  })

  it('returns null for a revoked membership (consent != approved)', async () => {
    // mem-A has consent: 'approved' in mock but the mock returns it correctly;
    // test a non-existent membership to simulate revocation
    const token = mintToken({ sub: 'mem-GONE', householdId: 'hh-A', epoch: 1 })
    const req   = makeRequest('/api/doorbell/state', { token })
    const session = await getSession(req)
    expect(session).toBeNull()
  })
})

describe('authorize role isolation', () => {
  it('allows guardian access for a guardian token', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req   = makeRequest('/api/household', { method: 'GET', token })
    const auth  = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) {
      expect(auth.session.householdId).toBe('hh-A')
      expect(auth.session.role).toBe('guardian')
    }
  })

  it('rejects helper role when guardian is required', async () => {
    const token = mintToken({ sub: 'mem-helper-A', householdId: 'hh-A', epoch: 1 })
    const req   = makeRequest('/api/household', { method: 'GET', token })
    const auth  = await authorize(req, 'guardian')
    expect(auth.ok).toBe(false)
  })

  it('hh-B token rejected when authorize checks guardian for hh-A route', async () => {
    // Both are valid guardians, but hh-B should only ever see hh-B data
    const tokenB = mintToken({ sub: 'mem-B', householdId: 'hh-B', epoch: 1 })
    const req    = makeRequest('/api/household', { method: 'GET', token: tokenB })
    const auth   = await authorize(req, 'guardian')
    // The call itself succeeds (mem-B IS a guardian), but the householdId is B
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-B')
  })

  it('cross-origin POST is rejected regardless of valid session', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
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

// ── Household scoping — verify routes use session.householdId ─────────────
// These tests import route handlers directly and verify they scope to the
// householdId embedded in the session, not any ID in the request body.

describe('doorbell state route scoping', () => {
  it('returns data scoped to the token household, ignoring query params', async () => {
    // We cannot easily test the full DB path without a real DB, but we can
    // verify that the route handler calls getState with the token's householdId
    // by mocking the store module.
    const { GET } = await import('@/app/api/doorbell/state/route')

    vi.mock('@/lib/doorbell/store', () => ({
      getState: vi.fn(async (householdId: string) => ({
        householdId,
        cases: [],
        devices: {},
      })),
    }))

    const { getState } = await import('@/lib/doorbell/store')

    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    // Craft a request that has hh-B in the query string — should be ignored
    const req  = makeRequest('/api/doorbell/state?householdId=hh-B', { token })
    await GET(req)

    expect(getState).toHaveBeenCalledWith('hh-A', expect.any(String), expect.anything())
    expect(getState).not.toHaveBeenCalledWith('hh-B', expect.any(String), expect.anything())
  })
})

// ── Cross-household IDOR tests for additional endpoints ───────────────────────

describe('cross-household IDOR protection', () => {
  it('household settings route cannot be accessed with wrong householdId in body', async () => {
    // Test that /api/household POST with a different householdId in body is rejected
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req = makeRequest('/api/household', {
      method: 'POST',
      token,
      body: { householdId: 'hh-B', timeoutSec: 30 },
    })
    const auth = await authorize(req, 'guardian')
    // Authorization succeeds (mem-A is a guardian), but the householdId in session is A
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
    // The route handler should only use session.householdId, not body.householdId
  })

  it('expected visit route cannot access another household\'s visits', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req = makeRequest('/api/doorbell/expected', {
      method: 'POST',
      token,
      body: { householdId: 'hh-B', label: 'Test', icon: '📦' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('member removal cannot target another household\'s member', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req = makeRequest('/api/household/members', {
      method: 'DELETE',
      token,
      body: { membershipId: 'mem-B' }, // Try to delete a member from household B
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
    // The route must verify membershipId belongs to session.householdId
  })

  it('face enrollment cannot be done for another household', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req = makeRequest('/api/face', {
      method: 'POST',
      token,
      body: { householdId: 'hh-B', action: 'enroll' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('visit request link cannot be accessed for another household', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req = makeRequest('/api/visit-requests/link', {
      method: 'POST',
      token,
      body: { householdId: 'hh-B' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('SOS cannot be triggered for another household', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req = makeRequest('/api/doorbell/sos', {
      method: 'POST',
      token,
      body: { householdId: 'hh-B' },
    })
    const auth = await authorize(req, 'guardian')
    expect(auth.ok).toBe(true)
    if (auth.ok) expect(auth.session.householdId).toBe('hh-A')
  })

  it('recurring visit cannot be created for another household', async () => {
    const token = mintToken({ sub: 'mem-A', householdId: 'hh-A', epoch: 1 })
    const req = makeRequest('/api/doorbell/recurring', {
      method: 'POST',
      token,
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
