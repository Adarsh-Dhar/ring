/**
 * requests.ts — Visit-request orchestration.
 *
 * This file MAY import store.ts. The reverse is not allowed (store.ts imports
 * request-lifecycle.ts instead to avoid a circular dependency).
 */
import { getHousehold } from '../db/households'
import { getApprovedMemberships } from '../db/memberships'
import * as dbr from '../db/visit-requests'
import { addExpectedFromRequest, visitCodeFor } from './store'
import { pushToMembership } from './notify'
import { sweepRequests } from './request-lifecycle'
import { notifyVisitor, msgs, firstName, statusUrl } from '../visitor-notify'
import { normalizePhone, normalizeEmail } from '../identity'
import { newToken, newDeviceId, hashToken } from '../visit-tokens'
import { PURPOSES, type Purpose } from './purposes'
import { VISIT_LIMITS as L } from './config'

type Err = { ok: false; error: string; status: number }
const err = (error: string, status = 400): Err => ({ ok: false, error, status })

// ── createVisitRequest ────────────────────────────────────────────────────────

export async function createVisitRequest(i: {
  linkToken:   string
  name:        string
  purpose:     Purpose
  note?:       string
  contactRaw:  string
  startsAt:    number
  endsAt:      number
  ip:          string
}): Promise<{ ok: true; statusToken: string } | Err> {
  const link = await dbr.findActiveLinkByHash(hashToken(i.linkToken))
  if (!link) return err('This link is no longer active.', 404)

  const now = Date.now()
  if (i.endsAt <= i.startsAt)                                       return err('The end time must be after the start.')
  if (i.endsAt <= now)                                              return err('That time has already passed.')
  if (i.endsAt - i.startsAt > L.maxWindowHours * 3_600_000)        return err('Please pick a shorter time window.')
  if (i.startsAt > now + L.maxDaysAhead * 86_400_000)              return err('That is too far ahead.')

  const phone = normalizePhone(i.contactRaw)
  const email = !phone && i.contactRaw.includes('@') ? normalizeEmail(i.contactRaw) : null
  if (!phone && !email) return err('Enter a phone number or an email address.')
  const contact = (phone ?? email)!
  const contactKind = phone ? 'sms' : 'email'

  const hour = new Date(now - 3_600_000)
  const day  = new Date(now - 86_400_000)
  if (await dbr.countByIp(i.ip, hour)                                 >= L.perIpHour)     return err('Too many requests. Try again later.', 429)
  if (await dbr.countByContact(link.householdId, contact, day)        >= L.perContactDay) return err('Too many requests for this contact today.', 429)
  if (await dbr.countByLink(link.id, day)                             >= L.perLinkDay)    return err('This link is busy. Try again later.', 429)
  if (await dbr.countOpen(link.householdId)                           >= L.maxOpen)       return err('Too many requests are waiting. Ask the family.', 429)

  const statusToken = newToken()
  const r = await dbr.createRequest({
    householdId: link.householdId,
    linkId:      link.id,
    name:        i.name,
    purpose:     i.purpose,
    note:        i.note ?? null,
    contact,
    contactKind,
    startsAt:    new Date(i.startsAt),
    endsAt:      new Date(i.endsAt),
    statusToken,
    ip:          i.ip,
    expiresAt:   new Date(Math.min(now + L.ttlHours * 3_600_000, i.endsAt)),
  })

  // Quiet push to all helpers — no SMS; a request is not urgent
  const p = PURPOSES[i.purpose] ?? PURPOSES.other
  getApprovedMemberships(link.householdId)
    .then(ms => ms.forEach(m =>
      pushToMembership(m.id, {
        title: `📩 ${i.name} asks to visit`,
        body:  `${p.icon} ${p.label}. Open the app to approve.`,
        tag:   `req:${r.id}`,
        url:   '/helper',
      })
    ))
    .catch(() => {})

  return { ok: true, statusToken }
}

// ── decideRequest ─────────────────────────────────────────────────────────────

