import fs from 'fs'
import path from 'path'

/** Folder with the mp4 files that act as the door camera. Override with VIDEOS_DIR. */
export const VIDEOS_DIR = path.resolve(process.cwd(), process.env.VIDEOS_DIR || 'videos')

/** Use local videos as the camera feed. On by default outside production; set LOCAL_VIDEO=0 to turn off. */
export const LOCAL_VIDEO =
  process.env.LOCAL_VIDEO === '1' || (process.env.LOCAL_VIDEO !== '0' && process.env.NODE_ENV !== 'production')

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
}

export interface DemoClip {
  file: string
  mime: string
}

export function listDemoClips(): DemoClip[] {
  if (!fs.existsSync(VIDEOS_DIR)) return []
  return fs
    .readdirSync(VIDEOS_DIR)
    .filter((f) => MIME[path.extname(f).toLowerCase()])
    .sort()
    .map((f) => ({ file: f, mime: MIME[path.extname(f).toLowerCase()] }))
}

/** A random video from the folder, or null if the folder is empty / feature is off. */
export function pickClip(): string | null {
  if (!LOCAL_VIDEO) return null
  const all = listDemoClips()
  return all.length ? all[Math.floor(Math.random() * all.length)].file : null
}

export function resolveDemoFile(name: string): { full: string; mime: string } | null {
  if (!name || name !== path.basename(name)) return null // no path tricks
  const ext = path.extname(name).toLowerCase()
  if (!MIME[ext]) return null
  const full = path.join(VIDEOS_DIR, name)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null
  return { full, mime: MIME[ext] }
}
