import { DEFAULT_ESCALATION_SECONDS, RESULT_TTL_MS, NO_RESPONSE_TTL_MS, CHECKIN_HOUR, CHECKIN_GRACE_MIN, EXPECTED_TIMEOUT_SECONDS, RECURRING_GRACE_MIN, CODE_MAX_ATTEMPTS, type PublicHelper, type Consent } from './config'
import { zonedHour, zonedDayKey, zonedHourOnSameDay, zonedWeekday, zonedDayNumber, zonedMinuteOnSameDay } from '../time'
import { fetchDeviceOnline, listDeviceIds, forceRefreshConnection, ringConfiguredForHousehold, getConnectionForHousehold } from '../ring/client'
import { pushToMembership, sendSms, recentFailures, type PushSub } from './notify'
import { getHousehold, getResidentEpoch, updateHousehold, getMembershipsForHousehold as dbGetMembershipsForHousehold } from '../db/households'
import { getMembership, getApprovedMemberships } from '../db/memberships'
import { createCase, getCase, getCasesForHousehold, getOpenCasesForHousehold, updateCase, deleteOldCases } from '../db/cases'
import { getExpectedVisitsForHousehold, getActiveExpectedVisits, deleteExpectedVisit, deleteOldExpectedVisits, createExpectedVisit, getRecurringVisitsForHousehold, updateRecurringVisit, deleteRecurringVisit, createRecurringVisit, markExpectedUsed } from '../db/visits'
import { getDb } from '../db/client'
import { sweepRequests, cancelRequestForVisit } from './request-lifecycle'
import { currentCode } from '../visit-code'
import { newSecret } from '../visit-tokens'
import { PURPOSES, type Purpose } from './purposes'

// ── Types ────────────────────────────────────────────────────────────────────

export type CaseStatus  = 'waiting' | 'answered' | 'no_response'
export type Answer      = 'safe' | 'not_safe' | 'call_me'
export type CaseKind    = 'visitor' | 'sos'
export type Visitor     = 'known' | 'delivery' | 'unknown'
export type PlannedMode = 'helper' | 'resident' | 'all-helper'

export const PLANNED_MODES = ['helper', 'resident', 'all-helper'] as const
const asMode = (v: string | null | undefined): PlannedMode =>
  (PLANNED_MODES as readonly string[]).includes(v ?? '') ? (v as PlannedMode) : 'helper'

export interface Quiet { enabled: boolean; startHour: number; endHour: number }

export interface ExpectedVisit {
  id:          string
  icon:        string
  label:       string
  startsAt:    number
  endsAt:      number
  who?:        string
  passphrase?: string
  codeSecret?: string   // hex HMAC key for the live code; never sent to any client
  requestId?:  string   // VisitRequest that created this visit
  singleUse?:  boolean
  usedAt?:     number
}

export interface RecurringVisit {
  id:             string
  icon:           string
  label:          string
  days:           number[]
  everyNWeeks:    number
  anchorWeek:     number
  startMin:       number
  endMin:         number
  alertIfMissed:  boolean
  paused:         boolean
  lastArrived?:   string
  lastMissedAlert?: string
  who?:           string
  passphrase?:    string
}

/** What a screen needs; the resident never gets the full schedule. */
export interface RecurringNow { id: string; icon: string; label: string; endsAt: number }

export interface DoorCase {
  id:            string
  kind:          CaseKind
  eventType:     string
  createdAt:     number
  helperIndex:   number
  deadlineAt:    number
  status:        CaseStatus
  answer?:       Answer
  answeredBy?:   string
  resolvedAt?:   number
  log:           { t: number; msg: string }[]
  visitor?:      Visitor
  confirmedAt?:  number
  declinedAt?:   number
  chain:         string[]
  deviceId?:     string | null
  ackedBy?:      string
  ackedAt?:      number
  lane?:         'normal' | 'expected'
  recurringId?:  string
  visitIcon?:    string
  visitLabel?:   string
  checkWho?:     string    // visitor identity shown on resident screen
  checkWord?:    string    // passphrase resident checks (only set when plannedMode='resident')
  checkMode?:    'word' | 'code'
  checkAttempts?: number
  checkCode?:    string    // resident snapshot only — live rotating code; never stored
  checkCodeEndsAt?: number // resident snapshot only — when the code changes next
  expectedId?:   string    // ExpectedVisit that matched (null for recurring or unplanned)
  selfVerifiedAt?: number  // set when resident confirms the passphrase
}

/** Match result from matchPlanned() */
interface PlannedMatch {
  id:          string
  icon:        string
  label:       string
  who?:        string
  passphrase?: string
  codeSecret?: string
  key:         string
  recurring?:  RecurringVisit  // set when the match came from a recurring schedule
}

export interface DeviceInfo { online: boolean; since: number; alertedAt?: number }

interface HouseholdState {
  householdId:    string
  timezone:       string
  plannedMode:    PlannedMode
  cases:          DoorCase[]
  offline:        boolean
  timeoutSec:     number
  quiet:          Quiet
  expected:       ExpectedVisit[]
  recurring:      RecurringVisit[]
  checkinAt:      number | null
  missedAlertDay: string | null
  devices:        Record<string, DeviceInfo>
  lastTickAt:     number
  lastRequestSweepAt: number
  loaded:         boolean
}

// ── State map ─────────────────────────────────────────────────────────────────

const householdStates = new Map<string, HouseholdState>()
const loadingStates   = new Map<string, Promise<void>>()

async function getOrCreateState(householdId: string): Promise<HouseholdState> {
  if (householdStates.has(householdId)) return householdStates.get(householdId)!
  if (loadingStates.has(householdId)) {
    await loadingStates.get(householdId)!
    return householdStates.get(householdId)!
  }
  const p = loadStateFromDB(householdId)
  loadingStates.set(householdId, p)
  await p
  loadingStates.delete(householdId)
  return householdStates.get(householdId)!
}