export async function decideRequest(
  householdId:  string,
  id:           string,
  by:           { kind: 'helper' | 'resident'; membershipId?: string },
  decision:     'approve' | 'decline'
): Promise<{ ok: true; status: string } | Err> {
  const r  = await dbr.getRequest(householdId, id)
  const hh = await getHousehold(householdId)
  if (!r || !hh) return err('Not found.', 404)

  const now = Date.now()
  if (r.status !== 'pending')              return err('Already decided.', 409)
  if (r.expiresAt.getTime() <= now) {
    await sweepRequests(householdId, now)
    return err('This request expired.', 410)
  }

  const who = firstName(hh.residentName)

  if (decision === 'decline') {
    if (!(await dbr.transition(id, ['pending'], { status: 'declined', decidedAt: new Date(now) })))
      return err('Already decided.', 409)
    notifyVisitor(r, msgs.declined(who)).catch(() => {})
    return { ok: true, status: 'declined' }
  }

  // approve path
  if (by.kind === 'helper') {
    if (!r.helperOkAt) {
      await dbr.updateRequest(id, { helperOkAt: new Date(now), helperOkBy: by.membershipId ?? null })
    }
  } else {
    // resident
    if (!r.helperOkAt)         return err('A helper must approve first.', 409)
    if (!(hh as any).requireResidentOk) return err('Resident approval is not required.', 409)
    if (!r.residentOkAt) {
      await dbr.updateRequest(id, { residentOkAt: new Date(now) })
    }
  }

  // Re-read to check both gates
  const f = (await dbr.getRequest(householdId, id))!
  const ready = !!f.helperOkAt && (!(hh as any).requireResidentOk || !!f.residentOkAt)
  if (!ready) return { ok: true, status: 'pending' }

  // Both gates passed — transition to approved and create the ExpectedVisit
  if (!(await dbr.transition(id, ['pending'], { status: 'approved', decidedAt: new Date(now) })))
    return err('Already decided.', 409)

  try {
    const e = await addExpectedFromRequest(householdId, {
      requestId: id,
      name:      f.name,
      purpose:   f.purpose as Purpose,
      startsAt:  f.startsAt.getTime(),
      endsAt:    f.endsAt.getTime(),
    })
    await dbr.updateRequest(id, { expectedVisitId: e.id })
  } catch (e) {
    // Roll back so a helper can retry
    await dbr.updateRequest(id, { status: 'pending' })
    throw e
  }

  notifyVisitor(f, msgs.approved(who, f.startsAt, f.endsAt, statusUrl(f.statusToken))).catch(() => {})
  return { ok: true, status: 'approved' }
}

// ── visitorView ───────────────────────────────────────────────────────────────

/**
 * What the visitor's status page may see.
 * The code is only shown when: approved + bound cookie matches + resident mode + inside window + not used.
 */
export async function visitorView(statusToken: string, deviceCookie?: string) {
  let r = await dbr.getRequestByToken(statusToken)
  if (!r) return null

  // Lazy expiry sweep when the visitor opens their status page
  if (r.status === 'pending' && r.expiresAt.getTime() <= Date.now()) {
    await sweepRequests(r.householdId)
    r = (await dbr.getRequestByToken(statusToken))!
  }

  const hh = await getHousehold(r.householdId)
  const base = {
    status:      r.status,
    name:        r.name,
    purpose:     r.purpose,
    startsAt:    r.startsAt.getTime(),
    endsAt:      r.endsAt.getTime(),
    resident:    firstName(hh?.residentName),
    plannedMode: (hh as any)?.plannedMode ?? 'helper',
  }

  if (r.status !== 'approved' || !r.expectedVisitId) {
    return { ...base, device: 'n/a' as const, visit: null, code: null }
  }

  const device = !r.deviceHash
    ? 'unbound' as const
    : deviceCookie && hashToken(deviceCookie) === r.deviceHash
      ? 'mine' as const
      : 'other' as const

  const vc = await visitCodeFor(r.householdId, r.expectedVisitId)
  const code =
    device === 'mine' && base.plannedMode === 'resident' && vc.state === 'ok'
      ? { value: vc.code, endsAt: vc.endsAt }
      : null

  return { ...base, device, visit: vc.state, code }
}

// ── bindDevice ────────────────────────────────────────────────────────────────

export async function bindDevice(statusToken: string): Promise<{ ok: true; cookie: string } | Err> {
  const r = await dbr.getRequestByToken(statusToken)
  if (!r || r.status !== 'approved') return err('Not available.', 409)
  const cookie = newDeviceId()
  if (!(await dbr.bindIfEmpty(r.id, hashToken(cookie))))
    return err('This link is already in use on another phone. Ask for a new link.', 409)
  return { ok: true, cookie }
}

// ── resendLink ────────────────────────────────────────────────────────────────

export async function resendLink(statusToken: string): Promise<{ ok: true } | Err> {
  const r = await dbr.getRequestByToken(statusToken)
  if (!r || !['pending', 'approved'].includes(r.status)) return err('Not available.', 409)
  if (r.resendCount >= L.resendMax) return err('Too many new links. Contact the family.', 429)
  const next = newToken()
  await dbr.updateRequest(r.id, { statusToken: next, deviceHash: null, resendCount: r.resendCount + 1 })
  notifyVisitor(r, msgs.link(statusUrl(next))).catch(() => {})
  return { ok: true }
}

// ── cancelOwn ─────────────────────────────────────────────────────────────────

/** Visitor cancels their own pending request. Approved visits must be removed by a guardian. */
export async function cancelOwn(statusToken: string): Promise<{ ok: true } | Err> {
  const r = await dbr.getRequestByToken(statusToken)
  if (!r) return err('Not found.', 404)
  if (!(await dbr.transition(r.id, ['pending'], { status: 'cancelled', decidedAt: new Date() })))
    return err('Already decided.', 409)
  return { ok: true }
}
