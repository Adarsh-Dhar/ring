export type Box = { x: number; y: number; w: number; h: number }   // all 0..1, relative to the image

export type DetectedFace = {
  descriptor: number[]   // 128 numbers
  score:      number     // detector confidence 0..1
  box:        Box
}

export type StoredFace = {
  id:          string
  householdId: string
  name:        string
  ref?:        string | null     // optional link, for example an expected or recurring visit id
  descriptor:  number[]
  consentAt:   Date
  createdBy?:  string | null
  createdAt:   Date
}

export type MatchReason = 'match' | 'no_face' | 'no_enrolled' | 'too_far' | 'ambiguous'

export type MatchResult = {
  faces:     number                                   // faces seen in the image
  matched:   boolean
  reason:    MatchReason
  guest?:    { name: string; ref?: string | null; faceId: string }
  distance?: number                                   // lower is closer. Present when at least one guest was compared.
  strength?: 'strong' | 'ok'
}

export class FaceError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

export type SightingFace = {
  i: number; box: Box; score: number
  status: 'known' | 'unknown' | 'ambiguous'
  name?: string; ref?: string | null; faceId?: string
  distance?: number; strength?: 'strong' | 'ok'
  embedding?: string            // sealed (encrypted); never returned by the list API
}
export type Sighting = {
  id: string; householdId: string; caseId?: string | null; deviceId?: string | null
  source: string; capturedAt: Date; faceCount: number; faces: SightingFace[]
}
