import { pickClip } from '../demo'
import { HELPERS, DEFAULT_ESCALATION_SECONDS, RESULT_TTL_MS, NO_RESPONSE_TTL_MS, CHECKIN_HOUR, CHECKIN_GRACE_MIN, RESIDENT_TZ, EMERGENCY_NUMBER, isPlaceholderPhone, type Helper, type PublicHelper, type Consent } from './config'
import { zonedHour, zonedDayKey, zonedHourOnSameDay } from '../time'
import { fetchDeviceOnline, listDeviceIds, ringConfigured } from '../ring/client'
import { pushToSubs, sendSms, type PushSub } from './notify'
import { loadState, saveSoon } from './persist'

export type CaseStatus = 'waiting' | 'answered' | 'no_response'
export type Answer = 'safe' | 'not_safe' | 'call_me'
export type CaseKind = 'visitor' | 'sos'
export type Visitor = 'known' | 'delivery' | 'unknown'

export interface Quiet { enabled: boolean; startHour: number; endHour: number }

export interface ExpectedVisit {
  id: string
  icon: string
  label: string
  startsAt: number
  endsAt: number
}

export interface DoorCase {
  id: string
  kind: CaseKind
  eventType: string
  clip: string | null
  createdAt: number
  helperIndex: number
  deadlineAt: number
  status: CaseStatus
  answer?: Answer
  answeredBy?: string
  resolvedAt?: number
  log: { t: number; msg: string }[]
  visitor?: Visitor
  confirmedAt?: number
  declinedAt?: number
  chain: string[]
  /** Ring device that produced this event (needed for live view). */
  deviceId?: string | null
  /** A helper has actually SEEN the alert (not just "the push was sent"). */
  ackedBy?: string
  ackedAt?: number
}

export interface DeviceInfo { online: boolean; since: number; alertedAt?: number }

interface DoorbellState {
  cases: DoorCase[]
  offline: boolean
  timeoutSec: number
  subs: Record<string, PushSub[]>
  expected: ExpectedVisit[]
  checkinAt: number | null
  missedAlertDay: string | null
  helpers: Helper[]
  quiet: Quiet
  residentEpoch: number
  devices: Record<string, DeviceInfo>
  lastTickAt: number
}

const realertIds: string[] = []

function restore(): Partial<DoorbellState> {
  const s = loadState<DoorbellState>()
  // Always use config helpers if seeding is enabled, to avoid stale data
  const useConfigHelpers = process.env.SEED_DEMO_HELPERS === '1' && process.env.NODE_ENV !== 'production'
  const helpers = useConfigHelpers ? HELPERS : (s.helpers ?? HELPERS)
  const known = helpers.filter((h) => h.consent === 'approved').map((h) => h.id)
  const timeout = s.timeoutSec ?? DEFAULT_ESCALATION_SECONDS
  for (const c of s.cases ?? []) {
    if (c.status === 'waiting') {
      // A live visitor must never be dropped because the server restarted: re-arm the timer and re-alert.
      c.deadlineAt = Date.now() + timeout * 1000
      c.log.push({ t: Date.now(), msg: 'Server restarted while this case was open. Timer restarted and helper alerted again.' })
      realertIds.push(c.id)
    }
    c.chain ||= known
  }
  return { ...s, helpers }
}

const g = globalThis as unknown as { __doorbell?: DoorbellState }
const state: DoorbellState = (g.__doorbell ||= {
  cases: [],
  offline: false,
  timeoutSec: DEFAULT_ESCALATION_SECONDS,
  subs: {},
  expected: [],
  checkinAt: null,
  missedAlertDay: null,
  helpers: HELPERS.map((h) => ({ ...h })),
  quiet: { enabled: false, startHour: 22, endHour: 6 },
  residentEpoch: 1,
  devices: {},
  lastTickAt: 0,
  ...restore(),
})
state.subs ||= {}
state.expected ||= []
state.checkinAt ??= null
state.missedAlertDay ??= null
state.helpers ||= HELPERS.map((h) => ({ ...h }))
state.quiet ||= { enabled: false, startHour: 22, endHour: 6 }
state.residentEpoch ||= 1
state.devices ||= {}
state.lastTickAt ||= 0
const persist = () => saveSoon(() => state)

