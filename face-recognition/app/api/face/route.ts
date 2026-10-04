// The implementation lives in /face. This file only exposes it (Next.js requires routes to sit under /app).
export { GET, POST } from '@/face/route'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
