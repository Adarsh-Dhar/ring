import fs from 'fs'
import path from 'path'

const DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const FILE = path.join(DIR, 'state.json')

export function loadState<T extends object>(): Partial<T> {
  if (!fs.existsSync(FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<T>
  } catch (e) {
    // Never silently start empty and overwrite the evidence: keep the broken file, then try the last good copy.
    const keep = `${FILE}.corrupt-${Date.now()}`
    try { fs.copyFileSync(FILE, keep) } catch {}
    console.error(`[PERSIST] state.json is unreadable (${(e as Error).message}). Saved a copy to ${keep}.`)
    try { return JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8')) as Partial<T> } catch { return {} }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Writes the latest state at most once per 300 ms.
 * NOTE: state.json holds phone numbers and case history in plain text. Keep DATA_DIR on an encrypted disk
 * with restricted permissions (file mode 600) until this moves to a real database.
 */
export function saveSoon(get: () => unknown) {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    try {
      fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
      const tmp = FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(get()), { mode: 0o600 })
      if (fs.existsSync(FILE)) {
        fs.copyFileSync(FILE, FILE + '.bak')
      }
      fs.renameSync(tmp, FILE)
    } catch (e) {
      // Suppress ENOENT errors during build time (data directory may not exist yet)
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[PERSIST]', e)
      }
    }
  }, 300)
}