const TRIGGER_EVENTS = new Set(
  (process.env.RING_TRIGGER_EVENTS || 'button_press').split(',').map((s) => s.trim()).filter(Boolean)
)

const id = () => `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export function addSub(helperId: string, sub: PushSub) {
  const list = (state.subs[helperId] ||= [])
  if (!list.some((s) => s.endpoint === sub.endpoint)) list.push(sub)
  persist()
}
export function removeSub(helperId: string, endpoint: string) {
  state.subs[helperId] = (state.subs[helperId] || []).filter((s) => s.endpoint !== endpoint)
  persist()
}

function notifyHelper(h: Helper, title: string, body: string, caseId: string) {
  const subs = state.subs[h.id] || []
  void pushToSubs(subs, { title, body, tag: caseId, url: '/helper' })
    .then((dead) => dead.forEach((e) => removeSub(h.id, e)))
    .catch((e) => console.error('[PUSH]', e))
}

function notifyAll(title: string, body: string, caseId: string) {
  approvedHelpers().forEach((h) => notifyHelper(h, title, body, caseId))
}

function smsHelper(h: Helper | undefined, body: string) {
  if (h) void sendSms(h.phone, body)
}

const approvedHelpers = () => state.helpers.filter((h) => h.consent === 'approved')
const findHelper = (id: string) => state.helpers.find((h) => h.id === id)
export const getHelper = (id: string) => findHelper(id)

function isQuiet(now: number): boolean {
  const q = state.quiet
  if (!q.enabled || q.startHour === q.endHour) return false
  const h = zonedHour(now, RESIDENT_TZ)
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour
}

const RESIDENT = process.env.RESIDENT_NAME || 'the resident'

const dayKey = (ms: number) => zonedDayKey(ms, RESIDENT_TZ)
const dueAt = (now: number) => zonedHourOnSameDay(now, RESIDENT_TZ, CHECKIN_HOUR)
const checkedInToday = (now: number) =>
  state.checkinAt !== null && dayKey(state.checkinAt) === dayKey(now)

function checkMissedCheckin(now: number) {
  const key = dayKey(now)
  const late = now >= dueAt(now) + CHECKIN_GRACE_MIN * 60_000
  if (!late || checkedInToday(now) || state.missedAlertDay === key) return
  state.missedAlertDay = key
  notifyAll('⚠️ No check-in today', `${RESIDENT} has not pressed "I'm OK" yet. Please call.`, `checkin-${key}`)
  smsAll(`${RESIDENT} has not checked in today. Please call.`)
  persist()
}

function smsAll(body: string) {
  approvedHelpers().forEach((h) => {
    void sendSms(h.phone, body)
  })
}

function alertSos(c: DoorCase) {
  notifyAll('🆘 Resident needs help', 'Open the app now.', c.id)
  smsAll(`${RESIDENT} pressed "I need help". Please call now.`)
  addLog(c, 'Push and SMS sent to all helpers.')
}

const addLog = (c: DoorCase, msg: string) => {
  c.log.push({ t: Date.now(), msg })
  persist()
}

/** True only if at least one approved helper has a real (non-placeholder) phone number. */
export const systemReady = () => approvedHelpers().some((h) => !isPlaceholderPhone(h.phone))

export function tick(now = Date.now()) {
  state.lastTickAt = now
  for (const c of state.cases) {
    if (c.status !== 'waiting') continue
    while (c.status === 'waiting' && now >= c.deadlineAt) {
      const fromId = c.chain[c.helperIndex]
      const from = findHelper(fromId)
      c.helperIndex += 1
      if (c.helperIndex >= c.chain.length) {
        c.status = 'no_response'
        c.resolvedAt = c.deadlineAt
        addLog(c, `${from?.name ?? 'Someone'} did not answer. Nobody left to ask. Resident told to keep door closed.`)
        smsAll(`Doorbell: nobody answered for ${RESIDENT}. Please call them now.`)
        addLog(c, 'SMS sent to all helpers.')
      } else {
        const toId = c.chain[c.helperIndex]
        const to = findHelper(toId)
        c.deadlineAt += state.timeoutSec * 1000
        addLog(c, `${from?.name ?? 'Someone'} did not answer in ${state.timeoutSec}s. Escalated to ${to?.name ?? 'next helper'}.`)
        if (to) {
          notifyHelper(to, `🚪 ${from?.name ?? 'Someone'} did not answer`, 'It is your turn. Open the app.', c.id)
          smsHelper(to, `Doorbell for ${RESIDENT}: ${from?.name ?? 'the first helper'} did not answer. It is your turn. Open the helper app now.`)
        }
      }
    }
  }
  checkMissedCheckin(now)
}

function activeCase(now = Date.now()): DoorCase | null {
  const c = state.cases[0]
  if (!c) return null
  if (c.status === 'waiting') return c
  const awaitingConfirm = c.status === 'answered' && c.answer === 'safe' && !c.confirmedAt && !c.declinedAt
  const age = now - (c.resolvedAt ?? c.createdAt)
  const ttl = c.status === 'no_response' || awaitingConfirm ? NO_RESPONSE_TTL_MS : RESULT_TTL_MS
  return age < ttl ? c : null
}

function openCase(kind: CaseKind, eventType: string, clip: string | null, note: string, deviceId: string | null = null): DoorCase {
  const now = Date.now()
  const c: DoorCase = {
    id: id(),
    kind,
    eventType,
    clip: clip ?? pickClip(), // no clip given -> random file from videos/ (when LOCAL_VIDEO is on)
    createdAt: now,
    helperIndex: 0,
    deadlineAt: now + state.timeoutSec * 1000,
    status: 'waiting',
    log: [],
    chain: approvedHelpers().map((h) => h.id),
    deviceId,
  }
  addLog(c, note)
  const exp = state.expected.find((e) => e.startsAt <= now && now < e.endsAt)
  if (exp) addLog(c, `Expected now: ${exp.label}.`)
  const approved = approvedHelpers()
  if (!approved.length) addLog(c, 'NO APPROVED HELPERS. Nobody can be alerted. Finish setup.')
  addLog(c, `Asked ${approved[0]?.name ?? 'a helper'}. ${state.timeoutSec}s to answer.`)
  if (kind === 'visitor' && approved[0]) {
    notifyHelper(approved[0], '🚪 Someone is at the door', `Open the app. You have ${state.timeoutSec}s.`, c.id)
    // Web push alone is unreliable (especially on iOS). SMS goes out at the FIRST step too.
    smsHelper(approved[0], `Someone is at ${RESIDENT}'s door. Open the helper app now. You have ${state.timeoutSec}s.`)
  }
  state.cases.unshift(c)
  if (state.cases.length > 200) state.cases.pop()
  if (kind === 'sos') alertSos(c)
  return c
}

