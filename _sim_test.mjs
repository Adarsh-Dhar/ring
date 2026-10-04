/**
 * Simulation route integration test.
 * Usage:  node _sim_test.mjs <otp>
 *
 * Get the OTP by running: curl -s -X POST http://localhost:3000/api/auth/send-otp \
 *   -H "Content-Type: application/json" -d '{"email":"dharadarsh0@gmail.com"}'
 * then reading the OTP printed in the Next.js server terminal.
 */

const BASE  = 'http://localhost:3000'
const EMAIL = '+918926130730'
const OTP   = process.argv[2]

if (!OTP || !/^\d{6}$/.test(OTP)) {
  console.error('Usage: node _sim_test.mjs <6-digit-otp>')
  process.exit(1)
}

let cookie = ''
let passed = 0, failed = 0

function p(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`) }
  else       { failed++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`) }
  return cond
}

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const r = await fetch(`${BASE}${path}`, opts)
  const sc = r.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  let json
  try { json = await r.json() } catch { json = {} }
  return { status: r.status, ok: r.ok, json }
}

const post = (path, body) => req('POST', path, body)
const get  = (path)       => req('GET',  path)
const sim  = (body)       => post('/api/dev/simulate', body)

// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══ 0. HEALTH ═══════════════════════════════════════════════')
const health = await get('/api/health')
// In DEMO_MODE, health check may return 503 initially (tickAgeMs=null is acceptable)
p('server is up', health.status === 200 || health.status === 503, JSON.stringify(health.json))

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 1. AUTH ══════════════════════════════════════════════════')

// OTP was passed in as argv[2] — skip requesting a new one

const verify = await post('/api/auth/verify-otp', { phone: EMAIL, otp: OTP })
p('verify-otp 200', verify.status === 200, verify.json.error ?? '')

if (!verify.ok) {
  console.error('\nOTP rejected — run send-otp again and pass the new code.')
  process.exit(1)
}

// Select household (first membership)
const memberships = verify.json.memberships ?? []
p('has at least one household', memberships.length > 0, `found ${memberships.length}`)
if (!memberships.length) { console.error('No household — run onboarding first'); process.exit(1) }

const selectHH = await post('/api/auth/select-household', { membershipId: memberships[0].id })
p('select-household 200', selectHH.status === 200, selectHH.json.error ?? '')
if (!selectHH.ok) { console.error('Could not select household'); process.exit(1) }

console.log(`  → Signed in as ${selectHH.json.role} of "${selectHH.json.residentName}"`)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 2. UNAUTHENTICATED GUARD ═════════════════════════════════')

const savedCookie = cookie
cookie = ''
const noAuthGet  = await get('/api/dev/simulate')
p('GET without session → 401', noAuthGet.status === 401)
const noAuthPost = await sim({ action: 'state' })
p('POST without session → 401', noAuthPost.status === 401)
cookie = savedCookie

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 3. DEMO_MODE CHECK ════════════════════════════════════════')

const demoCheck = await get('/api/dev/simulate')
p('GET returns enabled:true (DEMO_MODE=1)', demoCheck.json.enabled === true, JSON.stringify(demoCheck.json))

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 4. INPUT VALIDATION ══════════════════════════════════════')

const badDevice = await sim({ action: 'event', event: 'button_press', device: 'notvalid' })
p('device without sim- prefix → 400', badDevice.status === 400, badDevice.json.error)

const badAction = await sim({ action: 'not_real_action' })
p('unknown action → 400', badAction.status === 400)

const badEvent = await sim({ action: 'event', event: 'fake_event' })
p('unknown event type → 400', badEvent.status === 400)

const missingCaseId = await sim({ action: 'ack', caseId: '' })
p('empty caseId → 400', missingCaseId.status === 400)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 5. RESET (clean slate) ════════════════════════════════════')

const reset = await sim({ action: 'reset' })
p('reset → ok', reset.ok && reset.json.result === 'reset')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 6. STATE (empty after reset) ══════════════════════════════')

const stateEmpty = await sim({ action: 'state' })
p('state returns ok', stateEmpty.ok, stateEmpty.json.error ?? '')
p('no active case after reset', stateEmpty.json.state?.current === null)
console.log(`  → timeout=${stateEmpty.json.state?.timeoutSec}s, mode=${stateEmpty.json.state?.plannedMode}`)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 7. SETTINGS ════════════════════════════════════════════════')

const setTimeout10 = await sim({ action: 'timeout', value: 10 })
p('timeout set to 10', setTimeout10.ok && setTimeout10.json.value === 10)

const setMode = await sim({ action: 'plannedMode', mode: 'all-helper' })
p('plannedMode set to all-helper', setMode.ok && setMode.json.mode === 'all-helper')

const setModeBack = await sim({ action: 'plannedMode', mode: 'helper' })
p('plannedMode restored to helper', setModeBack.ok)

const setQuietOn = await sim({ action: 'quiet', enabled: true })
p('quiet enabled', setQuietOn.ok && setQuietOn.json.enabled === true)