async function loadStateFromDB(householdId: string): Promise<void> {
  try {
    const household = await getHousehold(householdId)
    if (!household) { console.error(`[STORE] Household not found: ${householdId}`); return }

    const dbCases = await getCasesForHousehold(householdId, 200)
    const cases: DoorCase[] = dbCases.map(c => ({
      id:            c.id,
      kind:          c.kind as CaseKind,
      eventType:     c.eventType,
      createdAt:     c.createdAt.getTime(),
      helperIndex:   c.helperIndex,
      deadlineAt:    c.deadlineAt.getTime(),
      status:        c.status as CaseStatus,
      answer:        c.answer as Answer | undefined,
      answeredBy:    c.answeredBy || undefined,
      resolvedAt:    c.resolvedAt?.getTime(),
      log:           (c.log as any) || [],
      visitor:       c.visitor as Visitor | undefined,
      confirmedAt:   c.confirmedAt?.getTime(),
      declinedAt:    c.declinedAt?.getTime(),
      chain:         (c.chain as any) || [],
      deviceId:      c.deviceId,
      ackedBy:       c.ackedBy || undefined,
      ackedAt:       c.ackedAt?.getTime(),
      lane:          c.lane as 'normal' | 'expected' | undefined,
      recurringId:   c.recurringId || undefined,
      visitIcon:     c.visitIcon || undefined,
      visitLabel:    c.visitLabel || undefined,
      checkWho:      (c as any).checkWho   || undefined,
      checkWord:     (c as any).checkWord  || undefined,
      checkMode:     ((c as any).checkMode as any) || undefined,
      checkAttempts: (c as any).checkAttempts ?? 0,
      expectedId:    (c as any).expectedId    || undefined,
      selfVerifiedAt: (c as any).selfVerifiedAt ? new Date((c as any).selfVerifiedAt).getTime() : undefined,
    }))

    const approved = await getApprovedMemberships(householdId)
    const known    = approved.map(m => m.id)
    const timeout  = household.timeoutSec || DEFAULT_ESCALATION_SECONDS
    for (const c of cases) {
      if (c.status === 'waiting') {
        c.deadlineAt = Date.now() + timeout * 1000
        c.log.push({ t: Date.now(), msg: 'Server restarted while this case was open. Timer restarted and helper alerted again.' })
      }
      c.chain = c.chain.length ? c.chain : known
    }

    const dbExpected  = await getExpectedVisitsForHousehold(householdId)
    const expected: ExpectedVisit[] = dbExpected.map(e => ({
      id:         e.id,
      icon:       e.icon,
      label:      e.label,
      startsAt:   e.startsAt.getTime(),
      endsAt:     e.endsAt.getTime(),
      who:        (e as any).who        || undefined,
      passphrase: (e as any).passphrase || undefined,
      codeSecret: (e as any).codeSecret || undefined,
      requestId:  (e as any).requestId  || undefined,
      singleUse:  !!(e as any).singleUse,
      usedAt:     (e as any).usedAt ? new Date((e as any).usedAt).getTime() : undefined,
    }))

    const dbRecurring = await getRecurringVisitsForHousehold(householdId)
    const recurring: RecurringVisit[] = dbRecurring.map(r => ({
      id:             r.id,
      icon:           r.icon,
      label:          r.label,
      days:           (r.days as any) || [],
      everyNWeeks:    r.everyNWeeks,
      anchorWeek:     r.anchorWeek,
      startMin:       r.startMin,
      endMin:         r.endMin,
      alertIfMissed:  r.alertIfMissed,
      paused:         r.paused,
      lastArrived:    r.lastArrived || undefined,
      lastMissedAlert: r.lastMissedAlert || undefined,
      who:            (r as any).who        || undefined,
      passphrase:     (r as any).passphrase || undefined,
    }))

    const dbDevices = await getDb().device.findMany({ where: { householdId } })
    const devices: Record<string, DeviceInfo> = {}
    for (const d of dbDevices) {
      devices[d.ringDeviceId] = { online: d.online, since: d.since.getTime(), alertedAt: d.alertedAt?.getTime() }
    }

    householdStates.set(householdId, {
      householdId,
      timezone:    household.timezone || 'UTC',
      plannedMode: asMode((household as any).plannedMode),
      cases,
      offline: false,
      timeoutSec: household.timeoutSec || DEFAULT_ESCALATION_SECONDS,
      quiet: { enabled: household.quietEnabled, startHour: household.quietStartHour, endHour: household.quietEndHour },
      expected,
      recurring,
      checkinAt:      null,
      missedAlertDay: null,
      devices,
      lastTickAt: 0,
      lastRequestSweepAt: 0,
      loaded: true,
    })
    console.log(`[STORE] Loaded state for household ${householdId}`)
  } catch (e) {
    console.error(`[STORE] Failed to load state for household ${householdId}`, e)
    householdStates.set(householdId, {
      householdId,
      timezone:    'UTC',
      plannedMode: 'helper',
      cases: [],
      offline: false,
      timeoutSec: DEFAULT_ESCALATION_SECONDS,
      quiet: { enabled: false, startHour: 22, endHour: 6 },
      expected: [],
      recurring: [],
      checkinAt:      null,
      missedAlertDay: null,
      devices: {},
      lastTickAt: 0,
      lastRequestSweepAt: 0,
      loaded: false,
    })
  }
}

// ── State persistence ─────────────────────────────────────────────────────────
// Only cases and household settings are persisted on every save.
// Visits are written once (on add) and never re-created here.

