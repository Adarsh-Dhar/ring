/**
 * Local fake of the Ring Partner API. Dev only. Run: npm run sim:ring
 *
 *  Ring-like side (what lib/ring/client.ts calls):
 *    POST /oauth/token                         refresh-token flow, short-lived tokens, rotating refresh token
 *    GET  /v1/devices, /v1/devices/:id/status  from tools/fixtures/*.json if present, else built-in
 *    POST/DELETE /v1/devices/:id/media/streaming/whep/sessions   30 s battery / 60 s wired limit, 1 session per device
 *  Control side (what /api/sim calls):
 *    POST /__control/event   { type, deviceId, clip, mode, delayMs }
 *    POST /__control/device  { deviceId, online, notify }
 *    POST /__control/chaos   { dropPct, duplicatePct, lateMs, badSigPct, appDownPct }
 *    GET  /__control/state   devices, sessions, delivery log
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { buildWebhook, postWebhook, type SigMode } from '../../lib/sim/webhook'

if (process.env.NODE_ENV === 'production') { console.error('fake-ring must never run in production'); process.exit(1) }

const PORT = Number(process.env.FAKE_RING_PORT || 4010)
const APP = process.env.APP_URL || 'http://localhost:3000'
const HOOK = `${APP}/api/webhook`
const KEY = process.env.RING_HMAC_KEY
const ACCOUNT = process.env.RING_ACCOUNT_ID
const CLIENT_ID = process.env.RING_CLIENT_ID || 'fake-client'
const CLIENT_SECRET = process.env.RING_CLIENT_SECRET || 'fake-secret'
const TOKEN_TTL = Number(process.env.FAKE_TOKEN_TTL_SECONDS || 14_400) // real Ring: about 4 h. Use 60 to test refresh.
const RETRY_BASE = Number(process.env.FAKE_RETRY_BASE_MS || 1000)
const FIX = path.join(__dirname, '..', 'fixtures')

type Dev = { id: string; name: string; online: boolean; wired: boolean; battery: number }
const devices = new Map<string, Dev>()
const fixture = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')) } catch { return null } }
const fx = fixture('devices.json')
for (const d of fx?.data ?? [{ id: 'fake-doorbell-001', attributes: { name: 'Front door' } }])
  devices.set(d.id, { id: d.id, name: d.attributes?.name ?? 'Front door', online: true, wired: false, battery: 87 })

let chaos = { dropPct: 0, duplicatePct: 0, lateMs: 0, badSigPct: 0, appDownPct: 0 }
const log: { t: number; msg: string }[] = []
const note = (msg: string) => { log.unshift({ t: Date.now(), msg }); if (log.length > 200) log.pop(); console.log('[fake-ring]', msg) }
const roll = (pct: number) => Math.random() * 100 < pct

const tokens = new Map<string, number>()  // access token -> expiry
let refresh = process.env.RING_REFRESH_TOKEN || 'fake-refresh-0'
const sessions = new Map<string, { deviceId: string; endsAt: number }>()

/** Ring retries a webhook until it gets 2xx. Same here: backoff, up to 5 attempts. */
async function deliver(type: string, deviceId: string, extra: Record<string, unknown>, mode: SigMode, requestId?: string) {
  const { raw, requestId: rid } = buildWebhook({ type, deviceId, accountId: ACCOUNT, requestId, extra })
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (roll(chaos.dropPct)) { note(`${type}: DROPPED (chaos), attempt ${attempt}`); return rid }
    const m: SigMode = roll(chaos.badSigPct) ? 'bad' : mode
    const r = await postWebhook(HOOK, raw, KEY, m)
    note(`${type} -> app ${r.status || 'no answer'} (attempt ${attempt}, sig ${m})`)
    if (r.status >= 200 && r.status < 300) return rid
    if (r.status >= 400 && r.status < 500 && r.status !== 429) return rid // Ring does not retry client errors
    await new Promise((res) => setTimeout(res, RETRY_BASE * 2 ** (attempt - 1)))
  }
  note(`${type}: gave up after 5 attempts`)
  return rid
}

async function sendEvent(b: any) {
  const type = String(b.type || 'button_press'), deviceId = String(b.deviceId || [...devices.keys()][0])
  const mode: SigMode = b.mode === 'badsig' ? 'bad' : b.mode === 'nosig' ? 'missing' : 'valid'
  const extra = { ...(b.clip ? { demo_clip: b.clip } : {}), ...(b.recurringId ? { demo_recurring_id: b.recurringId } : {}) }
  const wait = Number(b.delayMs ?? 0) + (b.mode === 'late' ? 20_000 : chaos.lateMs)
  const run = async () => {
    if (roll(chaos.appDownPct)) { note('chaos: pretending the app is down'); await new Promise((r) => setTimeout(r, RETRY_BASE)) }
    const rid = await deliver(type, deviceId, extra, mode)
    if (b.mode === 'duplicate' || roll(chaos.duplicatePct)) { note(`${type}: sending DUPLICATE`); await deliver(type, deviceId, extra, mode, rid) }
  }
  if (wait > 0) setTimeout(run, wait); else await run()
  return { ok: true, scheduledInMs: wait }
}

