'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import ChatThread from './ChatThread';
import type { Convo } from '@/lib/inbox';
import type { ThreadMsg } from '@/lib/thread';
import { parseCallLine } from '@/lib/sysText';

type Other = { name: string; online: boolean; lastSeen: string | null };
type Pick = { appId: string; name: string; photo: string | null };
const short = (iso: string) => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toDateString() === new Date(Date.now() - 864e5).toDateString() ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

function Ticks({ read }: { read: boolean }) {
  return read
    ? <svg className="wa-tk read" width="18" height="12" viewBox="0 0 18 12" aria-label="Read"><path d="M1 6.5l3.2 3.2L11 2.2M7 8.9l1 1L15.8 2.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg className="wa-tk" width="14" height="12" viewBox="0 0 14 12" aria-label="Sent"><path d="M1.5 6.5l3.4 3.4 7.6-7.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Opens one student's conversation: loads what's there first (so old messages never "ping"), then hands over to the chat. */
function Pane({ pick, onBack, brain }: { pick: Pick; onBack: () => void; brain: boolean }) {
  const [d, setD] = useState<{ msgs: ThreadMsg[]; other: Other } | null>(null), [bad, setBad] = useState(false);
  useEffect(() => {
    let dead = false;
    fetch(`/api/thread?app=${encodeURIComponent(pick.appId)}&read=1`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { if (!dead) setD(j); }).catch(() => { if (!dead) setBad(true); });
    return () => { dead = true; };
  }, [pick.appId]);
  if (bad) return <div className="msgr-empty"><b>Couldn’t open this chat</b><span>Check your connection and pick it again.</span></div>;
  if (!d) return <div className="msgr-empty"><span className="pspin2" /></div>;
  return <ChatThread key={pick.appId} as="staff" brain={brain} appId={pick.appId} msgs={d.msgs} otherInit={d.other} other={pick.name.split(/[\s,]+/)[0]} title={pick.name} avatar={{ name: pick.name, url: pick.photo, color: null }} onBack={onBack} fill />;
}

function NewChat({ onClose, onOpen }: { onClose: () => void; onOpen: (p: Pick) => void }) {
  const [q, setQ] = useState(''), [list, setList] = useState<{ id: string; name: string; school: string | null; programme: string | null }[] | null>(null);
  useEffect(() => { const t = setTimeout(() => fetch(`/api/chat/students?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((j) => setList(j.students || [])).catch(() => setList([])), 150); return () => clearTimeout(t); }, [q]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><b>New chat</b><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon n="x" size={16} /></button></div>
        <div className="search" style={{ marginBottom: 10 }}><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students by name or university…" /></div>
        <div className="pick-list">
          {(list || []).map((s) => <button key={s.id} className="pick" onClick={() => onOpen({ appId: s.id, name: s.name, photo: null })}><Avatar name={s.name} size={38} /><div><b>{s.name}</b><small>{[s.school, s.programme].filter(Boolean).join(' · ')}</small></div></button>)}
          {list && !list.length && <p className="muted" style={{ padding: 14, margin: 0 }}>No students found.</p>}
          {!list && <p className="muted" style={{ padding: 14, margin: 0 }}>Loading…</p>}
        </div>
      </div>
    </div>
  );
}

/** Every student conversation in one place, laid out like WhatsApp: the chats on the left, the open chat on the right (one at a time on a phone). */
export default function StaffMessenger({ initial, openApp, brain = false }: { initial: Convo[]; openApp: Pick | null; brain?: boolean }) {
  const [list, setList] = useState(initial), [q, setQ] = useState(''), [unreadOnly, setUnreadOnly] = useState(false), [creating, setCreating] = useState(false);
  const [active, setActive] = useState<Pick | null>(openApp);
  const qRef = useRef({ q, unreadOnly }); qRef.current = { q, unreadOnly };

  const refresh = useCallback(async () => {
    try {
      const { q: qq, unreadOnly: uo } = qRef.current;
      const r = await fetch(`/api/inbox?q=${encodeURIComponent(qq)}${uo ? '&f=unread' : ''}`, { cache: 'no-store' });
      if (r.ok) setList(((await r.json()) as { list: Convo[] }).list);
    } catch { /* retry next time */ }
  }, []);
  useEffect(() => { const t = setTimeout(refresh, q ? 250 : 0); return () => clearTimeout(t); }, [q, unreadOnly, refresh]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10_000);
    const nd = (e: Event) => { const k = (e as CustomEvent<{ event?: string }>).detail?.event; if (k === 'msg' || k === 'call' || k === 'wake') void refresh(); };
    window.addEventListener('wr:nudge', nd);
    return () => { clearInterval(t); window.removeEventListener('wr:nudge', nd); };
  }, [refresh]);
  useEffect(() => { const h = () => { const a = new URLSearchParams(location.search).get('app'); if (!a) setActive(null); }; window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, []);

  const open = (p: Pick | null) => {
    setActive(p);
    history.pushState(null, '', p ? `/inbox?app=${encodeURIComponent(p.appId)}` : '/inbox');
    if (p) setList((l) => l.map((c) => (c.appId === p.appId ? { ...c, unread: 0 } : c)));
  };
  const totalUnread = list.reduce((n, c) => n + c.unread, 0);

  return (
    <div className={`msgr ${active ? 'open' : ''}`}>
      <aside className="msgr-list">
        <div className="msgr-top">
          <h1>Chats{totalUnread ? <i>{totalUnread}</i> : null}</h1>
          <button type="button" className="msgr-new" onClick={() => setCreating(true)} aria-label="New chat" title="New chat"><Icon n="user-plus" size={19} /></button>
        </div>
        <div className="msgr-search"><Icon n="search" size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students or messages" aria-label="Search chats" /></div>
        <div className="msgr-chips"><button type="button" className={!unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(false)}>All</button><button type="button" className={unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(true)}>Unread{totalUnread ? ` ${totalUnread}` : ''}</button></div>
        <div className="msgr-items">
          {list.map((c) => {
            const call = parseCallLine(c.preview);
            return (
              <button key={c.email} type="button" className={`msgr-item ${active?.appId === c.appId ? 'on' : ''} ${c.unread ? 'unread' : ''}`} onClick={() => open({ appId: c.appId, name: c.name, photo: c.photo })}>
                <Avatar name={c.name} url={c.photo} size={48} />
                <span className="mi-main">
                  <span className="mi-row"><b>{c.name}</b><time>{short(c.at)}</time></span>
                  <span className="mi-row"><span className="mi-prev">{c.mine && <Ticks read={c.read} />}{call ? <><Icon n={call.video ? 'video' : 'phone'} size={14} className="ic-in" />{call.text}</> : c.preview}</span>{c.unread > 0 && <i className="mi-n">{c.unread}</i>}</span>
                </span>
              </button>
            );
          })}
          {!list.length && <p className="msgr-none">{q ? 'No chats match.' : unreadOnly ? 'You’re all caught up.' : 'No conversations yet. Press the new chat button to message a student.'}</p>}
        </div>
      </aside>
      <section className="msgr-pane">
        {active ? <Pane key={active.appId} pick={active} brain={brain} onBack={() => open(null)} />
          : <div className="msgr-empty"><span className="mi-ico"><Icon n="chat" size={30} /></span><b>Student chats</b><span>Pick a chat on the left, or start a new one. Messages, voice notes, photos and calls all happen here.</span><button className="btn" onClick={() => setCreating(true)}>New chat</button></div>}
      </section>
      {creating && <NewChat onClose={() => setCreating(false)} onOpen={(p) => { setCreating(false); open(p); }} />}
    </div>
  );
}
