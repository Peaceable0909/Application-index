'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { studentSend, studentMarkRead, staffReplyStudent, staffMarkChatRead } from '@/app/actions';
import Icon from './Icon';

export type Msg = { id: string; mine: boolean; body: string; at: string };
const when = (iso: string) => { const d = new Date(iso), t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${t}`; };

/** One conversation. `as="student"` sends through the student action, `as="staff"` through the staff reply. */
export default function ChatThread({ appId, msgs, as, other }: { appId: string; msgs: Msg[]; as: 'student' | 'staff'; other: string }) {
  const router = useRouter();
  const [list, setList] = useState(msgs), [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => setList(msgs), [msgs]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [list.length]);
  useEffect(() => { (as === 'student' ? studentMarkRead() : staffMarkChatRead(appId)).then(() => router.refresh()); const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, 15000); return () => clearInterval(t); }, [as, appId, router]);
  async function send() {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true); setErr('');
    const tmp: Msg = { id: 'tmp' + Date.now(), mine: true, body, at: new Date().toISOString() };
    setList((l) => [...l, tmp]); setText('');
    const fd = new FormData(); fd.set('appId', appId); fd.set('body', body);
    const r = as === 'student' ? await studentSend(fd) : await staffReplyStudent(fd);
    if (!r.ok) { setErr(r.error || 'Could not send'); setList((l) => l.filter((m) => m.id !== tmp.id)); setText(body); } else router.refresh();
    setBusy(false);
  }
  return (
    <div className="st-chat">
      <div className="st-chat-list" aria-live="polite">
        {list.length === 0 && <div className="st-chat-empty"><Icon n="send" size={26} /><b>Say hello to {other}</b><span>Ask anything about your application. You’ll see replies here.</span></div>}
        {list.map((m, i) => <div key={m.id} className={`st-bub ${m.mine ? 'mine' : ''}`} style={{ '--i': Math.min(i, 8) } as React.CSSProperties}><p>{m.body}</p><small>{when(m.at)}</small></div>)}
        <div ref={end} />
      </div>
      {err && <div className="st-err" style={{ margin: '0 0 8px' }}>{err}</div>}
      <form className="st-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea value={text} rows={1} maxLength={2000} placeholder={`Message ${other}…`} onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width:700px)').matches) { e.preventDefault(); send(); } }} />
        <button className="st-send" disabled={!text.trim() || busy} aria-label="Send"><Icon n="send" size={18} /></button>
      </form>
    </div>
  );
}
