/**
 * Load testing script for section 13 of the stress-test guide
 * Tests concurrent polling, webhook bursts, and soak tests
 *
 * Prerequisites:
 *   npm install -g autocannon hey
 *
 * Usage:
 *   # Test 1: Concurrent resident/helper polling
 *   APP_URL=http://localhost:3000 COOKIE="db_device=<device-cookie>" node tools/load-test.ts polling
 *
 *   # Test 2: Webhook burst with multiple households
 *   RING_HMAC_KEY=testkey123 APP_URL=http://localhost:3000 node tools/load-test.ts webhook-burst
 *
 *   # Test 3: Soak test (8-24 hours)
 *   RING_HMAC_KEY=testkey123 APP_URL=http://localhost:3000 node tools/load-test.ts soak --duration 3600
 */

import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:3000'
const KEY = process.env.RING_HMAC_KEY
const TEST_TYPE = process.argv[2]
const DURATION = parseInt(process.argv[3] || '60') // seconds

if (!KEY && (TEST_TYPE === 'webhook-burst' || TEST_TYPE === 'soak')) {
  console.error('Set RING_HMAC_KEY for webhook tests')
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

async function runPollingTest() {
  console.log('\n=== Test 13.1: Concurrent resident/helper polling ===')
  console.log(`Target: ${APP}/api/doorbell/state`)
  console.log('This test requires autocannon: npm install -g autocannon\n')

  const cookie = process.env.COOKIE
  if (!cookie) {
    console.error('Set COOKIE environment variable with a valid session cookie')
    console.log('Example: COOKIE="db_device=<your-device-token>"')
    process.exit(1)
  }

  const command = `autocannon -c 100 -d 60 -H "Cookie: ${cookie}" ${APP}/api/doorbell/state`
  console.log(`Running: ${command}`)
  console.log('\nIf autocannon is not installed, run: npm install -g autocannon\n')

  const { exec } = await import('child_process')
  exec(command, (error: any, stdout: any, stderr: any) => {
    if (error) {
      console.error('Error running autocannon:', error.message)
      console.log('Make sure autocannon is installed: npm install -g autocannon')
      return
    }
    console.log(stdout)
    if (stderr) console.error(stderr)
  })
}

async function runWebhookBurstTest() {
  console.log('\n=== Test 13.2: Webhook burst with multiple households ===')
  console.log(`Target: ${APP}/api/webhook`)
  console.log(`Duration: ${DURATION}s`)
  console.log('Simulating 1,000 presses across 20 households\n')

  const households = Array.from({ length: 20 }, (_, i) => `account-${i}`)
  const requests: { raw: string; headers: Record<string, string> }[] = []

  // Generate 1,000 webhook requests distributed across households
  for (let i = 0; i < 1000; i++) {
    const household = households[i % households.length]
    const webhook = buildWebhook('button_press', `device-${household}`)
    requests.push({
      raw: webhook.raw,
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': sign(KEY!, webhook.raw),
      },
    })
  }

  console.log('Generated 1,000 webhook requests')
  console.log('This test requires autocannon with a custom script')
  console.log('Save the following to webhook-burst.json and run:')
  console.log(`autocannon -c 50 -d ${DURATION} -R 20 -w webhook-burst.json ${APP}/api/webhook\n`)

  // Generate autocannon config
  const autocannonConfig = {
    connections: 50,
    duration: DURATION,
    amount: 1000,
    requests: requests.map(r => ({
      method: 'POST',
      headers: r.headers,
      body: r.raw,
    })),
  }

  console.log(JSON.stringify(autocannonConfig, null, 2))
}

async function runSoakTest() {
  console.log('\n=== Test 13.3: Soak test ===')
  console.log(`Duration: ${DURATION}s`)
  console.log('Simulating a doorbell press every minute\n')

  const intervals = Math.floor(DURATION / 60)
  console.log(`Will send ${intervals} doorbell presses over ${DURATION}s`)

  for (let i = 0; i < intervals; i++) {
    const webhook = buildWebhook('button_press', 'test-device')
    const res = await fetch(`${APP}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': sign(KEY!, webhook.raw),
      },
      body: webhook.raw,
    })

    const status = res.status
    const body = await res.text().catch(() => '')
    console.log(`[${new Date().toISOString()}] Press ${i + 1}/${intervals}: ${status} - ${body.substring(0, 50)}`)

    // Wait 60 seconds minus the time we just spent
    await new Promise(resolve => setTimeout(resolve, 60000))

    // Check health every 10 presses
    if ((i + 1) % 10 === 0) {
      const health = await fetch(`${APP}/api/health`).then(r => r.json())
      console.log(`  Health check: tickAgeMs=${health.tickAgeMs}, openCases=${health.openCases}, householdsLoaded=${health.householdsLoaded}`)
    }
  }

  console.log('\nSoak test completed. Final health check:')
  const finalHealth = await fetch(`${APP}/api/health`).then(r => r.json())
  console.log(JSON.stringify(finalHealth, null, 2))
}

async function runMultiHouseholdTest() {
  console.log('\n=== Test 13.4: 100+ households in memory ===')
  console.log('This test requires a database with 100+ households\n')

  const health = await fetch(`${APP}/api/health`).then(r => r.json())
  console.log('Current health:', JSON.stringify(health, null, 2))

  if (health.householdsLoaded < 100) {
    console.log(`\nOnly ${health.householdsLoaded} households loaded. Need 100+ for this test.`)
    console.log('Create test households using the setup page or API.')
  } else {
    console.log(`\n✓ ${health.householdsLoaded} households loaded - meets requirement`)
  }
}

async function runSlowDbTest() {
  console.log('\n=== Test 13.5: Slow database simulation ===')
  console.log('This test requires manual setup:')
  console.log('1. Add artificial delay to database queries (e.g., using pgbench or proxy)')
  console.log('2. Monitor that alerts still go out')
  console.log('3. Verify resident screen degrades to safe state\n')
  console.log('Manual test - see stress-test guide section 13.5')
}

async function main() {
  console.log('Load Testing Tool for Doorbell Helper')
  console.log('========================================\n')

  switch (TEST_TYPE) {
    case 'polling':
      await runPollingTest()
      break
    case 'webhook-burst':
      await runWebhookBurstTest()
      break
    case 'soak':
      await runSoakTest()
      break
    case 'multi-household':
      await runMultiHouseholdTest()
      break
    case 'slow-db':
      await runSlowDbTest()
      break
    default:
      console.log('Usage: node tools/load-test.ts <test-type> [options]')
      console.log('\nTest types:')
      console.log('  polling          - Test 13.1: Concurrent resident/helper polling')
      console.log('  webhook-burst    - Test 13.2: Webhook burst with multiple households')
      console.log('  soak             - Test 13.3: Soak test (duration in seconds)')
      console.log('  multi-household  - Test 13.4: 100+ households in memory')
      console.log('  slow-db          - Test 13.5: Slow database simulation (manual)')
      console.log('\nEnvironment variables:')
      console.log('  APP_URL          - Target URL (default: http://localhost:3000)')
      console.log('  RING_HMAC_KEY    - HMAC key for webhook tests')
      console.log('  COOKIE           - Session cookie for polling tests')
      console.log('\nExamples:')
      console.log('  node tools/load-test.ts polling')
      console.log('  COOKIE="db_device=xxx" node tools/load-test.ts polling')
      console.log('  node tools/load-test.ts webhook-burst')
      console.log('  node tools/load-test.ts soak 3600')
  }
}

main().catch(console.error)
