// The scroll film is the student's own video cut into stills (public/welcome/frames, 20 per second, 1600 px wide WebP).
// To use a different video: run scripts/welcome-frames.sh on it, set FRAME_COUNT to the number of files it reports, and if the shots or
// their timing changed re-measure with scripts/welcome-camera.mjs and update TIMELINE, CAMERA, FOCUS and the `still` frames in content.ts.
export const FRAME_COUNT = 183;

// The stills are cached hard by browsers (they never change under one version). BUMP THIS whenever the stills are replaced, or
// returning visitors keep seeing the old film.
export const FRAMES_VERSION = 3;

export const frameUrl = (i: number) => `/welcome/frames/f${String(Math.min(FRAME_COUNT, Math.max(1, i + 1))).padStart(3, '0')}.webp?v=${FRAMES_VERSION}`;
