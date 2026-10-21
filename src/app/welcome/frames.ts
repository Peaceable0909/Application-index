// The scroll film is the student's own video cut into stills (public/welcome/frames, 20 per second, 1600 px wide WebP).
// To use a different video: cut it the same way (ffmpeg -vf "fps=20,scale=1600:-2" -c:v libwebp -quality 78 f%03d.webp),
// set FRAME_COUNT to how many files there are, and adjust the beat start frames in content.ts.
export const FRAME_COUNT = 183;

export const frameUrl = (i: number) => `/welcome/frames/f${String(Math.min(FRAME_COUNT, Math.max(1, i + 1))).padStart(3, '0')}.webp`;
