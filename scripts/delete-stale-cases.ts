/**
 * Delete stale simulator cases from a household.
 * 
 * Usage:
 *   npx tsx scripts/delete-stale-cases.ts [householdId]
 * 
 * Environment variables:
 *   HOUSEHOLD_ID - The household ID to clean (optional if passed as argument)
 *   DELETE_ALL - Set to "true" to delete ALL cases (use with caution)
 * 
 * This script is useful for:
 * - Cleaning up simulator test cases after development/testing
 * - Resetting a household for fresh testing
 * - Removing stale cases that block new simulator rings
 */

import { getDb } from '../lib/db/client'
import { deleteSimulatorCases, deleteAllCasesForHousehold } from '../lib/db/cases'

async function main() {
  const householdId = process.argv[2] || process.env.HOUSEHOLD_ID
  const deleteAll = process.env.DELETE_ALL === 'true'

  if (!householdId) {
    console.error('Error: HOUSEHOLD_ID environment variable or command-line argument is required')
    console.log('Usage: npx tsx scripts/delete-stale-cases.ts <householdId>')
    console.log('Or: HOUSEHOLD_ID=xxx npx tsx scripts/delete-stale-cases.ts')
    console.log('To delete ALL cases (including real incidents): DELETE_ALL=true npx tsx scripts/delete-stale-cases.ts <householdId>')
    process.exit(1)
  }

  console.log(`Cleaning up cases for household: ${householdId}`)

  try {
    if (deleteAll) {
      console.warn('⚠️  WARNING: Deleting ALL cases including real incidents!')
      console.log('Are you sure? This action cannot be undone.')
      console.log('Press Ctrl+C to cancel, or Enter to continue...')
      
      // Simple confirmation - wait for user to press Enter
      await new Promise(resolve => {
        process.stdin.once('data', resolve)
      })

      console.log('Deleting ALL cases...')
      const result = await deleteAllCasesForHousehold(householdId)
      console.log(`✅ Deleted ${result.count} total cases`)
    } else {
      console.log('Deleting simulator cases only (deviceId starts with "sim-")...')
      const result = await deleteSimulatorCases(householdId)
      console.log(`✅ Deleted ${result.count} simulator cases`)
    }

    console.log('Done. The household is now clean for testing.')
  } catch (error) {
    console.error('Error deleting cases:', error)
    process.exit(1)
  }
}

main()
