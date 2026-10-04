/**
 * regular.ts: "register as a regular visitor" orchestration.
 *
 *   visitor (public link) -> submitRegistration -> pending
 *   helper OR resident     -> decideRegistration -> approved (face copied to GuestFace, ref "reg:<id>") | declined
 *   camera sighting        -> annotateCaseFromSighting -> door case tagged "regular visitor" (helper still decides)
 *
 * A match never opens a door. It only tells the helper who it probably is.
 */
import { encrypt, decrypt } from '../auth'
import { getHousehold } from '../db/households'
import { getApprovedMemberships } from '../db/memberships'
import * as dbr from '../db/regular-visitors'
import * as dbl from '../db/visit-requests'
import { pushToMembership } from './notify'
import { notifyVisitor, msgs, firstName, regularStatusUrl } from '../visitor-notify'
import { normalizePhone, normalizeEmail } from '../identity'
import { newToken, hashToken } from '../visit-tokens'
import { PURPOSES, type Purpose } from './purposes'
import { REGULAR_LIMITS as L } from './config'
import { FACE, FaceError, extractDescriptor, enrollDescriptor, matchDescriptor, deleteGuest, readImage } from '@/face'
import { seal, open } from '@/face/store'

type Err = { ok: false; error: string; status: number }
const err = (error: string, status = 400): Err => ({ ok: false, error, status })

export const REF_PREFIX = 'reg:'
export const regularRef = (id: string) => `${REF_PREFIX}${id}`

const purposeOf = (k: string) => (PURPOSES as any)[k] ?? PURPOSES.other

// ── photo sealing (same envelope as face descriptors) ─────────────────────────
const sealText = (t: string) => { const e = encrypt(t); return e ? 'enc:' + e : 'raw:' + t }
const openText = (s?: string | null): string | null => {
  if (!s) return null
  if (s.startsWith('enc:')) return decrypt(s.slice(4))
  if (s.startsWith('raw:')) return s.slice(4)
  return null
}

const mimeOf = (b: Buffer) =>
  b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
  : b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
  : 'image/webp'

// ── submit ────────────────────────────────────────────────────────────────────
export async function submitRegistration(i: {
  linkToken:  string
  name:       string
  purpose:    Purpose
  note?:      string
  contactRaw: string
  image:      string          // data URL or base64
  ip:         string
}): Promise<{ ok: true; statusToken: string } | Err> {
  if (!FACE.enabled) return err('Face registration is turned off.', 503)

  const link = await dbl.findActiveLinkByHash(hashToken(i.linkToken))
  if (!link) return err('This link is no longer active.', 404)

  const phone = normalizePhone(i.contactRaw)
  const email = !phone && i.contactRaw.includes('@') ? normalizeEmail(i.contactRaw) : null
  if (!phone && !email) return err('Enter a phone number or an email address.')
  const contact = (phone ?? email)!
  const contactKind = phone ? 'sms' : 'email'

  const now  = Date.now()
  const hour = new Date(now - 3_600_000)
  const day  = new Date(now - 86_400_000)
  if (await dbr.countByIp(i.ip, hour)                          >= L.perIpHour)     return err('Too many requests. Try again later.', 429)
  if (await dbr.countByContact(link.householdId, contact, day) >= L.perContactDay) return err('Too many requests for this contact today.', 429)
  if (await dbr.countByLink(link.id, day)                      >= L.perLinkDay)    return err('This link is busy. Try again later.', 429)
  if (await dbr.countPending(link.householdId)                 >= L.maxPending)    return err('Too many registrations are waiting. Ask the family.', 429)

  // Validate the picture and read the face. FaceError carries a message the visitor can act on.
  let buf: Buffer, descriptor: number[]
  try {
    buf = readImage(i.image)
    if (buf.length > L.maxPhotoBytes) return err('That photo is too large. Take a new one.', 413)
    descriptor = await extractDescriptor(buf)
  } catch (e) {
    if (e instanceof FaceError) return err(e.message, e.status)
    throw e
  }

  // Already a registered face? Say so without saying who.
  const dup = await matchDescriptor(link.householdId, descriptor)
  if (dup.reason === 'match') return err('This face is already registered.', 409)

  const statusToken = newToken()
  const r = await dbr.create({
    householdId: link.householdId,
    linkId:      link.id,
    name:        i.name,
    purpose:     i.purpose,
    note:        i.note ?? null,
    contact,
    contactKind,
    embedding:   seal(descriptor),
    photoEnc:    sealText(`data:${mimeOf(buf)};base64,${buf.toString('base64')}`),
    consentAt:   new Date(now),
    statusToken,
    ip:          i.ip,
    expiresAt:   new Date(now + L.ttlHours * 3_600_000),
  })

  // Quiet push to every approved helper. A registration is not urgent.
  const p = purposeOf(i.purpose)
  getApprovedMemberships(link.householdId)
    .then(ms => ms.forEach(m => pushToMembership(m.id, {
      title: `🙂 ${i.name} wants to be a regular visitor`,
      body:  `${p.icon} ${p.label}. Open the app to check the photo and approve.`,
      tag:   `reg:${r.id}`,
      url:   '/helper',
    })))
    .catch(() => {})

  return { ok: true, statusToken }
}

