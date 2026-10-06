/**
 * Next.js Edge Middleware — route protection
 *
 * Runs before every request matched by `config.matcher`.
 * It cannot use Prisma or Node.js APIs (Edge runtime only).
 *
 * What it does:
 *   - Checks that the relevant session cookie exists AND looks like a valid
 *     signed JWT (three base64url segments). It does NOT verify the HMAC
 *     signature or query the database — that is left to the API route handlers
 *     which run in the full Node.js runtime.
 *   - Redirects unauthenticated visitors to /login, carrying the original URL
 *     as `?next=` so the login page can send them back after sign-in.
 *   - Resident pages (/resident, /pair) use the device cookie instead.
 *   - The /sim page additionally requires DEMO_MODE=1; if not set the page
 *     itself shows a friendly "off" message, so the middleware just checks auth.
 *
 * Why not verify the signature here?
 *   AUTH_SECRET is a server-side secret. Next.js middleware runs at the edge
 *   where `process.env` works, but using `crypto.createHmac` (Node.js built-in)
 *   is not available. The Web Crypto API is available, but loading it just to
 *   add a second layer of signature verification on every page load adds latency
 *   without meaningfully improving security — a forged cookie that passes the
 *   shape check will be rejected by the first API call the page makes.
 */

import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE = 'db_session'
const DEVICE_COOKIE  = 'db_device'

/** Returns true when the value looks like a three-part base64url JWT. */
function looksLikeJwt(value: string | undefined): boolean {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 3) return false
  // Each part must be non-empty base64url
  return parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))
}

/** Decode the JWT payload without verifying the signature. */
function jwtPayload(value: string): Record<string, unknown> | null {
  try {
    const payload = value.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Returns true when the token has not yet expired (checks `exp` claim). */
function notExpired(value: string): boolean {
  const p = jwtPayload(value)
  if (!p || typeof p.exp !== 'number') return false
  return p.exp > Math.floor(Date.now() / 1000)
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Public paths — no auth required ─────────────────────────────────────
  const publicPaths = ['/login', '/api/auth', '/api/health', '/invite', '/pair']
  const isPublic = publicPaths.some(path => pathname.startsWith(path))

  if (isPublic) {
    // For invite pages, redirect unauthenticated users to login with next parameter
    if (pathname.startsWith('/invite')) {
      const sessionToken = req.cookies.get(SESSION_COOKIE)?.value
      if (!looksLikeJwt(sessionToken) || !notExpired(sessionToken!)) {
        const loginUrl = new URL('/login', req.url)
        loginUrl.searchParams.set('next', pathname + req.nextUrl.search)
        return NextResponse.redirect(loginUrl)
      }
    }
    return NextResponse.next()
  }

  // ── Resident / device pages — require device cookie ──────────────────────
  if (pathname.startsWith('/resident') || pathname.startsWith('/pair')) {
    const deviceToken = req.cookies.get(DEVICE_COOKIE)?.value
    if (!looksLikeJwt(deviceToken) || !notExpired(deviceToken!)) {
      // Resident devices always go to /pair (the pairing code entry screen)
      if (pathname === '/pair') return NextResponse.next()  // already there
      return NextResponse.redirect(new URL('/pair', req.url))
    }
    return NextResponse.next()
  }

  // ── All other protected pages — require session cookie ────────────────────
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value

  if (!looksLikeJwt(sessionToken) || !notExpired(sessionToken!)) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // Token present and not expired — allow through.
  // The API route that the page first calls will do the full DB + epoch check.
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/helper/:path*',
    '/setup/:path*',
    '/sim/:path*',
    '/onboarding/:path*',
    '/resident/:path*',
    '/pair/:path*',
    '/consent/:path*',
    '/workspace/:path*',
    '/workspaces',
    '/account',
    '/select-workspace',
    '/select-role',
    '/create-workspace',
    '/notifications',
  ],
}
