import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const userId = a.session!.userId

  try {
    const db = getDb()
    const notifications = await db.notification.findMany({
      where: {
        toUserId: userId,
      },
      include: {
        fromUser: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        status: n.status,
        metadata: n.metadata,
        read: n.read,
        readAt: n.readAt,
        createdAt: n.createdAt,
        respondedAt: n.respondedAt,
        fromUser: n.fromUser,
      })),
    })
  } catch (e) {
    console.error('[NOTIFICATIONS GET] Failed to load notifications', e)
    return fail('Unable to load notifications. Please try again.', 503)
  }
}

const CreateBody = z.object({
  type: z.enum(['helper_invite', 'helper_invite_accepted', 'helper_invite_rejected', 'visitor_request', 'alert']),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  toUserId: z.string(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const fromUserId = a.session!.userId

  const p = await parse(req, CreateBody)
  if (p.ok === false) return p.res
  const body = p.data

  try {
    const db = getDb()
    const notification = await db.notification.create({
      data: {
        type: body.type,
        title: body.title,
        message: body.message,
        toUserId: body.toUserId,
        fromUserId,
      },
    })

    return NextResponse.json({
      ok: true,
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        status: notification.status,
      },
    })
  } catch (e) {
    console.error('[NOTIFICATIONS POST] Failed to create notification', e)
    return fail('Unable to create notification. Please try again.', 503)
  }
}
