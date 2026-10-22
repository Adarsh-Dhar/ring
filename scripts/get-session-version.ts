import { getDb } from '../lib/db/client'

async function main() {
  const db = getDb()
  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, sessionVersion: true },
    take: 10
  })

  console.log('Users:')
  for (const u of users) {
    console.log(`  ${u.id} | ${u.email} | ${u.name} | sessionVersion: ${u.sessionVersion}`)
  }
}

main().catch(console.error)
