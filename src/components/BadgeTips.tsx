'use client';
import { useEffect, useState } from 'react';

type Tip = { name: string; desc: string; x: number; y: number; below: boolean };

/** One tooltip for every badge on the page (they carry data-bdg / data-name / data-desc). Hover, keyboard focus and tap all show it; Escape, scrolling or tapping elsewhere hides it. */
export default function BadgeTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-bdg]') as HTMLElement | null) : null);
    const show = (el: HTMLElement) => {
      const r = el.getBoundingClientRect(), half = Math.min(140, window.innerWidth / 2 - 8);
      setTip({ name: el.dataset.name || '', desc: el.dataset.desc || '', x: Math.min(window.innerWidth - half - 8, Math.max(half + 8, r.left + r.width / 2)), y: r.top < 110 ? r.bottom + 8 : r.top - 8, below: r.top < 110 });
    };
    const hide = () => setTip(null);
    const over = (e: Event) => { const el = find(e.target); if (el) show(el); };
    const out = (e: Event) => { if (find(e.target)) hide(); };
    const click = (e: Event) => { const el = find(e.target); if (el) show(el); else hide(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('pointerover', over); document.addEventListener('pointerout', out);
    document.addEventListener('focusin', over); document.addEventListener('focusout', out);
    document.addEventListener('click', click); document.addEventListener('keydown', key);
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', over); document.removeEventListener('focusout', out);
      document.removeEventListener('click', click); document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className={`vtip ${tip.below ? 'below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.name}</b>
      {tip.desc && <span>{tip.desc}</span>}
    </div>
  );
}
