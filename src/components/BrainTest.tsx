'use client';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import Btn from './Btn';
import { addBrainNote } from '@/app/brainActions';

type S = { id: string; name: string; school: string | null; programme: string | null };
type R = { reply?: string; needsHuman?: boolean; why?: string; error?: string };

/** Try the Brain on a real student's file with a made-up question. Nothing is sent to the student. */
export default function BrainTest({ on }: { on: boolean }) {
  const [q, setQ] = useState(''), [list, setList] = useState<S[]>([]), [pick, setPick] = useState<S | null>(null), [question, setQuestion] = useState(''), [busy, setBusy] = useState(false), [res, setRes] = useState<R | null>(null);
  useEffect(() => {
    if (pick || q.trim().length < 2) { setList([]); return; }
    const t = setTimeout(() => fetch(`/api/chat/students?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((j) => setList((j.students || []).slice(0, 6))).catch(() => setList([])), 200);
    return () => clearTimeout(t);
  }, [q, pick]);
  async function ask() {
    if (!pick || !question.trim() || busy) return;
    setBusy(true); setRes(null);
    try { const r = await fetch('/api/brain/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: pick.id, question }) }); setRes((await r.json()) as R); }
    catch { setRes({ error: 'Couldn’t reach the Brain.' }); }
    setBusy(false);
  }
  return (
    <div className="card">
      <h2><Icon n="spark" size={17} /> Try the Brain</h2>
      <p className="muted" style={{ marginTop: 0 }}>Pick a student, type something they might ask, and see what the Brain would suggest. Nothing is sent to the student.</p>
      {!on && <p className="bad-t">Switch the Brain on first (see the top of this page).</p>}
      {pick
        ? <p style={{ margin: '0 0 10px' }}><b>{pick.name}</b> <span className="muted">· {[pick.school, pick.programme].filter(Boolean).join(' · ')}</span> <button type="button" className="btn ghost sm" onClick={() => { setPick(null); setRes(null); }}>Change</button></p>
        : <div style={{ marginBottom: 10 }}><div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a student by name…" /></div>
            {list.length > 0 && <div className="pick-list">{list.map((s) => <button key={s.id} type="button" className="pick" onClick={() => { setPick(s); setList([]); }}><div><b>{s.name}</b><small>{[s.school, s.programme].filter(Boolean).join(' · ')}</small></div></button>)}</div>}</div>}
      <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={400} placeholder="e.g. Which documents am I still missing?" style={{ width: '100%', marginBottom: 8 }} />
      <button type="button" className="btn primary" onClick={ask} disabled={!on || !pick || !question.trim() || busy}>{busy ? 'Thinking…' : 'Ask the Brain'}</button>
      {res?.error && <p className="bad-t" style={{ margin: '10px 0 0' }}>{res.error}</p>}
      {res?.reply && (
        <div className="callout" style={{ marginTop: 12, background: res.needsHuman ? 'var(--amber-soft)' : 'var(--blue-soft)' }}>
          <div style={{ flex: 1 }}><p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{res.reply}</p><small className="muted">{res.needsHuman ? 'Needs a human: ' : 'Based on: '}{res.why}</small></div>
        </div>
      )}
      {res?.reply && (
        <form action={addBrainNote} className="grid" style={{ gap: 8, marginTop: 12 }}>
          <b>Teach the Brain</b>
          <small className="muted" style={{ marginTop: -4 }}>Wrong or missing something? Write the right answer here and save it as a note. The Brain will use it from now on.</small>
          <input name="title" required minLength={2} maxLength={80} defaultValue={question.slice(0, 80)} aria-label="Note title" />
          <textarea name="body" rows={3} maxLength={1500} required defaultValue={res.reply} aria-label="Note" />
          <div><Btn className="btn ghost" data-busy="Saving the note…">Save as a note</Btn></div>
        </form>
      )}
    </div>
  );
}
