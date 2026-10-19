/**
 * What the resident page shows for a visitor case (spec 6.2). Pure, so the page and its tests share one source.
 * The mode comes from the SNAPSHOT (riskScore + controlMode), not from the SSE stream, so it works when SSE is down.
 * The words come only from residentScreenFor(); nothing here writes its own wording.
 */
import { residentScreenFor, type ControlMode } from './modeCopy'
import { effectiveModeFor } from './collaborationController'
import { modeRank } from './riskRules'

export interface ModeScreenCase {
  kind: string
  riskScore?: number | null
  controlMode?: string | null
  ackedAt?: string | number | Date | null
}

export interface ModeScreen {
  mode: ControlMode
  icon: string
  title: string
  bg: string
  alarm: boolean
  calm: boolean
}

/** The effective mode of a visitor case, or null for anything else (SOS has its own screens). */
export function visitorModeOf(c: ModeScreenCase | null | undefined): ControlMode | null {
  if (!c || c.kind !== 'visitor') return null
  return effectiveModeFor(c.riskScore, (c.controlMode as ControlMode | null | undefined) ?? null)
}

const STYLE: Record<ControlMode, { icon: string; bg: string; alarm: boolean; calm: boolean }> = {
  ai_leads:      { icon: '🚪', bg: 'bg-sky-800',    alarm: false, calm: true },
  ai_assisted:   { icon: '👀', bg: 'bg-amber-700',  alarm: false, calm: false },
  helper_leads:  { icon: '⚠️', bg: 'bg-amber-700',  alarm: true,  calm: false },
  helper_only:   { icon: '⛔', bg: 'bg-red-800',    alarm: true,  calm: false },
  helper_urgent: { icon: '🚨', bg: 'bg-red-900',    alarm: true,  calm: false },
  emergency:     { icon: '🆘', bg: 'bg-red-900',    alarm: true,  calm: false },
}

export function modeScreenFor(c: ModeScreenCase | null | undefined): ModeScreen | null {
  const mode = visitorModeOf(c)
  if (!mode) return null
  return { mode, title: residentScreenFor(mode, !!c!.ackedAt), ...STYLE[mode] }
}

/** M4 and M5 outrank everything else on the screen, including night lock, offline and connection warnings. */
export const isUrgentMode = (m: ControlMode | null) => !!m && modeRank(m) >= modeRank('helper_urgent')
