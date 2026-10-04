import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createPushSubscription, deletePushSubscriptionByEndpoint } from '@/lib/db/push'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Sub = z.object({
  endpoint: z.string().url('Subscription endpoint must be a valid URL').max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth:   z.string().min(1).max(100),
  }),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, z.object({ subscription: Sub }))
  if (p.ok === false) return p.res

  const membershipId = a.session!.membershipId!

  try {
    await createPushSubscription(
      membershipId,
      p.data.subscription.endpoint,
      p.data.subscription.keys,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[PUSH SUBSCRIBE POST]', e)
    return fail(`Failed to save push subscription: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, z.object({
    endpoint: z.string().url('Endpoint must be a valid URL').max(1000),
  }))
  if (p.ok === false) return p.res

  const membershipId = a.session!.membershipId!

  try {
    await deletePushSubscriptionByEndpoint(membershipId, p.data.endpoint)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[PUSH SUBSCRIBE DELETE]', e)
    return fail(`Failed to remove push subscription: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true })
}
