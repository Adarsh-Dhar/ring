# Simulator sample videos

Place MP4 files here to show fake video in the helper and resident screens
during simulated doorbell events.

## File naming

The filename maps to the sim device ID used in the simulator:

| File | Shown for device |
|---|---|
| `default.mp4` | Any sim device without a specific file (fallback) |
| `front-door.mp4` | `sim-front-door` |
| `back-door.mp4` | `sim-back-door` |
| `<suffix>.mp4` | `sim-<suffix>` |

## How the fallback works

1. LiveView first tries `/sim/videos/<suffix>.mp4` (e.g. `front-door.mp4`).
2. If that file is missing or fails to load, it falls back to `default.mp4`.
3. If `default.mp4` is also missing, a "no sample video" placeholder is shown with instructions.

## Recommendations

- Keep clips short (5–15 seconds) and loop-friendly — they autoplay muted on loop.
- H.264 / AAC in an MP4 container works in all browsers.
- A typical doorbell view: someone approaching, pausing at the door, pressing the bell.
- You can use any royalty-free stock video or record your own doorstep.

## Quick test clip (no camera needed)

Generate a 10-second placeholder with ffmpeg:

```sh
ffmpeg -f lavfi -i "color=c=gray:size=640x360:rate=25" \
       -f lavfi -i "anullsrc=r=44100:cl=mono" \
       -vf "drawtext=text='Sim doorbell feed':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2" \
       -t 10 -c:v libx264 -c:a aac -shortest \
       public/sim/videos/default.mp4
```