const json = (res: http.ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body))
}
const readBody = (req: http.IncomingMessage) => new Promise<string>((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)) })

http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x'); const p = url.pathname
  try {
    if (p === '/oauth/token' && req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req))
      if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== CLIENT_SECRET || f.get('refresh_token') !== refresh) { note('token refresh REJECTED'); return json(res, 400, { error: 'invalid_grant' }) }
      const t = `fake-access-${Math.random().toString(36).slice(2)}`; tokens.set(t, Date.now() + TOKEN_TTL * 1000)
      refresh = `fake-refresh-${Math.random().toString(36).slice(2)}` // Ring-style rotation: the OLD refresh token stops working
      note(`token issued, expires in ${TOKEN_TTL}s; refresh token rotated`)
      return json(res, 200, { access_token: t, refresh_token: refresh, expires_in: TOKEN_TTL, token_type: 'Bearer' })
    }
    if (p.startsWith('/__control/')) {
      if (p === '/__control/state') return json(res, 200, { devices: [...devices.values()], chaos, sessions: [...sessions.entries()], log: log.slice(0, 40), refreshToken: refresh })
      const b = JSON.parse((await readBody(req)) || '{}')
      if (p === '/__control/event') return json(res, 200, await sendEvent(b))
      if (p === '/__control/chaos') { chaos = { ...chaos, ...b }; note(`chaos = ${JSON.stringify(chaos)}`); return json(res, 200, chaos) }
      if (p === '/__control/device') {
        const d = devices.get(b.deviceId) ?? [...devices.values()][0]
        d.online = !!b.online
        if (b.notify !== false) await deliver(d.online ? 'device_online' : 'device_offline', d.id, {}, 'valid')
        return json(res, 200, d)
      }
      return json(res, 404, { error: 'unknown control path' })
    }
    // ---- Ring API: needs a bearer token we issued (or the pasted Playground-style token) ----
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '')
    const exp = tokens.get(bearer)
    if (!(bearer === 'fake-playground-token' || (exp && exp > Date.now()))) return json(res, 401, { errors: [{ title: 'invalid or expired token' }] })
    if (roll(chaos.appDownPct)) return json(res, 503, { errors: [{ title: 'chaos' }] })
    if (p === '/v1/devices') return json(res, 200, fx ?? { data: [...devices.values()].map((d) => ({ id: d.id, type: 'devices', attributes: { name: d.name } })) })
    let m = p.match(/^\/v1\/devices\/([^/]+)\/status$/)
    if (m) {
      const d = devices.get(decodeURIComponent(m[1])); if (!d) return json(res, 404, { errors: [{ title: 'not found' }] })
      return json(res, 200, { data: { id: d.id, type: 'devices', attributes: { online: d.online, battery_level: d.battery } } })
    }
    m = p.match(/^\/v1\/devices\/([^/]+)\/media\/streaming\/whep\/sessions(?:\/([^/]+))?$/)
    if (m) {
      const d = devices.get(decodeURIComponent(m[1])); if (!d) return json(res, 404, {})
      if (req.method === 'DELETE') { sessions.delete(m[2] || ''); res.writeHead(200); return res.end() }
      if (!d.online) return json(res, 409, { errors: [{ title: 'device offline' }] })
      for (const [sid, s] of sessions) if (s.endsAt < Date.now()) sessions.delete(sid)
      if ([...sessions.values()].some((s) => s.deviceId === d.id)) return json(res, 429, { errors: [{ title: 'a stream is already active' }] })
      const sid = `sess_${Math.random().toString(36).slice(2, 10)}`, secs = d.wired ? 60 : 30
      sessions.set(sid, { deviceId: d.id, endsAt: Date.now() + secs * 1000 })
      note(`WHEP session ${sid} opened, ends in ${secs}s`)
      res.writeHead(201, { 'Content-Type': 'application/sdp', Location: `${p}/${sid}`, 'X-Max-Seconds': String(secs) })
      return res.end('v=0\r\n') // placeholder SDP: the app's /api/ring/live/sim route never sends this to a browser
    }
    json(res, 404, { errors: [{ title: 'not found' }] })
  } catch (e) { console.error(e); json(res, 500, { error: 'fake-ring crashed' }) }
}).listen(PORT, () => console.log(`[fake-ring] http://localhost:${PORT}  -> webhooks to ${HOOK}`))