async function saveState(householdId: string, state: HouseholdState) {
  if (!state.loaded) return
  try {
    for (const c of state.cases) { await updateCase(c.id, c) }

    await updateHousehold(householdId, {
      timeoutSec:     state.timeoutSec,
      quietEnabled:   state.quiet.enabled,
      quietStartHour: state.quiet.startHour,
      quietEndHour:   state.quiet.endHour,
    })

    // Devices
    for (const [ringDeviceId, info] of Object.entries(state.devices)) {
      await getDb().device.upsert({
        where:  { householdId_ringDeviceId: { householdId, ringDeviceId } },
        update: { online: info.online, since: new Date(info.since), alertedAt: info.alertedAt ? new Date(info.alertedAt) : null },
        create: { householdId, ringDeviceId, online: info.online, since: new Date(info.since), alertedAt: info.alertedAt ? new Date(info.alertedAt) : null },
      })
    }
  } catch (e) {
    console.error(`[STORE] Failed to save state for household ${householdId}`, e)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIGGER_EVENTS = new Set(
  (process.env.RING_TRIGGER_EVENTS || 'button_press').split(',').map(s => s.trim()).filter(Boolean)
)

const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
const clean = <T>(v: T | null | undefined): T | undefined => v == null ? undefined : v

function isQuiet(state: HouseholdState, now: number): boolean {
  const q = state.quiet
  if (!q.enabled || q.startHour === q.endHour) return false
  const h = zonedHour(now, state.timezone)
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour
}

const GRACE_MS = RECURRING_GRACE_MIN * 60_000

function windowToday(v: RecurringVisit, now: number, timezone: string) {
  if (v.paused) return null
  if (!v.days.includes(zonedWeekday(now, timezone))) return null
  const day  = zonedDayNumber(now, timezone)
  const week = Math.floor((day - v.anchorWeek) / 7)
  if (week < 0 || week % v.everyNWeeks !== 0) return null
  return {
    start: zonedMinuteOnSameDay(now, timezone, v.startMin),
    end:   zonedMinuteOnSameDay(now, timezone, v.endMin),
    key:   `${v.id}:${day}`,
  }
}

/**
 * Find a planned-visit match for a doorbell ring at `now`.
 * Returns null when plannedMode is 'all-helper' (every ring goes to a helper).
 */
function matchPlanned(
  state:    HouseholdState,
  now:      number,
  timezone: string,
  forceId?: string | null
): PlannedMatch | null {
  if (state.plannedMode === 'all-helper') return null

  // 1. Recurring visits
  for (const v of state.recurring) {
    if (forceId) {
      if (v.id === forceId) return { id: v.id, icon: v.icon, label: v.label, who: v.who, passphrase: v.passphrase, key: `${v.id}:forced:${now}`, recurring: v }
      continue
    }
    const w = windowToday(v, now, timezone)
    if (w && now >= w.start - GRACE_MS && now < w.end + GRACE_MS) {
      return { id: v.id, icon: v.icon, label: v.label, who: v.who, passphrase: v.passphrase, key: w.key, recurring: v }
    }
  }

  // 2. One-off expected visits
  if (!forceId) {
    for (const e of state.expected) {
      if (e.singleUse && e.usedAt) continue
      if (now >= e.startsAt - GRACE_MS && now < e.endsAt + GRACE_MS) {
        return { id: e.id, icon: e.icon, label: e.label, who: e.who, passphrase: e.passphrase, codeSecret: e.codeSecret, key: `${e.id}:once` }
      }
    }
  }

  return null
}

function nextOccurrence(v: RecurringVisit, now: number, timezone: string): number | null {
  for (let i = 0; i <= 7 * v.everyNWeeks; i++) {
    const w = windowToday(v, now + i * 86_400_000, timezone)
    if (w && w.end > now) return w.start
  }
  return null
}

function checkMissedVisits(state: HouseholdState, now: number, timezone: string, residentName: string) {
  for (const v of state.recurring) {
    if (!v.alertIfMissed) continue
    const w = windowToday(v, now, timezone)
    if (!w || now < w.end + GRACE_MS) continue
    if (v.lastArrived === w.key || v.lastMissedAlert === w.key) continue
    v.lastMissedAlert = w.key
    updateRecurringVisit(v.id, { lastMissedAlert: w.key }).catch(() => {})
    notifyAll(state, `${v.icon} ${v.label} did not come`, `Expected today and nobody rang. Maybe call ${residentName}.`, `missed-${w.key}`)
    smsAll(state, `${v.icon} ${v.label} was expected today and nobody rang. Maybe call ${residentName}.`, residentName)
  }
}

/** Today's planned visits for the resident idle screen — no passphrases. */
function todayVisits(state: HouseholdState, now: number, timezone: string) {
  if (state.plannedMode === 'all-helper') return []
  const today   = zonedDayKey(now, timezone)
  const results: { id: string; icon: string; label: string; startsAt: number; endsAt: number; done: boolean }[] = []

  for (const v of state.recurring) {
    if (v.paused) continue
    const w = windowToday(v, now, timezone)
    if (!w) continue
    results.push({ id: v.id, icon: v.icon, label: v.label, startsAt: w.start, endsAt: w.end, done: v.lastArrived === w.key })
  }
  for (const e of state.expected) {
    // Only show visits whose window falls on today (not future dates)
    if (zonedDayKey(e.startsAt, timezone) !== today) continue
    // Mark as done if the window has fully closed (no open case needed: resident saw them)
    const done = now >= e.endsAt
    results.push({ id: e.id, icon: e.icon, label: e.label, startsAt: e.startsAt, endsAt: e.endsAt, done })
  }
  return results.sort((a, b) => a.startsAt - b.startsAt)
}

const dayKey      = (ms: number, tz: string) => zonedDayKey(ms, tz)
const dueAt       = (now: number, tz: string) => zonedHourOnSameDay(now, tz, CHECKIN_HOUR)
const checkedInToday = (state: HouseholdState, now: number, tz: string) =>
  state.checkinAt !== null && dayKey(state.checkinAt, tz) === dayKey(now, tz)

function checkMissedCheckin(state: HouseholdState, now: number, timezone: string, residentName: string) {
  const key  = dayKey(now, timezone)
  const late = now >= dueAt(now, timezone) + CHECKIN_GRACE_MIN * 60_000
  if (!late || checkedInToday(state, now, timezone) || state.missedAlertDay === key) return
  state.missedAlertDay = key
  notifyAll(state, '⚠️ No check-in today', `${residentName} has not pressed "I'm OK" yet. Please call.`, `checkin-${key}`)
  smsAll(state, `${residentName} has not checked in today. Please call.`, residentName)
}

function notifyAll(state: HouseholdState, title: string, body: string, caseId: string) {
  getApprovedMemberships(state.householdId).then(memberships => {
    memberships.forEach(m => pushToMembership(m.id, { title, body, tag: caseId, url: '/helper' }).catch(e => console.error('[PUSH]', e)))
  })
}

function smsAll(state: HouseholdState, body: string, residentName: string, urgent = true) {
  getApprovedMemberships(state.householdId).then(memberships => {
    memberships.forEach(m => {
      if (m.user.phone) sendSms(m.user.phone, body, { urgent }).catch(e => console.error('[SMS]', e))
    })
  })
}

function alertSos(state: HouseholdState, c: DoorCase, residentName: string) {
  notifyAll(state, '🆘 Resident needs help', 'Open the app now.', c.id)
  smsAll(state, `${residentName} pressed "I need help". Please call now.`, residentName, true)
  addLog(c, 'Push and SMS sent to all helpers.')
}

const addLog = (c: DoorCase, msg: string) => { c.log.push({ t: Date.now(), msg }) }

// ── Public read functions ─────────────────────────────────────────────────────

export async function getState(householdId: string, view: 'resident' | 'helper' = 'helper', membershipId?: string) {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) return null

  await tick(householdId)
  const now      = Date.now()
  const resident = view === 'resident'
  const cur      = activeCase(state, now)
  const tz       = household.timezone

  const memberships = await getApprovedMemberships(householdId)
  const pub = (m: any, withPhone: boolean) => ({
    id: m.id, name: m.user.name, emoji: m.emoji,
    ...(withPhone ? { phone: m.user.phone } : {})
  })

  // For resident view: strip checkWho/checkWord/checkMode unless it is an expected waiting case
  const currentForResident = cur ? (() => {
    const base: DoorCase = { ...cur, log: [] }
    const showCheck = cur.lane === 'expected' && cur.status === 'waiting' && hasCheck(cur)
    if (!showCheck) {
      delete base.checkWho; delete base.checkWord; delete base.checkMode; delete base.checkAttempts
    } else if (cur.checkMode === 'code') {
      // Inject the live code into the resident snapshot (never stored, never sent elsewhere)
      const e = state.expected.find(x => x.id === cur.expectedId)
      if (e?.codeSecret) {
        const w = currentCode(e.codeSecret, now)
        base.checkCode       = w.code
        base.checkCodeEndsAt = w.endsAt
      }
    }
    return base
  })() : null

  return {
    now,
    me:     membershipId ?? null,
    ready:  memberships.length > 0,
    emergencyNumber: household.emergencyNumber,
    timeoutSec:  state.timeoutSec,
    offline:     state.offline || anyDeviceOffline(state),
    helpers:     memberships.map(m => pub(m, resident)),
    current:     resident ? currentForResident : cur,
    history:     resident ? [] : state.cases.slice(0, 10),
    expected:    state.expected.filter(e => e.endsAt > now).map(e => ({ ...e, passphrase: undefined, codeSecret: undefined })),
    expectedNow: state.expected
      .filter(e => e.startsAt <= now && now < e.endsAt)
      .map(e => ({ id: e.id, icon: e.icon, label: e.label, startsAt: e.startsAt, endsAt: e.endsAt })),
    timeZone:    tz,
    plannedMode: state.plannedMode,
    todayVisits: resident ? todayVisits(state, now, tz) : [],
    recurring: resident ? [] : state.recurring.map(v => ({ ...v, next: nextOccurrence(v, now, tz) })),
    recurringNow: state.recurring.flatMap(v => {
      const w = windowToday(v, now, tz)
      return w && now >= w.start - GRACE_MS && now < w.end + GRACE_MS
        ? [{ id: v.id, icon: v.icon, label: v.label, endsAt: w.end }]
        : []
    }),
    checkin:   { doneToday: checkedInToday(state, now, tz), dueHour: CHECKIN_HOUR },
    quietNow:  isQuiet(state, now),
    alerts:    resident ? null : alertStatus(now),
    devices:   state.devices,
  }
}

export async function getHistory(householdId: string) {
  const state       = await getOrCreateState(householdId)
  const memberships = await getApprovedMemberships(householdId)
  return {
    helpers: memberships.map(m => ({ id: m.id, name: m.user.name, emoji: m.emoji })),
    cases:   state.cases
  }
}

export async function getSetup(householdId: string) {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) return null

  const memberships = await dbGetMembershipsForHousehold(householdId)
  const now = Date.now()

  return {
    members: memberships.map(m => ({
      id: m.id, name: m.user.name, phone: m.user.phone, emoji: m.emoji, consent: m.consent, role: m.role,
    })),
    quiet:       state.quiet,
    timeoutSec:  state.timeoutSec,
    ready:       memberships.some(m => m.consent === 'approved'),
    timeZone:    household.timezone,
    plannedMode: state.plannedMode,
    expected:    state.expected.map(e => ({ ...e, codeSecret: undefined })),
    recurring:   state.recurring.map(v => ({ ...v, next: nextOccurrence(v, now, household.timezone) })),
  }
}

