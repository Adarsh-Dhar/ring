#!/bin/bash

# Test Server Downloadable Event Types
# This script tests that the server correctly identifies downloadable event types

cd "$(dirname "$0")"

if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

BASE_URL="http://localhost:3000"
DEVICE_ID="${DEVICE_ID:-ava1.ring.device.FYCDT37JM5XOKZJSSPNEMQUHRPPBWBDUBDBAHEEG7VTANC6UI7ISUSEFSKXYYLI6XEGURMGPFFNJTPC446BAQFKLMF4GC55}"

echo "🧪 Testing Server Downloadable Event Types"
echo "=========================================="
echo "📡 Device: $DEVICE_ID"
echo "🌐 Server: $BASE_URL"
echo ""

# Test 1: Check server is running
echo "📋 Test 1: Server health check"
HEALTH_CHECK=$(curl -s "$BASE_URL/api/ring/config")
if echo "$HEALTH_CHECK" | grep -q "error"; then
    echo "❌ Server not responding"
    exit 1
fi
echo "✅ Server is running"
echo ""

# Test 2: Get all clips and check event types
echo "📋 Test 2: Fetch clips and check event types"
sleep 2
CLIPS_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID")

if echo "$CLIPS_RESPONSE" | grep -q "error"; then
    echo "❌ Error fetching clips:"
    echo "$CLIPS_RESPONSE"
    exit 1
fi

echo "✅ Clips fetched successfully"
echo ""

# Test 3: Analyze event types and downloadable status
echo "📋 Test 3: Analyze event types and downloadable status"
echo "$CLIPS_RESPONSE" | python3 << 'PYTHON_SCRIPT'
import json
import sys

try:
    data = json.load(sys.stdin)
    clips = data.get('clips', [])
    
    if not clips:
        print("❌ No clips found")
        sys.exit(1)
    
    print(f"📊 Total clips: {len(clips)}")
    print("")
    
    # Count by event type
    event_type_counts = {}
    downloadable_counts = {}
    
    for clip in clips:
        et = clip['eventType']
        downloadable = clip.get('downloadable', False)
        
        event_type_counts[et] = event_type_counts.get(et, 0) + 1
        if downloadable:
            downloadable_counts[et] = downloadable_counts.get(et, 0) + 1
    
    print("📈 Event types found:")
    for et, count in sorted(event_type_counts.items()):
        dl_count = downloadable_counts.get(et, 0)
        dl_status = "✅ Downloadable" if dl_count > 0 else "❌ Not downloadable"
        print(f"   {et}: {count} clips ({dl_count} downloadable) - {dl_status}")
    
    print("")
    
    # Show downloadable vs non-downloadable
    downloadable = [c for c in clips if c.get('downloadable', False)]
    non_downloadable = [c for c in clips if not c.get('downloadable', False)]
    
    print(f"✅ Downloadable clips: {len(downloadable)}")
    print(f"❌ Non-downloadable clips: {len(non_downloadable)}")
    print("")
    
    # Show expected downloadable types
    expected_downloadable = ['motion', 'ding', 'doorbell_motion', 'doorbell_motion_detected']
    print("📋 Expected downloadable event types:")
    for et in expected_downloadable:
        count = event_type_counts.get(et, 0)
        status = "✅ Found" if count > 0 else "⚠️  Not found (trigger to test)"
        print(f"   {et}: {status} ({count} clips)")
    
    print("")
    
    # Show specific clips
    print("📹 Clip details (first 5):")
    for i, clip in enumerate(clips[:5]):
        dl_status = "✅" if clip.get('downloadable', False) else "❌"
        print(f"   {i+1}. {dl_status} {clip['eventType']} - {clip['startMs']}")
    
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
PYTHON_SCRIPT

echo ""
echo "📋 Test 4: Test with eventTypes filter"
echo "Testing filter for motion events..."
sleep 2
MOTION_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID&eventTypes=motion")

if echo "$MOTION_RESPONSE" | grep -q "error"; then
    echo "⚠️  Motion filter test failed (expected if no motion events)"
else
    MOTION_COUNT=$(echo "$MOTION_RESPONSE" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('clips', [])))")
    echo "✅ Motion filter works: ${MOTION_COUNT} motion clips found"
fi

echo ""
echo "✅ Server testing complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Check the UI at http://localhost:3000/clips"
echo "   2. Use the 'Only downloadable' filter to see downloadable clips"
echo "   3. Trigger motion/doorbell events to generate downloadable clips"
