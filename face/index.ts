/**
 * Face recognition: the one door into this folder. Import from '@/face' anywhere in the app:
 *
 *   import { matchFace } from '@/face'
 *   const r = await matchFace(householdId, jpegBuffer, { ref: expectedVisitId })
 *   if (r.matched) { ... }          // r.guest.name, r.distance, r.strength
 *
 * Treat a match as supporting evidence, never as the only thing that opens a door.
 */
import { FACE } from './config'
import { bestGuest } from './match'
import { detectFaces, isLoaded, warmUp } from './engine'
import { faceStore, setFaceStore, memoryFaceStore } from './store'
import { FaceError, type MatchResult, type StoredFace } from './types'

export { FACE } from './config'
export { FaceError } from './types'
export type { MatchResult, StoredFace, DetectedFace, Box } from './types'
export { warmUp, setFaceStore, memoryFaceStore }
export * from './sightings'
export { onCameraEvent, fetchRingSnapshot, tagRegular } from './camera'

export type ImageInput = string | Buffer

/** Accepts a Buffer, a data URL or plain base64. Checks size and file type. */
export function readImage(input: ImageInput): Buffer {
  let buf: Buffer
  if (Buffer.isBuffer(input)) buf = input
  else {
    const b64 = input.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new FaceError('bad_image', 'Image must be base64.', 422)
    buf = Buffer.from(b64, 'base64')
  }
  if (buf.length === 0) throw new FaceError('bad_image', 'Empty image.', 422)
  if (buf.length > FACE.maxImageBytes) throw new FaceError('too_large', `Image is larger than ${Math.round(FACE.maxImageBytes / 1e6)} MB.`, 413)
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8
  const png  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP'
  if (!jpeg && !png && !webp) throw new FaceError('bad_image', 'Use a JPEG, PNG or WebP image.', 422)
  return buf
}

export const faceStatus = () => ({ enabled: FACE.enabled, modelsLoaded: isLoaded(), threshold: FACE.threshold })

/** Check that the picture holds exactly one clear face and return its 128 numbers. Same rules as enrollFace. */
export async function extractDescriptor(image: ImageInput): Promise<number[]> {
  const faces = await detectFaces(readImage(image))
  if (faces.length === 0) throw new FaceError('no_face', 'No face found. Use a clear, front-facing photo.', 422)
  if (faces.length > 1) throw new FaceError('multiple_faces', 'More than one face in the photo. Use a photo of one person.', 422)
  const f = faces[0]
  if (f.box.w < FACE.minFaceWidth) throw new FaceError('face_too_small', 'The face is too small. Move closer.', 422)
  return f.descriptor
}

/** Save an already extracted descriptor (consent must have been recorded by the caller). */
export async function enrollDescriptor(
  householdId: string,
  input: { name: string; descriptor: number[]; consentAt: Date; ref?: string; createdBy?: string }
): Promise<{ id: string; name: string }> {
  const name = input.name.trim()
  if (!name) throw new FaceError('name_required', 'Name is required.', 400)
  const store = faceStore()
  if ((await store.count(householdId)) >= FACE.maxPerHousehold) throw new FaceError('limit', 'Too many saved faces. Delete one first.', 409)
  const saved = await store.add({ householdId, name, ref: input.ref ?? null, descriptor: input.descriptor, consentAt: input.consentAt, createdBy: input.createdBy ?? null })
  return { id: saved.id, name: saved.name }
}

/** Compare one descriptor with every saved guest in the household (no image needed). */
export async function matchDescriptor(householdId: string, descriptor: number[]) {
  return bestGuest(await faceStore().list(householdId), descriptor)
}

/** Save one consented photo of one guest. Only the 128 numbers are kept, never the picture. */
export async function enrollFace(
  householdId: string,
  input: { name: string; image: ImageInput; consent: boolean; ref?: string; createdBy?: string }
): Promise<{ id: string; name: string }> {
  if (input.consent !== true) throw new FaceError('consent_required', 'The guest must agree before their face is saved.', 400)
  if (!input.name.trim()) throw new FaceError('name_required', 'Name is required.', 400)
  if ((await faceStore().count(householdId)) >= FACE.maxPerHousehold) throw new FaceError('limit', 'Too many saved faces. Delete one first.', 409)
  const descriptor = await extractDescriptor(input.image)
  return enrollDescriptor(householdId, { name: input.name, descriptor, consentAt: new Date(), ref: input.ref, createdBy: input.createdBy })
}

/**
 * Compare the biggest face in the picture with the household's saved guests.
 * Pass `ref` (or `name`) to compare against just the guest you expect. That is a 1:1 check and is much safer than searching everyone.
 */
export async function matchFace(
  householdId: string,
  image: ImageInput,
  opts: { ref?: string; name?: string } = {}
): Promise<MatchResult> {
  const faces = await detectFaces(readImage(image))
  if (faces.length === 0) return { faces: 0, matched: false, reason: 'no_face' }
  const primary = faces[0]

  let pool: StoredFace[] = await faceStore().list(householdId)
  if (opts.ref)  pool = pool.filter((p) => p.ref === opts.ref)
  if (opts.name) pool = pool.filter((p) => p.name === opts.name)
  if (pool.length === 0) return { faces: faces.length, matched: false, reason: 'no_enrolled' }

  const pick = bestGuest(pool, primary.descriptor)
  if (pick.reason !== 'match') return { faces: faces.length, matched: false, reason: pick.reason, distance: pick.distance }
  return {
    faces: faces.length, matched: true, reason: 'match', distance: pick.distance, strength: pick.strength,
    guest: { name: pick.guest!.name, ref: pick.guest!.ref, faceId: pick.guest!.id },
  }
}

/** Saved guests, without any biometric data. */
export async function listFaces(householdId: string) {
  return (await faceStore().list(householdId)).map((f) => ({ id: f.id, name: f.name, ref: f.ref ?? null, consentAt: f.consentAt, createdAt: f.createdAt }))
}

export const deleteFace  = (householdId: string, id: string) => faceStore().remove(householdId, id)
/** Remove everything saved for a guest (by name and/or ref). Use when a visit is deleted or the guest asks. */
export const deleteGuest = (householdId: string, by: { name?: string; ref?: string }) => faceStore().removeGuest(householdId, by)
