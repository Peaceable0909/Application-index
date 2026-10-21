// Cleans the /welcome stills cut from the "clearer" video (video_text_enhanced.mp4), which still carried the generator's
// semi-transparent white star at the bottom right (about x 1450, y 750 on a 1600 px still) and, from the removal tool, a damaged
// top-left corner. Not a general tool: the star's position, its shape (read off frame 93, where it sits on pure black) and the
// frame numbers below belong to that one film.
//   1. brightness and colour of the star are undone separately (the video keeps colour at half the sharpness of brightness),
//      with the star's strength read per frame from the picture just outside it; its thin bright rim is softened;
//   2. frames 34 to 40 (skin close-up) are rebuilt from their surroundings instead, because the star does not blend like a plain
//      overlay there;
//   3. where the background is bright (above ~222) the star is only a few levels and the picture is left alone;
//   4. the top-left corner is copied back from the stills of the original video, feathered in, on the frames where it is damaged.
// Usage: FILL=34-40 node scripts/welcome-unstar.cjs <new stills dir> <original stills dir> <output dir> [frame,frame,...]
// Clearer video's stills: (1) undo the semi-transparent white star watermark. Its strength is read per frame by comparing the plain
// part of the star with the picture just outside it (median over the edge, so texture does not matter); (2) put back the corner the
// removal tool damaged, from the original stills.
const sharp = require('sharp');
const fs = require('fs');
const [, , ENH, OLD, OUT, ONLY] = process.argv;
const CX = 1450, CY = 750, R = 45, SZ = 2 * R;
const blur = (src, r) => { // box blur, three passes ~ gaussian
  let cur = Float32Array.from(src);
  for (let pass = 0; pass < 3; pass++) for (const dir of [0, 1]) {
    const out = new Float32Array(SZ * SZ);
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) { let s = 0, n = 0; for (let d = -r; d <= r; d++) { const xx = dir ? x : x + d, yy = dir ? y + d : y; if (xx >= 0 && xx < SZ && yy >= 0 && yy < SZ) { s += cur[yy * SZ + xx]; n++; } } out[y * SZ + x] = s / n; }
    cur = out;
  }
  return cur;
};
const FILL = (process.env.FILL || '').split(',').filter(Boolean).flatMap((r) => { const [a, b] = r.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); });
const name = (f) => `f${String(f).padStart(3, '0')}.webp`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
(async () => {
  const ref = await sharp(`${ENH}/${name(93)}`).raw().toBuffer({ resolveWithObject: true });
  const W = ref.info.width, H = ref.info.height, C = ref.info.channels;
  const A0 = new Float32Array(SZ * SZ);
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
    const i = ((CY - R + y) * W + (CX - R + x)) * C; const l = (ref.data[i] + ref.data[i + 1] + ref.data[i + 2]) / 3;
    A0[y * SZ + x] = l < 5 ? 0 : clamp(l / 255, 0, 0.9);
  }
  // outside pixels near the star, and plain-part pixels (not the bright rim) a few pixels inside its edge, each with its nearest outside neighbour
  const outside = [], plain = [];
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (A0[y * SZ + x] === 0) outside.push([x, y]);
  const pairs = [];
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
    const a = A0[y * SZ + x]; if (a < 0.18 || a > 0.34) continue;
    let bd = 1e9, bq = null; for (const q of outside) { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; bq = q; } }
    if (bd >= 9 && bd <= 100) pairs.push([x, y, bq[0], bq[1]]);
  }
  const star = []; for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (A0[y * SZ + x] > 0.02) star.push([x, y]);
  const ring = [];
  for (const [x, y] of outside) { let bd = 1e9; for (const q of star) { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) bd = d; } if (bd >= 9 && bd <= 144) ring.push([x, y]); }
  const rim = new Uint8Array(SZ * SZ);
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) { let on = 0; for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < SZ && xx >= 0 && xx < SZ && A0[yy * SZ + xx] >= 0.3) { on = 1; break; } } rim[y * SZ + x] = on; }
  const frames = ONLY ? ONLY.split(',').map(Number) : Array.from({ length: 183 }, (_, i) => i + 1);
  // pass 1: strength per frame
  const ks = {};
  const cache = {};
  for (const f of frames) {
    const { data } = await sharp(`${ENH}/${name(f)}`).raw().toBuffer({ resolveWithObject: true });
    cache[f] = data;
    const L = (x, y) => { const i = ((CY - R + y) * W + (CX - R + x)) * C; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
    const est = [];
    for (const [x, y, qx, qy] of pairs) { const q = L(qx, qy); if (255 - q < 40) continue; est.push(((L(x, y) - q) / (255 - q)) / A0[y * SZ + x]); }
    est.sort((a, b) => a - b);
    ks[f] = est.length >= 25 ? { k: est[est.length >> 1], n: est.length } : null;
    if (frames.length < 183) delete cache[f] && 0;
  }
  // smooth over neighbouring frames that have a reading (the strength does not jump from one frame to the next)
  const all = frames.slice();
  const kSmooth = {};
  for (const f of all) {
    const near = []; for (let d = -3; d <= 3; d++) { const e = ks[f + d]; if (e) near.push(e.k); }
    near.sort((a, b) => a - b);
    kSmooth[f] = near.length ? clamp(near[near.length >> 1], 0.3, 1.6) : 1;
  }
  const report = [];
  for (const f of all) {
    const { data } = await sharp(`${ENH}/${name(f)}`).raw().toBuffer({ resolveWithObject: true });
    const buf = Buffer.from(data);
    const k = clamp(kSmooth[f], 0.75, 1.25);
    const ringL = ring.map(([x, y]) => { const i = ((CY - R + y) * W + (CX - R + x)) * C; return (data[i] + data[i + 1] + data[i + 2]) / 3; }).sort((a, b) => a - b)[ring.length >> 1];
    if (ringL > 222) { /* bright background: the star is hardly there (a few levels), leave the picture alone */ } else if (FILL.includes(f)) {
      // smooth background (skin, wall): rebuild the star's area from what surrounds it
      const mask = new Uint8Array(SZ * SZ);
      for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) { let on = 0; for (let dy = -4; dy <= 4 && !on; dy++) for (let dx = -4; dx <= 4; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < SZ && xx >= 0 && xx < SZ && A0[yy * SZ + xx] > 0.02) { on = 1; break; } } mask[y * SZ + x] = on; }
      for (let c = 0; c < 3; c++) {
        let F = new Float32Array(SZ * SZ), mean = 0, n = 0;
        for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) { const v = data[((CY - R + y) * W + (CX - R + x)) * C + c]; F[y * SZ + x] = v; if (!mask[y * SZ + x]) { mean += v; n++; } }
        for (let i = 0; i < SZ * SZ; i++) if (mask[i]) F[i] = mean / n;
        for (let it = 0; it < 400; it++) { const G = Float32Array.from(F); for (let y = 1; y < SZ - 1; y++) for (let x = 1; x < SZ - 1; x++) { const i = y * SZ + x; if (mask[i]) G[i] = (F[i - 1] + F[i + 1] + F[i - SZ] + F[i + SZ]) / 4; } F = G; }
        for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if (mask[y * SZ + x]) buf[((CY - R + y) * W + (CX - R + x)) * C + c] = clamp(Math.round(F[y * SZ + x]), 0, 255);
      }
    } else {
    // The video keeps colour at half the sharpness of brightness, so the star's colour edge is softer than its brightness edge:
    // undo brightness with the sharp star map and colour with a softened one.
    const AB = blur(A0, 2);
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
      const a = k * A0[y * SZ + x], ab = k * AB[y * SZ + x]; if (a <= 0 && ab <= 0.003) continue;
      const i = ((CY - R + y) * W + (CX - R + x)) * C;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const Y = 0.299 * r + 0.587 * g + 0.114 * b, Cb = -0.168736 * r - 0.331264 * g + 0.5 * b, Cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
      const Y2 = a > 0 ? clamp((Y - 255 * a) / (1 - a), 0, 255) : Y;
      const Cb2 = Cb / (1 - ab), Cr2 = Cr / (1 - ab);
      buf[i] = clamp(Math.round(Y2 + 1.402 * Cr2), 0, 255);
      buf[i + 1] = clamp(Math.round(Y2 - 0.344136 * Cb2 - 0.714136 * Cr2), 0, 255);
      buf[i + 2] = clamp(Math.round(Y2 + 1.772 * Cb2), 0, 255);
    }
    // the thin bright rim of the star is where a small error is magnified most: soften it with its surroundings
    const snap = Buffer.from(buf);
    for (let y = 2; y < SZ - 2; y++) for (let x = 2; x < SZ - 2; x++) {
      if (!rim[y * SZ + x]) continue;
      const i = ((CY - R + y) * W + (CX - R + x)) * C;
      for (let c = 0; c < 3; c++) { let s = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += snap[((CY - R + y + dy) * W + (CX - R + x + dx)) * C + c]; buf[i + c] = Math.round(s / 25); }
    }
    }
    const old = await sharp(`${OLD}/${name(f)}`).raw().toBuffer();
    const CW = 360, CH = 140, FE = 50;
    // Only where the clearer video's corner really differs from the original's (the removal tool's patch, or a hard edge there):
    // elsewhere its picture is better, and the original's slightly different tone would show as a faint box.
    let worst = 0;
    for (let by = 0; by < 16; by++) for (let bx = 0; bx < 40; bx++) {
      let a = 0, b = 0;
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { const i = ((by * 10 + y) * W + bx * 10 + x) * C; a += buf[i] + buf[i + 1] + buf[i + 2]; b += old[i] + old[i + 1] + old[i + 2]; }
      worst = Math.max(worst, Math.abs(a - b) / 300);
    }
    if (worst > 25) for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const m = clamp(Math.min((CW - x) / FE, (CH - y) / FE), 0, 1); const i = (y * W + x) * C;
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(buf[i + c] * (1 - m) + old[i + c] * m);
    }
    await sharp(buf, { raw: { width: W, height: H, channels: C } }).webp({ quality: 80, effort: 5 }).toFile(`${OUT}/${name(f)}`);
    report.push(`${f}:${k.toFixed(2)}${ks[f] ? '' : '*'}`);
  }
  console.log(report.join(' '));
})();
