// Measures, for every still of the /welcome film, how much empty (white) space is left on each side of the picture, and prints the
// CAMERA keyframes for src/app/welcome/content.ts: how far to slide the picture sideways (as a share of the screen width) so the
// text panels have about NEED of the screen to sit in. Run it after cutting new stills:  node scripts/welcome-camera.mjs
// Keep WINDOWS in step with the panels in content.ts: [first frame, last frame, side the text sits on], padded by ~8 frames so the
// slide eases in and out before and after the panel.
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WINDOWS = [[0, 30, 'L'], [48, 98, 'R'], [94, 128, 'L'], [126, 148, 'R']];
const NEED = 0.34, MAX = 0.13, W = 160, H = 90;
const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/welcome/frames');
const files = readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();

const free = [];
for (const f of files) {
  const { data } = await sharp(join(dir, f)).resize(W, H).greyscale().raw().toBuffer({ resolveWithObject: true });
  const L = (x, y) => data[y * W + x];
  const busy = new Array(W).fill(0);
  for (let x = 1; x < W - 1; x++) {
    let n = 0, rows = 0;
    for (let y = 6; y < H - 6; y++) { const g = Math.abs(L(x + 1, y) - L(x - 1, y)) + Math.abs(L(x, y + 1) - L(x, y - 1)); if (g > 22 || L(x, y) < 200) n++; rows++; }
    busy[x] = n / rows;
  }
  const clear = busy.map((v) => v < 0.06);
  let l = 0; while (l < W && clear[l]) l++;
  let r = 0; while (r < W && clear[W - 1 - r]) r++;
  free.push({ l: l / W, r: r / W });
}
const N = free.length;
const shift = new Array(N).fill(0);
for (const [a, b, side] of WINDOWS) for (let f = a; f <= Math.min(b, N - 1); f++) {
  let m = 1; for (let k = -3; k <= 3; k++) { const q = free[Math.min(N - 1, Math.max(0, f + k))]; m = Math.min(m, side === 'L' ? q.l : q.r); }
  const need = Math.min(MAX, Math.max(0, NEED - m));
  shift[f] = side === 'L' ? need : -need;
}
const smooth = shift.map((_, f) => { let s = 0, n = 0; for (let k = -10; k <= 10; k++) { const i = f + k; if (i >= 0 && i < N) { s += shift[i]; n++; } } return s / n; });
// never slide into an edge that has something on it (the uncovered strip is the picture's own edge, stretched)
const out = smooth.map((v, f) => (v > 0 ? Math.min(v, free[f].l * 0.9) : -Math.min(-v, free[f].r * 0.9)));
const keys = [];
for (let f = 0; f < N; f += 3) if (Math.abs(out[f]) > 0.004 || (f >= 3 && Math.abs(out[f - 3]) > 0.004)) keys.push(`[${f}, ${+out[f].toFixed(3)}]`);
console.log(`${N} frames. Paste into CAMERA in src/app/welcome/content.ts:\n\n${keys.join(', ')}`);
