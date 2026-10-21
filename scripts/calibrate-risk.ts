#!/usr/bin/env npx tsx
/**
 * Risk-rule calibration harness (spec section 12).
 *
 * Usage:  npx tsx scripts/calibrate-risk.ts
 *    or:  npm run calibrate
 *
 * Reads every *.json fixture in tests/fixtures/section12/.
 * Each fixture file is an array of cases; each case has:
 *   - transcript: string
 *   - interviewState: Partial<InterviewState>
 *   - expectedCodes: Behaviour[]     codes expected to score > 0 or be confirmed
 *   - notExpected:   Behaviour[]     codes that must NOT score (false-positive check)
 *
 * Reports precision and recall per code, and lists every false positive
 * on the spec 4.1 zero-score behaviours.
 *
 * NOTE: All current fixtures are synthetic. Supply labelled real or role-played
 * transcripts before treating the output as calibration data.
 */

import * as fs from 'fs'
import * as path from 'path'
import { scoreObservations, observationsFromEvidence, phraseMatches, BEHAVIOURS, PHRASE_PATTERNS, type Behaviour, type InterviewState } from '../lib/doorstep/riskRules'

const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/section12')
const ZERO_SCORE_PHRASES = [
  'looking nervous', 'avoids eye contact', 'has an accent', 'speaking slowly',
  'face mismatch', 'blurry camera', 'arriving without notice', 'arrived unannounced',
  'my van broke down', "i'll beat the traffic",
]

interface Fixture {
  id: string
  description: string
  transcript: string
  interviewState?: Partial<InterviewState>
  expectedCodes: Behaviour[]
  notExpected: Behaviour[]
  synthetic?: boolean
}

// ── Load fixtures ────────────────────────────────────────────────────────────

const allFixtures: Fixture[] = []
for (const file of fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'))) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'))
  const items: Fixture[] = Array.isArray(raw) ? raw : [raw]
  allFixtures.push(...items)
}

if (allFixtures.length === 0) {
  console.error('No fixtures found in', FIXTURES_DIR)
  process.exit(1)
}

const syntheticCount = allFixtures.filter(f => f.synthetic).length
console.log(`\nLoaded ${allFixtures.length} fixtures (${syntheticCount} synthetic, ${allFixtures.length - syntheticCount} labelled real)`)
if (syntheticCount === allFixtures.length) {
  console.warn('⚠  All fixtures are synthetic. Calibration is not valid until real labelled data is supplied.\n')
}

// ── Score each fixture ───────────────────────────────────────────────────────

interface CodeStats { tp: number; fp: number; fn: number }
const stats: Record<string, CodeStats> = {}
for (const b of BEHAVIOURS) stats[b] = { tp: 0, fp: 0, fn: 0 }

const fpZeroScoreLines: { id: string; phrase: string; transcript: string }[] = []
const results: { id: string; pass: boolean; details: string }[] = []

for (const fix of allFixtures) {
  const is = fix.interviewState ?? {}

  // Run phraseMatches against the transcript to find which codes the pattern layer would fire.
  // Skip codes without PHRASE_PATTERNS (they need sensor/helper sources, not transcript alone).
  const PHRASE_CODES = new Set(Object.keys(PHRASE_PATTERNS) as Behaviour[])
  const firedCodes = new Set<Behaviour>()
  for (const b of BEHAVIOURS) {
    if (PHRASE_CODES.has(b) && phraseMatches(b, fix.transcript)) firedCodes.add(b)
  }

  // For codes with no PHRASE_PATTERN (e.g. purpose_contradiction, extra_knock, door events), they need
  // either a sensor/helper source — the pattern layer alone cannot fire them. We don't test those here.

  // Tally TP / FP / FN
  for (const expected of fix.expectedCodes) {
    if (firedCodes.has(expected)) stats[expected].tp++
    else stats[expected].fn++
  }
  for (const code of firedCodes) {
    if (!fix.expectedCodes.includes(code)) stats[code].fp++
  }

  // Check notExpected (false-positive guard)
  const badFires = fix.notExpected.filter(c => firedCodes.has(c))

  // Check zero-score phrase guard
  for (const phrase of ZERO_SCORE_PHRASES) {
    if (fix.transcript.toLowerCase().includes(phrase.toLowerCase())) {
      for (const code of firedCodes) {
        fpZeroScoreLines.push({ id: fix.id, phrase, transcript: fix.transcript })
      }
    }
  }

  const pass = badFires.length === 0
  if (!pass) {
    results.push({ id: fix.id, pass: false, details: `False positives: ${badFires.join(', ')} in "${fix.transcript}"` })
  } else {
    results.push({ id: fix.id, pass: true, details: fix.description })
  }
}

// ── Print results ────────────────────────────────────────────────────────────

console.log('\n── Per-code precision & recall ─────────────────────────────────────')
console.log(String('Code').padEnd(32) + String('Precision').padEnd(12) + String('Recall').padEnd(10) + 'TP  FP  FN')
for (const b of BEHAVIOURS) {
  const s = stats[b]
  if (s.tp + s.fp + s.fn === 0) continue
  const precision = s.tp + s.fp > 0 ? s.tp / (s.tp + s.fp) : null
  const recall    = s.tp + s.fn > 0 ? s.tp / (s.tp + s.fn) : null
  const pStr = precision !== null ? (precision * 100).toFixed(0) + '%' : 'n/a'
  const rStr = recall !== null ? (recall * 100).toFixed(0) + '%' : 'n/a'
  console.log(b.padEnd(32) + pStr.padEnd(12) + rStr.padEnd(10) + `${s.tp}   ${s.fp}   ${s.fn}`)
}

console.log('\n── False-positive guard results ────────────────────────────────────')
const fails = results.filter(r => !r.pass)
if (fails.length === 0) {
  console.log('✅  No false positives on notExpected codes.')
} else {
  for (const f of fails) console.error(`❌  [${f.id}] ${f.details}`)
}

if (fpZeroScoreLines.length > 0) {
  console.log('\n── Spec 4.1 zero-score phrase false positives ──────────────────────')
  for (const f of fpZeroScoreLines) {
    console.error(`❌  [${f.id}] Pattern matched on zero-score phrase "${f.phrase}"`)
  }
} else {
  console.log('\n✅  No spec 4.1 zero-score phrase false positives.')
}

const totalFails = fails.length + fpZeroScoreLines.length
console.log(`\n── Summary: ${allFixtures.length} fixtures, ${totalFails} failures ─────────────────────────────\n`)
process.exit(totalFails > 0 ? 1 : 0)
