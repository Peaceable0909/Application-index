#!/bin/sh
# Cuts a video into the stills the /welcome page plays (public/welcome/frames/f001.webp ...).
#   scripts/welcome-frames.sh path/to/video.mp4        (FFMPEG=/path/to/ffmpeg if it is not on the PATH)
# Afterwards: set FRAME_COUNT in src/app/welcome/frames.ts to the number printed here. If the new video is the same
# shots in the same order (for example the same film in higher quality) nothing else changes. If the shots, their
# timing or the person's position changed, re-measure the white space with scripts/welcome-camera.mjs and update
# TIMELINE, CAMERA, FOCUS and the `still` numbers in src/app/welcome/content.ts.
set -e
[ -n "$1" ] || { echo "usage: $0 video.mp4" >&2; exit 1; }
out="$(dirname "$0")/../public/welcome/frames"
rm -rf "$out" && mkdir -p "$out"
"${FFMPEG:-ffmpeg}" -v error -i "$1" -vf "fps=20,scale=1600:-2:flags=lanczos" -c:v libwebp -quality 78 -compression_level 5 "$out/f%03d.webp"
echo "$(ls "$out" | wc -l) frames written to public/welcome/frames ($(du -sh "$out" | cut -f1))"