export function ingestEvent(event: { event_type: string; event_id?: string; device_id?: string | null; raw?: any }): DoorCase | null {
  if (state.offline) return null
  if (!TRIGGER_EVENTS.has(event.event_type)) return null
  tick()
  const existing = activeCase()
  if (existing && existing.status === 'waiting') {
    addLog(existing, `Another ${event.event_type} event merged into this case (no second alert).`)
    return existing
  }
  const clip = event.raw?.data?.attributes?.demo_clip ?? event.raw?.demo_clip ?? null
  return openCase('visitor', event.event_type, clip, `Ring sent ${event.event_type}.`, event.device_id ?? null)
}

export function raiseSos(): DoorCase {
  tick()
  const existing = activeCase()
  if (existing && existing.status === 'waiting') {
    if (existing.kind === 'sos') return existing
    existing.kind = 'sos'
    addLog(existing, 'Resident pressed "I need help".')
    alertSos(existing)
    return existing
  }
  const c = openCase('sos', 'sos', null, 'Resident pressed "I need help".')
  return c
}

/** A helper confirms they have SEEN the alert. The resident screen only says "help is coming" after this. */
export function ackCase(caseId: string, helperId: string): { ok: true; case: DoorCase } | { ok: false; error: string; status: number } {
  const c = state.cases.find((x) => x.id === caseId)
  if (!c) return { ok: false, error: 'case not found', status: 404 }
  const h = findHelper(helperId)
  if (!h || h.consent !== 'approved' || !c.chain.includes(helperId)) return { ok: false, error: 'not allowed', status: 403 }
  if (!c.ackedAt) {
    c.ackedAt = Date.now()
    c.ackedBy = helperId
    addLog(c, `${h.name} saw the alert.`)
  }
  return { ok: true, case: c }
}