// ── sweep (lazy expiry) ───────────────────────────────────────────────────────
export async function sweepRegistrations(householdId: string, now = Date.now()) {
  const rows = await dbr.findExpirable(householdId, new Date(now))
  if (!rows.length) return
  const hh = await getHousehold(householdId)
  for (const r of rows) {
    if (await dbr.transition(r.id, ['pending'], { status: 'expired', decidedAt: new Date(now), ...dbr.PURGE })) {
      notifyVisitor(r, msgs.regularExpired(firstName(hh?.residentName))).catch(() => {})
    }
  }
}

/** Called when the visit link is revoked: pending registrations die with it. */
export async function cancelPendingRegistrations(householdId: string) {
  const rows = await dbr.listPendingForHousehold(householdId)
  if (!rows.length) return
  const hh = await getHousehold(householdId)
  for (const r of rows) {
    if (await dbr.transition(r.id, ['pending'], { status: 'cancelled', decidedAt: new Date(), ...dbr.PURGE })) {
      notifyVisitor(r, msgs.regularCancelled(firstName(hh?.residentName))).catch(() => {})
    }
  }
}

// ── decide (helper OR resident, first answer wins) ────────────────────────────
export async function decideRegistration(
  householdId: string,
  id:          string,
  by:          { kind: 'helper' | 'resident'; membershipId?: string },
  decision:    'approve' | 'decline'
): Promise<{ ok: true; status: string } | Err> {
  const r  = await dbr.getById(householdId, id)
  const hh = await getHousehold(householdId)
  if (!r || !hh) return err('Not found.', 404)

  const now = Date.now()
  if (r.status !== 'pending') return err('Already decided.', 409)
  if (r.expiresAt.getTime() <= now) { await sweepRegistrations(householdId, now); return err('This registration expired.', 410) }

  const who = firstName(hh.residentName)
  const decidedBy = by.kind === 'helper' ? `helper:${by.membershipId ?? ''}` : 'resident'

  if (decision === 'decline') {
    if (!(await dbr.transition(id, ['pending'], { status: 'declined', decidedBy, decidedAt: new Date(now), ...dbr.PURGE })))
      return err('Already decided.', 409)
    notifyVisitor(r, msgs.regularDeclined(who)).catch(() => {})
    return { ok: true, status: 'declined' }
  }

  // approve: claim the row first so two approvers cannot both enrol the face
  if (!(await dbr.transition(id, ['pending'], { status: 'approved', decidedBy, decidedAt: new Date(now) })))
    return err('Already decided.', 409)

  const descriptor = open(r.embedding ?? '')
  if (!descriptor) {
    await dbr.transition(id, ['approved'], { status: 'pending', decidedBy: null, decidedAt: null })
    return err('The saved face could not be read. Ask them to register again.', 422)
  }

  try {
    const saved = await enrollDescriptor(householdId, {
      name: r.name, descriptor, consentAt: r.consentAt, ref: regularRef(id),
      createdBy: by.membershipId,
    })
    await dbr.update(id, { faceId: saved.id, ...dbr.PURGE })
  } catch (e) {
    // Roll back so someone can retry (for example after removing an old face)
    await dbr.transition(id, ['approved'], { status: 'pending', decidedBy: null, decidedAt: null })
    if (e instanceof FaceError) return err(e.message, e.status)
    throw e
  }

  notifyVisitor(r, msgs.regularApproved(who, regularStatusUrl(r.statusToken))).catch(() => {})
  return { ok: true, status: 'approved' }
}

