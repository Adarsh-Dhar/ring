/**
 * Step 7: record REAL Ring responses once (a friend's 30-minute Playground token), so the fake server can replay them.
 *   RING_ACCESS_TOKEN=<playground token> npx tsx tools/record-ring.ts
 * Writes tools/fixtures/devices.json and tools/fixtures/status-<n>.json, with account/device identifiers masked.
 */
import fs from 'fs'
import path from 'path'

const API = process.env.RING_API_BASE || 'https://api.amazonvision.com'
const TOKEN = process.env.RING_ACCESS_TOKEN
if (!TOKEN) { console.error('Set RING_ACCESS_TOKEN'); process.exit(1) }
const OUT = path.join(__dirname, 'fixtures'); fs.mkdirSync(OUT, { recursive: true })

const mask = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replace(/ava\d+\.ring\.[a-z]+\.[A-Za-z0-9_-]+/g, 'ava1.ring.device.MASKED').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'masked@example.com'))
const get = async (p: string) => { const r = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } }); console.log(r.status, p); return r.ok ? r.json() : null }

;(async () => {
  const devs: any = await get('/v1/devices')
  if (!devs) return
  fs.writeFileSync(path.join(OUT, 'devices.json'), JSON.stringify(mask(devs), null, 2))
  let n = 0
  for (const d of devs.data ?? []) {
    const s = await get(`/v1/devices/${encodeURIComponent(d.id)}/status`)
    if (s) fs.writeFileSync(path.join(OUT, `status-${n++}.json`), JSON.stringify(mask(s), null, 2))
  }
  console.log(`Saved to ${OUT}. Read the files before committing: remove anything personal.`)
})()
