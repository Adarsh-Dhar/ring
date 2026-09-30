import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, adminPinOk, IS_PROD } from './auth'
import { getHelper, getHelperEpoch, getResidentEpoch } from './doorbell/store'
import type { z } from 'zod'

export const COOKIE = 'db_session'
export type Session = { role: 'helper'; helperId: string } | { role: 'resident' }
type Who = 'helper' | 'resident' | 'admin'

const tokenFrom = (req: NextRequest) => {
  const b = req.headers.get('authorization')
  if (b?.startsWith('Bearer ')) return b.slice(7)
  return req.cookies.get(COOKIE)?.value ?? null
}

/** Resolves the caller from a signed token AND current server state (revoked/declined helpers fail). */
export function getSession(req: NextRequest): Session | null {
  const t = verifyToken(tokenFrom(req))
  if (!t) return null
  if (t.role === 'resident') return t.epoch === getResidentEpoch() ? { role: 'resident' } : null
  const h = getHelper(t.id)
  if (!h || h.consent !== 'approved' || t.epoch !== getHelperEpoch(t.id)) return null
  return { role: 'helper', helperId: h.id }
}

export const isAdmin = (req: NextRequest) => adminPinOk(req.headers.get('x-setup-pin'))

/** Dev-only: allow bypassing auth for local development when ALLOW_DEV_AUTH=1 */
const DEV_AUTH_BYPASS = process.env.ALLOW_DEV_AUTH === '1' && !IS_PROD

/** Browsers always send Origin on cross-site POSTs. If it is present it must match our host. */
function sameOrigin(req: NextRequest) {
  const o = req.headers.get('origin')
  if (!o) return true
  try { return new URL(o).host === req.headers.get('host') } catch { return false }
}

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

export type Auth = { ok: true; session: Session | null; admin: boolean } | { ok: false; res: NextResponse }

export function authorize(req: NextRequest, ...allowed: Who[]): Auth {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return { ok: false, res: fail('bad origin', 403) }
  const admin = allowed.includes('admin') && isAdmin(req)
  const s = getSession(req)
  const sessionOk = !!s && allowed.includes(s.role)
  
  // Dev-only: allow resident/helper access without auth for local testing
  // IMPORTANT: Never bypass admin - admin always requires PIN
  if (DEV_AUTH_BYPASS && !admin && !sessionOk && !allowed.includes('admin')) {
    console.log('[DEV AUTH] Allowed roles:', allowed, 'Session:', s, 'SessionOK:', sessionOk)
    // Check for dev helper header (set by helper page for testing)
    const devHelperId = req.headers.get('x-dev-helper-id')
    
    // If resident is allowed (and ONLY resident), bypass as resident
    if (allowed.includes('resident') && !allowed.includes('helper')) {
      console.log('[DEV AUTH] Bypassing as resident')
      return { ok: true, session: { role: 'resident' } as Session, admin: false }
    }
    // If helper is allowed (and ONLY helper), bypass as helper using dev header or 'h1'
    if (allowed.includes('helper') && !allowed.includes('resident')) {
      const helperId = devHelperId || 'h1'
      console.log('[DEV AUTH] Bypassing as helper', helperId)
      return { ok: true, session: { role: 'helper', helperId } as Session, admin: false }
    }
    // If both are allowed, try to guess based on URL or default to helper
    if (allowed.includes('helper') && allowed.includes('resident')) {
      const url = req.nextUrl.pathname
      console.log('[DEV AUTH] Both allowed, URL:', url, 'Dev helper:', devHelperId)
      if (url.includes('/resident')) {
        console.log('[DEV AUTH] Bypassing as resident (from URL)')
        return { ok: true, session: { role: 'resident' } as Session, admin: false }
      }
      const helperId = devHelperId || 'h1'
      console.log('[DEV AUTH] Bypassing as helper', helperId, '(default)')
      return { ok: true, session: { role: 'helper', helperId } as Session, admin: false }
    }
  }
  
  if (!admin && !sessionOk) return { ok: false, res: fail('Not signed in', 401) }
  return { ok: true, session: sessionOk ? s : null, admin }
}

/** Parses and validates a JSON body with a zod schema. */
export async function parse<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown
  try { raw = await req.json() } catch { return { ok: false, res: fail('invalid JSON') } }
  const r = schema.safeParse(raw)
  if (!r.success) return { ok: false, res: fail('invalid request') }
  return { ok: true, data: r.data }
}

export const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: IS_PROD, path: '/', maxAge: 60 * 60 * 24 * 365 }
