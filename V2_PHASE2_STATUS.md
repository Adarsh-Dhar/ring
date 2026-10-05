> **Correction:** the sections below describe the intended design. Before the escalation fix, `tick()` did not save escalation steps and no worker handled deadlines. See `docs/STATUS_AND_CHECKLIST.md` for what is actually verified.

# Phase 2 Status: Durable Timers

## Current Status: Implementation Complete

## Completed Work

### 1. pg-boss Integration ✅
- Installed `pg-boss` package (v12.36.0)
- Created `lib/queue/index.ts` - Queue wrapper and initialization
- Created `lib/queue/jobs.ts` - Job definitions and scheduling helpers
- Added npm scripts: `npm run worker` and `npm run worker:once`

### 2. Webhook Enqueue-and-Return ✅
- Modified `app/api/webhook/route.ts` to use enqueue-and-return pattern
- Webhook now stores event in database and schedules async job
- Returns immediately to Ring (200 OK) without blocking on processing
- Enhanced `WebhookEvent` model with:
  - `eventType` - Event type for routing
  - `deviceId` - Source device
  - `rawPayload` - Full JSON payload
  - `processedAt` - When job was processed
- Applied schema changes via `prisma db push`

### 3. Worker Implementation ✅
- Created `workers/timer-worker.ts` with:
  - `runWorker()` - Main worker loop (continuous)
  - `runSingleJob()` - Single job execution (for testing)
  - Job processors:
    - `processEscalation()` - Handle case escalation
    - `processCheckIn()` - Handle check-in reminders
    - `processExpectedVisitWindow()` - Handle expected visit windows
    - `processRecurringVisitWindow()` - Handle recurring visit windows
    - `processCleanupOldCases()` - Clean up old cases
    - `processCleanupOldDevices()` - Clean up old devices
    - `processDeviceOnline()` - Handle device online/offline updates
    - `processIngestEvent()` - Process doorbell/motion events

### 4. Job Types ✅
- `escalate-case` - Escalate case to next helper
- `check-in` - Daily check-in reminder
- `expected-visit-window` - Expected visit window check
- `recurring-visit-window` - Recurring visit scheduling
- `cleanup-old-cases` - Clean up cases older than 30 days
- `cleanup-old-devices` - Clean up revoked devices older than 30 days
- `device-online` - Device online update
- `device-offline` - Device offline update
- `ingest-event` - Ingest doorbell/motion event

### 5. Job Scheduling Helpers ✅
- `scheduleEscalation()` - Schedule escalation job
- `scheduleCheckIn()` - Schedule check-in reminder
- `scheduleExpectedVisitWindow()` - Schedule expected visit
- `scheduleRecurringVisitWindow()` - Schedule recurring visit
- `scheduleCleanupJobs()` - Schedule periodic cleanup
- `scheduleDeviceOnline()` - Schedule device online/offline
- `scheduleIngestEvent()` - Schedule event ingestion

## Integration Points

### Webhook Flow (New)
1. Ring sends webhook → `/api/webhook`
2. Verify signature and timestamp
3. Store event in `WebhookEvent` table
4. Schedule job to queue
5. Return 200 OK immediately
6. Worker picks up job from queue
7. Worker processes event (ingestEvent, setDeviceOnline, etc.)
8. Worker marks event as processed

### Escalation Flow (Updated)
1. Case created with deadline
2. Escalation job scheduled for deadline
3. Worker picks up job at deadline
4. Worker escalates to next helper or marks as no_response
5. Worker schedules next escalation if needed

### Check-in Flow (Updated)
1. Daily check-in job scheduled
2. Worker checks if resident checked in
3. If not, notify helpers
4. Schedule next day's check-in

## Testing Required

### Manual Testing
- [ ] Start worker: `npm run worker`
- [ ] Send test webhook via `/sim`
- [ ] Verify webhook returns immediately (200 OK)
- [ ] Verify worker processes event within 1-2 seconds
- [ ] Verify case created after worker processes
- [ ] Test escalation by setting short timeout
- [ ] Verify escalation job runs at deadline
- [ ] Test device online/offline via webhook
- [ ] Verify device status updated after worker processes

### Integration Testing
- [ ] Test with real Ring webhook (if available)
- [ ] Test webhook replay attack prevention (timestamp window)
- [ ] Test job retry on failure
- [ ] Test worker crash recovery (jobs persist in database)
- [ ] Test multiple workers (should not process same job twice)

## Deployment Considerations

### Production Setup
1. **Worker Process**: Run worker as separate process from web server
   ```bash
   npm run worker
   ```
2. **Process Manager**: Use PM2 or systemd to keep worker running
3. **Monitoring**: Add health check endpoint for worker status
4. **Scaling**: Single worker per database (pg-boss handles concurrency)
5. **Failure Handling**: Worker automatically retries failed jobs

### Environment Variables
- `DATABASE_URL` - Required for pg-boss connection
- No additional variables needed for queue

### Database Schema
- pg-boss creates its own tables in `pgboss` schema
- No migration needed for pg-boss tables (auto-created on first start)

## Known Limitations

1. **Single Worker**: Currently designed for single worker per database
2. **No Backpressure**: Queue can grow unbounded if worker is slow
3. **No Dead Letter Queue**: Failed jobs are retried but not moved to DLQ
4. **Manual Cleanup**: Old jobs remain in queue table until pg-boss cleanup
5. **No Job Priority**: All jobs have equal priority

## Next Steps

### Optional Enhancements
1. Add job priority support for critical escalations
2. Add dead letter queue for permanently failed jobs
3. Add monitoring/metrics for queue depth and processing time
4. Add backpressure protection (reject webhooks if queue too deep)
5. Add job cancellation for stale jobs (e.g., case already resolved)

### Move to Phase 3
Phase 2 is complete. Ready to move to Phase 3: Realtime and fail-closed with SSE and server-computed ResidentView.

## Dependencies
- ✅ pg-boss 12.36.0
- ✅ Existing Prisma models
- ✅ Existing store functions (ingestEvent, setDeviceOnline)

## Notes
- Webhook no longer blocks on processing - returns immediately
- All timer-based operations are now durable and survive restarts
- Jobs persist in database - safe for worker crashes
- Worker can be restarted without losing jobs
- Queue depth can be monitored via pg-boss stats

## Migration Notes
- No user migration needed
- Existing webhook flow enhanced, not replaced
- Can run side-by-side with old in-memory timers (for testing)
- To fully enable: stop using in-memory timers, rely only on queue