/** Audit trail: who opened live video for which case. */
export function logView(caseId: string, helperId: string, what: string) {
  const c = state.cases.find((x) => x.id === caseId)
  if (!c) return
  addLog(c, `${findHelper(helperId)?.name ?? helperId} ${what}.`)
}
export const caseDevice = (caseId: string) => state.cases.find((x) => x.id === caseId)?.deviceId ?? null
export const isCaseOpenFor = (caseId: string, helperId: string) => {
  const c = state.cases.find((x) => x.id === caseId)
  const h = findHelper(helperId)
  return !!c && !!h && h.consent === 'approved' && c.chain.includes(helperId) && Date.now() - c.createdAt < 30 * 60_000
}

/* ---------- Ring device health: a dead doorbell must never look like "All quiet" ---------- */

export function setDeviceOnline(deviceId: string, online: boolean, source: string) {
  const prev = state.devices[deviceId]
  if (prev && prev.online === online) return
  const now = Date.now()
  state.devices[deviceId] = { online, since: now, alertedAt: prev?.alertedAt }
  if (!online) {
    state.devices[deviceId].alertedAt = now
    notifyAll('⚠️ Doorbell offline', `The doorbell cannot be reached (${source}). ${RESIDENT} will NOT be alerted about visitors.`, `device-${deviceId}`)
    smsAll(`Doorbell for ${RESIDENT} is OFFLINE. Visitors will not be detected. Please check it and call ${RESIDENT}.`)
  } else if (prev) {
    notifyAll('✅ Doorbell back online', 'The doorbell is working again.', `device-${deviceId}`)
  }
  persist()
}

export const anyDeviceOffline = () => Object.values(state.devices).some((d) => !d.online)

let polling = false
let ringFailures = 0
async function pollDevices() {
  // Skip Ring polling when using simulator
  if (process.env.ENABLE_SIM === '1' && process.env.NODE_ENV !== 'production') return
  if (polling || !ringConfigured()) return
  polling = true
  try {
    const ids = process.env.RING_DEVICE_IDS
      ? process.env.RING_DEVICE_IDS.split(',').map((x) => x.trim()).filter(Boolean)
      : await listDeviceIds()
    for (const d of ids) setDeviceOnline(d, await fetchDeviceOnline(d), 'status check')
    ringFailures = 0
  } catch (e) {
    ringFailures += 1
    // Only log every 10th failure to avoid spam
    if (ringFailures % 10 === 0) console.error('[RING] status poll failed', ringFailures, e)
    // We cannot tell whether the doorbell works: treat it as offline after 3 misses in a row.
    if (ringFailures === 3) setDeviceOnline('ring-api', false, 'Ring cannot be reached')
  } finally {
    polling = false
  }
}

