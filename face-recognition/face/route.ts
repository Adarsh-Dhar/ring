/**
 * HTTP layer for face recognition. app/api/face/route.ts just re-exports GET and POST from here.
 *
 *   GET  /api/face                                   list saved guests + status           (guardian or helper)
 *   POST /api/face {action:'enroll', name, image, consent:true, ref?}                     (guardian)
 *   POST /api/face {action:'match',  image, ref?, name?}                                  (guardian or helper)
 *   POST /api/face {action:'delete', id}  or  {action:'delete', name?, ref?}              (guardian)
 *
 * `image` is a base64 string or data URL (JPEG, PNG or WebP).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'
import { FACE } from './config'
import { enrollFace, matchFace, listFaces, deleteFace, deleteGuest, faceStatus, FaceError } from './index'

const image = z.string().min(100).max(8_000_000)

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enroll'), name: z.string().trim().min(1).max(60), image, consent: z.literal(true), ref: z.string().max(80).optional() }),
  z.object({ action: z.literal('match'),  image, ref: z.string().max(80).optional(), name: z.string().max(60).optional() }),
  z.object({ action: z.literal('delete'), id: z.string().max(80).optional(), name: z.string().max(60).optional(), ref: z.string().max(80).optional() }),
])

const off = () => fail('Face recognition is turned off.', 503)

function problem(e: unknown) {
  if (e instanceof FaceError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
  console.error('[FACE]', e)
  return fail('Face check failed.', 500)
}

export async function GET(req: NextRequest) {
  if (!FACE.enabled) return off()
  const a = await authorize(req, 'guardian', 'helper')
  if (a.ok === false) return a.res
  return NextResponse.json({ ...faceStatus(), faces: await listFaces(a.session.householdId) })
}

export async function POST(req: NextRequest) {
  if (!FACE.enabled) return off()
  if (Number(req.headers.get('content-length') ?? 0) > 12_000_000) return fail('Request too large', 413)
  const a = await authorize(req, 'guardian', 'helper')
  if (a.ok === false) return a.res
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const { householdId, userId, role } = a.session
  const b = p.data

  if (b.action !== 'match' && role !== 'guardian') return fail('Only a guardian can do that', 403)
  if (!hit(`face:${householdId}:${b.action}`, b.action === 'match' ? 30 : 10, 60_000)) return fail('Too many requests', 429)

  try {
    if (b.action === 'enroll') return NextResponse.json({ ok: true, face: await enrollFace(householdId, { name: b.name, image: b.image, consent: b.consent, ref: b.ref, createdBy: userId }) })
    if (b.action === 'match')  return NextResponse.json({ ok: true, result: await matchFace(householdId, b.image, { ref: b.ref, name: b.name }) })
    // delete
    const removed = b.id ? await deleteFace(householdId, b.id) : await deleteGuest(householdId, { name: b.name, ref: b.ref })
    return NextResponse.json({ ok: true, removed })
  } catch (e) {
    return problem(e)
  }
}
