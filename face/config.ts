/** All face-recognition settings in one place. Everything is overridable by env. */
const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d
}

export const FACE = {
  /** Set FACE_ENABLED=0 to switch the whole feature off (routes answer 503). */
  enabled:         process.env.FACE_ENABLED !== '0',
  auto:             process.env.FACE_AUTO !== '0',
  storeDescriptors: process.env.FACE_STORE_DESCRIPTORS !== '0',
  retentionDays:    num(process.env.FACE_RETENTION_DAYS, 30),
  maxFacesPerImage: num(process.env.FACE_MAX_FACES_PER_IMAGE, 10),
  /** Max euclidean distance between two 128-d descriptors to count as the same person. The usual default is 0.6; 0.5 is stricter. */
  threshold:       num(process.env.FACE_MATCH_THRESHOLD, 0.5),
  /** At or below this distance a match is reported as "strong". */
  strongThreshold: num(process.env.FACE_STRONG_THRESHOLD, 0.4),
  /** If the best two different guests are closer than this to each other, the result is "ambiguous". */
  ambiguityMargin: num(process.env.FACE_AMBIGUITY_MARGIN, 0.04),
  /** Detector confidence floor (0..1). */
  minConfidence:   num(process.env.FACE_MIN_CONFIDENCE, 0.6),
  /** The face must be at least this fraction of the image width, otherwise it is too small to trust. */
  minFaceWidth:    num(process.env.FACE_MIN_FACE_WIDTH, 0.1),
  /** Reject uploads larger than this many bytes. */
  maxImageBytes:   num(process.env.FACE_MAX_IMAGE_BYTES, 4_000_000),
  /** Images are shrunk so their longest side is at most this many pixels (speed and memory). */
  maxSide:         num(process.env.FACE_MAX_SIDE, 960),
  /** Enrolled photos allowed per household. */
  maxPerHousehold: num(process.env.FACE_MAX_PER_HOUSEHOLD, 50),
  /** Requests waiting for the detector; more than this are refused with "busy". */
  maxQueue:        num(process.env.FACE_MAX_QUEUE, 8),
  /** Folder holding the model files. Defaults to the ones shipped inside @vladmandic/face-api. */
  modelDir:        process.env.FACE_MODEL_DIR || '',
}
