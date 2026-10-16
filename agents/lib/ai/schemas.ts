import { z } from 'zod'
import { PURPOSE_KEYS } from '@/lib/doorbell/purposes'

export const DescriberOut = z.object({
  description: z.string().max(200),
  tags: z.object({
    uniform: z.boolean().default(false),
    parcel:  z.boolean().default(false),
    vehicle: z.boolean().default(false),
  }).default({ uniform: false, parcel: false, vehicle: false }),
})
export type DescriberResult = z.infer<typeof DescriberOut>

export const GreeterOut = z.object({
  transcript:          z.string().max(600),
  claimedIdentity:     z.string().max(80).nullable().default(null),
  claimedOrganisation: z.string().max(80).nullable().default(null),
  purpose:             z.string().max(120).nullable().default(null),
  uniformVisible:      z.boolean().nullable().default(null),
  visitorSummary:      z.string().max(300),
  understood:          z.boolean().default(true),
})
export type GreeterResult = z.infer<typeof GreeterOut>

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
