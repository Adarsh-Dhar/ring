import { NextRequest } from 'next/server'
import { authorize } from '@/lib/guard'
import { computeResidentView } from '@/lib/state/resident-view'
import { getState } from '@/lib/doorbell/store'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * SSE endpoint for resident screen realtime updates
 * Authenticates with authorize(req, 'resident')
 * Ignores any householdId in query string - uses only session's
 * Sends state events on change and heartbeat every 5 seconds
 */
export async function GET(req: NextRequest) {
  const auth = await authorize(req, 'resident')
  if (auth.ok === false) return auth.res

  const householdId = auth.session.householdId // never from the query string
  const membershipId = auth.session.membershipId

  const enc = new TextEncoder()
  let timer: ReturnType<typeof setInterval>, beat: ReturnType<typeof setInterval>
  let last = ''

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

      const failClosedView = () => ({
        state: 'CLOSED_KEEP_SHUT',
        message: 'Connection lost - keep door closed',
        backgroundColor: '#2d1b1b',
        textColor: '#ffffff',
        showVideo: false,
        showFaces: false,
        canOpen: false,
      })

      const push = async () => {
        try {
          // Load state using the same logic as /api/doorbell/state
          const state = await getState(householdId, 'resident', membershipId)

          if (!state) {
            send('state', { view: failClosedView(), at: Date.now() })
            return
          }

          // Load household for timezone and quiet hours
          const household = await getDb().household.findUnique({
            where: { id: householdId },
          })

          if (!household) {
            send('state', { view: failClosedView(), at: Date.now() })
            return
          }

          // Build StateInfo for computeResidentView
          // State has a different structure - use the current case and helpers
          const currentCase = state.current
          const stateInfo = {
            cases: currentCase ? [{
              id: currentCase.id,
              status: currentCase.status,
              kind: currentCase.kind,
              createdAt: new Date(currentCase.createdAt),
              helperIndex: currentCase.helperIndex,
              deadlineAt: new Date(currentCase.deadlineAt),
              answer: currentCase.answer,
              answeredBy: currentCase.answeredBy,
              visitor: currentCase.visitor,
              visitIcon: currentCase.visitIcon,
              visitLabel: currentCase.visitLabel,
              checkWho: currentCase.checkWho,
              checkWord: currentCase.checkWord,
              expectedId: currentCase.expectedId,
              regularId: currentCase.regularId,
            }] : [],
            deviceOnline: !state.offline,
            lastHeartbeat: new Date(), // the view is computed live; the client detects loss from missing heartbeat events
            timezone: household.timezone,
            quietEnabled: household.quietEnabled,
            quietStartHour: household.quietStartHour,
            quietEndHour: household.quietEndHour,
            nightLockActive: state.quietNow ?? false,
          }

          const view = computeResidentView(stateInfo, household)
          const json = JSON.stringify(view)
          if (json !== last) {
            last = json
            send('state', { view, at: Date.now() })
          }
        } catch (error) {
          console.error('[SSE] Error computing resident view:', error)
          send('state', { view: failClosedView(), at: Date.now() })
        }
      }

      await push()
      timer = setInterval(push, 2000)
      beat = setInterval(() => send('heartbeat', { at: Date.now() }), 5000)

      req.signal.addEventListener('abort', () => {
        clearInterval(timer)
        clearInterval(beat)
        controller.close()
      })
    },
    cancel() {
      clearInterval(timer)
      clearInterval(beat)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
}