// ── Case lifecycle ────────────────────────────────────────────────────────────

function activeCase(state: HouseholdState, now = Date.now()): DoorCase | null {
  const c = state.cases[0]
  if (!c) return null
  if (c.status === 'waiting') return c
  const awaitingConfirm = c.status === 'answered' && c.answer === 'safe' && !c.confirmedAt && !c.declinedAt
  const age = now - (c.resolvedAt ?? c.createdAt)
  const ttl = c.status === 'no_response' || awaitingConfirm ? NO_RESPONSE_TTL_MS : RESULT_TTL_MS
  return age < ttl ? c : null
}

async function openCase(
  state:            HouseholdState,
  kind:             CaseKind,
  eventType:        string,
  note:             string,
  deviceId:         string | null = null,
  forceRecurringId: string | null = null
): Promise<DoorCase> {
  const household = await getHousehold(state.householdId)
  if (!household) throw new Error('Household not found')

  const now      = Date.now()
  const m        = kind === 'visitor' ? matchPlanned(state, now, household.timezone, forceRecurringId) : null
  const hasSecret     = !!m?.codeSecret
  const residentCheck = !!m && state.plannedMode === 'resident' && (!!m.passphrase || hasSecret)
  const secs     = m ? EXPECTED_TIMEOUT_SECONDS : state.timeoutSec
  const approved = await getApprovedMemberships(state.householdId)

  const c: DoorCase = {
    id:          newId('case'),
    kind,
    eventType,
    createdAt:   now,
    helperIndex: 0,
    deadlineAt:  now + secs * 1000,
    status:      'waiting',
    log:         [],
    chain:       approved.map(m => m.id),
    deviceId,
    lane:        m ? 'expected' : 'normal',
    recurringId: m?.recurring?.id,
    visitIcon:   m?.icon,
    visitLabel:  m?.label,
    checkWho:    m ? (m.who || m.label) : undefined,
    checkMode:   residentCheck ? (hasSecret ? 'code' : 'word') : undefined,
    checkAttempts: 0,
    checkWord:   residentCheck && !hasSecret ? m!.passphrase : undefined,
    expectedId:  m && !m.recurring ? m.id : undefined,
  }

  addLog(c, note)

  if (m) {
    if (m.recurring) {
      // Persist lastArrived on the recurring rule
      m.recurring.lastArrived = m.key
      updateRecurringVisit(m.recurring.id, { lastArrived: m.key }).catch((e) => console.error('[STORE] could not save arrival mark', e))
    }
    if (residentCheck) {
      addLog(c, `Planned visit: ${m.icon} ${m.label}. Resident will verify the pass-word first.`)
    } else {
      addLog(c, `Planned visit: ${m.icon} ${m.label}. Quiet alert, helper confirms.`)
    }
  }

  if (!approved.length) addLog(c, 'NO APPROVED HELPERS. Nobody can be alerted. Finish setup.')
  addLog(c, `Asked ${approved[0]?.user.name ?? 'a helper'}. ${secs}s to answer.`)

  if (kind === 'visitor' && approved[0]) {
    if (m && !residentCheck) {
      pushToMembership(approved[0].id, { title: `${m.icon} ${m.label} may be at the door`, body: 'Open the app and confirm. One tap.', tag: c.id, url: '/helper' })
    } else if (m && residentCheck) {
      pushToMembership(approved[0].id, { title: `${m.icon} ${m.label} may be here`, body: `Resident is checking${hasSecret ? ' a number' : ' a pass-word'}. You will be notified.`, tag: c.id, url: '/helper' })
    } else {
      pushToMembership(approved[0].id, { title: '🚪 Someone is at the door', body: `Open the app. You have ${state.timeoutSec}s.`, tag: c.id, url: '/helper' })
      if (approved[0].user.phone) {
        sendSms(approved[0].user.phone, `Someone is at ${household.residentName}'s door. Open the helper app now. You have ${state.timeoutSec}s.`, { urgent: true })
      }
    }
  }

  state.cases.unshift(c)
  if (state.cases.length > 200) state.cases.pop()
  await createCase({ ...c, householdId: state.householdId })

  if (kind === 'sos') alertSos(state, c, household.residentName)
  return c
}

