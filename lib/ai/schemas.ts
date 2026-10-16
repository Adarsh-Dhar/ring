import { z } from 'zod'
import { PURPOSE_KEYS } from '@/lib/doorbell/purposes'
import { LEVELS, RISK_CATEGORIES } from '@/lib/ai/risk/combine'

export const InterrogatorTurnOut = z.object({
  transcript:          z.string().max(600),
  understood:          z.boolean().default(true),
  claims: z.object({
    name:         z.string().max(80).nullable().default(null),
    organisation: z.string().max(80).nullable().default(null),
    reason:       z.string().max(120).nullable().default(null),
    forWhom:      z.string().max(80).nullable().default(null),
    time:         z.string().max(40).nullable().default(null),
  }),
  inconsistencies:     z.array(z.string().max(100)).max(5).default([]),
  evasive:             z.boolean().default(false),
  nextQuestion:       z.string().max(200).nullable().default(null),   // 20 WORDS (checked by validQuestion), not 20 characters
  realReasonSummary:  z.string().max(250).nullable().default(null),
  verdict:            z.enum(['consistent', 'inconsistent', 'evasive', 'unclear']).default('unclear'),
  /** Running gut-check shown live to helpers. Ungrounded, so the code caps it at 'medium'. */
  riskHint:           z.enum(LEVELS).default('none'),
})
export type InterrogatorTurnResult = z.infer<typeof InterrogatorTurnOut>

export const CompressorOut = z.object({
  text: z.string().max(120),
  icon: z.enum(PURPOSE_KEYS),
})

export const IntakeTurnOut = z.object({
  claims: z.object({
    organisation: z.string().max(80).nullable().default(null),
    purpose:      z.string().max(120).nullable().default(null),
    time:         z.string().max(40).nullable().default(null),   // free text as the visitor said it
    startsAt:     z.string().max(40).nullable().default(null),   // ISO 8601 if the model could resolve it
  }),
  nextQuestion: z.string().max(200).nullable().default(null),
})
export type IntakeTurn = z.infer<typeof IntakeTurnOut>

export const DigestOut = z.object({ text: z.string().max(700) })

/** Final risk judgement. Every non-trivial claim must carry a verbatim quote; code verifies the quotes. */
export const RiskJudgeOut = z.object({
  level:     z.enum(LEVELS),
  evidence:  z.array(z.object({ category: z.enum(RISK_CATEGORIES), quote: z.string().max(200) })).max(6).default([]),
  rationale: z.string().max(400).default(''),
})
