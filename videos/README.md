# videos/

Put your .mp4 files here (also .webm / .mov). Any number of files.

These act as the "door camera". When a doorbell press (or SOS) happens, the helper
screen plays one of these as a live-looking feed. Nothing is recorded.

- Simulator (/sim): every file here becomes a button, so you choose which one plays.
- Real/unknown trigger: a random file from this folder is used.
- Folder is NOT under public/, so videos are only served to signed-in helpers.
- Override the folder with VIDEOS_DIR in .env.
- Use H.264 (AVC) + AAC mp4 for playback in every browser.