export async function ingestEvent(householdId: string, event: { event_type: string; event_id?: string; device_id?: string | null; raw?: any }): Promise<DoorCase | null> {
  const state = await getOrCreateState(householdId)
  if (state.offline) return null
  if (!TRIGGER_EVENTS.has(event.event_type)) return null

  await tick(householdId)
  const existing = activeCase(state)
  if (existing && existing.status === 'waiting') {
    addLog(existing, `Another ${event.event_type} event merged into this case (no second alert).`)
    await updateCase(existing.id, existing)
    return null  // Return null to indicate the event was merged into an existing case
  }

  const c = await openCase(state, 'visitor', event.event_type, `Ring sent ${event.event_type}.`, event.device_id ?? null, null)
  void import('@/face/camera').then((m) => m.onCameraEvent(householdId, { caseId: c.id, deviceId: event.device_id ?? null })).catch(() => {})
  return c
}

export async function raiseSos(householdId: string): Promise<DoorCase> {
  const state = await getOrCreateState(householdId)
  await tick(householdId)
  const existing = activeCase(state)
  if (existing && existing.status === 'waiting') {
    if (existing.kind === 'sos') return existing
    existing.kind = 'sos'
    addLog(existing, 'Resident pressed "I need help".')
    const household = await getHousehold(householdId)
    if (household) alertSos(state, existing, household.residentName)
    await updateCase(existing.id, existing)
    return existing
  }
  return openCase(state, 'sos', 'sos', 'Resident pressed "I need help".')
}

export async function ackCase(householdId: string, caseId: string, membershipId: string): Promise<{ ok: true; case: DoorCase } | { ok: false; error: string; status: number }> {
  const state = await getOrCreateState(householdId)
  const c     = state.cases.find(x => x.id === caseId)
  if (!c) return { ok: false, error: 'case not found', status: 404 }

  const membership = await getMembership(membershipId)
  if (!membership || membership.consent !== 'approved' || !c.chain.includes(membershipId)) {
    return { ok: false, error: 'not allowed', status: 403 }
  }

  if (!c.ackedAt) {
    c.ackedAt = Date.now(); c.ackedBy = membershipId
    addLog(c, `${membership.user.name} saw the alert.`)
    await updateCase(c.id, c)
  }
  return { ok: true, case: c }
}

export async function logView(householdId: string, caseId: string, membershipId: string, what: string) {
  const state = await getOrCreateState(householdId)
  const c     = state.cases.find(x => x.id === caseId)
  if (!c) return
  const membership = await getMembership(membershipId)
  addLog(c, `${membership?.user.name ?? membershipId} ${what}.`)
  await updateCase(c.id, c)
}

export const caseDevice = (householdId: string, caseId: string) => {
  const state = householdStates.get(householdId)
  if (!state) return null
  return state.cases.find(x => x.id === caseId)?.deviceId ?? null
}

export const isCaseOpenFor = async (householdId: string, caseId: string, membershipId: string) => {
  const state      = await getOrCreateState(householdId)
  const c          = state.cases.find(x => x.id === caseId)
  const membership = await getMembership(membershipId)
  return !!c && !!membership && membership.consent === 'approved' && c.chain.includes(membershipId) && Date.now() - c.createdAt < 30 * 60_000
}

// ── Self-verify (resident checks pass-word or live code) ──────────────────────

const hasCheck = (c: DoorCase) => !!c.checkWord || c.checkMode === 'code'

async function markUsed(state: HouseholdState, c: DoorCase) {
  if (!c.expectedId) return
  const e = state.expected.find(x => x.id === c.expectedId)
  if (!e || !e.singleUse || e.usedAt) return
  e.usedAt = Date.now()
  await markExpectedUsed(e.id, e.usedAt).catch(err => console.error('[STORE] could not mark visit used', err))
}

