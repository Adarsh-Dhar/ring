/**
 * Debug script to check current state
 */
import { getDb } from '../lib/db/client'

async function main() {
  const db = getDb()
  const households = await db.household.findMany()
  console.log('Households:', households.length)
  for (const h of households) {
    console.log(`  ${h.id}: ${h.residentName} (tz: ${h.timezone})`)
    const cases = await db.case.findMany({ where: { householdId: h.id } })
    console.log(`    Cases: ${cases.length}`)
    const members = await db.membership.findMany({ where: { householdId: h.id } })
    console.log(`    Members: ${members.length}`)
  }
}

main().catch(console.error)
