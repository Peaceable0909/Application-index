'use client';
import { useEffect, useRef, useState } from 'react';

// The opening intro. The still logo shows straight away, then /brand/extravel-intro.gif plays from its first frame and the screen
// fades out when it ends. No film yet (or it can't be fetched in time)? A short shine across the still logo stands in for it.
const FILM = '/brand/extravel-intro.gif';
const WAIT_MS = 3500;      // how long the film gets to arrive
const SHINE_MS = 1900;     // length of the stand-in
const FALLBACK_MS = 6000;  // film length if it can't be read from the file

/** Length of a GIF in ms from its frame delays (0 when it isn't a GIF). */
function gifLength(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 0;
  let p = 13, ms = 0;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9) { const d = b[p + 2] | (b[p + 3] << 8); ms += d < 2 ? 100 : d * 10; }
      while (p < b.length && b[p]) p += b[p] + 1;
      p++;
    } else if (t === 0x2c) {
      const f = b[p + 8];
      p += 9;
      if (f & 0x80) p += 3 * (1 << ((f & 7) + 1));
      p++;
      while (p < b.length && b[p]) p += b[p] + 1;
      p++;
    } else break;
  }
  return ms;
}

export default function Splash() {
  const [s, setS] = useState<'still' | 'film' | 'shine' | 'out' | 'gone'>('still');
  const [src, setSrc] = useState('');
  const skip = useRef<() => void>(undefined);

  useEffect(() => {
    (window as unknown as { __sp?: boolean }).__sp = true; // tells the page's own safety timer that the app started
    const html = document.documentElement;
    if (html.classList.contains('no-splash') || matchMedia('(prefers-reduced-motion: reduce)').matches) { setS('gone'); return; }
    // keep the keyboard (an autofocused field) from opening behind the intro; give focus back afterwards
    const held = document.activeElement as HTMLElement | null;
    if (held && held !== document.body) held.blur();
    const timers: number[] = [];
    let over = false, started = false, url = '';
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
    const finish = () => {
      if (over) return;
      over = true;
      timers.forEach(clearTimeout);
      setS('out');
      later(() => {
        setS('gone');
        if (url) { URL.revokeObjectURL(url); url = ''; }
        if (held && held.isConnected && (!document.activeElement || document.activeElement === document.body)) held.focus({ preventScroll: true });
      }, 520);
    };
    skip.current = finish;
    const stand = () => { if (over || started) return; started = true; setS('shine'); later(finish, SHINE_MS); };
    later(stand, WAIT_MS);
    (async () => {
      try {
        const r = await fetch(FILM);
        if (!r.ok || !(r.headers.get('content-type') || '').includes('gif')) { r.body?.cancel().catch(() => {}); throw new Error('no film'); }
        const buf = await r.arrayBuffer();
        if (over || started) return;
        started = true;
        timers.forEach(clearTimeout);
        const len = gifLength(buf) || FALLBACK_MS;
        url = URL.createObjectURL(new Blob([buf], { type: 'image/gif' }));
        setSrc(url);
        setS('film');
        later(finish, Math.min(Math.max(len, 1500), 9000) + 150);
      } catch { stand(); }
    })();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    window.addEventListener('keydown', key);
    return () => { over = true; timers.forEach(clearTimeout); window.removeEventListener('keydown', key); if (url) URL.revokeObjectURL(url); };
  }, []);

  if (s === 'gone') return null;
  return (
    <div className="splash" data-s={s} aria-hidden onPointerDown={() => skip.current?.()}>
      <div className="splash-stage">
        <img className="splash-poster" src="/brand/extravel-logo.png" alt="" draggable={false} fetchPriority="high" />
        <span className="splash-shine" />
        {src && <img className="splash-film" src={src} alt="" draggable={false} />}
      </div>
      <div className="splash-skip">Tap to skip</div>
    </div>
  );
}
