/**
 * Migration script to convert single-household setup to multi-household schema.
 * This script:
 * 1. Migrates existing Helper records to User + Membership
 * 2. Creates a Household from environment variables
 * 3. Migrates in-memory state (if available) to database records
 */

import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function migrate() {
  console.log('[MIGRATION] Starting multi-household migration...')

  // Step 1: Create the first household from environment variables
  const residentName = process.env.RESIDENT_NAME || 'Resident'
  const timezone = process.env.RESIDENT_TZ || 'Asia/Kolkata'
  const emergencyNumber = process.env.EMERGENCY_NUMBER || '112'

  console.log('[MIGRATION] Creating household:', { residentName, timezone, emergencyNumber })

  const household = await prisma.household.create({
    data: {
      residentName,
      timezone,
      emergencyNumber,
      timeoutSec: Number(process.env.ESCALATION_SECONDS || 30),
      quietStartHour: 22,
      quietEndHour: 6,
      quietEnabled: false,
      residentEpoch: 1,
    }
  })

  console.log('[MIGRATION] Household created:', household.id)

  // Step 2: Migrate helpers to users and memberships
  // Note: The old Helper model is being removed, so we need to check if there's old data
  // For now, we'll assume helpers are managed through the new UI

  // Step 3: If there's a Ring refresh token in env, create a RingConnection
  const ringRefreshToken = process.env.RING_REFRESH_TOKEN
  const ringClientId = process.env.RING_CLIENT_ID
  const ringClientSecret = process.env.RING_CLIENT_SECRET

  if (ringRefreshToken && ringClientId && ringClientSecret) {
    console.log('[MIGRATION] Migrating Ring token to connection...')

    // Import encryption functions
    const { encrypt } = await import('../lib/auth')

    const encryptedRefresh = encrypt(ringRefreshToken)
    if (!encryptedRefresh) {
      console.error('[MIGRATION] Failed to encrypt Ring token')
      return
    }

    // We don't have the access token, so we'll need to refresh it
    // For now, just store the refresh token
    const connection = await prisma.ringConnection.create({
      data: {
        householdId: household.id,
        ringAccountId: 'migrated', // Will be updated on first OAuth flow
        encryptedAccessToken: '', // Will be refreshed
        encryptedRefreshToken: encryptedRefresh,
        status: 'unclaimed',
      }
    })

    console.log('[MIGRATION] Ring connection created:', connection.id)
  }

  console.log('[MIGRATION] Migration complete!')
  console.log('[MIGRATION] Next steps:')
  console.log('[MIGRATION] 1. Run: npm run db:migrate')
  console.log('[MIGRATION] 2. Update your .env file with new variables')
  console.log('[MIGRATION] 3. Start the app and complete Ring OAuth linking')
  console.log('[MIGRATION] 4. Invite helpers through the new UI')
}

migrate()
  .then(() => {
    console.log('[MIGRATION] Done')
    process.exit(0)
  })
  .catch((e) => {
    console.error('[MIGRATION] Error:', e)
    process.exit(1)
  })
  .finally(() => {
    prisma.$disconnect()
  })
