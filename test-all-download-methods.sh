#!/bin/bash

# Comprehensive Test of All Ring API Download Methods
# This script systematically tries every possible approach to download on_demand recordings

cd "$(dirname "$0")"

if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

BASE_URL="http://localhost:3000"
DEVICE_ID="${DEVICE_ID:-ava1.ring.device.FYCDT37JM5XOKZJSSPNEMQUHRPPBWBDUBDBAHEEG7VTANC6UI7ISUSEFSKXYYLI6XEGURMGPFFNJTPC446BAQFKLMF4GC55}"

echo "🧪 Comprehensive Ring API Download Methods Test"
echo "=========================================="
echo "📡 Device: $DEVICE_ID"
echo "🌐 Server: $BASE_URL"
echo ""

# Get a sample on_demand event
echo "📋 Step 1: Get sample on_demand event..."
sleep 2
CLIPS_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID")

if echo "$CLIPS_RESPONSE" | grep -q "error"; then
    echo "❌ Error fetching clips - waiting for rate limit..."
    sleep 30
    CLIPS_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID")
fi

SAMPLE_EVENT=$(echo "$CLIPS_RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    clips = data.get('clips', [])
    if clips and clips[0].get('eventType') == 'on_demand':
        print(clips[0]['eventId'])
    else:
        print('NO_ON_DEMAND')
except:
    print('ERROR')
")

if [ "$SAMPLE_EVENT" = "NO_ON_DEMAND" ] || [ "$SAMPLE_EVENT" = "ERROR" ]; then
    echo "❌ No on_demand events found"
    exit 1
fi

echo "✅ Found on_demand event: $SAMPLE_EVENT"
echo ""

# Test Method 1: Amazon Vision with event_id
echo "📋 Method 1: Amazon Vision API with event_id"
sleep 2
RESPONSE=$(curl -s -X POST "$BASE_URL/api/ring/clip" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"timestamp\":$(date +%s)000,\"duration\":15000,\"eventId\":\"$SAMPLE_EVENT\",\"eventType\":\"on_demand\"}")

if echo "$RESPONSE" | grep -q "error"; then
    echo "❌ Method 1 failed: $(echo $RESPONSE | python3 -c 'import json,sys; print(json.load(sys.stdin).get(\"error\", \"Unknown\")[:100])')"
else
    echo "✅ Method 1 SUCCESS!"
    echo "✅ ON_demand recordings ARE downloadable!"
    exit 0
fi
echo ""

# Test Method 2: Check if Ring clients_api works with current token
echo "📋 Method 2: Ring clients_api with current token"
BASE_EVENT_ID=$(echo "$SAMPLE_EVENT" | sed 's/.*\.//')
RING_RESPONSE=$(curl -s "https://api.ring.com/clients_api/dings/${BASE_EVENT_ID}/share/download?disable_redirect=true" \
  -H "Authorization: Bearer $RING_ACCESS_TOKEN")

if echo "$RING_RESPONSE" | grep -q "error\|401\|403"; then
    echo "❌ Method 2 failed - requires different authentication"
else
    echo "✅ Method 2 SUCCESS - Ring clients_api works with current token!"
    echo "✅ This means we can use Ring clients_api for on_demand downloads"
    exit 0
fi
echo ""

# Test Method 3: Try GET instead of POST
echo "📋 Method 3: Try GET request instead of POST"
GET_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID")

if echo "$GET_RESPONSE" | grep -q "error"; then
    echo "❌ Method 3 failed"
else
    echo "✅ Method 3 works for clips list (expected)"
fi
echo ""

echo "📋 Summary:"
echo "All standard methods failed or require different authentication."
echo "The fundamental issue: Ring's API policy doesn't allow downloading on_demand events via the available endpoints."
echo ""
echo "💡 What WILL work:"
echo "   - Automatic events (motion, ding, doorbell_motion) via Amazon Vision API"
echo "   - On_demand events via Ring clients_api with Ring refresh token (requires Ring username/password)"
echo ""
echo "🎯 To get working downloads NOW:"
echo "   1. Trigger motion detection on your camera"
echo "   2. Wait 1-2 minutes for Ring to process"
echo "   3. Refresh the clips page"
echo "   4. Download the new motion events (these WILL work)"
