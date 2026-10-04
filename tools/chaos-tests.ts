/**
 * Chaos scenario test scripts for section 15 of the stress-test guide
 * These are end-to-end scenarios that test the system when multiple things fail
 *
 * Usage:
 *   RING_HMAC_KEY=testkey123 APP_URL=http://localhost:3000 tsx tools/chaos-tests.ts <scenario>
 *
 * Scenarios:
 *   everything-fails   - Postgres down + Twilio wrong key + push revoked + Ring offline
 *   long-night         - Quiet hours + expected visit + wrong pass-word
 *   helper-chaos       - Helper H1 no answer, H2 answers safe, H1 answers not-safe
 *   impersonator       - Attacker knows expected visit, rings, gives wrong pass-word twice
 *   rapid-events       - Ring, SOS, device offline, ring again within 5 seconds
 *   restart-escalation - Restart mid-escalation while second helper's timer running
 *   worker-kill        - Kill timer worker mid-escalation (v2)
 *   redis-fail         - Redis failure during notification (v2)
 *   network-partition  - Network partition between webhook and worker (v2)
 */

import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:3000'
const KEY = process.env.RING_HMAC_KEY

if (!KEY) {
  console.error('Set RING_HMAC_KEY')
  process.exit(1)
}

/**
 * Build a Ring Webhook v1.1 body
 */
function buildWebhook(type: string, deviceId: string, requestId?: string) {
  const ts = Date.now()
  const rid = requestId || crypto.randomUUID()
  return {
    requestId: rid,
    raw: JSON.stringify({
      meta: { version: '1.1', time: new Date(ts).toISOString().replace(/Z$/, '123456Z'), request_id: rid },
      data: { id: `${deviceId}_${type}_${ts}`, type, attributes: { source: deviceId, source_type: 'devices', timestamp: ts }, relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } } },
    }),
  }
}

const sign = (key: string, raw: string) => 'sha256=' + crypto.createHmac('sha256', key).update(raw, 'utf8').digest('hex')

async function postWebhook(url: string, raw: string, signature: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
    body: raw,
  })
  return { status: res.status, body: await res.text().catch(() => '') }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getHealth() {
  const res = await fetch(`${APP}/api/health`)
  return res.json()
}

/**
 * Scenario 1: Everything fails
 * Postgres down + Twilio wrong key + push permission revoked + Ring offline
 */
async function scenarioEverythingFails() {
  console.log('\n=== Scenario 1: Everything fails ===')
  console.log('This is a MANUAL test scenario')
  console.log('\nSetup steps:')
  console.log('1. Stop Postgres: docker-compose stop postgres')
  console.log('2. Set invalid Twilio credentials in .env.local')
  console.log('3. Revoke push permissions from browser settings')
  console.log('4. Send device_offline webhook')
  console.log('\nExpected: Resident screen shows "keep door closed, call helper"')
  console.log('\nTo run:')
  console.log('  docker-compose stop postgres')
  console.log('  # Edit .env.local with invalid TWILIO_AUTH_TOKEN')
  console.log('  # Revoke push in browser')
  console.log('  # Then send device_offline via /sim or webhook')
  console.log('  # Check resident screen')
}

/**
 * Scenario 2: The long night
 * Quiet hours on + expected visit with correct pass-word
 */
async function scenarioLongNight() {
  console.log('\n=== Scenario 2: The long night ===')
  console.log('Expected: Door must stay closed even with correct pass-word')
  console.log('\nSetup steps:')
  console.log('1. Via /sim: Enable quiet hours (quiet: true)')
  console.log('2. Add expected visit with pass-word')
  console.log('3. Ring doorbell')
  console.log('4. Resident confirms correct pass-word')
  console.log('\nExpected: Resident screen shows "Night lock is on, do not open"')
  console.log('Resident confirm button should be refused')
  console.log('\nTo run manually:')
  console.log('  1. Open /sim in browser')
  console.log('  2. Click "🌙 Quiet on"')
  console.log('  3. Add expected visit with pass-word "test123"')
  console.log('  4. Click "🔔 Doorbell press"')
  console.log('  5. On resident screen, verify pass-word "test123"')
  console.log('  6. Expected: Still shows night lock, cannot open')
}

/**
 * Scenario 3: Helper chaos
 * H1 on plane (no answer), H2 answers safe, H1 lands and answers not-safe within 5 min
 */