export function addExpected(icon: string, label: string, startsAt: number, endsAt: number): ExpectedVisit {
  const e = { id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, icon, label, startsAt, endsAt }
  state.expected.push(e)
  persist()
  return e
}
export function removeExpected(id: string) {
  state.expected = state.expected.filter((e) => e.id !== id)
  persist()
}

export function checkIn() {
  state.checkinAt = Date.now()
  persist()
}

type Fail = { ok: false; error: string; status: number }

export function answerCase(
  caseId: string, helperId: string, answer: Answer, visitor?: Visitor
): { ok: true; case: DoorCase } | Fail {
  tick()
  const c = state.cases.find((x) => x.id === caseId)
  if (!c) return { ok: false, error: 'case not found', status: 404 }
  const helper = findHelper(helperId)
  // Only an approved helper who is in THIS case's chain may answer.
  if (!helper || helper.consent !== 'approved' || !c.chain.includes(helperId)) {
    return { ok: false, error: 'You are not allowed to answer this case', status: 403 }
  }
  if (c.status === 'answered') return { ok: true, case: c }
  // Later helpers cannot jump the queue on a visitor case (SOS alerts everyone at once).
  if (c.status === 'waiting' && c.kind === 'visitor' && c.chain.indexOf(helperId) > c.helperIndex) {
    return { ok: false, error: 'It is not your turn yet', status: 409 }
  }
  c.status = 'answered'
  c.answer = answer
  c.visitor = visitor
  c.answeredBy = helperId
  c.resolvedAt = Date.now()
  const label = answer === 'safe' ? 'SAFE' : answer === 'not_safe' ? 'NOT SAFE' : 'will CALL the resident'
  addLog(c, `${helper.name} answered: ${label}.`)
  return { ok: true, case: c }
}

export function confirmCase(caseId: string, ok: boolean): DoorCase | null {
  const c = state.cases.find((x) => x.id === caseId)
  if (!c || c.status !== 'answered' || c.answer !== 'safe') return null
  if (ok && isQuiet(Date.now())) {
    c.declinedAt = Date.now()
    c.resolvedAt = Date.now()
    addLog(c, 'Night lock is on. The door stays closed.')
    return c
  }
  if (ok) c.confirmedAt = Date.now()
  else c.declinedAt = Date.now()
  c.resolvedAt = Date.now()
  addLog(c, ok ? 'Resident confirmed: opening the door.' : 'Resident chose to keep the door closed.')
  return c
}

/* ---------- Views: each role only gets what it needs ---------- */

const pub = (h: Helper, withPhone: boolean): PublicHelper => ({ id: h.id, name: h.name, emoji: h.emoji, ...(withPhone ? { phone: h.phone } : {}) })

export type View = 'resident' | 'helper'

export function getState(view: View = 'helper', helperId?: string) {
  tick()
  const now = Date.now()
  const resident = view === 'resident'
  const cur = activeCase(now)
  return {
    now,
    me: helperId ?? null,
    ready: systemReady(),
    emergencyNumber: EMERGENCY_NUMBER,
    timeoutSec: state.timeoutSec,
    offline: state.offline || anyDeviceOffline(),
    helpers: approvedHelpers().map((h) => pub(h, resident)),
    // The resident never needs the audit log.
    current: cur ? (resident ? { ...cur, log: [] } : cur) : null,
    history: resident ? [] : state.cases.slice(0, 10),
    expected: state.expected.filter((e) => e.endsAt > now),
    expectedNow: state.expected.filter((e) => e.startsAt <= now && now < e.endsAt),
    checkin: { doneToday: checkedInToday(now), dueHour: CHECKIN_HOUR },
    quietNow: isQuiet(now),
  }
}

export function getHistory() {
  tick()
  return { helpers: state.helpers.map((h) => pub(h, false)), cases: state.cases }
}

export const getSetup = () => ({
  helpers: state.helpers,
  quiet: state.quiet,
  timeoutSec: state.timeoutSec,
  ready: systemReady(),
  timeZone: RESIDENT_TZ,
})