const setQuietOff = await sim({ action: 'quiet', enabled: false })
p('quiet disabled', setQuietOff.ok && setQuietOff.json.enabled === false)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 8. DEVICE EVENTS ══════════════════════════════════════════')

const offline = await sim({ action: 'event', event: 'device_offline', device: 'sim-front-door' })
p('device_offline processed', offline.ok && offline.json.result === 'processed')

const online = await sim({ action: 'event', event: 'device_online', device: 'sim-front-door' })
p('device_online processed', online.ok && online.json.result === 'processed')

const stateAfterDevice = await sim({ action: 'state' })
const devices = stateAfterDevice.json.state?.devices ?? {}
p('sim-front-door appears in devices', 'sim-front-door' in devices, JSON.stringify(devices['sim-front-door'] ?? 'missing'))

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 9. DOORBELL PRESS → OPEN CASE ═════════════════════════════')

await sim({ action: 'reset' })   // ensure clean state

const ring = await sim({ action: 'event', event: 'button_press', device: 'sim-front-door' })
p('button_press creates a case', ring.ok && !!ring.json.caseId, ring.json.result)
const caseId = ring.json.caseId

// Duplicate ring should be merged (ignored, not a new case)
const ring2 = await sim({ action: 'event', event: 'button_press', device: 'sim-front-door' })
p('second ring is merged/ignored', ring2.ok && ring2.json.result === 'ignored', ring2.json.reason ?? ring2.json.result)

// State shows the open case
const stateOpen = await sim({ action: 'state' })
p('state shows active case', stateOpen.json.state?.current?.id === caseId)
p('case status is waiting', stateOpen.json.state?.current?.status === 'waiting')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 10. HELPER ACTIONS ════════════════════════════════════════')

const ack = await sim({ action: 'ack', caseId })
p('ack succeeds', ack.ok && ack.json.result === 'acked', `by: ${ack.json.by}`)

const answer = await sim({ action: 'answer', caseId, answer: 'safe', visitor: 'known' })
p('answer safe/known succeeds', answer.ok && answer.json.result === 'answered', answer.json.error ?? `by: ${answer.json.by}`)

const stateAnswered = await sim({ action: 'state' })
p('case status is answered', stateAnswered.json.state?.current?.status === 'answered')
p('case answer is safe', stateAnswered.json.state?.current?.answer === 'safe')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 11. RESIDENT CONFIRM ══════════════════════════════════════')

const confirm = await sim({ action: 'confirm', caseId, ok: true })
p('resident confirms open', confirm.ok && confirm.json.result === 'confirmed_open')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 12. RESIDENT CHECK-IN ═════════════════════════════════════')

const checkin = await sim({ action: 'checkin' })
p('checkin succeeds', checkin.ok && checkin.json.result === 'checked_in')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 13. SOS ════════════════════════════════════════════════════')

await sim({ action: 'reset' })

const sos = await sim({ action: 'sos' })
p('SOS raises a case', sos.ok && !!sos.json.caseId, sos.json.result)

const stateSos = await sim({ action: 'state' })
p('SOS case kind is sos', stateSos.json.state?.current?.kind === 'sos')

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 14. EXPECTED VISIT + VERIFY ═══════════════════════════════')

await sim({ action: 'reset' })
await sim({ action: 'timeout', value: 10 })
await sim({ action: 'plannedMode', mode: 'resident' })

const addExp = await sim({ action: 'expected', label: 'Test delivery', icon: '📦', passphrase: 'banana', minutes: 10 })
p('expected visit added', addExp.ok && !!addExp.json.expectedId, addExp.json.label ?? addExp.json.error)

const ringExp = await sim({ action: 'event', event: 'button_press' })
p('button_press with expected visit creates case', ringExp.ok && !!ringExp.json.caseId, ringExp.json.result)
const expCaseId = ringExp.json.caseId

const stateExp = await sim({ action: 'state' })
p('expected case lane is expected', stateExp.json.state?.current?.lane === 'expected')
p('check mode set (resident mode)', !!stateExp.json.state?.current?.checkMode, stateExp.json.state?.current?.checkMode)

// Resident says Yes
const verifyOk = await sim({ action: 'verify', caseId: expCaseId, ok: true })
p('resident verifies pass-word ok', verifyOk.ok, verifyOk.json.error ?? verifyOk.json.result)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 15. MOTION EVENT ══════════════════════════════════════════')

await sim({ action: 'reset' })
const motion = await sim({ action: 'event', event: 'motion_detected' })
// Should create a case (RING_TRIGGER_EVENTS includes motion_detected in .env.local)
p('motion_detected processed or noted', motion.ok, `result=${motion.json.result}, reason=${motion.json.reason ?? 'n/a'}`)

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ 16. FINAL RESET ════════════════════════════════════════════')

const finalReset = await sim({ action: 'reset' })
p('final reset ok', finalReset.ok)

const finalState = await sim({ action: 'state' })
p('state clean after reset', finalState.json.state?.current === null)

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n══ RESULTS: ${passed} passed, ${failed} failed ════════════════════════`)
if (failed > 0) process.exit(1)