async function scenarioHelperChaos() {
  console.log('\n=== Scenario 3: Helper chaos ===')
  console.log('Expected: Final state is consistent, resident told safest outcome')
  console.log('\nSetup steps:')
  console.log('1. Create household with 2 helpers (H1, H2)')
  console.log('2. Set timeout to 10 seconds')
  console.log('3. Ring doorbell')
  console.log('4. Wait 10s (H1 times out, escalates to H2)')
  console.log('5. H2 answers "safe"')
  console.log('6. Within 5 minutes, H1 answers "not safe"')
  console.log('\nExpected: Final state is "not safe" (safest outcome)')
  console.log('Resident sees the safest answer')
  console.log('\nTo run manually:')
  console.log('  1. Setup household with 2 helpers via /setup')
  console.log('  2. Open /sim, set timeout to 10s')
  console.log('  3. Ring doorbell')
  console.log('  4. Wait 10s (watch escalation)')
  console.log('  5. In /sim, click "✅ Safe (known)"')
  console.log('  6. Within 5 min, try to answer "⛔ Not safe" from H1\'s account')
  console.log('  Expected: H1 cannot override after H2 answered (or override succeeds and shows not-safe)')
}

/**
 * Scenario 4: Impersonator
 * Attacker knows expected visit exists, rings, gives wrong pass-word twice
 */
async function scenarioImpersonator() {
  console.log('\n=== Scenario 4: Impersonator ===')
  console.log('Expected: Demoted to full alert and SMS')
  console.log('\nSetup steps:')
  console.log('1. Add expected visit with pass-word "secret123"')
  console.log('2. Set planned mode to resident')
  console.log('3. Attacker rings doorbell')
  console.log('4. Resident sees pass-word check')
  console.log('5. Attacker says wrong pass-word twice')
  console.log('\nExpected: Case demoted to normal lane, full alert sent to helpers')
  console.log('First helper restarted at full timeout')
  console.log('\nTo run manually:')
  console.log('  1. Open /sim')
  console.log('  2. Set planned mode to "🏠 Resident mode"')
  console.log('  3. Add expected visit with pass-word "secret123"')
  console.log('  4. Ring doorbell')
  console.log('  5. On resident screen, enter wrong pass-word twice')
  console.log('  Expected: Screen changes to "Someone is here", full alert sent')
}

/**
 * Scenario 5: Rapid events
 * Ring, SOS, device offline, ring again within 5 seconds
 */
async function scenarioRapidEvents() {
  console.log('\n=== Scenario 5: Rapid events ===')
  console.log('Expected: System handles gracefully, no crashes')
  console.log('\nSetup steps:')
  console.log('1. Send button_press webhook')
  console.log('2. Immediately send SOS via /sim')
  console.log('3. Immediately send device_offline webhook')
  console.log('4. Immediately send button_press webhook again')
  console.log('\nExpected: All events processed, no crashes, resident screen shows appropriate state')
  console.log('\nTo run manually:')
  console.log('  1. Open /sim')
  console.log('  2. Click "🔔 Doorbell press"')
  console.log('  3. Click "🆘 Press SOS"')
  console.log('  4. Click "📴 Go offline"')
  console.log('  5. Click "🔔 Doorbell press"')
  console.log('  Expected: Screen shows SOS or offline, no crash')
}

/**
 * Scenario 6: Restart mid-escalation
 * Restart server while second helper's timer is running
 */
async function scenarioRestartEscalation() {
  console.log('\n=== Scenario 6: Restart mid-escalation ===')
  console.log('Expected: Case resumes, deadline preserved, no duplicate SMS')
  console.log('\nSetup steps:')
  console.log('1. Create household with 2 helpers')
  console.log('2. Set timeout to 30 seconds')
  console.log('3. Ring doorbell')
  console.log('4. Wait 10s (H1 has 20s left)')
  console.log('5. Kill server: pkill -f "next dev"')
  console.log('6. Restart server: npm run dev')
  console.log('7. Wait for escalation to complete')
  console.log('\nExpected:')
  console.log('  - Case resumes (deadline preserved)')
  console.log('  - H1 timer continues, then escalates to H2')
  console.log('  - No duplicate SMS sent')
  console.log('  - Log shows "Server restarted. Resuming timer"')
  console.log('\nTo run manually:')
  console.log('  1. Setup 2 helpers, timeout 30s')
  console.log('  2. Ring doorbell')
  console.log('  3. Wait 10s')
  console.log('  4. pkill -f "next dev"')
  console.log('  5. npm run dev')
  console.log('  6. Watch /sim case log for "Server restarted" message')
}

/**
 * Scenario 7: Worker kill (v2)
 * Kill timer worker mid-escalation to test job persistence
 */
async function scenarioWorkerKill() {
  console.log('\n=== Scenario 7: Worker kill (v2) ===')
  console.log('Expected: Job persists in queue, new worker picks it up')
  console.log('\nSetup steps:')
  console.log('1. Start timer worker: npm run worker')
  console.log('2. Create household with 2 helpers')
  console.log('3. Set timeout to 30 seconds')
  console.log('4. Ring doorbell')
  console.log('5. Wait 10s (H1 has 20s left)')
  console.log('6. Kill worker: pkill -f "timer-worker"')
  console.log('7. Wait 5 seconds')
  console.log('8. Restart worker: npm run worker')
  console.log('9. Wait for escalation to complete')
  console.log('\nExpected:')
  console.log('  - Escalation job persists in pg-boss queue')
  console.log('  - New worker picks up job')
  console.log('  - Escalation completes on schedule')
  console.log('  - No duplicate jobs created')
  console.log('\nTo run manually:')
  console.log('  1. npm run worker (in terminal 1)')
  console.log('  2. Setup 2 helpers, timeout 30s')
  console.log('  3. Ring doorbell')
  console.log('  4. Wait 10s')
  console.log('  5. pkill -f "timer-worker"')
  console.log('  6. npm run worker (in terminal 1 again)')
  console.log('  7. Watch worker logs for job completion')
}

