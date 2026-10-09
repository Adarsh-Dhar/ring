import { PrismaClient } from '@prisma/client'

// One client per process. Next.js dev reloads modules, so keep it on globalThis (same trick as the store).
const g = globalThis as unknown as { __prisma?: PrismaClient }

const make = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  console.log('Initializing Prisma with DATABASE_URL:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'))
  return new PrismaClient()
}

export const getDb = () => (g.__prisma ||= make())
