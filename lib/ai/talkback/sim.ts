import type { TalkbackProvider } from './types'

/** The /sim page plays the lines with browser speech/audio and records with the mic, then POSTs to /api/ai/interrogator/audio. */
export const SimTalkback: TalkbackProvider = {
  name: 'sim',
  async serverDriven() { return false },
  async say() { return true },
  async listen() { return null },
}
