'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import Icon from './Icon';

export type Msg = { id: string; from_email: string; to_email: string; body: string; application_id: string | null; student: string | null; created_at: string; read_at: string | null };
type P = { email: string; name: string; avatar_url: string | null; color: string | null; title: string | null };

const day = (d: string) => { const t = new Date(d), n = new Date(); const same = (a: Date, b: Date) => a.toDateString() === b.toDateString(); const y = new Date(n.getTime() - 864e5); return same(t, n) ? 'Today' : same(t, y) ? 'Yesterday' : t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); };
const hm = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function ChatThread({ me, other, initial, students }: { me: string; other: P; initial: Msg[]; students: { id: string; name: string }[] }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [seenUpTo, setSeenUpTo] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(initial.length ? initial[initial.length - 1].created_at : null);

  const merge = useCallback((add: Msg[]) => {
    if (!add.length) return;
    setMsgs((cur) => { const ids = new Set(cur.map((m) => m.id)); const next = [...cur, ...add.filter((m) => !ids.has(m.id))]; last.current = next.length ? next[next.length - 1].created_at : null; return next; });
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/chat?with=${encodeURIComponent(other.email)}${last.current ? `&since=${encodeURIComponent(last.current)}` : ''}`, { cache: 'no-store' });
        if (!r.ok || stop) return;
        const j = await r.json();
        merge(j.messages || []); setSeenUpTo(j.seenUpTo || null);
        window.dispatchEvent(new CustomEvent('chat-unread', { detail: j.unread }));
      } catch { /* offline: try again next tick */ }
    };
    tick(); const t = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [other.email, merge]);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length]);

  async function send() {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: other.email, body, applicationId: tag || null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send');
      merge([j.message]); setText(''); setTag(''); setTagging(false);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  let prevDay = '';
  const lastMine = [...msgs].reverse().find((m) => m.from_email === me);
  return (
    <div className="chat">
      <header className="chat-head">
        <Link href="/chat" className="iconbtn chat-back" aria-label="Back to chats"><Icon n="left" size={18} /></Link>
        <Avatar name={other.name} url={other.avatar_url} color={other.color} size={42} />
        <div><b>{other.name}</b><small>{other.title || other.email}</small></div>
      </header>
      <div className="chat-body">
        {!msgs.length && <div className="chat-empty"><Avatar name={other.name} url={other.avatar_url} color={other.color} size={72} /><b>Start a conversation with {other.name.split(' ')[0]}</b><span className="muted">Messages here are private between the two of you.</span></div>}
        {msgs.map((m) => {
          const mine = m.from_email === me, d = day(m.created_at), sep = d !== prevDay; prevDay = d;
          return (
            <div key={m.id}>
              {sep && <div className="chat-day"><span>{d}</span></div>}
              <div className={`bub ${mine ? 'mine' : 'theirs'}`}>
                {m.student && <Link href={`/applications/${m.application_id}`} className="stu-chip"><Icon n="file" size={13} /> {m.student}</Link>}
                <p>{m.body}</p>
                <small>{hm(m.created_at)}{mine && lastMine?.id === m.id && (m.read_at || (seenUpTo && seenUpTo >= m.created_at)) ? ' · Seen' : ''}</small>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <footer className="chat-foot">
        {err && <div className="err-line">{err}</div>}
        {tagging && (
          <div className="chat-tag">
            <select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">About which student?</option>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button type="button" className="iconbtn" onClick={() => { setTagging(false); setTag(''); }} aria-label="Remove student tag">×</button>
          </div>
        )}
        <div className="chat-row">
          <button type="button" className="iconbtn" title="Mention a student" onClick={() => setTagging((t) => !t)}><Icon n="file" size={18} /></button>
          <textarea value={text} rows={1} placeholder={`Message ${other.name.split(' ')[0]}…`} maxLength={2000}
            onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button type="button" className="btn chat-send" onClick={send} disabled={busy || !text.trim()} aria-label="Send"><Icon n="send" size={17} /></button>
        </div>
      </footer>
    </div>
  );
}
