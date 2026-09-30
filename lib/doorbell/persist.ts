import fs from 'fs'
import path from 'path'

const DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const FILE = path.join(DIR, 'state.json')

export function loadState<T extends object>(): Partial<T> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<T>
  } catch {
    return {}
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Writes the latest state at most once per 300 ms. */
export function saveSoon(get: () => unknown) {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    try {
      fs.mkdirSync(DIR, { recursive: true })
      const tmp = FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(get()))
      fs.renameSync(tmp, FILE)
    } catch (e) {
      console.error('[PERSIST]', e)
    }
  }, 300)
}