export async function selfVerify(
  householdId: string,
  caseId:      string,
  ok:          boolean
): Promise<DoorCase | null> {
  const state     = await getOrCreateState(householdId)
  const c         = state.cases.find(x => x.id === caseId)
  if (!c) return null
  // Only applicable to a waiting expected-visitor case that has a check
  if (c.kind !== 'visitor' || c.status !== 'waiting' || c.lane !== 'expected' || !hasCheck(c)) return null

  const household = await getHousehold(householdId)
  if (!household) return null
  const now      = Date.now()
  const approved = await getApprovedMemberships(householdId)

  if (ok) {
    // Resident confirmed → case resolved as safe
    c.status         = 'answered'
    c.answer         = 'safe'
    c.selfVerifiedAt = now
    c.confirmedAt    = now
    c.resolvedAt     = now
    addLog(c, `Resident confirmed the visitor (${c.checkWho ?? c.visitLabel}). Door can be opened.`)
    // Mark the single-use visit as used
    await markUsed(state, c)
    // Notify all helpers; they can still override to not_safe within 5 min
    approved.forEach(m => pushToMembership(m.id, {
      title: `${c.visitIcon ?? '👤'} ${c.visitLabel ?? 'Visitor'} verified`,
      body:  `${household.residentName} confirmed the visitor. You can still say Don't open.`,
      tag: c.id, url: '/helper'
    }))
  } else if (c.checkMode === 'code' && (c.checkAttempts ?? 0) + 1 < CODE_MAX_ATTEMPTS) {
    // Code mode — first "No": grant one retry
    c.checkAttempts = (c.checkAttempts ?? 0) + 1
    addLog(c, `Resident said the number did not match. Asked them to have it read out again. (attempt ${c.checkAttempts}/${CODE_MAX_ATTEMPTS})`)
  } else {
    // Word mode first "No", or code mode second "No" → demote to normal lane
    c.lane       = 'normal'
    c.checkWord  = undefined
    c.checkMode  = undefined
    c.deadlineAt = now + state.timeoutSec * 1000
    addLog(c, 'Resident said the visitor did NOT pass the check. Treated as an unknown visitor: full alert and SMS.')
    const first = approved.find(m => m.id === c.chain[c.helperIndex])
    if (first) {
      pushToMembership(first.id, { title: '🚪 Someone is at the door', body: `The expected visitor did not pass the check. Open the app. You have ${state.timeoutSec}s.`, tag: c.id, url: '/helper' })
      if (first.user.phone) sendSms(first.user.phone, `Someone is at ${household.residentName}'s door and did not pass the check. Open the helper app now. You have ${state.timeoutSec}s.`, { urgent: true })
    }
  }

  await updateCase(c.id, c)
  return c
}

// ── answerCase ────────────────────────────────────────────────────────────────

export async function answerCase(
  householdId:  string,
  caseId:       string,
  membershipId: string,
  answer:       Answer,
  visitor?:     Visitor
): Promise<{ ok: true; case: DoorCase } | { ok: false; error: string; status: number }> {
  const state = await getOrCreateState(householdId)
  await tick(householdId)
  const c = state.cases.find(x => x.id === caseId)
  if (!c) return { ok: false, error: 'case not found', status: 404 }

  const membership = await getMembership(membershipId)
  if (!membership || membership.consent !== 'approved' || !c.chain.includes(membershipId)) {
    return { ok: false, error: 'You are not allowed to answer this case', status: 403 }
  }

  // Special case: resident self-verified safe but a helper overrides to not_safe within 5 min
  if (
    c.status === 'answered' &&
    c.selfVerifiedAt &&
    !c.answeredBy &&
    answer === 'not_safe' &&
    Date.now() - c.selfVerifiedAt < 5 * 60_000
  ) {
    c.answer      = 'not_safe'
    c.answeredBy  = membershipId
    c.confirmedAt = undefined
    c.declinedAt  = Date.now()
    c.resolvedAt  = Date.now()
    addLog(c, `${membership.user.name} overrode self-verification: NOT SAFE.`)
    await updateCase(c.id, c)
    return { ok: true, case: c }
  }

  if (c.status === 'answered') {
    if (c.answeredBy === membershipId) return { ok: true, case: c }
    return { ok: false, error: 'This case was already answered', status: 409 }
  }

  if (c.status === 'waiting' && c.kind === 'visitor' && c.chain.indexOf(membershipId) > c.helperIndex) {
    return { ok: false, error: 'It is not your turn yet', status: 409 }
  }

  c.status     = 'answered'
  c.answer     = answer
  c.visitor    = visitor
  c.answeredBy = membershipId
  c.resolvedAt = Date.now()
  const label  = answer === 'safe' ? 'SAFE' : answer === 'not_safe' ? 'NOT SAFE' : 'will CALL the resident'
  addLog(c, `${membership.user.name} answered: ${label}.`)
  if (answer === 'safe') await markUsed(state, c)
  await updateCase(c.id, c)
  return { ok: true, case: c }
}

export async function confirmCase(householdId: string, caseId: string, ok: boolean): Promise<DoorCase | null> {
  const state = await getOrCreateState(householdId)
  const c     = state.cases.find(x => x.id === caseId)
  if (!c || c.status !== 'answered' || c.answer !== 'safe') return null

  if (ok && isQuiet(state, Date.now())) {
    c.declinedAt = Date.now(); c.resolvedAt = Date.now()
    addLog(c, 'Night lock is on. The door stays closed.')
  } else {
    if (ok) c.confirmedAt = Date.now()
    else    c.declinedAt  = Date.now()
    c.resolvedAt = Date.now()
    addLog(c, ok ? 'Resident confirmed: opening the door.' : 'Resident chose to keep the door closed.')
  }
  await updateCase(c.id, c)
  return c
}

// ── Device management ─────────────────────────────────────────────────────────

export async function setDeviceOnline(householdId: string, deviceId: string, online: boolean, source: string) {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) return

  const prev = state.devices[deviceId]
  if (prev && prev.online === online) return

  const now = Date.now()
  state.devices[deviceId] = { online, since: now, alertedAt: prev?.alertedAt }

  if (!online) {
    state.devices[deviceId].alertedAt = now
    notifyAll(state, '⚠️ Doorbell offline', `The doorbell cannot be reached (${source}). ${household.residentName} will NOT be alerted about visitors.`, `device-${deviceId}`)
    smsAll(state, `Doorbell for ${household.residentName} is OFFLINE. Visitors will not be detected. Please check it and call ${household.residentName}.`, household.residentName, false)
  } else if (prev) {
    notifyAll(state, '✅ Doorbell back online', 'The doorbell is working again.', `device-${deviceId}`)
  }

  await saveState(householdId, state)
}

