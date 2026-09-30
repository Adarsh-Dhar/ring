#!/bin/bash
# Generate fake sample clips for demo mode
# Requires ffmpeg to be installed

SAMPLES_DIR="public/samples"
mkdir -p "$SAMPLES_DIR"

echo "Generating sample clips in $SAMPLES_DIR..."

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed."
    echo "Install it with:"
    echo "  Mac: brew install ffmpeg"
    echo "  Linux: sudo apt install ffmpeg"
    echo "  Windows: winget install ffmpeg"
    exit 1
fi

# Generate clips with different severity levels
# Each clip is 10 seconds, 720p, no audio, with different colors to distinguish them

# Level 0: Empty porch (black screen)
ffmpeg -f lavfi -i color=c=black:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-00-empty-porch.mp4" -y 2>/dev/null

# Level 1: Delivery person (blue screen)
ffmpeg -f lavfi -i color=c=blue:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-01-delivery.mp4" -y 2>/dev/null

# Level 2: Neighbor walking (green screen)
ffmpeg -f lavfi -i color=c=green:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-02-neighbor.mp4" -y 2>/dev/null

# Level 3: Loitering (yellow screen)
ffmpeg -f lavfi -i color=c=yellow:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-03-loitering.mp4" -y 2>/dev/null

# Level 4: Peering into windows (orange screen)
ffmpeg -f lavfi -i color=c=orange:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-04-peering.mp4" -y 2>/dev/null

# Level 5: Shoplifting (red screen)
ffmpeg -f lavfi -i color=c=red:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-05-shoplifting.mp4" -y 2>/dev/null

# Level 6: Stealing package (dark red screen)
ffmpeg -f lavfi -i color=c=darkred:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-06-stealing.mp4" -y 2>/dev/null

# Level 7: Vandalism (purple screen)
ffmpeg -f lavfi -i color=c=purple:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-07-vandalism.mp4" -y 2>/dev/null

# Level 8: Burglary (magenta screen)
ffmpeg -f lavfi -i color=c=magenta:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-08-burglary.mp4" -y 2>/dev/null

# Level 9: Fighting (brown screen)
ffmpeg -f lavfi -i color=c=brown:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-09-fighting.mp4" -y 2>/dev/null

# Level 10: Armed robbery (gray screen)
ffmpeg -f lavfi -i color=c=gray:s=1280x720:d=10 -c:v libx264 -crf 28 -an "$SAMPLES_DIR/level-10-armed-robbery.mp4" -y 2>/dev/null

echo "✓ Sample clips generated successfully!"
echo "Files created in $SAMPLES_DIR:"
ls -lh "$SAMPLES_DIR"
