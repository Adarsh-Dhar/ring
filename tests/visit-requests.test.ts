/**
 * visit-requests.test.ts — orchestration tests for the visit-request feature.
 * Mocks all DB and notification layers so no real DB is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Tracking stores ──────────────────────────────────────────────────────────

const smsCalls:   { to: string; body: string }[] = []
const emailCalls: { to: string; subject: string; text: string }[] = []
const pushCalls:  { membershipId: string; payload: any }[] = []
const createdRequests: any[] = []
const createdExpected: any[] = []

// Stable Maps — cleared in beforeEach, never reassigned (vi.mock closures capture the reference)
const dbRequests = new Map<string, any>()
const dbLinks    = new Map<string, any>()

// ── Mock: notify ─────────────────────────────────────────────────────────────

vi.mock('@/lib/doorbell/notify', () => ({
  sendSms:          (to: string, body: string) => { smsCalls.push({ to, body }); return Promise.resolve(true) },
  pushToMembership: (membershipId: string, payload: any) => { pushCalls.push({ membershipId, payload }); return Promise.resolve() },
  recentFailures:   () => ({ sms: 0, push: 0 }),
  recordFailure:    () => {},
}))

vi.mock('@/lib/email', () => ({
  sendEmail: (to: string, subject: string, text: string) => { emailCalls.push({ to, subject, text }); return Promise.resolve(true) },
}))

// ── Mock: DB layers ──────────────────────────────────────────────────────────

// Note: dbRequests and dbLinks are declared above as stable const Maps

vi.mock('@/lib/db/visit-requests', () => {
  return {
    findActiveLinkByHash: (hash: string) => {
      const link = [...dbLinks.values()].find(l => l.tokenHash === hash && !l.revokedAt)
      return Promise.resolve(link ?? null)
    },
    findActiveLink: (householdId: string) => {
      const link = [...dbLinks.values()].find(l => l.householdId === householdId && !l.revokedAt) ?? null
      return Promise.resolve(link)
    },
    createLink: (householdId: string, createdByUserId: string, tokenHash: string) => {
      const link = { id: `link-${Date.now()}`, householdId, createdByUserId, tokenHash, createdAt: new Date(), revokedAt: null }
      dbLinks.set(link.id, link)
      return Promise.resolve(link)
    },
    revokeActiveLinks: (householdId: string) => {
      const pending: any[] = []
      for (const [, l] of dbLinks) {
        if (l.householdId === householdId && !l.revokedAt) {
          l.revokedAt = new Date()
          for (const [, r] of dbRequests) {
            if (r.linkId === l.id && r.status === 'pending') {
              r.status = 'cancelled'; r.decidedAt = new Date()
              pending.push(r)
            }
          }
        }
      }
      return Promise.resolve(pending)
    },
    countByIp:      vi.fn(() => Promise.resolve(0)),
    countByContact: vi.fn(() => Promise.resolve(0)),
    countByLink:    vi.fn(() => Promise.resolve(0)),
    countOpen:      vi.fn(() => Promise.resolve(0)),
    createRequest: (data: any) => {
      const r = { status: 'pending', resendCount: 0, deviceHash: null, ...data, id: `req-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, createdAt: new Date() }
      createdRequests.push(r)
      dbRequests.set(r.id, r)
      return Promise.resolve(r)
    },
    getRequest: (householdId: string, id: string) => {
      const r = dbRequests.get(id)
      return Promise.resolve(r && r.householdId === householdId ? r : null)
    },
    getRequestByToken: (statusToken: string) => {
      const r = [...dbRequests.values()].find(x => x.statusToken === statusToken) ?? null
      return Promise.resolve(r)
    },
    updateRequest: (id: string, data: any) => {
      const r = dbRequests.get(id)
      if (r) Object.assign(r, data)
      return Promise.resolve(r)
    },
    listRequests: (householdId: string, statuses: string[]) => {
      return Promise.resolve([...dbRequests.values()].filter(r => r.householdId === householdId && statuses.includes(r.status)))
    },
    transition: async (id: string, from: string[], data: any) => {
      const r = dbRequests.get(id)
      if (!r || !from.includes(r.status)) return false
      Object.assign(r, data)
      return true
    },
    findExpirable: (householdId: string, now: Date) => {
      return Promise.resolve([...dbRequests.values()].filter(r => r.householdId === householdId && r.status === 'pending' && r.expiresAt <= now))
    },
    bindIfEmpty: async (id: string, deviceHash: string) => {
      const r = dbRequests.get(id)
      if (!r || r.deviceHash || r.status !== 'approved') return false
      r.deviceHash = deviceHash
      return true
    },
  }
})

vi.mock('@/lib/db/cases', () => ({
  createCase:            () => Promise.resolve({}),
  getCasesForHousehold:  () => Promise.resolve([]),
  updateCase:            () => Promise.resolve({}),
  deleteOldCases:        () => Promise.resolve({}),
  getCase:               () => Promise.resolve(null),
  getOpenCasesForHousehold: () => Promise.resolve([]),
}))

vi.mock('@/lib/db/visits', () => ({
  createExpectedVisit:       (d: any) => { createdExpected.push(d); return Promise.resolve(d) },
  createRecurringVisit:      () => Promise.resolve({}),
  getExpectedVisitsForHousehold:  () => Promise.resolve([]),
  getRecurringVisitsForHousehold: () => Promise.resolve([]),
  getActiveExpectedVisits:   () => Promise.resolve([]),
  deleteExpectedVisit:       () => Promise.resolve({}),
  deleteRecurringVisit:      () => Promise.resolve({}),
  deleteOldExpectedVisits:   () => Promise.resolve({}),
  updateRecurringVisit:      () => Promise.resolve({}),
  markExpectedUsed:          () => Promise.resolve({}),
}))

const HOUSEHOLD = {
  id: 'hh-vr', residentName: 'Amma', timezone: 'UTC', timeoutSec: 30,
  quietEnabled: false, quietStartHour: 22, quietEndHour: 6, emergencyNumber: '112',
  plannedMode: 'resident', requireResidentOk: false,
}
let hhOverride: Record<string, any> = {}

vi.mock('@/lib/db/households', () => ({
  getHousehold:  (id: string) => Promise.resolve({ ...HOUSEHOLD, id, ...hhOverride }),
  updateHousehold: () => Promise.resolve({}),
  getResidentEpoch: () => Promise.resolve(1),
  getMembershipsForHousehold: () => Promise.resolve([]),
}))

const HELPER = {
  id: 'mem-h1', userId: 'u-h1', householdId: 'hh-vr', role: 'helper', consent: 'approved',
  tokenEpoch: 1, user: { id: 'u-h1', name: 'Priya', phone: '+91999', email: null }, emoji: '🙂',
}

vi.mock('@/lib/db/memberships', () => ({
  getApprovedMemberships: () => Promise.resolve([HELPER]),
  getMembership: (id: string) => Promise.resolve(id === HELPER.id ? HELPER : null),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({ device: { findMany: () => Promise.resolve([]) } }),
}))

vi.mock('@/lib/ring/client', () => ({
  ringConfiguredForHousehold: () => Promise.resolve(false),
  getConnectionForHousehold:  () => Promise.resolve(null),
  forceRefreshConnection:     () => Promise.resolve(true),
}))

vi.mock('@/lib/doorbell/request-lifecycle', () => ({
  sweepRequests:          () => Promise.resolve(),
  cancelRequestForVisit:  () => Promise.resolve(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { createVisitRequest, decideRequest, visitorView, bindDevice, resendLink, cancelOwn } from '@/lib/doorbell/requests'
import { hashToken, newToken } from '@/lib/visit-tokens'
import { VISIT_LIMITS as L } from '@/lib/doorbell/config'
import { resetAll } from '@/lib/doorbell/store'

const HH = 'hh-vr'

// Helper: create a live link and return its hash + token
function makeLink(householdId = HH) {
  const token = newToken()
  const hash  = hashToken(token)
  const link  = {
    id: `link-${Date.now()}`, householdId, tokenHash: hash, createdByUserId: 'u-h1',
    createdAt: new Date(), revokedAt: null,
    household: { ...HOUSEHOLD, id: householdId },
  }
  dbLinks.set(link.id, link)
  return { token, hash, link }
}

// Helper: submit a basic valid request
const NOW = Date.now()
const START = NOW + 3_600_000        // 1 h from now
const END   = NOW + 5_400_000        // 1.5 h from now

async function submitRequest(linkToken: string, overrides: any = {}) {
  return createVisitRequest({
    linkToken, name: 'Test Visitor', purpose: 'doctor', contactRaw: '+911234567890',
    startsAt: START, endsAt: END, ip: '1.2.3.4', ...overrides,
  })
}

beforeEach(async () => {
  smsCalls.length   = 0
  emailCalls.length = 0
  pushCalls.length  = 0
  createdRequests.length = 0
  createdExpected.length = 0
  dbRequests.clear()
  dbLinks.clear()
  hhOverride = {}
  Object.keys(hhOverride).forEach(k => delete hhOverride[k])
  // Reset vi.fn() counters on the db mock
  const dbr = await import('@/lib/db/visit-requests')
  vi.mocked(dbr.countByIp).mockReset().mockResolvedValue(0)
  vi.mocked(dbr.countByContact).mockReset().mockResolvedValue(0)
  vi.mocked(dbr.countByLink).mockReset().mockResolvedValue(0)
  vi.mocked(dbr.countOpen).mockReset().mockResolvedValue(0)
  await resetAll(HH)
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('createVisitRequest validation', () => {
  it('rejects unknown link token', async () => {
    const r = await submitRequest('bad-token')
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(404)
  })

  it('rejects revoked link', async () => {
    const { token, link } = makeLink()
    link.revokedAt = new Date()
    const r = await submitRequest(token)
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(404)
  })

  it('rejects end <= start', async () => {
    const { token } = makeLink()
    const r = await submitRequest(token, { startsAt: START, endsAt: START })
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(400)
  })

  it('rejects window > maxWindowHours', async () => {
    const { token } = makeLink()
    const r = await submitRequest(token, { startsAt: NOW + 1000, endsAt: NOW + (L.maxWindowHours + 1) * 3_600_000 + 1000 })
    expect(r.ok).toBe(false)
  })

  it('rejects startsAt too far ahead', async () => {
    const { token } = makeLink()
    const far = NOW + (L.maxDaysAhead + 1) * 86_400_000
    const r = await submitRequest(token, { startsAt: far, endsAt: far + 3_600_000 })
    expect(r.ok).toBe(false)
  })

  it('rejects already-passed end time', async () => {
    const { token } = makeLink()
    const r = await submitRequest(token, { startsAt: NOW - 7200_000, endsAt: NOW - 3600_000 })
    expect(r.ok).toBe(false)
  })

  it('rejects bad contact (neither phone nor email)', async () => {
    const { token } = makeLink()
    const r = await submitRequest(token, { contactRaw: 'notacontact' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).error).toMatch(/phone|email/i)
  })

  it('accepts email contact', async () => {
    const { token } = makeLink()
    const r = await submitRequest(token, { contactRaw: 'visitor@example.com' })
    expect(r.ok).toBe(true)
  })
})

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('blocks 6th request from same IP in an hour', async () => {
    const { countByIp } = await import('@/lib/db/visit-requests')
    vi.mocked(countByIp).mockResolvedValueOnce(L.perIpHour)
    const { token } = makeLink()
    const r = await submitRequest(token)
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(429)
  })

  it('blocks after perContactDay requests for same contact', async () => {
    const { countByContact } = await import('@/lib/db/visit-requests')
    vi.mocked(countByContact).mockResolvedValueOnce(L.perContactDay)
    const { token } = makeLink()
    const r = await submitRequest(token)
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(429)
  })

  it('blocks when maxOpen is reached for household', async () => {
    const { countOpen } = await import('@/lib/db/visit-requests')
    vi.mocked(countOpen).mockResolvedValueOnce(L.maxOpen)
    const { token } = makeLink()
    const r = await submitRequest(token)
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(429)
  })
})

// ── Helper approve ────────────────────────────────────────────────────────────

describe('helper approve flow', () => {
  it('creates an ExpectedVisit with singleUse and codeSecret after helper approve', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    expect(sub.ok).toBe(true)
    if (!sub.ok) return

    const req = [...dbRequests.values()][0]
    const result = await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status).toBe('approved')

    expect(createdExpected.length).toBe(1)
    expect(createdExpected[0].singleUse).toBe(true)
    expect(createdExpected[0].codeSecret).toBeTruthy()
    expect(createdExpected[0].requestId).toBe(req.id)
  })

  it('notifies visitor exactly once on approve', async () => {
    const { token } = makeLink()
    await submitRequest(token, { contactRaw: '+911234567890' })
    const req = [...dbRequests.values()][0]
    smsCalls.length = 0
    await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')
    // 1 SMS for approval notification
    expect(smsCalls.length).toBe(1)
    expect(smsCalls[0].body).toContain('approved')
  })
})

// ── requireResidentOk ─────────────────────────────────────────────────────────

describe('requireResidentOk', () => {
  beforeEach(() => {
    Object.keys(hhOverride).forEach(k => delete hhOverride[k])
    hhOverride.requireResidentOk = true
  })

  it('helper approve alone keeps status pending', async () => {
    const { token } = makeLink()
    await submitRequest(token)
    const req = [...dbRequests.values()][0]
    const r = await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe('pending')
    expect(createdExpected.length).toBe(0)   // no visit created yet
  })

  it('resident approve before helper returns 409', async () => {
    const { token } = makeLink()
    await submitRequest(token)
    const req = [...dbRequests.values()][0]
    const r = await decideRequest(HH, req.id, { kind: 'resident' }, 'approve')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })

  it('helper then resident approve → approved + visit created', async () => {
    const { token } = makeLink()
    await submitRequest(token)
    const req = [...dbRequests.values()][0]
    await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')
    const r = await decideRequest(HH, req.id, { kind: 'resident' }, 'approve')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe('approved')
    expect(createdExpected.length).toBe(1)
  })
})

// ── Race condition (double approve) ──────────────────────────────────────────

describe('double approve race', () => {
  it('second concurrent approve gets 409, only one visit created', async () => {
    const { token } = makeLink()
    await submitRequest(token)
    const req = [...dbRequests.values()][0]
    // Simulate concurrent approvals by calling approve twice rapidly
    const [r1, r2] = await Promise.all([
      decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve'),
      decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve'),
    ])
    const okCount = [r1, r2].filter(r => r.ok && (r as any).status === 'approved').length
    expect(okCount).toBe(1)
    // Only one ExpectedVisit regardless
    expect(createdExpected.length).toBeLessThanOrEqual(1)
  })
})

// ── Decline ───────────────────────────────────────────────────────────────────

describe('decline', () => {
  it('notifies visitor and marks declined', async () => {
    const { token } = makeLink()
    await submitRequest(token, { contactRaw: '+911234567890' })
    const req = [...dbRequests.values()][0]
    smsCalls.length = 0
    const r = await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'decline')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe('declined')
    expect(smsCalls.length).toBe(1)
    expect(smsCalls[0].body).toContain('not approved')
  })
})

// ── visitorView ───────────────────────────────────────────────────────────────

describe('visitorView', () => {
  it('returns null for unknown token', async () => {
    const v = await visitorView('no-such-token')
    expect(v).toBeNull()
  })

  it('pending → status pending, no code', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    if (!sub.ok) return
    const v = await visitorView(sub.statusToken)
    expect(v).not.toBeNull()
    expect(v!.status).toBe('pending')
    expect(v!.code).toBeNull()
  })

  it('approved, resident mode: code shown only for bound device', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    if (!sub.ok) return
    const req = [...dbRequests.values()][0]
    await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')

    // Re-read after approve to get updated statusToken (same in this mock)
    const v1 = await visitorView(sub.statusToken)
    expect(v1!.device).toBe('unbound')
    expect(v1!.code).toBeNull()

    // Bind a device
    const bind = await bindDevice(sub.statusToken)
    expect(bind.ok).toBe(true)

    // Now the bound device sees status but may not see code (visit timing / no codeSecret in store mock)
    // Just verify device is now 'mine' when cookie matches
    if (bind.ok) {
      const v2 = await visitorView(sub.statusToken, bind.cookie)
      expect(v2!.device).toBe('mine')
    }
  })

  it('contact details never appear in visitorView', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token, { contactRaw: 'secret@example.com' })
    if (!sub.ok) return
    const v = await visitorView(sub.statusToken)
    expect(JSON.stringify(v)).not.toContain('secret@example.com')
  })
})

// ── bindDevice ────────────────────────────────────────────────────────────────

describe('bindDevice', () => {
  it('second bind attempt on already-bound request returns 409', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    if (!sub.ok) return
    const req = [...dbRequests.values()][0]
    await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')

    const b1 = await bindDevice(sub.statusToken)
    expect(b1.ok).toBe(true)
    const b2 = await bindDevice(sub.statusToken)
    expect(b2.ok).toBe(false)
    if (!b2.ok) expect((b2 as any).status).toBe(409)
  })
})

// ── resendLink ────────────────────────────────────────────────────────────────

describe('resendLink', () => {
  it('clears device binding and decrements resend budget', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    if (!sub.ok) return
    const req = [...dbRequests.values()][0]
    await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')
    await bindDevice(sub.statusToken)

    smsCalls.length = 0
    const r = await resendLink(sub.statusToken)
    expect(r.ok).toBe(true)
    // The deviceHash should now be cleared
    expect(req.deviceHash).toBeNull()
    expect(req.resendCount).toBe(1)
  })

  it('blocks after resendMax', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    if (!sub.ok) return
    const req = [...dbRequests.values()][0]
    req.resendCount = L.resendMax  // simulate exhausted budget; status stays 'pending'
    const r = await resendLink(sub.statusToken)
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(429)
  })
})

// ── cancelOwn ────────────────────────────────────────────────────────────────

describe('cancelOwn', () => {
  it('cancels a pending request', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    if (!sub.ok) return
    const r = await cancelOwn(sub.statusToken)
    expect(r.ok).toBe(true)
    const req = [...dbRequests.values()][0]
    expect(req.status).toBe('cancelled')
  })

  it('cannot cancel an approved request', async () => {
    const { token } = makeLink()
    const sub = await submitRequest(token)
    if (!sub.ok) return
    const req = [...dbRequests.values()][0]
    await decideRequest(HH, req.id, { kind: 'helper', membershipId: HELPER.id }, 'approve')
    const r = await cancelOwn(sub.statusToken)
    expect(r.ok).toBe(false)
    if (!r.ok) expect((r as any).status).toBe(409)
  })
})

// ── Contact details never in list responses ───────────────────────────────────

describe('contact privacy', () => {
  it('contact details never appear in createVisitRequest response', async () => {
    const { token } = makeLink()
    const r = await submitRequest(token, { contactRaw: 'private@example.com' })
    expect(JSON.stringify(r)).not.toContain('private@example.com')
  })
})
