'use client';
import { useState, useTransition } from 'react';
import { studentToggleChecklist } from '@/app/actions';
import Confirmed from './Confirmed';
import type { CheckItem } from '@/lib/studentData';

const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The student's own tick-list. Ticking is instant (optimistic) and saved in the background. */
export default function ChecklistPanel({ items: initial }: { items: CheckItem[] }) {
  const [items, setItems] = useState(initial);
  const [party, setParty] = useState(false);
  const [, start] = useTransition();
  const done = items.filter((i) => i.done).length, pct = items.length ? Math.round((done / items.length) * 100) : 0;
  function toggle(id: string) {
    const was = items.find((i) => i.id === id)!;
    const next = items.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    setItems(next);
    if (!was.done && next.every((i) => i.done)) setParty(true);
    start(async () => { const r = await studentToggleChecklist(id); if (!r.ok) setItems((cur) => cur.map((i) => (i.id === id ? { ...i, done: was.done } : i))); });
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="st-card" id="checklist">
      {party && <Confirmed title="Checklist complete!" lines={['Nice work. Everything on your list is done.']} onClose={() => setParty(false)} seconds={4} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}><h2>Your checklist</h2><span className="st-sub" style={{ margin: 0 }}>{done} of {items.length} done</span></div>
      <div className="st-progress" style={{ margin: '10px 0 16px' }}><i style={{ width: `${pct}%` }} /></div>
      <ul className="st-list">
        {items.map((i) => (
          <li key={i.id}><button className={`st-check ${i.done ? 'done' : ''}`} onClick={() => toggle(i.id)} aria-pressed={i.done}>
            <span className="st-box"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
            <span className="st-grow"><b>{i.text}</b>{i.due && !i.done && <small style={{ color: i.due < today ? 'var(--st-red)' : undefined }}>{i.due < today ? 'Overdue · ' : 'Due '}{fmt(i.due)}</small>}</span>
          </button></li>
        ))}
      </ul>
    </div>
  );
}
