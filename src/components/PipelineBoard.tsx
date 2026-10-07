'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import { moveStatus } from '@/app/actions';

export type PCard = { id: string; name: string; school: string; programme: string; status: string | null; counselor: string | null; missing: number; judged: boolean; unpaid: boolean; deadlineLeft: number | null; stale: boolean };
const NONE = '__none';

function Card({ c, cols, onMove, drag }: { c: PCard; cols: string[]; onMove: (id: string, to: string) => void; drag: (id: string | null) => void }) {
  const dl = c.deadlineLeft;
  return (
    <div className="pcard-k" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; drag(c.id); }} onDragEnd={() => drag(null)}>
      <Link href={`/applications/${encodeURIComponent(c.id)}`} className="k-name">{c.name}</Link>
      <div className="k-sub">{[c.school, c.programme].filter(Boolean).join(' · ') || '—'}</div>
      <div className="k-tags">
        {c.judged && <span className={`kt ${c.missing ? 'warn' : 'ok'}`}>{c.missing ? `${c.missing} doc${c.missing === 1 ? '' : 's'} missing` : 'Docs complete'}</span>}
        {c.unpaid && <span className="kt warn">Unpaid</span>}
        {dl !== null && <span className={`kt ${dl < 0 ? 'bad' : dl <= 14 ? 'warn' : ''}`}>{dl < 0 ? `${-dl}d overdue` : dl === 0 ? 'Due today' : `${dl}d left`}</span>}
        {c.stale && <span className="kt">Stale</span>}
      </div>
      <div className="k-foot"><span className="muted">{c.counselor || 'No counselor'}</span>
        <select className="mv" aria-label="Move to stage" value={c.status || NONE} onChange={(e) => onMove(c.id, e.target.value)}>{[NONE, ...cols].map((s) => <option key={s} value={s}>{s === NONE ? '(no stage)' : s}</option>)}</select>
      </div>
    </div>
  );
}

export default function PipelineBoard({ cards: initial, stages }: { cards: PCard[]; stages: string[] }) {
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const [, start] = useTransition();
  const cols = [NONE, ...stages];

  function move(id: string, to: string) {
    const prev = cards.find((c) => c.id === id); if (!prev) return;
    const status = to === NONE ? null : to;
    if ((prev.status || null) === status) return;
    if (status === null) { setMsg({ t: 'Choose a real stage to move to.', bad: true }); return; }
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));
    start(async () => {
      const r = await moveStatus(id, status);
      if (!r.ok) { setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status: prev.status } : c))); setMsg({ t: r.error || 'Could not move it.', bad: true }); }
      else setMsg({ t: `${prev.name} → ${status}${r.sheet === false ? ' (saved here, but the sheet could not be updated)' : ''}`, bad: r.sheet === false });
      setTimeout(() => setMsg(null), 4000);
    });
  }
  return (
    <>
      {msg && <div className={`toast ${msg.bad ? 'bad' : ''}`}>{msg.t}</div>}
      <div className="kanban">
        {cols.map((col) => {
          const list = cards.filter((c) => (c.status || NONE) === col);
          if (col === NONE && !list.length) return null;
          return (
            <section key={col} className={`kcol ${over === col ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain') || dragId; if (id) move(id, col); setDragId(null); }}>
              <header><b>{col === NONE ? 'No stage yet' : col}</b><span className="n">{list.length}</span></header>
              <div className="kbody">
                {list.map((c) => <Card key={c.id} c={c} cols={stages} onMove={move} drag={setDragId} />)}
                {!list.length && <div className="kempty">Drop a student here</div>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 13 }}><Icon n="arrow" size={13} /> Drag a card to another column (or use the stage menu on the card). Changes are saved to your Google Sheet too.</p>
    </>
  );
}