export const anyDeviceOffline = (state: HouseholdState) => Object.values(state.devices).some(d => !d.online)

const pollingHouseholds    = new Set<string>()
const ringFailuresByHousehold = new Map<string, number>()

async function pollDevicesForHousehold(householdId: string) {
  if (pollingHouseholds.has(householdId)) return
  if (!(await ringConfiguredForHousehold(householdId))) return
  pollingHouseholds.add(householdId)
  try {
    const connection = await getConnectionForHousehold(householdId)
    if (!connection) return
    const ids = await listDeviceIds(connection.id)
    for (const d of ids) {
      const online = await fetchDeviceOnline(connection.id, d)
      await setDeviceOnline(householdId, d, online, 'status check')
    }
    ringFailuresByHousehold.set(householdId, 0)
  } catch (e) {
    const failures = (ringFailuresByHousehold.get(householdId) || 0) + 1
    ringFailuresByHousehold.set(householdId, failures)
    if (failures % 10 === 0) console.error(`[RING] status poll failed for household ${householdId}`, failures, e)
    if (failures === 3) await setDeviceOnline(householdId, 'ring-api', false, 'Ring cannot be reached')
  } finally {
    pollingHouseholds.delete(householdId)
  }
}

// ── Visits: add / remove ──────────────────────────────────────────────────────

export async function addExpected(
  householdId: string,
  icon: string, label: string, startsAt: number, endsAt: number,
  who?: string, passphrase?: string
): Promise<ExpectedVisit> {
  const state = await getOrCreateState(householdId)
  const e: ExpectedVisit = { id: newId('exp'), icon, label, startsAt, endsAt, who: clean(who), passphrase: clean(passphrase) }
  await createExpectedVisit({ householdId, ...e })   // write first: a failed write leaves nothing half-created in memory
  state.expected.push(e)
  return e
}

/** Create an ExpectedVisit from an approved VisitRequest (code-mode, single-use). */
export async function addExpectedFromRequest(
  householdId: string,
  r: { requestId: string; name: string; purpose: Purpose; startsAt: number; endsAt: number }
): Promise<ExpectedVisit> {
  const state = await getOrCreateState(householdId)
  const p = PURPOSES[r.purpose] ?? PURPOSES.other
  const e: ExpectedVisit = {
    id:         newId('exp'),
    icon:       p.icon,
    label:      p.label,
    startsAt:   r.startsAt,
    endsAt:     r.endsAt,
    who:        clean(r.name),
    codeSecret: newSecret(),
    requestId:  r.requestId,
    singleUse:  true,
  }
  await createExpectedVisit({ householdId, ...e })
  state.expected.push(e)
  return e
}

/** Return the current rotating code for a visit, or a state string if unavailable. */
export async function visitCodeFor(householdId: string, expectedId: string, now = Date.now()) {
  const state = await getOrCreateState(householdId)
  const e = state.expected.find(x => x.id === expectedId)
  if (!e || !e.codeSecret) return { state: 'gone' as const }
  if (e.usedAt)            return { state: 'used' as const }
  if (now < e.startsAt - GRACE_MS) return { state: 'early' as const }
  if (now >= e.endsAt + GRACE_MS)  return { state: 'late' as const }
  return { state: 'ok' as const, ...currentCode(e.codeSecret, now) }
}

export async function removeExpected(householdId: string, id: string) {
  const state = await getOrCreateState(householdId)
  const e = state.expected.find(x => x.id === id)
  state.expected = state.expected.filter(e => e.id !== id)
  await deleteExpectedVisit(householdId, id)
  // If this visit was created from a request, notify the visitor it was cancelled
  if (e?.requestId) {
    cancelRequestForVisit(householdId, e.requestId).catch(console.error)
  }
}

export async function addRecurring(
  householdId: string,
  v: {
    icon: string; label: string; days: number[]; everyNWeeks: number
    startMin: number; endMin: number; alertIfMissed: boolean; startNextWeek: boolean
    who?: string; passphrase?: string
  }
): Promise<RecurringVisit> {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) throw new Error('Household not found')

  const now      = Date.now()
  const thisWeek = zonedDayNumber(now, household.timezone) - zonedWeekday(now, household.timezone)
  const r: RecurringVisit = {
    id:            newId('rec'),
    icon:          v.icon,
    label:         v.label,
    days:          [...new Set(v.days)].sort(),
    everyNWeeks:   v.everyNWeeks,
    anchorWeek:    thisWeek + (v.startNextWeek ? 7 : 0),
    startMin:      v.startMin,
    endMin:        v.endMin,
    alertIfMissed: v.alertIfMissed,
    paused:        false,
    who:           clean(v.who),
    passphrase:    clean(v.passphrase),
  }
  await createRecurringVisit({ householdId, ...r })   // write first
  state.recurring.push(r)
  return r
}

export async function setRecurringPaused(householdId: string, id: string, paused: boolean) {
  const state = await getOrCreateState(householdId)
  const v     = state.recurring.find(x => x.id === id)
  if (v) { v.paused = paused; await updateRecurringVisit(id, { paused }) }
}

export async function removeRecurring(householdId: string, id: string) {
  const state = await getOrCreateState(householdId)
  state.recurring = state.recurring.filter(x => x.id !== id)
  await deleteRecurringVisit(householdId, id)
}

// ── Household settings ────────────────────────────────────────────────────────

export async function checkIn(householdId: string) {
  const state  = await getOrCreateState(householdId)
  state.checkinAt = Date.now()
  await updateHousehold(householdId, {})
}

export async function setQuiet(householdId: string, q: Quiet) {
  const state = await getOrCreateState(householdId)
  state.quiet = { enabled: !!q.enabled, startHour: q.startHour, endHour: q.endHour }
  await updateHousehold(householdId, { quietEnabled: q.enabled, quietStartHour: q.startHour, quietEndHour: q.endHour })
}

export async function setOffline(householdId: string, v: boolean) {
  const state = await getOrCreateState(householdId)
  state.offline = v
}

export async function setTimeoutSec(householdId: string, n: number) {
  const state = await getOrCreateState(householdId)
  state.timeoutSec = Math.max(3, Math.min(600, Math.floor(n)))
  await updateHousehold(householdId, { timeoutSec: state.timeoutSec })
}

