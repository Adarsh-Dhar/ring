import fs from 'fs'
import path from 'path'

const DEMO_DIR = path.join(process.cwd(), 'public', 'demo-clips')

export interface DemoClip {
  file: string
  mime: string
}

export function listDemoClips(): DemoClip[] {
  if (!fs.existsSync(DEMO_DIR)) return []
  const files = fs.readdirSync(DEMO_DIR)
  return files
    .filter((f) => /\.(mp4|webm|mov|avi)$/i.test(f))
    .map((f) => ({
      file: f,
      mime: f.endsWith('.mp4') ? 'video/mp4' : f.endsWith('.webm') ? 'video/webm' : 'video/mp4',
    }))
}

export function resolveDemoFile(name: string): { full: string; mime: string } | null {
  if (!name) return null
  const full = path.join(DEMO_DIR, name)
  if (!fs.existsSync(full)) return null
  const ext = path.extname(name).toLowerCase()
  const mime = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : 'video/mp4'
  return { full, mime }
}
