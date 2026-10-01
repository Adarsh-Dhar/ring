import { HELPERS, DEFAULT_ESCALATION_SECONDS, RESULT_TTL_MS, NO_RESPONSE_TTL_MS, CHECKIN_HOUR, CHECKIN_GRACE_MIN, RESIDENT_TZ, EMERGENCY_NUMBER, isPlaceholderPhone, EXPECTED_TIMEOUT_SECONDS, RECURRING_GRACE_MIN, type Helper, type PublicHelper, type Consent } from './config'
import { zonedHour, zonedDayKey, zonedHourOnSameDay, zonedWeekday, zonedDayNumber, zonedMinuteOnSameDay } from '../time'
import { fetchDeviceOnline, listDeviceIds, ringConfigured } from '../ring/client'
import { pushToSubs, sendSms, type PushSub } from './notify'
import { loadState, saveSoon } from './persist'
import { dbEnabled, loadHelpers, saveHelpers } from '../db/helpers'

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

export interface RecurringVisit {
  id: string
  icon: string
  label: string
  days: number[]        // 0 = Sun ... 6 = Sat
  everyNWeeks: number   // 1 = every week, 2 = every other week ...
  anchorWeek: number    // day number of the Sunday that starts week 0 (for every-N-weeks)
  startMin: number      // minutes after local midnight, resident time zone
  endMin: number
  alertIfMissed: boolean
  paused: boolean
  lastArrived?: string  // occurrence key `${id}:${dayNumber}`
  lastMissedAlert?: string
}

/** What a screen needs; the resident never gets the full schedule. */
export interface RecurringNow { id: string; icon: string; label: string; endsAt: number }

export interface DoorCase {
  id: string
  kind: CaseKind
  eventType: string
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
  /** 'expected' = matched a recurring visit: quiet alert, helper confirms in one tap. */
  lane?: 'normal' | 'expected'
  recurringId?: string
  /** Copied at match time so history survives deleting the schedule. */
  visitIcon?: string
  visitLabel?: string
}

export interface DeviceInfo { online: boolean; since: number; alertedAt?: number }

