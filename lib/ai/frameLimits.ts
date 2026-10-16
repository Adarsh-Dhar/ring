/**
 * One source of truth for the simulator's AI frames. ALL sizes are DECODED bytes (what the model actually receives),
 * never base64 string lengths: base64 is ~33% larger, which is what made limits disagree before.
 */
export const FRAME_DATA_URL_PREFIX = 'data:image/jpeg;base64,'
export const MAX_FRAMES = 6
export const MAX_FRAME_BYTES = 500_000      // per frame, decoded
export const MAX_TOTAL_BYTES = 3_000_000    // all frames, decoded

/** Exact decoded size of a base64 payload (accounts for '=' padding). */
export function decodedBytes(base64: string): number {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - pad)
}

export type FrameCheck = { ok: true; totalBytes: number } | { ok: false; error: string }

/** Validate a list of JPEG data URLs: count, prefix, JPEG magic bytes, per-frame and total decoded size. */
export function validateFrames(frames: unknown): FrameCheck {
  if (!Array.isArray(frames) || frames.length === 0) return { ok: false, error: 'No frames supplied' }
  if (frames.length > MAX_FRAMES) return { ok: false, error: `Too many frames. Maximum ${MAX_FRAMES}.` }
  let total = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (typeof f !== 'string' || !f.startsWith(FRAME_DATA_URL_PREFIX)) {
      return { ok: false, error: `Frame ${i + 1} is not a valid JPEG data URL` }
    }
    const b64 = f.slice(FRAME_DATA_URL_PREFIX.length)
    const head = Buffer.from(b64.slice(0, 8), 'base64')
    if (head.length < 2 || head[0] !== 0xff || head[1] !== 0xd8) {
      return { ok: false, error: `Frame ${i + 1} is not a valid JPEG data URL` }
    }
    const size = decodedBytes(b64)
    if (size > MAX_FRAME_BYTES) return { ok: false, error: `Frame ${i + 1} too large. Maximum ${Math.round(MAX_FRAME_BYTES / 1024)} KB.` }
    total += size
  }
  if (total > MAX_TOTAL_BYTES) return { ok: false, error: `Total payload too large. Maximum ${MAX_TOTAL_BYTES / 1_000_000} MB.` }
  return { ok: true, totalBytes: total }
}
