'use client';
import { useEffect } from 'react';

/** A full-screen "it worked" moment: a ring that draws itself, a check that ticks in, and a little burst. Closes itself, or on tap / Esc. */
export default function Confirmed({ title, lines = [], action, onClose, seconds = 6 }: { title: string; lines?: string[]; action?: { label: string; href: string }; onClose: () => void; seconds?: number }) {
  useEffect(() => {
    const t = setTimeout(onClose, seconds * 1000);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { clearTimeout(t); window.removeEventListener('keydown', k); };
  }, [onClose, seconds]);
  return (
    <div className="cf-bg" role="dialog" aria-live="polite" aria-label={title} onClick={onClose}>
      <div className="cf-card" onClick={(e) => e.stopPropagation()}>
        <div className="cf-burst" aria-hidden>{Array.from({ length: 14 }).map((_, i) => <i key={i} style={{ '--a': `${i * (360 / 14)}deg`, '--d': `${70 + (i % 3) * 18}px`, '--c': ['#2458d6', '#e2c566', '#16a34a', '#8b5cf6', '#f59e0b'][i % 5], animationDelay: `${0.45 + (i % 4) * 0.04}s` } as React.CSSProperties} />)}</div>
        <svg className="cf-svg" viewBox="0 0 80 80" aria-hidden>
          <circle className="cf-fill" cx="40" cy="40" r="34" />
          <circle className="cf-ring" cx="40" cy="40" r="34" />
          <path className="cf-tick" d="M25 41.5l10.5 10.5L56 29.5" />
        </svg>
        <h2>{title}</h2>
        {lines.map((l, i) => <p key={i}>{l}</p>)}
        <div className="cf-actions">
          {action && <a className="btn" href={action.href} target="_blank" rel="noreferrer">{action.label}</a>}
          <button className="btn ghost" onClick={onClose}>Done</button>
        </div>
        <div className="cf-bar" style={{ animationDuration: `${seconds}s` }} aria-hidden />
      </div>
    </div>
  );
}
