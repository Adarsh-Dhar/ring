import { makeToken } from '../lib/auth'

const deviceId = 'test-resident-device'
const householdId = 'cmv8splrm000098zd8f4t5jtb'

// Get the resident epoch from the household
const residentEpoch = 1

// Create a device token (1 year expiry)
const exp = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
const token = makeToken({
  kind: 'device',
  sub: deviceId,
  householdId,
  epoch: residentEpoch,
  exp,
})

if (token) {
  console.log('Resident device token:')
  console.log(token)
} else {
  console.error('Failed to generate token')
  process.exit(1)
}
