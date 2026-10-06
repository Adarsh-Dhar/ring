import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RespondBody = z.object({
  action: z.enum(['accept', 'reject', 'mark_read']),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const userId = a.session!.userId
  const { id: notificationId } = await params

  const p = await parse(req, RespondBody)
  if (p.ok === false) return p.res
  const body = p.data

  try {
    const db = getDb()

    // Verify the notification belongs to the user
    const notification = await db.notification.findUnique({
      where: { id: notificationId },
      include: { fromUser: true },
    })

    if (!notification) {
      return fail('Notification not found', 404)
    }

    if (notification.toUserId !== userId) {
      return fail('You can only respond to your own notifications', 403)
    }

    if (body.action === 'mark_read') {
      await db.notification.update({
        where: { id: notificationId },
        data: {
          read: true,
          readAt: new Date(),
        },
      })
      return NextResponse.json({ ok: true })
    }

    if (notification.status !== 'pending') {
      return fail('This notification has already been responded to', 400)
    }

    if (body.action === 'accept') {
      // For helper invites, accept the membership
      if (notification.type === 'helper_invite' && notification.metadata) {
        const metadata = notification.metadata as any
        if (metadata.membershipId) {
          // Validate the membership belongs to the user and household
          const membership = await db.membership.findUnique({
            where: { id: metadata.membershipId },
          })

          if (!membership) {
            return fail('Membership not found', 404)
          }

          if (membership.userId !== userId) {
            return fail('This membership does not belong to you', 403)
          }

          if (membership.householdId !== metadata.householdId) {
            return fail('Membership household mismatch', 403)
          }

          if (membership.consent !== 'pending') {
            return fail('Membership is not in pending state', 400)
          }

          await db.membership.update({
            where: { id: metadata.membershipId },
            data: {
              consent: 'approved',
              consentAt: new Date(),
            },
          })
        }

        // Notify the resident who sent the invite
        if (notification.fromUserId) {
          const toUser = await db.user.findUnique({
            where: { id: userId },
            select: { name: true },
          })
          await db.notification.create({
            data: {
              type: 'helper_invite_accepted',
              title: 'Helper Invite Accepted',
              message: `${toUser?.name || 'A helper'} has accepted your invitation to be a helper.`,
              toUserId: notification.fromUserId,
              fromUserId: userId,
              status: 'read',
            },
          })
        }
      }

      await db.notification.update({
        where: { id: notificationId },
        data: {
          status: 'accepted',
          respondedAt: new Date(),
          read: true,
          readAt: new Date(),
        },
      })

      return NextResponse.json({ ok: true, status: 'accepted' })
    }

    if (body.action === 'reject') {
      // For helper invites, reject/remove the membership
      if (notification.type === 'helper_invite' && notification.metadata) {
        const metadata = notification.metadata as any
        if (metadata.membershipId) {
          // Validate the membership belongs to the user and household
          const membership = await db.membership.findUnique({
            where: { id: metadata.membershipId },
          })

          if (membership && membership.userId === userId && membership.householdId === metadata.householdId && membership.consent === 'pending') {
            await db.membership.delete({
              where: { id: metadata.membershipId },
            })
          }
        }

        // Notify the resident who sent the invite
        if (notification.fromUserId) {
          const toUser = await db.user.findUnique({
            where: { id: userId },
            select: { name: true },
          })
          await db.notification.create({
            data: {
              type: 'helper_invite_rejected',
              title: 'Helper Invite Rejected',
              message: `${toUser?.name || 'A helper'} has declined your invitation to be a helper.`,
              toUserId: notification.fromUserId,
              fromUserId: userId,
              status: 'read',
            },
          })
        }
      }

      await db.notification.update({
        where: { id: notificationId },
        data: {
          status: 'rejected',
          respondedAt: new Date(),
          read: true,
          readAt: new Date(),
        },
      })

      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[NOTIFICATION RESPOND] Failed to respond to notification', e)
    return fail('Unable to respond to notification. Please try again.', 503)
  }
}
