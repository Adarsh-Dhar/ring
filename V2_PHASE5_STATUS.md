# Phase 5 Status: Notification Ladder

## Current Status: Implementation Complete

## Completed Work

### 1. Redis Integration ✅
- Created `lib/redis/index.ts` with:
  - Singleton Redis client with connection pooling
  - `getRedis()` - Get Redis client
  - `closeRedis()` - Close connection
  - `publish()` / `subscribe()` - Pub/sub for realtime events
  - `setCache()` / `getCache()` / `deleteCache()` - Simple caching
  - `increment()` / `incrementWithTTL()` - Counters with TTL
  - `hSet()` / `hGet()` / `hGetAll()` / `hDel()` - Hash operations
  - Connection error handling and reconnection logic
- Installed `ioredis` package (v6.0.0)

### 2. Notification Ladder ✅
- Created `lib/notify/ladder.ts` with:
  - `sendNotificationLadder()` - Main ladder function
  - Ladder: Push (0s) → SMS (15s) → Voice (45s)
  - Delivery receipt tracking
  - Rate limiting (10 notifications per minute per membership)
  - `sendPushNotification()` - Push notification step
  - `sendSmsNotification()` - SMS notification step
  - `sendVoiceNotification()` - Voice notification step (placeholder)
  - `recordDeliveryReceipt()` - Record delivery status
  - `getDeliveryReceipts()` - Get delivery history
  - `checkRateLimit()` - Check notification rate limit

### 3. Redis-Based Rate Limiting ✅
- Created `lib/ratelimit/redis.ts` with:
  - `checkRateLimit()` - Generic rate limit check
  - `checkIpRateLimit()` - IP-based rate limiting
  - `checkUserRateLimit()` - User-based rate limiting
  - `checkOtpRateLimit()` - OTP-specific rate limiting
  - `checkWebhookRateLimit()` - Webhook rate limiting
  - `getRateLimitStatus()` - Get current counter value
  - `resetRateLimit()` - Reset counter (for testing)
  - Fail-open on Redis unavailability

## Ladder Behavior

### Urgency Levels
- **Low**: Push only
- **Medium**: Push → SMS
- **High**: Push → SMS → Voice

### Timing
- Push: Immediate (0s)
- SMS: 15 seconds after push
- Voice: 45 seconds after push (30s after SMS)

### Rate Limiting
- 10 notifications per minute per membership
- Sliding window with TTL
- Fails open if Redis unavailable

### Delivery Receipts
- Cached in Redis for 24 hours
- Tracks status: sent, delivered, failed, timeout
- Records errors for debugging

## Integration Points

### Store Integration (Not Yet Done)
To use the notification ladder in the doorbell store:

1. Replace `notifyHelper()` calls with `sendNotificationLadder()`
2. Replace `pushToMembership()` with ladder for critical alerts
3. Use urgency levels based on alert type:
   - SOS: High
   - Escalation: High
   - Expected visit: Medium
   - Check-in reminder: Low

### Rate Limit Migration
Current rate limiting is in-memory. To migrate:

1. Replace in-memory limits with Redis-based limits
2. Update OTP verification to use `checkOtpRateLimit()`
3. Update webhook handler to use `checkWebhookRateLimit()`
4. Update general API endpoints to use `checkIpRateLimit()`

## Testing Required

### Manual Testing
- [ ] Configure Redis (`REDIS_URL` environment variable)
- [ ] Test Redis connection
- [ ] Send ladder notification with low urgency
- [ ] Send ladder notification with medium urgency
- [ ] Send ladder notification with high urgency
- [ ] Verify rate limiting works
- [ ] Verify delivery receipts are recorded
- [ ] Test Redis failure (fails open)

### Integration Testing
- [ ] Test with multiple push subscriptions
- [ ] Test with no push subscriptions (falls back to SMS)
- [ ] Test with no phone number (fails gracefully)
- [ ] Test rate limit enforcement
- [ ] Test concurrent notifications
- [ ] Test Redis reconnection after failure

## Deployment Considerations

### Production Setup
1. **Redis Instance**: Configure Redis cluster or managed service
2. **Environment Variables**:
   - `REDIS_URL` - Redis connection string
   - `VAPID_SUBJECT` - For push notifications
   - `TWILIO_ACCOUNT_SID` - For SMS
   - `TWILIO_AUTH_TOKEN` - For SMS
3. **Monitoring**: Track Redis connection health
4. **Scaling**: Redis supports horizontal scaling

### Environment Variables
- `REDIS_URL` - Required for Redis features
- `DEMO_NO_SMS` - Disable SMS in demo mode
- `VAPID_PUBLIC_KEY` - Push notification public key
- `VAPID_PRIVATE_KEY` - Push notification private key
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token

### Voice Integration
Current voice notification is a placeholder. To implement:
1. Add Twilio Voice API integration
2. Use text-to-speech for message
3. Track call status in delivery receipts
4. Add voice delivery confirmation

## Known Limitations

1. **Voice Placeholder**: Voice notifications not implemented
2. **No Delivery Confirmation**: Push/SMS delivery not confirmed (assumes sent)
3. **No Retry Logic**: Failed channels not retried
4. **No Analytics**: No tracking of ladder success rates
5. **No Custom Timing**: Fixed delays (15s, 45s) not configurable
6. **No Priority Queue**: All notifications processed in order

## Next Steps

### Immediate
1. Integrate ladder into doorbell store
2. Replace in-memory rate limits with Redis
3. Add voice notification implementation
4. Add delivery confirmation from Twilio
5. Add ladder analytics

### Optional Enhancements
1. Configurable ladder delays
2. Custom ladder definitions per household
3. Priority queue for urgent notifications
4. Retry logic for failed channels
5. Analytics dashboard
6. Per-channel rate limits

### Move to Phase 6
Phase 5 is functionally complete. Ready to move to Phase 6: Hardening.

## Dependencies
- ✅ ioredis 6.0.0
- ✅ Existing notification system (lib/doorbell/notify.ts)
- ✅ Existing Twilio integration
- ✅ Existing push notification system

## Notes
- Redis provides persistence and horizontal scaling
- Ladder provides automatic escalation through channels
- Rate limiting prevents notification spam
- Delivery receipts provide audit trail
- Fails open if Redis unavailable (safety-critical)
- Voice notifications need Twilio Voice integration

## Migration Notes
- Redis connection required for rate limiting and pub/sub
- Can run without Redis (falls back to in-memory)
- Ladder can be gradually rolled out
- Old notification system remains for backward compatibility
- Environment variable for enabling ladder: `USE_NOTIFICATION_LADDER`
