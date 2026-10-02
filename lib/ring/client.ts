/**
 * Minimal Ring Partner API client (server-side only).
 * Docs: https://developer.amazon.com/docs/ring/api-documentation.html
 *
 * Tokens: Ring access tokens last about 4 hours and come with a refresh token.
 * - Quick testing: paste a Playground token into RING_ACCESS_TOKEN (valid 30 minutes).
 * - Production: set RING_REFRESH_TOKEN + RING_CLIENT_ID + RING_CLIENT_SECRET and this client
 *   refreshes automatically. Verify the refresh request against Ring's "Token Exchange" doc.
 */
const API = process.env.RING_API_BASE || 'https://api.amazonvision.com'
const TOKEN_URL = process.env.RING_TOKEN_URL || 'https://oauth.ring.com/oauth/token'

import fs from 'fs'
import path from 'path'

/**
 * Ring rotates the refresh token on every refresh and the old one stops working.
 * Keep the newest one on disk (DATA_DIR volume, mode 600) so a restart does not fall back to a dead token from .env.
 */
const TOKEN_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const TOKEN_FILE = path.join(TOKEN_DIR, 'ring-token.json')

export function loadSavedRefreshToken(file = TOKEN_FILE): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof j?.refreshToken !== 'string' || !j.refreshToken) return null
    // If someone pasted a DIFFERENT token into .env since this file was written (re-authorised Ring),
    // the .env token is newer than the file. Ignore the file so the new token wins.
    const env = process.env.RING_REFRESH_TOKEN || ''
    if (env && j.envSeed !== env) return null
    return j.refreshToken
  } catch { return null }
}
export function saveRefreshToken(token: string, file = TOKEN_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ refreshToken: token, envSeed: process.env.RING_REFRESH_TOKEN || '', savedAt: Date.now() }), { mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch (e) { console.error('[RING] could not save the new refresh token. It will be lost on restart.', e) }
}

let cached: { token: string; exp: number } | null = null
let refreshToken = loadSavedRefreshToken() || process.env.RING_REFRESH_TOKEN || ''

/** Forces a refresh now (used daily so the ~30 day refresh token never expires unused). */
export async function forceRefresh(): Promise<boolean> {
  cached = null
  return !!(await accessToken())
}

export const ringConfigured = () => !!(process.env.RING_ACCESS_TOKEN || refreshToken)

let refreshing: Promise<string | null> | null = null

/** Ring rotates the refresh token on every use, so two refreshes at once would make the second one fail.
 *  Everyone who needs a token while a refresh is running waits for that same refresh. */
async function accessToken(): Promise<string | null> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  if (refreshToken && process.env.RING_CLIENT_ID && process.env.RING_CLIENT_SECRET) {
    if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null })
    return refreshing
  }
  return process.env.RING_ACCESS_TOKEN || null
}

async function doRefresh(): Promise<string | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.RING_CLIENT_ID!,
      client_secret: process.env.RING_CLIENT_SECRET!,
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) { console.error('[RING] token refresh failed', res.status); return null }
  const j: any = await res.json()
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 }
  if (j.refresh_token) { refreshToken = j.refresh_token; saveRefreshToken(refreshToken) } // save BEFORE anything else: the old token is now dead
  return cached.token
}

export async function ringFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const t = await accessToken()
  if (!t) throw new Error('Ring is not configured')
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${t}` },
    signal: AbortSignal.timeout(8000),
  })
  // Token expired earlier than we expected: drop the cached one and try once with a fresh token.
  if (res.status === 401 && !retried && refreshToken) { cached = null; return ringFetch(path, init, true) }
  return res
}

/** GET /v1/devices/{id}/status  ->  data.attributes.online */
export async function fetchDeviceOnline(deviceId: string): Promise<boolean> {
  const res = await ringFetch(`/v1/devices/${encodeURIComponent(deviceId)}/status`)
  if (!res.ok) throw new Error(`status ${res.status}`)
  const j: any = await res.json()
  return j?.data?.attributes?.online === true
}

/** GET /v1/devices -> ids of devices shared with this app. */
export async function listDeviceIds(): Promise<string[]> {
  const res = await ringFetch('/v1/devices')
  if (!res.ok) throw new Error(`devices ${res.status}`)
  const j: any = await res.json()
  return (j?.data ?? []).map((d: any) => d.id as string)
}

/** Starts a WHEP session. Returns the SDP answer, and the session URL for closing it. */
export async function startWhep(deviceId: string, offerSdp: string) {
  const res = await ringFetch(`/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
  })
  if (res.status !== 201) throw new Error(`whep ${res.status}`)
  const location = res.headers.get('location') || ''
  return { answer: await res.text(), sessionId: location.split('/').pop() || '' }
}

export async function stopWhep(deviceId: string, sessionId: string) {
  await ringFetch(
    `/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  ).catch(() => {})
}
