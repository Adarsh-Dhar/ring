import { PrismaClient } from '@prisma/client'

// One client per process. Next.js dev reloads modules, so keep it on globalThis (same trick as the store).
const g = globalThis as unknown as { __prisma?: PrismaClient }
const make = () => new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } })

export const getDb = () => (g.__prisma ||= make())
