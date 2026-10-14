'use client';
import { useEffect, useState } from 'react';
import Icon from './Icon';

const pad = (n: number) => String(n).padStart(2, '0');

/** A live countdown with ticking digits: days · hours · minutes · seconds. */
export default function Countdown({ to, title, sub }: { to: string; title: string; sub?: string }) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = now === null ? null : Math.max(0, target - now);
  const d = left === null ? 0 : Math.floor(left / 864e5), h = left === null ? 0 : Math.floor((left % 864e5) / 36e5), m = left === null ? 0 : Math.floor((left % 36e5) / 6e4), s = left === null ? 0 : Math.floor((left % 6e4) / 1e3);
  const urgent = left !== null && left < 3 * 864e5;
  const cells: [string, number][] = [['days', d], ['hrs', h], ['min', m], ['sec', s]];
  return (
    <section className={`st-card st-count ${urgent ? 'urgent' : ''}`}>
      <div className="st-count-h"><div><div className="st-eyebrow">{title}</div>{sub && <p className="st-sub" style={{ margin: 0 }}>{sub}</p>}</div></div>
      {left === 0 ? <p className="st-count-done"><Icon n="spark" size={16} className="ic-in" />It’s time</p> : (
        <div className="st-count-grid" role="timer" aria-label={`${d} days ${h} hours ${m} minutes left`}>
          {cells.map(([l, n]) => (
            <div key={l} className="st-count-c"><b key={`${l}${n}`} className="tick">{pad(n)}</b><small>{l}</small></div>
          ))}
        </div>
      )}
    </section>
  );
}
