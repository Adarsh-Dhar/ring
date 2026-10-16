import { makeToken } from '../lib/auth'

const userId = 'cmv8roj9d0000ay5awkebhxyx'
const householdId = 'cmv8splrm000098zd8f4t5jtb'
const membershipId = 'cmv8spls5000298zdc91ysv6b'

// Get current session version from database
const sessionVersion = 1

// Create a guardian session token (30 days expiry)
const exp = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
const token = makeToken({
  kind: 'user',
  sub: userId,
  householdId,
  membershipId,
  userId,
  sessionVersion,
  exp,
})

if (token) {
  console.log('Guardian session token:')
  console.log(token)
  console.log('Household ID:', householdId)
  console.log('Membership ID:', membershipId)
} else {
  console.error('Failed to generate token')
  process.exit(1)
}
