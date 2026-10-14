'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { tick, success } from '@/lib/haptics';

/** Pull the page down from the top to refresh it, like a native app. Touch only; off on the chat screen. */
export default function PullToRefresh() {
  const router = useRouter(), path = usePathname() || '';
  const [pull, setPull] = useState(0), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const st = useRef<{ y0: number; on: boolean } | null>(null), py = useRef(0), armed = useRef(false);
  const off = path.startsWith('/student/messages');
  useEffect(() => {
    if (off) return;
    const set = (v: number) => { py.current = v; setPull(v); };
    const ts = (e: TouchEvent) => { if (window.scrollY > 0 || e.touches.length !== 1 || document.querySelector('.st-sheet-bg, .callui, .cf-bg')) { st.current = null; return; } st.current = { y0: e.touches[0].clientY, on: false }; armed.current = false; };
    const tm = (e: TouchEvent) => {
      const s = st.current; if (!s) return;
      const dy = e.touches[0].clientY - s.y0;
      if (dy > 10 && window.scrollY <= 0) { s.on = true; set(Math.min(96, dy * 0.42)); if (!armed.current && py.current >= 62) { armed.current = true; tick(); } if (armed.current && py.current < 62) armed.current = false; }
      else if (dy <= 0 && s.on) { s.on = false; set(0); }
    };
    const te = () => {
      const s = st.current; st.current = null;
      if (!s?.on) return;
      if (py.current >= 62) { setBusy(true); set(54); router.refresh(); setTimeout(() => { setBusy(false); setDone(true); success(); set(0); setTimeout(() => setDone(false), 700); }, 900); }
      else set(0);
    };
    document.addEventListener('touchstart', ts, { passive: true }); document.addEventListener('touchmove', tm, { passive: true }); document.addEventListener('touchend', te); document.addEventListener('touchcancel', te);
    return () => { document.removeEventListener('touchstart', ts); document.removeEventListener('touchmove', tm); document.removeEventListener('touchend', te); document.removeEventListener('touchcancel', te); };
  }, [off, router]);
  if (off || (pull === 0 && !busy && !done)) return null;
  const p = Math.min(1, pull / 62);
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${pull}px)`, opacity: busy || done ? 1 : Math.min(1, p * 1.2), transition: pull === 0 || busy ? 'transform .35s cubic-bezier(.32,.72,0,1), opacity .25s' : 'none' }} aria-hidden>
      {done ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        : busy ? <span className="ptr-spin" /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${p * 180}deg)`, transition: 'transform .1s' }}><path d="M12 5v14M6 13l6 6 6-6" /></svg>}
    </div>
  );
}
