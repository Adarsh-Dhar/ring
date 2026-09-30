// Demo mode: serve local video files from /public/samples instead of calling Ring.
import fs from 'fs'
import path from 'path'

export const DEMO_DEVICE_ID = 'demo-camera'
export const SAMPLES_DIR = path.join(process.cwd(), 'public', 'samples')
const EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v'])
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true'
}

export interface DemoClip {
  file: string
  startMs: number
  endMs: number
  severity?: number
}

/** Lists sample videos, newest first. Uses file modified time as the "event" time. */
export function listDemoClips(): DemoClip[] {
  if (!fs.existsSync(SAMPLES_DIR)) return []
  return fs
    .readdirSync(SAMPLES_DIR)
    .filter((f) => EXTS.has(path.extname(f).toLowerCase()))
    .map((file) => {
      const startMs = Math.floor(fs.statSync(path.join(SAMPLES_DIR, file)).mtimeMs)
      // Extract severity from filename if present (e.g., "level-05-something.mp4" -> 5)
      const severityMatch = file.match(/level-(\d+)/i)
      const severity = severityMatch ? parseInt(severityMatch[1], 10) : undefined
      return { file, startMs, endMs: startMs + 15000, severity }
    })
    .sort((a, b) => b.startMs - a.startMs)
}

/** Resolves a sample file name safely (no path traversal). */
export function resolveDemoFile(name: string): { full: string; mime: string } | null {
  const safe = path.basename(name)
  const clip = listDemoClips().find((c) => c.file === safe)
  if (!clip) return null
  return { full: path.join(SAMPLES_DIR, safe), mime: MIME[path.extname(safe).toLowerCase()] || 'video/mp4' }
}
