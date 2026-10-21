'use client';
import { useEffect, useRef, useState } from 'react';
import { BEATS, FOCUS } from './content';
import { FRAME_COUNT, frameUrl } from './frames';

// The scroll film: the page scrolls, the picture follows. The video is a set of stills; the one that matches the scroll position
// is drawn on a canvas. Stills are fetched nearest-first (so scrolling ahead of the download still works), and only a short
// window of them is kept decoded, because a decoded 1600 px picture is ~6 MB of memory and a phone cannot hold all 183.
const N = FRAME_COUNT;
const EASE = 0.16;        // how quickly the picture catches up with the scroll (1 = instantly)
const HOLD_START = 0.03;  // the first and last scenes rest for a moment before and after the film moves
const HOLD_END = 0.04;
const PARALLEL = 6;       // downloads at once
const FIRST = 24;         // stills fetched straight away; the rest wait until the person scrolls, so a visitor who only reads the top does not download the whole film

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const focusAt = (f: number) => {
  for (let i = 1; i < FOCUS.length; i++) {
    if (f <= FOCUS[i][0]) { const [f0, x0] = FOCUS[i - 1], [f1, x1] = FOCUS[i]; return x0 + ((x1 - x0) * (f - f0)) / Math.max(1, f1 - f0); }
  }
  return FOCUS[FOCUS.length - 1][1];
};
const beatAt = (f: number) => {
  let b = 0;
  BEATS.forEach((s, i) => { if (f >= s.from) b = i; });
  return b;
};

export default function ScrollStory() {
  const track = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [beat, setBeat] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // the still pictures below take over
    const cv = canvas.current, trackEl = track.current, pinEl = pin.current, cardEl = card.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !trackEl || !pinEl || !cardEl || !ctx || typeof createImageBitmap !== 'function') return;

    const blobs: (Blob | undefined)[] = new Array(N);
    const bitmaps = new Map<number, ImageBitmap>();
    const decoding = new Set<number>();
    const fetching = new Set<number>();
    const failures = new Map<number, number>();
    let alive = true, unlocked = false, raf = 0, dirty = true, target = 0, shown = 0, w = 0, h = 0, lastBeat = 0, painted = false;
    const small = () => innerWidth < 720;

    const sizeCanvas = () => {
      const r = cardEl.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(r.width * dpr)); h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      dirty = true;
    };

    const readScroll = () => {
      const r = trackEl.getBoundingClientRect(), span = r.height - pinEl.offsetHeight;
      const p = span > 0 ? clamp(-r.top / span, 0, 1) : 0;
      target = clamp((p - HOLD_START) / (1 - HOLD_START - HOLD_END), 0, 1) * (N - 1);
      cardEl.style.setProperty('--p', p.toFixed(4));
    };

    const nearestMissing = (c: number) => {
      const cap = unlocked || target > 8 ? N : FIRST;
      for (let d = 0; d < N; d++) {
        for (const i of d === 0 ? [c] : [c + d, c - d]) {
          if (i >= 0 && i < cap && !blobs[i] && !fetching.has(i) && (failures.get(i) || 0) < 2) return i;
        }
      }
      return -1;
    };
    const pump = () => {
      while (alive && fetching.size < PARALLEL) {
        const i = nearestMissing(Math.round(target));
        if (i < 0) return;
        fetching.add(i);
        fetch(frameUrl(i))
          .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
          .then((b) => { blobs[i] = b; })
          .catch(() => failures.set(i, (failures.get(i) || 0) + 1))
          .finally(() => { fetching.delete(i); if (alive) { decode(Math.round(shown)); pump(); } });
      }
    };

    // keep the stills around the current one decoded, drop the ones far away
    const decode = (c: number) => {
      const behind = small() ? 4 : 6, ahead = small() ? 10 : 14, keepBehind = behind + 8, keepAhead = ahead + 10;
      for (let i = Math.max(0, c - behind); i <= Math.min(N - 1, c + ahead); i++) {
        const b = blobs[i];
        if (!b || bitmaps.has(i) || decoding.has(i)) continue;
        decoding.add(i);
        createImageBitmap(b)
          .then((bm) => { decoding.delete(i); if (!alive) { bm.close(); return; } bitmaps.set(i, bm); dirty = true; tick(); })
          .catch(() => { decoding.delete(i); failures.set(i, 2); });
      }
      bitmaps.forEach((bm, i) => { if (i < c - keepBehind || i > c + keepAhead) { bm.close(); bitmaps.delete(i); } });
    };

    const draw = () => {
      const c = Math.round(shown);
      let bm: ImageBitmap | undefined;
      for (let d = 0; d <= 40 && !bm; d++) bm = bitmaps.get(c + d) || bitmaps.get(c - d);
      if (!bm) return;
      const scale = Math.max(w / bm.width, h / bm.height), vw = w / scale, vh = h / scale;
      const sx = clamp(focusAt(shown) * bm.width - vw / 2, 0, bm.width - vw), sy = (bm.height - vh) / 2;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bm, sx, sy, vw, vh, 0, 0, w, h);
      if (!painted) { painted = true; setReady(true); }
    };

    const tick = () => {
      if (raf || !alive) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        readScroll();
        const gap = target - shown;
        if (Math.abs(gap) > 0.02) { shown += gap * EASE; dirty = true; } else if (shown !== target) { shown = target; dirty = true; }
        const c = Math.round(shown);
        decode(c); pump();
        if (dirty) { dirty = false; draw(); }
        const b = beatAt(shown);
        if (b !== lastBeat) { lastBeat = b; setBeat(b); }
        if (shown !== target) tick();
      });
    };

    sizeCanvas(); readScroll(); shown = target; lastBeat = beatAt(shown); setBeat(lastBeat);
    pump(); tick();
    const onScroll = () => { unlocked = true; tick(); };
    const onResize = () => { sizeCanvas(); tick(); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(cardEl);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onResize);
      ro.disconnect();
      bitmaps.forEach((bm) => bm.close());
      bitmaps.clear();
    };
  }, []);

  return (
    <div className="wl-story" ref={track} aria-hidden="true">
      <div className="wl-pin" ref={pin}>
        <div className="wl-frame">
          <div className={`wl-card${ready ? ' on' : ''}`} ref={card}>
            <canvas ref={canvas} className="wl-canvas" />
            <ol className="wl-rail">{BEATS.map((b, i) => <li key={b.title} className={i === beat ? 'on' : i < beat ? 'done' : ''} />)}</ol>
            <div className="wl-bar"><i /></div>
          </div>
          <div className="wl-cap">
            {BEATS.map((b, i) => (
              <div key={b.title} className={`wl-beat${i === beat ? ' on' : ''}`}>
                <small>{String(i + 1).padStart(2, '0')} / {String(BEATS.length).padStart(2, '0')}</small>
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
