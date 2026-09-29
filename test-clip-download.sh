#!/bin/bash

# Ring Clip Download Test Script - UI-like behavior
# This script tests the clip download functionality through the Next.js API
# by loading the same environment that Next.js uses

# Set working directory to project root
cd "$(dirname "$0")"

# Load environment variables exactly like Next.js does
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

BASE_URL="http://localhost:3000"
DEVICE_ID="${DEVICE_ID:-ava1.ring.device.FYCDT37JM5XOKZJSSPNEMQUHRPPBWBDUBDBAHEEG7VTANC6UI7ISUSEFSKXKYYLI6XEGURMGPFFNJTPC446BAQFKLMF4GC55}"

echo "🎬 Ring Clip Download Test (UI-like behavior)"
echo "=============================================="
echo "📡 Device: $DEVICE_ID"
echo "🌐 Server: $BASE_URL"
echo "📁 Working directory: $(pwd)"
echo ""

# Debug: Show loaded environment
echo "🔧 Environment check:"
echo "   RING_ACCESS_TOKEN: ${RING_ACCESS_TOKEN:0:20}..."
echo "   NEXT_PUBLIC_RING_DEVICE_ID: $NEXT_PUBLIC_RING_DEVICE_ID"
echo ""

# Test 1: Check if server is running
echo "🔍 Checking if server is running..."
HEALTH_CHECK=$(curl -s "$BASE_URL/api/ring/config")
if echo "$HEALTH_CHECK" | grep -q "error"; then
    echo "❌ Server error or not responding"
    echo "$HEALTH_CHECK"
    exit 1
fi
echo "✅ Server is running"
echo ""

# Test 2: Get clips list (exactly like UI)
echo "📋 Fetching clips list..."
sleep 2  # Avoid Ring API rate limiting
CLIPS_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID")

# Check for errors
if echo "$CLIPS_RESPONSE" | grep -q "error"; then
    echo "❌ Error fetching clips:"
    echo "$CLIPS_RESPONSE"
    echo ""
    echo "💡 Troubleshooting:"
    echo "   1. Ensure Next.js server is running: npm run dev"
    echo "   2. Check .env.local file exists and has valid credentials"
    echo "   3. Use the UI at http://localhost:3000/clips for testing"
    exit 1
fi

echo "✅ Clips response received"
echo ""

# Test 3: Parse clips response
echo "🔍 Parsing clips response..."

# Use Python for proper JSON parsing
CLIP_DATA=$(echo "$CLIPS_RESPONSE" | python3 -c "
import json
import sys

try:
    data = json.load(sys.stdin)
    clips = data.get('clips', [])
    
    if not clips:
        print('NO_CLIPS')
    else:
        clip = clips[0]
        print(f\"{clip['id']}|{clip['eventType']}|{clip['startMs']}|{clip.get('eventId', '')}|{clip.get('downloadable', True)}\")
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
")

if [ "$CLIP_DATA" = "NO_CLIPS" ]; then
    echo "❌ No clips found"
    exit 1
fi

if [[ "$CLIP_DATA" == ERROR* ]]; then
    echo "❌ Error parsing clips: $CLIP_DATA"
    exit 1
fi

# Parse the clip data
CLIP_ID=$(echo "$CLIP_DATA" | cut -d'|' -f1)
CLIP_TYPE=$(echo "$CLIP_DATA" | cut -d'|' -f2)
CLIP_TIMESTAMP=$(echo "$CLIP_DATA" | cut -d'|' -f3)
CLIP_EVENT_ID=$(echo "$CLIP_DATA" | cut -d'|' -f4)
CLIP_DOWNLOADABLE=$(echo "$CLIP_DATA" | cut -d'|' -f5)

echo "📹 Selected clip:"
echo "   ID: $CLIP_ID"
echo "   Type: $CLIP_TYPE"
echo "   Timestamp: $CLIP_TIMESTAMP"
echo "   Event ID: $CLIP_EVENT_ID"
echo "   Downloadable: $CLIP_DOWNLOADABLE"
echo "   Date: $(date -r $((CLIP_TIMESTAMP / 1000)) 2>/dev/null || echo 'Invalid date')"
echo ""

# Test 4: Attempt download (exactly like UI)
echo "⬇️  Attempting download (UI method)..."

# Create JSON payload properly
JSON_PAYLOAD="{\"deviceId\":\"$DEVICE_ID\",\"timestamp\":$CLIP_TIMESTAMP,\"duration\":15000,\"eventId\":\"$CLIP_EVENT_ID\",\"eventType\":\"$CLIP_TYPE\"}"

echo "📦 Request payload:"
echo "$JSON_PAYLOAD"
echo ""

sleep 2  # Avoid Ring API rate limiting
DOWNLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/api/ring/clip" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

# Check if download was successful
if echo "$DOWNLOAD_RESPONSE" | grep -q "error"; then
    echo "❌ Download failed:"
    
    # Parse error with Python
    ERROR_MSG=$(echo "$DOWNLOAD_RESPONSE" | python3 -c "
import json
import sys

try:
    data = json.load(sys.stdin)
    if 'error' in data:
        print(data['error'])
    else:
        print(str(data))
except:
    print(sys.stdin.read())
")
    echo "Error: $ERROR_MSG"
    
    echo ""
    if [ "$CLIP_TYPE" = "on_demand" ]; then
        echo "💡 This is expected behavior for 'on_demand' events"
        echo "   Ring's Media Clips API does not allow downloading manually triggered recordings"
        echo "   Trigger motion or doorbell events to get downloadable clips"
    fi
    exit 1
else
    echo "✅ Download successful!"
    echo "📊 Response size: ${#DOWNLOAD_RESPONSE} bytes"
    
    # Check if it's binary data (video)
    if file - <<< "$DOWNLOAD_RESPONSE" 2>/dev/null | grep -q "video"; then
        echo "🎬 Valid video file received"
    else
        echo "📊 Response type: $(file - <<< "$DOWNLOAD_RESPONSE" 2>/dev/null || echo 'unknown')"
    fi
    
    exit 0
fi