// ── remove / withdraw ─────────────────────────────────────────────────────────
async function eraseApproved(householdId: string, id: string): Promise<boolean> {
  if (!(await dbr.transition(id, ['approved'], { status: 'removed', decidedAt: new Date(), ...dbr.PURGE }))) return false
  await deleteGuest(householdId, { ref: regularRef(id) })
  return true
}

/** Guardian removes a regular visitor. Their face is deleted. */
export async function removeRegular(householdId: string, id: string): Promise<{ ok: true } | Err> {
  const r = await dbr.getById(householdId, id)
  if (!r) return err('Not found.', 404)
  return (await eraseApproved(householdId, id)) ? { ok: true } : err('Not registered.', 409)
}

/** The visitor changes their mind: pending is cancelled, approved is erased. */
export async function withdraw(statusToken: string): Promise<{ ok: true } | Err> {
  const r = await dbr.getByToken(statusToken)
  if (!r) return err('Not found.', 404)
  if (r.status === 'approved') return (await eraseApproved(r.householdId, r.id)) ? { ok: true } : err('Already removed.', 409)
  if (await dbr.transition(r.id, ['pending'], { status: 'cancelled', decidedAt: new Date(), ...dbr.PURGE })) return { ok: true }
  return err('Already decided.', 409)
}

// ── views ─────────────────────────────────────────────────────────────────────
/** What the visitor's status page may see. Never the photo, never the contact. */
export async function visitorView(statusToken: string) {
  let r = await dbr.getByToken(statusToken)
  if (!r) return null
  if (r.status === 'pending' && r.expiresAt.getTime() <= Date.now()) {
    await sweepRegistrations(r.householdId)
    r = (await dbr.getByToken(statusToken))!
  }
  const hh = await getHousehold(r.householdId)
  return { status: r.status, name: r.name, purpose: r.purpose, resident: firstName(hh?.residentName) }
}

/** Pending list for helpers and the resident; approved list only for helpers. Metadata only. */
export async function listForApprover(householdId: string, kind: 'helper' | 'resident') {
  await sweepRegistrations(householdId)
  const pending = await dbr.list(householdId, ['pending'])
  const approved = kind === 'helper' ? await dbr.list(householdId, ['approved'], 100) : []
  return {
    pending: pending.map(r => ({
      id: r.id, name: r.name, purpose: r.purpose, note: r.note,
      contactKind: r.contactKind, createdAt: r.createdAt.getTime(),
    })),
    approved: approved.map(r => ({
      id: r.id, name: r.name, purpose: r.purpose, since: r.decidedAt?.getTime() ?? r.createdAt.getTime(),
      by: (r.decidedBy ?? '').startsWith('helper') ? 'helper' : 'resident',
    })),
  }
}

/** The pending photo, only while it is still pending. */
export async function photoFor(householdId: string, id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await dbr.getById(householdId, id)
  if (!r || r.status !== 'pending') return null
  const url = openText(r.photoEnc)
  const m = url?.match(/^data:(image\/[a-z]+);base64,(.+)$/)
  return m ? { mime: m[1], bytes: Buffer.from(m[2], 'base64') } : null
}

// ── camera: count a recognised face as a regular visitor ──────────────────────
export async function annotateCaseFromSighting(
  householdId: string,
  caseId: string | null | undefined,
  sighting: { faces: { status: string; ref?: string | null; strength?: 'strong' | 'ok' }[] }
) {
  if (!caseId) return
  const rank = (s?: string) => (s === 'strong' ? 2 : s === 'ok' ? 1 : 0)
  const need = rank(L.tagStrength)
  const hit = sighting.faces.find(f => f.status === 'known' && f.ref?.startsWith(REF_PREFIX) && rank(f.strength) >= need)
  if (!hit?.ref) return
  const id = hit.ref.slice(REF_PREFIX.length)
  const r = await dbr.getById(householdId, id)
  if (!r || r.status !== 'approved') return          // removed or stale face
  const p = purposeOf(r.purpose)
  const { noteRegularVisitor } = await import('./store')
  await noteRegularVisitor(householdId, caseId, { id, name: r.name, icon: p.icon, strength: hit.strength ?? 'ok' })
}
