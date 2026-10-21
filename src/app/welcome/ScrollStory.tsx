'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import OpenChat from './OpenChat';
import { CAMERA, FOCUS, PANELS, TIMELINE, type Panel } from './content';
import { FRAME_COUNT, frameUrl } from './frames';

// The page is the film. The page scrolls, the picture follows, and the text sits in the white space around her.
// The film is a set of stills; the one that matches the scroll position is drawn on a canvas. Stills are fetched nearest-first
// (so scrolling ahead of the download still works), and only a short window of them is kept decoded, because a decoded 1600 px
// still is ~6 MB of memory and a phone cannot hold all 183.
const N = FRAME_COUNT;
const EASE = 0.16;   // how quickly the picture catches up with the scroll (1 = instantly)
const PARALLEL = 6;  // downloads at once
const FIRST = 24;    // stills fetched straight away; the rest wait until the person scrolls, so a visitor who only reads the top does not download the whole film
const WIDE = '(min-aspect-ratio: 3/2) and (min-width: 900px)'; // room for text beside the picture; anything narrower puts the text in a card at the bottom

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerpKeys = (keys: [number, number][], f: number) => {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (f <= keys[i][0]) { const [f0, v0] = keys[i - 1], [f1, v1] = keys[i]; return v0 + ((v1 - v0) * (f - f0)) / Math.max(1, f1 - f0); }
  }
  return keys[keys.length - 1][1];
};

type Run = { start: number; end: number; from: number; to: number; panels: string[] };
/** The scroll plan: which frames and which panels belong to each stretch of scrolling. On a narrow screen two panels that would sit side by side follow each other instead. */
function plan(wide: boolean, has: (id: string) => boolean) {
  const runs: Run[] = [];
  let at = 0;
  for (const s of TIMELINE) {
    const ids = s.panels.filter(has);
    const parts = !wide && ids.length > 1 ? ids.map((id) => [id]) : [ids];
    const len = parts.length > 1 ? s.vh * 0.8 : s.vh;
    parts.forEach((p, i) => {
      const a = s.frames[0] + ((s.frames[1] - s.frames[0]) * i) / parts.length, b = s.frames[0] + ((s.frames[1] - s.frames[0]) * (i + 1)) / parts.length;
      runs.push({ start: at, end: at + len, from: a, to: b, panels: p });
      at += len;
    });
  }
  return { runs, total: at };
}
const runAt = (runs: Run[], v: number) => runs.find((r) => v < r.end) ?? runs[runs.length - 1];
const frameAt = (runs: Run[], v: number) => { const r = runAt(runs, v); return r.from + ((r.to - r.from) * clamp((v - r.start) / Math.max(1e-6, r.end - r.start), 0, 1)); };

function Buttons({ ws, kind }: { ws: string | null; kind: NonNullable<Panel['cta']> }) {
  return (
    <div className="wl-cta">
      {ws && <OpenChat ws={ws} className="wl-btn" label="Chat with an adviser"><Icon n="chat" size={18} /><span>{kind === 'ask' ? 'Ask about a course' : 'Chat with an adviser'}</span></OpenChat>}
      {kind !== 'ask' && <a href="/student/login" className="wl-btn ghost"><span>Student sign in</span></a>}
    </div>
  );
}

export function PanelBody({ p, ws, unis, hint }: { p: Panel; ws: string | null; unis: string[] | null; hint?: boolean }) {
  return (
    <>
      {p.label && <p className="wl-eyebrow">{p.label}</p>}
      {p.id === 'hero' ? <h1>{p.title}</h1> : <h2>{p.title}</h2>}
      {p.text && <p className="wl-text">{p.text}</p>}
      {p.points && <ul className="wl-points">{p.points.map((t) => <li key={t}><Icon n="check" size={16} />{t}</li>)}</ul>}
      {p.list && <ul className="wl-why">{p.list.map((it) => <li key={it.title}><span className="wl-ico"><Icon n={it.icon} size={18} /></span><div><b>{it.title}</b><small>{it.text}</small></div></li>)}</ul>}
      {p.unis && unis && <ul className="wl-pills">{unis.map((n) => <li key={n}>{n}</li>)}</ul>}
      {p.cta && <Buttons ws={ws} kind={p.cta} />}
      {hint && <p className="wl-hint"><span>Keep scrolling</span><Icon n="down" size={16} /></p>}
    </>
  );
}

