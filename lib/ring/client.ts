/**
 * Minimal Ring Partner API client (server-side only).
 * Docs: https://developer.amazon.com/docs/ring/api-documentation.html
 *
 * Tokens: Ring access tokens last about 4 hours and come with a refresh token.
 * This client is now per-connection (multi-household support).
 */
const API = process.env.RING_API_BASE || 'https://api.amazonvision.com'
const TOKEN_URL = process.env.RING_TOKEN_URL || 'https://oauth.ring.com/oauth/token'

import { decrypt, encrypt } from '../auth'
import { getDb } from '../db/client'

// Per-connection token cache and refresh locks
const tokenCache = new Map<string, { token: string; exp: number }>()
const refreshLocks = new Map<string, Promise<string | null>>()

/**
 * Get an access token for a specific connection.
 * Refreshes automatically if needed (with per-connection locking).
 */
async function accessToken(connectionId: string): Promise<string | null> {
  // Check cache first
  const cached = tokenCache.get(connectionId)
  if (cached && cached.exp > Date.now() + 60_000) {
    return cached.token
  }

  // Load connection from DB
  const db = getDb()
  const connection = await db.ringConnection.findUnique({
    where: { id: connectionId }
  })

  if (!connection || connection.status !== 'linked') {
    console.error('[RING] Connection not found or not linked', connectionId)
    return null
  }

  // Decrypt the refresh token
  const refreshToken = decrypt(connection.encryptedRefreshToken)
  if (!refreshToken) {
    console.error('[RING] Failed to decrypt refresh token', connectionId)
    return null
  }

  // If we have a cached access token that's still valid, use it
  if (cached && cached.exp > Date.now()) {
    return cached.token
  }

  // Need to refresh - use per-connection lock
  if (!refreshLocks.has(connectionId)) {
    const lock = doRefresh(connectionId, refreshToken, db).finally(() => {
      refreshLocks.delete(connectionId)
    })
    refreshLocks.set(connectionId, lock)
  }

  return refreshLocks.get(connectionId)!
}

async function doRefresh(connectionId: string, refreshToken: string, db: ReturnType<typeof getDb>): Promise<string | null> {
  const clientId = process.env.RING_CLIENT_ID
  const clientSecret = process.env.RING_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('[RING] Missing RING_CLIENT_ID or RING_CLIENT_SECRET')
    return null
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (res.ok === false) {
      console.error('[RING] Token refresh failed', res.status)

      // Mark connection as revoked if refresh fails permanently
      if (res.status === 401 || res.status === 403) {
        await db.ringConnection.update({
          where: { id: connectionId },
          data: { status: 'revoked' }
        })
      }

      return null
    }

    const j: any = await res.json()
    const accessToken = j.access_token
    const newRefreshToken = j.refresh_token
    const expiresIn = Number(j.expires_in) || 3600

    if (!accessToken) {
      console.error('[RING] No access token in response')
      return null
    }

    // Cache the access token
    tokenCache.set(connectionId, {
      token: accessToken,
      exp: Date.now() + expiresIn * 1000
    })

    // Update the connection with new tokens if refresh token rotated
    if (newRefreshToken && newRefreshToken !== refreshToken) {
      const encryptedAccess = encrypt(accessToken)
      const encryptedRefresh = encrypt(newRefreshToken)

      if (encryptedAccess && encryptedRefresh) {
        await db.ringConnection.update({
          where: { id: connectionId },
          data: {
            encryptedAccessToken: encryptedAccess,
            encryptedRefreshToken: encryptedRefresh,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
          }
        })
      }
    }

    return accessToken
  } catch (e) {
    console.error('[RING] Refresh error', e)
    return null
  }
}

/**
 * Make an authenticated request to Ring API for a specific connection.
 */
export async function ringFetchForConnection(
  connectionId: string,
  path: string,
  init: RequestInit = {},
  retried = false
): Promise<Response> {
  const t = await accessToken(connectionId)
  if (!t) throw new Error('Ring connection not available')

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${t}` },
    signal: AbortSignal.timeout(10000),
  })

  // Token expired earlier than we expected: drop the cached one and try once with a fresh token
  if (res.status === 401 && !retried) {
    tokenCache.delete(connectionId)
    return ringFetchForConnection(connectionId, path, init, true)
  }

  return res
}

/**
 * Get the Ring connection for a household.
 */
export async function getConnectionForHousehold(householdId: string) {
  const db = getDb()
  return db.ringConnection.findFirst({
    where: {
      householdId,
      status: 'linked'
    }
  })
}

/**
 * Forces a refresh for a specific connection (used daily).
 */
export async function forceRefreshConnection(connectionId: string): Promise<boolean> {
  tokenCache.delete(connectionId)
  return !!(await accessToken(connectionId))
}

/**
 * Check if a household has a linked Ring connection.
 */
export async function ringConfiguredForHousehold(householdId: string): Promise<boolean> {
  const connection = await getConnectionForHousehold(householdId)
  return !!connection
}

/** GET /v1/devices/{id}/status  ->  data.attributes.online */
export async function fetchDeviceOnline(connectionId: string, deviceId: string): Promise<boolean> {
  const res = await ringFetchForConnection(connectionId, `/v1/devices/${encodeURIComponent(deviceId)}/status`)
  if (res.ok === false) throw new Error(`status ${res.status}`)
  const j: any = await res.json()
  return j?.data?.attributes?.online === true
}

/** GET /v1/devices -> ids of devices shared with this app. */
export async function listDeviceIds(connectionId: string): Promise<string[]> {
  const res = await ringFetchForConnection(connectionId, '/v1/devices')
  if (res.ok === false) throw new Error(`devices ${res.status}`)
  const j: any = await res.json()
  return (j?.data ?? []).map((d: any) => d.id as string)
}

/** Starts a WHEP session. Returns the SDP answer, and the session URL for closing it. */
export async function startWhep(connectionId: string, deviceId: string, offerSdp: string) {
  const res = await ringFetchForConnection(connectionId, `/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offerSdp,
  })
  if (res.status !== 201) throw new Error(`whep ${res.status}`)
  const location = res.headers.get('location') || ''
  return { answer: await res.text(), sessionId: location.split('/').pop() || '' }
}

export async function stopWhep(connectionId: string, deviceId: string, sessionId: string) {
  await ringFetchForConnection(
    connectionId,
    `/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  ).catch(() => {})
}
