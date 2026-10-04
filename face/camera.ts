import { FACE } from './config'
import { recordSighting } from './sightings'
import type { ImageInput } from './index'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** UNVERIFIED: body field names for Ring's image download. Check Ring's docs / Playground before relying on it. */
export async function fetchRingSnapshot(householdId: string, deviceId: string): Promise<Buffer | null> {
  const ring = await import('@/lib/ring/client')
  const conn = await ring.getConnectionForHousehold(householdId)
  if (!conn) return null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(2000)
    try {
      const res = await ring.ringFetchForConnection(conn.id, `/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'image/jpeg' }, body: JSON.stringify({ format: 'jpeg' }),
      })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > 0) return buf
    } catch { /* try again */ }
  }
  return null
}

export async function onCameraEvent(
  householdId: string,
  ev: { caseId?: string | null; deviceId?: string | null; image?: ImageInput; source?: string }
) {
  try {
    if (!FACE.enabled || !FACE.auto) return null
    let image = ev.image
    let source = ev.source ?? 'upload'
    if (!image) {
      if (!ev.deviceId || ev.deviceId.startsWith('sim-')) return null
      image = (await fetchRingSnapshot(householdId, ev.deviceId)) ?? undefined
      source = 'ring'
      if (!image) return null
    }
    return await recordSighting(householdId, image, { caseId: ev.caseId, deviceId: ev.deviceId, source })
  } catch (e) {
    console.error('[FACE] camera event failed', e)
    return null
  }
}