export default function ScrollStory({ ws, unis }: { ws: string | null; unis: string[] | null }) {
  const track = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState<string[]>(['hero']);
  const [ready, setReady] = useState(false);
  const has = useMemo(() => (id: string) => id !== 'apply' || !!unis, [unis]);
  const panels = useMemo(() => PANELS.filter((p) => has(p.id)), [has]);
  const groups = useMemo(() => panels.filter((p) => p.id !== 'why'), [panels]);
  const lastGroup = useRef(0);
  const act = groups.findIndex((g) => active.includes(g.id) || (g.id === 'pack' && active.includes('why')));
  if (act >= 0) lastGroup.current = act;

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // the still pictures below take over
    const cv = canvas.current, trackEl = track.current, pinEl = pin.current, stageEl = stage.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !trackEl || !pinEl || !stageEl || !ctx || typeof createImageBitmap !== 'function') { setReady(true); return; } // cannot draw the film: show the words over the first picture

    const blobs: (Blob | undefined)[] = new Array(N);
    const bitmaps = new Map<number, ImageBitmap>();
    const decoding = new Set<number>();
    const fetching = new Set<number>();
    const failures = new Map<number, number>();
    const mq = matchMedia(WIDE);
    let wide = mq.matches, schedule = plan(wide, has);
    let alive = true, unlocked = false, raf = 0, dirty = true, target = 0, shown = 0, w = 0, h = 0, painted = false, lastActive = '';
    const small = () => innerWidth < 720;

    const layout = () => {
      wide = mq.matches;
      schedule = plan(wide, has);
      trackEl.style.height = CSS.supports('height', '1svh') ? `calc(100svh + ${schedule.total}svh)` : `calc(100vh + ${schedule.total}vh)`;
      const r = stageEl.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(r.width * dpr)); h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      dirty = true;
    };

    // scroll position in units of one screen height / 100, the same unit the plan uses
    const readScroll = () => {
      const r = trackEl.getBoundingClientRect(), unit = pinEl.offsetHeight / 100;
      target = clamp(-r.top / unit, 0, schedule.total);
    };
    const frameNow = (pos: number) => clamp(frameAt(schedule.runs, pos), 0, N - 1);

    const nearestMissing = (c: number) => {
      const cap = unlocked || target > 0 ? N : FIRST;
      for (let d = 0; d < N; d++) {
        for (const i of d === 0 ? [c] : [c + d, c - d]) {
          if (i >= 0 && i < cap && !blobs[i] && !fetching.has(i) && (failures.get(i) || 0) < 2) return i;
        }
      }
      return -1;
    };
    const pump = () => {
      while (alive && fetching.size < PARALLEL) {
        const i = nearestMissing(Math.round(frameNow(shown)));
        if (i < 0) return;
        fetching.add(i);
        fetch(frameUrl(i))
          .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
          .then((b) => { blobs[i] = b; })
          .catch(() => failures.set(i, (failures.get(i) || 0) + 1))
          .finally(() => { fetching.delete(i); if (alive) { decode(Math.round(frameNow(shown))); pump(); } });
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
      const f = frameNow(shown), c = Math.round(f);
      let bm: ImageBitmap | undefined;
      for (let d = 0; d <= 40 && !bm; d++) bm = bitmaps.get(c + d) || bitmaps.get(c - d);
      if (!bm) return;
      const scale = Math.max(w / bm.width, h / bm.height), vw = w / scale, vh = h / scale;
      const sx = clamp((wide ? 0.5 : lerpKeys(FOCUS, f)) * bm.width - vw / 2, 0, bm.width - vw), sy = (bm.height - vh) / 2;
      const dx = wide ? Math.round(lerpKeys(CAMERA, f) * w) : 0;
      ctx.imageSmoothingQuality = 'high';
      // The picture slides sideways to open more white space; the strip it uncovers is its own edge, stretched, so there is no seam.
      if (dx > 0) ctx.drawImage(bm, sx, sy, 4, vh, 0, 0, dx + 2, h);
      else if (dx < 0) ctx.drawImage(bm, sx + vw - 4, sy, 4, vh, w + dx - 2, 0, -dx + 2, h);
      ctx.drawImage(bm, sx, sy, vw, vh, dx, 0, w, h);
      if (!painted) { painted = true; setReady(true); }
    };

    const tick = () => {
      if (raf || !alive) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        readScroll();
        const gap = target - shown;
        if (Math.abs(gap) > 0.05) { shown += gap * EASE; dirty = true; } else if (shown !== target) { shown = target; dirty = true; }
        decode(Math.round(frameNow(shown))); pump();
        if (dirty) { dirty = false; draw(); }
        const now = runAt(schedule.runs, shown).panels.join(',');
        if (now !== lastActive) { lastActive = now; setActive(now ? now.split(',') : []); }
        stageEl.style.setProperty('--p', (shown / Math.max(1, schedule.total)).toFixed(4));
        if (shown !== target) tick();
      });
    };

    layout(); readScroll(); shown = target;
    lastActive = runAt(schedule.runs, shown).panels.join(','); setActive(lastActive ? lastActive.split(',') : []);
    pump(); tick();
    const onScroll = () => { unlocked = true; tick(); };
    const onResize = () => { layout(); tick(); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(stageEl);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onResize);
      ro.disconnect();
      bitmaps.forEach((bm) => bm.close());
      bitmaps.clear();
    };
  }, [has]);

  return (
    <div className="wl-story" ref={track}>
      <div className="wl-pin" ref={pin}>
        <div className={`wl-stage${ready ? ' on' : ''}`} ref={stage}>
          <canvas ref={canvas} className="wl-canvas" aria-hidden="true" />
          {panels.map((p) => {
            const on = active.includes(p.id);
            return (
              <section key={p.id} className={`wl-panel ${p.side}${p.card ? ' card' : ''}${on ? ' on' : ''}`} aria-hidden={!on} {...(on ? {} : { inert: true })}>
                <PanelBody p={p} ws={ws} unis={unis} hint={p.id === 'hero'} />
              </section>
            );
          })}
          <ol className="wl-rail" aria-hidden="true">{groups.map((g, i) => <li key={g.id} className={i === lastGroup.current ? 'on' : i < lastGroup.current ? 'done' : ''} />)}</ol>
          <div className="wl-bar" aria-hidden="true"><i /></div>
        </div>
      </div>
    </div>
  );
}