/** Health for an external uptime monitor. `tickAgeMs` large => escalation timer is NOT running (e.g. serverless). */
export function getHealth() {
  const now = Date.now()
  return {
    tickAgeMs: state.lastTickAt ? now - state.lastTickAt : null,
    ready: systemReady(),
    anyDeviceOffline: anyDeviceOffline(),
    openCases: state.cases.filter((c) => c.status === 'waiting').length,
  }
}

/* ---------- Access tokens (see lib/auth.ts) ---------- */
export const getResidentEpoch = () => state.residentEpoch
export const getHelperEpoch = (id: string) => findHelper(id)?.tokenEpoch ?? 1
export function rotateResident() { state.residentEpoch += 1; persist() }
export function rotateHelper(id: string): boolean {
  const h = findHelper(id)
  if (!h) return false
  h.tokenEpoch = (h.tokenEpoch ?? 1) + 1
  delete state.subs[id] // old phones stop receiving alerts too
  persist()
  return true
}

export function addHelper(name: string, phone: string, emoji: string): Helper {
  const h: Helper = { id: `h_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, phone, emoji, consent: 'pending', tokenEpoch: 1 }
  state.helpers.push(h)
  persist()
  return h
}
export function removeHelper(id: string): boolean {
  const h = findHelper(id)
  if (!h) return false
  if (h.consent === 'approved' && approvedHelpers().length <= 1) return false
  state.helpers = state.helpers.filter((x) => x.id !== id)
  delete state.subs[id]
  persist()
  return true
}
export function setConsent(id: string, consent: Consent): boolean {
  const h = findHelper(id)
  if (!h) return false
  if (h.consent === 'approved' && consent !== 'approved' && approvedHelpers().length <= 1) return false
  h.consent = consent
  h.consentAt = Date.now()
  persist()
  return true
}
export function moveHelper(id: string, dir: -1 | 1) {
  const i = state.helpers.findIndex((h) => h.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= state.helpers.length) return
  ;[state.helpers[i], state.helpers[j]] = [state.helpers[j], state.helpers[i]]
  persist()
}
export function setQuiet(q: Quiet) {
  state.quiet = { enabled: !!q.enabled, startHour: q.startHour, endHour: q.endHour }
  persist()
}

export function setOffline(v: boolean) {
  state.offline = v
  persist()
}
export function setTimeoutSec(n: number) {
  state.timeoutSec = Math.max(3, Math.min(600, Math.floor(n)))
  persist()
}
export function resetAll() {
  state.cases.length = 0
  state.offline = false
  state.devices = {}
  persist()
}

// Server-side timers: escalation and device checks run without any tab open.
// This REQUIRES a long-running Node process (not serverless). /api/health reports if it is not ticking.
const gt = globalThis as unknown as { __doorbellTimer?: ReturnType<typeof setInterval>; __doorbellPoll?: ReturnType<typeof setInterval> }
if (!gt.__doorbellTimer) {
  gt.__doorbellTimer = setInterval(() => tick(), 1000)
  gt.__doorbellTimer.unref?.()
  // Re-alert for cases that were open when the process last stopped.
  for (const cid of realertIds.splice(0)) {
    const c = state.cases.find((x) => x.id === cid)
    if (!c || c.status !== 'waiting') continue
    if (c.kind === 'sos') alertSos(c)
    else {
      const h = findHelper(c.chain[c.helperIndex])
      if (h) {
        notifyHelper(h, '🚪 Someone is at the door', 'The system restarted. Open the app now.', c.id)
        smsHelper(h, `Someone is at ${RESIDENT}'s door (system restarted). Open the helper app now.`)
      }
    }
  }
}
if (!gt.__doorbellPoll && ringConfigured()) {
  void pollDevices()
  gt.__doorbellPoll = setInterval(() => void pollDevices(), 60_000)
  gt.__doorbellPoll.unref?.()
}
