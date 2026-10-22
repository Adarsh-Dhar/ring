import { makeToken } from '../lib/auth'
import { getDb } from '../lib/db/client'

async function main() {
  const db = getDb()

  // Get first approved membership with user and household info
  const membership = await db.membership.findFirst({
    where: {
      consent: 'approved'
    },
    include: {
      user: {
        select: { id: true, sessionVersion: true }
      },
      household: {
        select: { id: true }
      }
    }
  })

  if (!membership) {
    console.error('No approved membership found in database')
    process.exit(1)
  }

  const userId = membership.user.id
  const sessionVersion = membership.user.sessionVersion
  const householdId = membership.household.id
  const membershipId = membership.id

  // Create a helper session token (30 days expiry)
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
    console.log('Helper session token:')
    console.log(token)
    console.log('User ID:', userId)
    console.log('Household ID:', householdId)
    console.log('Membership ID:', membershipId)
    console.log('Session Version:', sessionVersion)
  } else {
    console.error('Failed to generate token')
    process.exit(1)
  }
}

main().catch(console.error)
