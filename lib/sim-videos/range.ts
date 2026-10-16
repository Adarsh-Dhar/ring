/**
 * HTTP Range parsing for the simulator video route (single range only).
 * Supports  bytes=N-M, bytes=N- and bytes=-N (last N bytes). An end past the file is clamped.
 * Returns null when the header is absent/unsupported (serve the whole file),
 * or 'unsatisfiable' when the start is outside the file (respond 416).
 */
export type ByteRange = { start: number; end: number }

export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header || size <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null

  let start: number
  let end: number
  if (a === '') {                       // suffix: last N bytes
    const n = parseInt(b, 10)
    if (!(n > 0)) return 'unsatisfiable'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = parseInt(a, 10)
    end = b === '' ? size - 1 : parseInt(b, 10)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}
