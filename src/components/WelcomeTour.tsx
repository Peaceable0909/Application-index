'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { confetti } from '@/lib/confetti';
import { tick, success } from '@/lib/haptics';

const SLIDES = [
  { e: '🎓', t: (n: string) => `Welcome, ${n}!`, d: 'Your whole admission journey in one place: where you are, what is next, and who to ask.', hue: ['#5ac8fa', '#007aff'] },
  { e: '📷', t: () => 'Scan documents with your camera', d: 'Photograph each page and we turn it into one neat PDF, then tell your counselor straight away.', hue: ['#ffb340', '#ff9500'] },
  { e: '💬', t: () => 'Message or call your counselor', d: 'Send a message any time, or tap Call for a voice or video chat. You can even send stickers.', hue: ['#4cd964', '#2fb750'] },
  { e: '🔔', t: () => 'Never miss a thing', d: 'Turn on alerts so we can tell you the moment something needs you. Add the app to your home screen too.', hue: ['#c77dff', '#9b4fd6'] },
];

/** A short first-visit tour in a bottom sheet. Shown once per device. */
export default function WelcomeTour({ name }: { name: string }) {
  const [open, setOpen] = useState(false), [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { try { if (!localStorage.getItem('wr_tour_v1')) { const t = setTimeout(() => setOpen(true), 900); return () => clearTimeout(t); } } catch { /* storage off */ } }, []);
  function close(celebrate = false) { try { localStorage.setItem('wr_tour_v1', '1'); } catch { /* optional */ } setOpen(false); if (celebrate) { success(); confetti({ count: 90 }); } }
  function go(n: number) { const el = box.current; if (!el) return; el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' }); tick(); }
  if (!open) return null;
  const last = i === SLIDES.length - 1;
  return (
    <div className="st-sheet-bg wt-bg" role="dialog" aria-modal="true" aria-label="Welcome" onClick={() => close()}>
      <div className="st-sheet wt" onClick={(e) => e.stopPropagation()}>
        <div className="st-grab" />
        <div className="wt-track" ref={box} onScroll={(e) => { const el = e.currentTarget; setI(Math.round(el.scrollLeft / el.clientWidth)); }}>
          {SLIDES.map((s, k) => (
            <div key={k} className="wt-slide">
              <div className="wt-art" style={{ ['--h1' as string]: s.hue[0], ['--h2' as string]: s.hue[1] }}><span>{s.e}</span></div>
              <h2>{s.t(name)}</h2><p>{s.d}</p>
            </div>
          ))}
        </div>
        <div className="wt-dots">{SLIDES.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="wt-act">
          {last ? <>
            <Link href="/student/me" className="st-btn" onClick={() => close(true)}>Turn on alerts</Link>
            <button type="button" className="st-btn ghost" onClick={() => close(true)}>Let’s go</button>
          </> : <>
            <button type="button" className="st-btn" onClick={() => go(i + 1)}>Next</button>
            <button type="button" className="st-btn ghost" onClick={() => close()}>Skip</button>
          </>}
        </div>
      </div>
    </div>
  );
}
