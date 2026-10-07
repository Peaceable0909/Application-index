'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { staffAddChecklist, staffRemoveChecklist } from '@/app/actions';
import ChatThread from './ChatThread';
import type { ThreadMsg } from '@/lib/thread';

const TEMPLATES = ['Book your IELTS test', 'Pay your tuition deposit', 'Book your biometrics appointment', 'Complete your TB test', 'Send your updated bank statement'];
export type Item = { id: string; text: string; due: string | null; done: boolean };

/** What the counselor sees of the student's in-portal chat and checklist. */
export default function StaffStudentPanel({ appId, studentName, msgs, otherInit, items }: { appId: string; studentName: string; msgs: ThreadMsg[]; otherInit?: { name: string; online: boolean; lastSeen: string | null }; items: Item[] }) {
  const router = useRouter();
  const [text, setText] = useState(''), [due, setDue] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function add(t = text) {
    if (busy) return; setBusy(true); setErr('');
    const fd = new FormData(); fd.set('appId', appId); fd.set('text', t); fd.set('due', due);
    const r = await staffAddChecklist(fd);
    if (r.ok) { setText(''); setDue(''); router.refresh(); } else setErr(r.error || 'Could not add');
    setBusy(false);
  }
  return (
    <div className="grid g2" style={{ alignItems: 'start', marginBottom: 16 }}>
      <div className="card"><h2>Chat with {studentName.split(/[\s,]+/)[0]}</h2><p className="muted" style={{ marginTop: 0 }}>Replies appear in their student portal. We only email them if they’re away.</p>
        <ChatThread as="staff" appId={appId} msgs={msgs} otherInit={otherInit} other={studentName.split(/[\s,]+/)[0]} /></div>
      <div className="card"><h2>Student checklist</h2><p className="muted" style={{ marginTop: 0 }}>Small to-dos shown on the student’s home screen.</p>
        {items.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 6 }}>
          {items.map((it) => <li key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span>{it.done ? '✅' : '⬜'}</span><span style={{ flex: 1, textDecoration: it.done ? 'line-through' : 'none' }}>{it.text}{it.due ? <small className="muted"> · due {it.due}</small> : null}</span><button className="btn ghost sm" onClick={async () => { await staffRemoveChecklist(it.id); router.refresh(); }}>Remove</button></li>)}
        </ul>
        <div className="filters" style={{ marginBottom: 8 }}>{TEMPLATES.map((t) => <button key={t} className="btn ghost sm" disabled={busy} onClick={() => add(t)}>+ {t}</button>)}</div>
        <div className="filters"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or write your own…" maxLength={140} style={{ flex: '1 1 200px' }} /><input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" /><button className="btn sm" disabled={busy || text.trim().length < 3} onClick={() => add()}>Add</button></div>
        {err && <small className="bad-t">{err}</small>}
      </div>
    </div>
  );
}
