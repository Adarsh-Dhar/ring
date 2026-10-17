import { describe, it, expect, afterEach, vi } from 'vitest'

// The routes under test return before touching the database; keep Prisma out of the import graph.
vi.mock('@prisma/client', () => ({ PrismaClient: class {}, Prisma: {} }))
import { NextRequest } from 'next/server'

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    body: body ? JSON.stringify(body) : undefined,
  })

describe('workspace simulation routes are locked to DEMO_MODE', () => {
  const saved = process.env.DEMO_MODE
  afterEach(() => { if (saved === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = saved })

  it('typed interrogator answers are refused when DEMO_MODE is off', async () => {
    delete process.env.DEMO_MODE
    const { POST } = await import('@/app/api/sim/interrogator/answer/route')
    const r = await POST(req('/api/sim/interrogator/answer', 'POST', { caseId: 'c1', text: 'hello' }))
    expect(r.status).toBe(403)
  })

  it('sim visit-request GET and POST are refused when DEMO_MODE is off', async () => {
    delete process.env.DEMO_MODE
    const { GET, POST } = await import('@/app/api/sim/visit-request/route')
    expect((await GET(req('/api/sim/visit-request'))).status).toBe(403)
    expect((await POST(req('/api/sim/visit-request', 'POST', { action: 'apply', name: 'x', purpose: 'doctor' }))).status).toBe(403)
  })
})