/**
 * Scenario 8: Redis failure (v2)
 * Redis fails during notification ladder
 */
async function scenarioRedisFail() {
  console.log('\n=== Scenario 8: Redis failure (v2) ===')
  console.log('Expected: Notification ladder fails open, system continues')
  console.log('\nSetup steps:')
  console.log('1. Configure Redis (REDIS_URL)')
  console.log('2. Enable notification ladder (USE_NOTIFICATION_LADDER=1)')
  console.log('3. Ring doorbell')
  console.log('4. Stop Redis: docker-compose stop redis')
  console.log('5. Ring doorbell again')
  console.log('6. Start Redis: docker-compose start redis')
  console.log('\nExpected:')
  console.log('  - First notification succeeds (Redis available)')
  console.log('  - Second notification fails open (uses fallback)')
  console.log('  - No crashes or errors')
  console.log('  - Rate limiting disabled during Redis outage')
  console.log('\nTo run manually:')
  console.log('  1. Set REDIS_URL in .env.local')
  console.log('  2. Set USE_NOTIFICATION_LADDER=1')
  console.log('  3. docker-compose start redis')
  console.log('  4. Ring doorbell (check logs)')
  console.log('  5. docker-compose stop redis')
  console.log('  6. Ring doorbell (check logs for fallback)')
  console.log('  7. docker-compose start redis')
}

/**
 * Scenario 9: Network partition (v2)
 * Network partition between webhook and worker
 */
async function scenarioNetworkPartition() {
  console.log('\n=== Scenario 9: Network partition (v2) ===')
  console.log('Expected: Webhook enqueues job, worker processes when network restored')
  console.log('\nSetup steps:')
  console.log('1. Start timer worker')
  console.log('2. Simulate network partition (block webhook port)')
  console.log('3. Send webhook')
  console.log('4. Verify webhook returns 200 (enqueue succeeds)')
  console.log('5. Restore network')
  console.log('6. Verify worker processes job')
  console.log('\nExpected:')
  console.log('  - Webhook stores event in database')
  console.log('  - Job scheduled in pg-boss queue')
  console.log('  - Worker processes job when network restored')
  console.log('  - No data loss')
  console.log('\nTo run manually:')
  console.log('  1. npm run worker')
  console.log('  2. Use firewall to block worker access (simulated)')
  console.log('  3. Send webhook via /sim or curl')
  console.log('  4. Check database for WebhookEvent record')
  console.log('  5. Check pg-boss queue for pending job')
  console.log('  6. Restore network')
  console.log('  7. Watch worker logs for job processing')
}

async function main() {
  const scenario = process.argv[2]

  console.log('Chaos Scenario Tests for Doorbell Helper')
  console.log('=========================================\n')

  switch (scenario) {
    case 'everything-fails':
      await scenarioEverythingFails()
      break
    case 'long-night':
      await scenarioLongNight()
      break
    case 'helper-chaos':
      await scenarioHelperChaos()
      break
    case 'impersonator':
      await scenarioImpersonator()
      break
    case 'rapid-events':
      await scenarioRapidEvents()
      break
    case 'restart-escalation':
      await scenarioRestartEscalation()
      break
    case 'worker-kill':
      await scenarioWorkerKill()
      break
    case 'redis-fail':
      await scenarioRedisFail()
      break
    case 'network-partition':
      await scenarioNetworkPartition()
      break
    default:
      console.log('Usage: tsx tools/chaos-tests.ts <scenario>')
      console.log('\nScenarios:')
      console.log('  everything-fails    - Postgres down + Twilio wrong + push revoked + Ring offline')
      console.log('  long-night          - Quiet hours + expected visit + wrong pass-word')
      console.log('  helper-chaos        - H1 no answer, H2 safe, H1 not-safe within 5 min')
      console.log('  impersonator        - Attacker knows visit, gives wrong pass-word twice')
      console.log('  rapid-events        - Ring, SOS, offline, ring within 5s')
      console.log('  restart-escalation  - Restart mid-escalation while H2 timer running')
      console.log('  worker-kill         - Kill timer worker mid-escalation (v2)')
      console.log('  redis-fail          - Redis failure during notification (v2)')
      console.log('  network-partition   - Network partition between webhook and worker (v2)')
      console.log('\nMost scenarios require manual execution via /sim or webhooks.')
      console.log('See the stress-test guide section 15 for detailed instructions.')
  }
}

main().catch(console.error)
