# Ring Clips Testing Commands

## Quick Test with Curl

### 1. Get Device ID
```bash
curl http://localhost:3000/api/ring/devices
```

### 2. Get Clips List
```bash
curl "http://localhost:3000/api/ring/clips?deviceId=YOUR_DEVICE_ID"
```

### 3. Download a Specific Clip
```bash
curl -X POST http://localhost:3000/api/ring/clip \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "YOUR_DEVICE_ID",
    "timestamp": 1790656058395,
    "duration": 15000,
    "eventId": "ava1.ring.history.event.V6G5HW23L2Y47RRSKOQ2MNS44DUPCGSFWTNM6A7QNUXHKWYRCWEBUZW4THGW2ESJMRYZTHQCKN6VCHT57MFJYWN7UKGMLZSU"
  }'
```

## Automated Test Scripts

### Simple Test (First Clip)
```bash
./test-clip-download.sh
```

### Advanced Test (Try Multiple Clips)
```bash
./test-random-clip.sh
```

### With Custom Device ID
```bash
DEVICE_ID="your_device_id" ./test-random-clip.sh
```

## What to Expect

- **on_demand events**: Will fail with "TIME_RANGE_NOT_AUTHORIZED" (Ring API limitation)
- **motion/ding/doorbell events**: Should download successfully
- **Success response**: Binary video data (MP4)
- **Error response**: JSON with error message

## Notes

- Ring's Media Clips API only allows downloading automatic events
- Manually triggered recordings (on_demand) are not downloadable
- Trigger motion or doorbell events to generate downloadable clips
- Timestamp must be in milliseconds
- Duration is in milliseconds (max 900000 = 15 minutes)
