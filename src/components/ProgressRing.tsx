'use client';
import { useEffect, useState } from 'react';

/** A ring that fills and counts up to the percentage when it appears. */
export default function ProgressRing({ percent, size = 150, label = 'complete' }: { percent: number; size?: number; label?: string }) {
  const R = 52, C = 2 * Math.PI * R, target = Math.max(0, Math.min(100, Math.round(percent)));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(target); return; }
    let raf = 0; const t0 = performance.now(), dur = 1500;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); setShown(Math.round(target * e)); if (k < 1) raf = requestAnimationFrame(tick); };
    const start = setTimeout(() => { raf = requestAnimationFrame(tick); }, 250);
    return () => { clearTimeout(start); cancelAnimationFrame(raf); };
  }, [target]);
  return (
    <div className="ring" style={{ ['--s' as string]: `${size}px` }} role="img" aria-label={`${target}% ${label}`}>
      <svg viewBox="0 0 120 120"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#2458d6" /><stop offset="100%" stopColor="#7aa2ff" /></linearGradient></defs>
        <circle className="track" cx="60" cy="60" r={R} />
        <circle className="bar" cx="60" cy="60" r={R} strokeDasharray={C} strokeDashoffset={C - (C * shown) / 100} /></svg>
      <div className="num"><b>{shown}%</b><small>{label}</small></div>
    </div>
  );
}