export async function setPlannedMode(householdId: string, mode: PlannedMode) {
  const state      = await getOrCreateState(householdId)
  state.plannedMode = mode
  await updateHousehold(householdId, { plannedMode: mode })
}

export async function resetAll(householdId: string) {
  const state = await getOrCreateState(householdId)
  state.cases.length = 0
  state.offline      = false
  state.devices      = {}
  state.recurring    = []
  state.expected     = []
  // Re-read plannedMode from DB so tests that change it don't bleed into the next test
  const household = await getHousehold(householdId)
  if (household) state.plannedMode = asMode((household as any).plannedMode)
  await deleteOldCases(householdId, 0)
  await deleteOldExpectedVisits(householdId)
}

// ── Alert status ──────────────────────────────────────────────────────────────

const DEGRADED_FAILS = 3
let lastDegradedPushAt = 0

export function alertStatus(now = Date.now()) {
  const f = recentFailures(now)
  return { degraded: f.push >= DEGRADED_FAILS, recentSmsFailures: f.sms, recentPushFailures: f.push }
}

function warnIfAlertsFailing(state: HouseholdState, now: number) {
  const a = alertStatus(now)
  if (!a.degraded || now - lastDegradedPushAt < 60 * 60_000) return
  lastDegradedPushAt = now
  notifyAll(state, '⚠️ Alerts may not reach you', 'Some alerts failed to send. Check the helper app and call the resident if unsure.', 'alerts-degraded')
}

export const resetAlertWarning = () => { lastDegradedPushAt = 0 }

// ── Tick ──────────────────────────────────────────────────────────────────────

export async function tick(householdId?: string) {
  if (householdId) {
    const state     = await getOrCreateState(householdId)
    const household = await getHousehold(householdId)
    if (!household) return

    const now = Date.now()
    state.lastTickAt = now
    warnIfAlertsFailing(state, now)

    for (const c of state.cases) {
      if (c.status !== 'waiting') continue
      while (c.status === 'waiting' && now >= c.deadlineAt) {
        if (c.lane === 'expected') {
          c.lane       = 'normal'
          c.deadlineAt += state.timeoutSec * 1000
          addLog(c, `Nobody confirmed the expected visit in ${EXPECTED_TIMEOUT_SECONDS}s. Treated as an unknown visitor: normal alert and SMS.`)

          const approved = await getApprovedMemberships(householdId)
          const first    = approved.find(m => m.id === c.chain[c.helperIndex])
          if (first) {
            pushToMembership(first.id, { title: '🚪 Someone is at the door', body: `Nobody confirmed the expected visit. Open the app. You have ${state.timeoutSec}s.`, tag: c.id, url: '/helper' })
            if (first.user.phone) {
              sendSms(first.user.phone, `Someone is at ${household.residentName}'s door. Open the helper app now. You have ${state.timeoutSec}s.`, { urgent: true })
            }
          }
          continue
        }

        const fromId = c.chain[c.helperIndex]
        const from   = await getMembership(fromId)
        c.helperIndex += 1

        if (c.helperIndex >= c.chain.length) {
          c.status     = 'no_response'
          c.resolvedAt = c.deadlineAt
          addLog(c, `${from?.user.name ?? 'Someone'} did not answer. Nobody left to ask. Resident told to keep door closed.`)
          smsAll(state, `Doorbell: nobody answered for ${household.residentName}. Please call them now.`, household.residentName, true)
          addLog(c, 'SMS sent to all helpers.')
        } else {
          const toId = c.chain[c.helperIndex]
          const to   = await getMembership(toId)
          c.deadlineAt += state.timeoutSec * 1000
          addLog(c, `${from?.user.name ?? 'Someone'} did not answer in ${state.timeoutSec}s. Escalated to ${to?.user.name ?? 'next helper'}.`)
          if (to) {
            pushToMembership(to.id, { title: `🚪 ${from?.user.name ?? 'Someone'} did not answer`, body: 'It is your turn. Open the app.', tag: c.id, url: '/helper' })
            if (to.user.phone) {
              sendSms(to.user.phone, `Doorbell for ${household.residentName}: ${from?.user.name ?? 'the first helper'} did not answer. It is your turn. Open the helper app now.`, { urgent: true })
            }
          }
        }
      }
    }

    checkMissedCheckin(state, now, household.timezone, household.residentName)
    checkMissedVisits(state, now, household.timezone, household.residentName)

    // Throttled request sweep (~every 30 s per household)
    if (now - state.lastRequestSweepAt > 30_000) {
      state.lastRequestSweepAt = now
      sweepRequests(householdId, now).catch(e => console.error('[STORE] request sweep failed', e))
    }
  } else {
    for (const [hid] of householdStates) { await tick(hid) }
  }
}

export async function getHealth() {
  const now    = Date.now()
  const states = Array.from(householdStates.values())
  return {
    tickAgeMs:       states.length > 0 ? now - Math.max(...states.map(s => s.lastTickAt)) : null,
    ready:           states.some(s => s.cases.some(c => c.status === 'waiting')),
    anyDeviceOffline: states.some(s => anyDeviceOffline(s)),
    openCases:       states.reduce((sum, s) => sum + s.cases.filter(c => c.status === 'waiting').length, 0),
    alerts:          alertStatus(now),
  }
}

// ── Global scheduler ──────────────────────────────────────────────────────────

const gt = globalThis as unknown as { __doorbellTimer?: ReturnType<typeof setInterval>; __doorbellPoll?: ReturnType<typeof setInterval> }

if (!gt.__doorbellTimer) {
  gt.__doorbellTimer = setInterval(() => tick(), 1000)
  gt.__doorbellTimer.unref?.()
}

if (!gt.__doorbellPoll) {
  gt.__doorbellPoll = setInterval(async () => {
    for (const householdId of householdStates.keys()) { await pollDevicesForHousehold(householdId) }
  }, 60_000)
  gt.__doorbellPoll.unref?.()

  setInterval(async () => {
    for (const householdId of householdStates.keys()) {
      const connection = await getConnectionForHousehold(householdId)
      if (connection) forceRefreshConnection(connection.id).catch(e => console.error('[RING] daily refresh failed', e))
    }
  }, 24 * 60 * 60_000).unref?.()
}

async function getAllMembershipsForHousehold(householdId: string) {
  return getDb().membership.findMany({ where: { householdId }, include: { user: true }, orderBy: { position: 'asc' } })
}