interface DoorbellState {
  cases: DoorCase[]
  offline: boolean
  timeoutSec: number
  subs: Record<string, PushSub[]>
  expected: ExpectedVisit[]
  recurring: RecurringVisit[]
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
  const legacyHelpers = s.helpers
  ;(globalThis as any).__legacyHelpers ??= legacyHelpers
  // Always use config helpers if seeding is enabled, to avoid stale data
  const useConfigHelpers = process.env.SEED_DEMO_HELPERS === '1' && process.env.NODE_ENV !== 'production'
  const helpers = dbEnabled ? [] : (useConfigHelpers ? HELPERS : (s.helpers ?? HELPERS))
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
  recurring: [],
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
state.recurring ||= []
state.checkinAt ??= null
state.missedAlertDay ??= null
state.helpers ||= HELPERS.map((h) => ({ ...h }))
state.quiet ||= { enabled: false, startHour: 22, endHour: 6 }
state.residentEpoch ||= 1
state.devices ||= {}
state.lastTickAt ||= 0

const gl = globalThis as unknown as { __doorbellReady?: Promise<void>; __legacyHelpers?: Helper[] }
let helpersLoaded = !dbEnabled
let dbLoadFailed = false
const SEED_DEMO = process.env.SEED_DEMO_HELPERS === '1' && process.env.NODE_ENV !== 'production'

const approvedHelpers = () => state.helpers.filter((h) => h.consent === 'approved')
const findHelper = (id: string) => state.helpers.find((h) => h.id === id)
export const getHelper = (id: string) => findHelper(id)

let helperSave: Promise<void> = Promise.resolve()
let helperSaveErr: unknown = null

function persistHelpers() {
  if (!dbEnabled) return
  const snapshot = state.helpers.map((h) => ({ ...h }))
  helperSave = helperSave
    .then(() => saveHelpers(snapshot))
    .then(() => { helperSaveErr = null }, (e) => { helperSaveErr = e; console.error('[DB] saving helpers failed', e) })
}

/** Resolves true when the latest change is safely in Postgres. */
export async function flushHelpers(): Promise<boolean> {
  await helperSave
  return helperSaveErr === null
}

const persist = () => saveSoon(() =>
  helpersLoaded && dbEnabled ? { ...state, helpers: [] }
  : dbEnabled ? { ...state, helpers: gl.__legacyHelpers ?? [] }   // not loaded yet: do not wipe the old copy
  : state)

// Start hydration on first import if DB is enabled
if (dbEnabled) {
  console.log('[DB] Database enabled, starting hydration...')
  void (async () => {
    try {
      let rows = await loadHelpers()
      if (rows.length === 0) {
        const seed = gl.__legacyHelpers?.length ? gl.__legacyHelpers : (SEED_DEMO ? HELPERS : [])
        if (seed.length) {
          await saveHelpers(seed)
          rows = seed.map((h) => ({ ...h }))
          console.log(`[DB] imported ${seed.length} helper(s)`)
        }
      }
      state.helpers = rows
      const known = approvedHelpers().map((h) => h.id)
      for (const c of state.cases) c.chain ||= known
      helpersLoaded = true
      dbLoadFailed = false
      console.log('[DB] Hydration complete, helpers loaded:', rows.length)
      persist()
    } catch (e) {
      dbLoadFailed = true
      console.error('[DB] could not load helpers, retrying in 5s', e)
      await new Promise((r) => setTimeout(r, 5000))
      // Will retry on next tick
    }
  })()
} else {
  console.log('[DB] Database not enabled (DATABASE_URL not set)')
}

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

function isQuiet(now: number): boolean {
  const q = state.quiet
  if (!q.enabled || q.startHour === q.endHour) return false
  const h = zonedHour(now, RESIDENT_TZ)
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour
}

const GRACE_MS = RECURRING_GRACE_MIN * 60_000

/** Today's window for a visit (resident time zone), or null if it is not due today. */
function windowToday(v: RecurringVisit, now: number) {
  if (v.paused) return null
  if (!v.days.includes(zonedWeekday(now, RESIDENT_TZ))) return null
  const day = zonedDayNumber(now, RESIDENT_TZ)
  const week = Math.floor((day - v.anchorWeek) / 7)
  if (week < 0 || week % v.everyNWeeks !== 0) return null
  return {
    start: zonedMinuteOnSameDay(now, RESIDENT_TZ, v.startMin),
    end: zonedMinuteOnSameDay(now, RESIDENT_TZ, v.endMin),
    key: `${v.id}:${day}`,
  }
}

function matchRecurring(now: number, forceId?: string | null) {
  for (const v of state.recurring) {
    if (forceId) { if (v.id === forceId) return { visit: v, key: `${v.id}:forced:${now}` }; continue }
    const w = windowToday(v, now)
    if (w && now >= w.start - GRACE_MS && now < w.end + GRACE_MS) return { visit: v, key: w.key }
  }
  return null
}

function nextOccurrence(v: RecurringVisit, now: number): number | null {
  for (let i = 0; i <= 7 * v.everyNWeeks; i++) {
    const w = windowToday(v, now + i * 86_400_000) // fine for zones without DST (Asia/Kolkata); revisit for DST zones
    if (w && w.end > now) return w.start
  }
  return null
}

function checkMissedVisits(now: number) {
  for (const v of state.recurring) {
    if (!v.alertIfMissed) continue
    const w = windowToday(v, now)
    if (!w || now < w.end + GRACE_MS) continue
    if (v.lastArrived === w.key || v.lastMissedAlert === w.key) continue
    v.lastMissedAlert = w.key
    notifyAll(`${v.icon} ${v.label} did not come`, `Expected today and nobody rang. Maybe call ${RESIDENT}.`, `missed-${w.key}`)
    persist()
  }
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
      if (c.lane === 'expected') {
        // Nobody confirmed in time: treat as an unknown visitor. Never less safe than a normal case.
        c.lane = 'normal'
        c.deadlineAt += state.timeoutSec * 1000
        addLog(c, `Nobody confirmed the expected visit in ${EXPECTED_TIMEOUT_SECONDS}s. Treated as an unknown visitor: normal alert and SMS.`)
        const first = findHelper(c.chain[c.helperIndex])
        if (first) {
          notifyHelper(first, '🚪 Someone is at the door', `Nobody confirmed the expected visit. Open the app. You have ${state.timeoutSec}s.`, c.id)
          smsHelper(first, `Someone is at ${RESIDENT}'s door. Open the helper app now. You have ${state.timeoutSec}s.`)
        }
        continue
      }
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
  checkMissedVisits(now)
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

function openCase(kind: CaseKind, eventType: string, note: string, deviceId: string | null = null, forceRecurringId: string | null = null): DoorCase {
  const now = Date.now()
  const m = kind === 'visitor' ? matchRecurring(now, forceRecurringId) : null
  const secs = m ? EXPECTED_TIMEOUT_SECONDS : state.timeoutSec
  const c: DoorCase = {
    id: id(),
    kind,
    eventType,
    createdAt: now,
    helperIndex: 0,
    deadlineAt: now + secs * 1000,
    status: 'waiting',
    log: [],
    chain: approvedHelpers().map((h) => h.id),
    deviceId,
    lane: m ? 'expected' : 'normal',
    recurringId: m?.visit.id,
    visitIcon: m?.visit.icon,
    visitLabel: m?.visit.label,
  }
  addLog(c, note)
  if (m) {
    m.visit.lastArrived = m.key
    addLog(c, `Matches recurring visit: ${m.visit.icon} ${m.visit.label}. Quiet alert, helper confirms.`)
  }
  const exp = state.expected.find((e) => e.startsAt <= now && now < e.endsAt)
  if (exp) addLog(c, `Expected now: ${exp.label}.`)
  const approved = approvedHelpers()
  if (!approved.length) addLog(c, 'NO APPROVED HELPERS. Nobody can be alerted. Finish setup.')
  addLog(c, `Asked ${approved[0]?.name ?? 'a helper'}. ${secs}s to answer.`)
  if (kind === 'visitor' && approved[0]) {
    if (m) {
      notifyHelper(approved[0], `${m.visit.icon} ${m.visit.label} may be at the door`, 'Open the app and confirm. One tap.', c.id)
      // no SMS on purpose: expected visits stay quiet
    } else {
      notifyHelper(approved[0], '🚪 Someone is at the door', `Open the app. You have ${state.timeoutSec}s.`, c.id)
      // Web push alone is unreliable (especially on iOS). SMS goes out at the FIRST step too.
      smsHelper(approved[0], `Someone is at ${RESIDENT}'s door. Open the helper app now. You have ${state.timeoutSec}s.`)
    }
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
  return openCase('visitor', event.event_type, `Ring sent ${event.event_type}.`, event.device_id ?? null, null)
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
  const c = openCase('sos', 'sos', 'Resident pressed "I need help".')
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

export function addRecurring(
  v: { icon: string; label: string; days: number[]; everyNWeeks: number; startMin: number; endMin: number; alertIfMissed: boolean; startNextWeek: boolean }
): RecurringVisit {
  const now = Date.now()
  const thisWeek = zonedDayNumber(now, RESIDENT_TZ) - zonedWeekday(now, RESIDENT_TZ)
  const r: RecurringVisit = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    icon: v.icon, label: v.label,
    days: [...new Set(v.days)].sort(),
    everyNWeeks: v.everyNWeeks,
    anchorWeek: thisWeek + (v.startNextWeek ? 7 : 0),
    startMin: v.startMin, endMin: v.endMin,
    alertIfMissed: v.alertIfMissed, paused: false,
  }
  state.recurring.push(r)
  persist()
  return r
}
export function setRecurringPaused(id: string, paused: boolean) {
  const v = state.recurring.find((x) => x.id === id)
  if (v) { v.paused = paused; persist() }
}
export function removeRecurring(id: string) {
  state.recurring = state.recurring.filter((x) => x.id !== id)
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
    timeZone: RESIDENT_TZ,
    recurring: resident ? [] : state.recurring.map((v) => ({ ...v, next: nextOccurrence(v, now) })),
    recurringNow: state.recurring.flatMap((v): RecurringNow[] => {
      const w = windowToday(v, now)
      return w && now >= w.start - GRACE_MS && now < w.end + GRACE_MS
        ? [{ id: v.id, icon: v.icon, label: v.label, endsAt: w.end }]
        : []
    }),
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
  recurring: state.recurring.map((v) => ({ ...v, next: nextOccurrence(v, Date.now()) })),
})

/** Health for an external uptime monitor. `tickAgeMs` large => escalation timer is NOT running (e.g. serverless). */
export function getHealth() {
  const now = Date.now()
  return {
    tickAgeMs: state.lastTickAt ? now - state.lastTickAt : null,
    ready: systemReady(),
    anyDeviceOffline: anyDeviceOffline(),
    openCases: state.cases.filter((c) => c.status === 'waiting').length,
    db: dbEnabled ? { loaded: helpersLoaded, failing: dbLoadFailed || helperSaveErr !== null } : null,
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
  persistHelpers()
  return true
}

export function addHelper(name: string, phone: string, emoji: string): Helper {
  const h: Helper = { id: `h_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, phone, emoji, consent: 'pending', tokenEpoch: 1 }
  state.helpers.push(h)
  persist()
  persistHelpers()
  return h
}
export function removeHelper(id: string): boolean {
  const h = findHelper(id)
  if (!h) return false
  if (h.consent === 'approved' && approvedHelpers().length <= 1) return false
  state.helpers = state.helpers.filter((x) => x.id !== id)
  delete state.subs[id]
  persist()
  persistHelpers()
  return true
}
export function setConsent(id: string, consent: Consent): boolean {
  const h = findHelper(id)
  if (!h) return false
  if (h.consent === 'approved' && consent !== 'approved' && approvedHelpers().length <= 1) return false
  h.consent = consent
  h.consentAt = Date.now()
  persist()
  persistHelpers()
  return true
}
export function moveHelper(id: string, dir: -1 | 1) {
  const i = state.helpers.findIndex((h) => h.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= state.helpers.length) return
  ;[state.helpers[i], state.helpers[j]] = [state.helpers[j], state.helpers[i]]
  persist()
  persistHelpers()
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
  state.recurring = []
  persist()
}

// Server-side timers: escalation and device checks run without any tab open.
// This REQUIRES a long-running Node process (not serverless). /api/health reports if it is not ticking.
const gt = globalThis as unknown as { __doorbellTimer?: ReturnType<typeof setInterval>; __doorbellPoll?: ReturnType<typeof setInterval> }
if (!gt.__doorbellTimer) {
  gt.__doorbellTimer = setInterval(() => tick(), 1000)
  gt.__doorbellTimer.unref?.()
  // Re-alert for cases that were open when the process last stopped.
  // Wait a bit for helpers to load from DB before re-alerting
  setTimeout(() => {
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
  }, 2000)
}
if (!gt.__doorbellPoll && ringConfigured()) {
  void pollDevices()
  gt.__doorbellPoll = setInterval(() => void pollDevices(), 60_000)
  gt.__doorbellPoll.unref?.()
}
