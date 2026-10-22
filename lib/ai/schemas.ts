import { z } from 'zod'
import { PURPOSE_KEYS } from '@/lib/doorbell/purposes'
import { LEVELS, RISK_CATEGORIES } from '@/lib/ai/risk/combine'

/** The interviewer's output schemas live in lib/ai/interrogation/schemas.ts. */

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

/** Final risk evidence. Every claim must carry a verbatim quote; code verifies the quotes and decides the score. */
export const RiskJudgeOut = z.object({
  /** Old output field. Accepted and ignored: the model never sets the level. */
  level:     z.enum(LEVELS).default('none'),
  evidence:  z.array(z.object({ category: z.enum(RISK_CATEGORIES), quote: z.string().max(200), earlierQuote: z.string().max(200).optional() })).max(8).default([]),
  rationale: z.string().max(400).default(''),
})
