'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import Icon from './Icon';
import { COLORS, gradient } from '@/lib/profile';
import type { ChatMsg, RoomRow } from '@/lib/chat';

export type Person = { email: string; name: string; avatar_url: string | null; color: string | null; title: string | null };
type Member = { email: string; role: string; last_read_at: string; typing: boolean; muted: boolean };
const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
const PICKER = ['😀', '😊', '😂', '🥹', '😍', '🤔', '😅', '😭', '🙌', '👏', '👍', '👎', '🙏', '💪', '🔥', '🎉', '✅', '❌', '⚠️', '📌', '📎', '📞', '⏰', '❤️'];

const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const dayLabel = (d: string) => { const t = new Date(d), n = new Date(); return same(t, n) ? 'Today' : same(t, new Date(n.getTime() - 864e5)) ? 'Yesterday' : t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); };
const hm = (d: string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const short = (d: string) => { const t = new Date(d); return same(t, new Date()) ? hm(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const api = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; };
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Photos from phones are huge: shrink before upload so they fit under the 4 MB limit. */
async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif' || f.size < 700_000) return f;
  try {
    const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.82));
    return new File([b], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}

function Rich({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s<]+|@[\w.]+)/g);
  return <>{parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="lnk">{p}</a> : /^@[\w.]+$/.test(p) ? <span key={i} className={`mention ${mine ? 'on' : ''}`}>{p}</span> : p)}</>;
}

export default function ChatApp({ me, people, initialRooms, initialActive }: { me: string; people: Record<string, Person>; initialRooms: RoomRow[]; initialActive: string | null }) {
  const [rooms, setRooms] = useState(initialRooms);
  const [online, setOnline] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(initialActive);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const who = useCallback((e: string): Person => people[e.toLowerCase()] || { email: e, name: e.split('@')[0], avatar_url: null, color: null, title: null }, [people]);

  const refresh = useCallback(async () => {
    try { const j = await api('/api/chat/rooms'); setRooms(j.rooms); setOnline(j.online); window.dispatchEvent(new CustomEvent('chat-unread', { detail: j.unread })); } catch { /* retry next tick */ }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(() => !document.hidden && refresh(), 6000); return () => clearInterval(t); }, [refresh]);

  useEffect(() => { const h = (e: Event) => setRooms((rs) => rs.map((r) => (r.id === (e as CustomEvent<string>).detail && r.unread ? { ...r, unread: 0 } : r))); window.addEventListener('chat-room-read', h); return () => window.removeEventListener('chat-room-read', h); }, []);

  const open = useCallback((id: string | null) => { setActive(id); history.pushState(null, '', id ? `/chat?room=${id}` : '/chat'); }, []);
  useEffect(() => { const h = () => setActive(new URLSearchParams(location.search).get('room')); window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, []);

  const title = (r: RoomRow) => (r.kind === 'group' ? r.name || 'Group' : who(r.members.find((m) => m !== me) || me).name);
  const list = rooms.filter((r) => !q || title(r).toLowerCase().includes(q.toLowerCase()));
  const room = rooms.find((r) => r.id === active) || null;
  const roomIcon = (r: RoomRow, s: number) => r.kind === 'group'
    ? <span className="pic grp" style={{ width: s, height: s, background: gradient(r.color) }}><Icon n="users" size={Math.round(s * 0.45)} /></span>
    : (() => { const p = who(r.members.find((m) => m !== me) || me); return <span className="av-wrap"><Avatar name={p.name} url={p.avatar_url} color={p.color} size={s} />{online.includes(p.email) && <i className="live" />}</span>; })();

  return (
    <div className={`chatapp ${active ? 'open' : ''}`}>
      <aside className="chat-list card">
        <div className="chat-tools">
          <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats…" /></div>
          <button className="btn sm" onClick={() => setCreating(true)}><Icon n="user-plus" size={14} /> New</button>
        </div>
        <div className="chat-scroll">
          {list.map((r) => (
            <button key={r.id} className={`chat-item ${active === r.id ? 'on' : ''}`} onClick={() => open(r.id)}>
              {roomIcon(r, 44)}
              <div><b>{title(r)}{r.muted && <span className="muted" title="Muted"> 🔕</span>}</b><small>{r.last_preview ? `${r.last_sender === me ? 'You: ' : r.kind === 'group' && r.last_sender ? `${who(r.last_sender).name.split(' ')[0]}: ` : ''}${r.last_preview}` : 'No messages yet'}</small></div>
              <span className="when">{short(r.last_message_at)}{r.unread > 0 && <i className={`n ${r.muted ? 'quiet' : ''}`}>{r.unread}</i>}</span>
            </button>
          ))}
          {!list.length && <p className="muted" style={{ padding: 18, margin: 0 }}>{rooms.length ? 'No chats match.' : 'No conversations yet. Press New to start one.'}</p>}
        </div>
      </aside>
      <section className="chat-pane card">
        {room
          ? <Thread key={room.id} room={room} me={me} who={who} people={people} online={online} title={title(room)} icon={roomIcon(room, 42)} onBack={() => open(null)} onChanged={refresh} onLeft={() => { open(null); refresh(); }} />
          : <div className="chat-empty"><span className="ico"><Icon n="chat" size={26} /></span><b>Your messages</b><span className="muted">Pick a conversation, or start a new one.</span><button className="btn" onClick={() => setCreating(true)}>New chat</button></div>}
      </section>
      {creating && <NewChat me={me} people={people} online={online} onClose={() => setCreating(false)} onOpen={(id) => { setCreating(false); refresh(); open(id); }} />}
    </div>
  );
}

function NewChat({ me, people, online, onClose, onOpen }: { me: string; people: Record<string, Person>; online: string[]; onClose: () => void; onOpen: (id: string) => void }) {
  const [mode, setMode] = useState<'dm' | 'group'>('dm');
  const [name, setName] = useState(''); const [color, setColor] = useState('navy');
  const [pick, setPick] = useState<string[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const others = Object.values(people).filter((p) => p.email.toLowerCase() !== me).sort((a, b) => a.name.localeCompare(b.name));
  const go = async (body: unknown) => { setBusy(true); setErr(''); try { onOpen((await api('/api/chat/rooms', json('POST', body))).id); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  const toggle = (e: string) => setPick((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><b>New chat</b><button className="iconbtn" onClick={onClose} aria-label="Close">×</button></div>
        <div className="tabs" style={{ margin: '0 0 12px' }}>
          <button className={`tab ${mode === 'dm' ? 'active' : ''}`} onClick={() => setMode('dm')}>Direct message</button>
          <button className={`tab ${mode === 'group' ? 'active' : ''}`} onClick={() => setMode('group')}>New group</button>
        </div>
        {mode === 'group' && (
          <div style={{ marginBottom: 12 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (e.g. Counselors)" maxLength={60} style={{ width: '100%' }} />
            <div className="swatches" style={{ marginTop: 10 }}>{Object.keys(COLORS).map((k) => <label key={k} className={`sw ${color === k ? 'on' : ''}`}><input type="radio" hidden checked={color === k} onChange={() => setColor(k)} /><i style={{ background: gradient(k), width: 28, height: 28 }} /></label>)}</div>
            <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setPick(pick.length === others.length ? [] : others.map((p) => p.email.toLowerCase()))}>{pick.length === others.length ? 'Clear all' : 'Select everyone'}</button>
          </div>
        )}
        <div className="pick-list">
          {others.map((p) => { const e = p.email.toLowerCase(), on = pick.includes(e); return (
            <button key={e} className={`pick ${mode === 'group' && on ? 'on' : ''}`} onClick={() => (mode === 'dm' ? go({ with: e }) : toggle(e))} disabled={busy}>
              <span className="av-wrap"><Avatar name={p.name} url={p.avatar_url} color={p.color} size={38} />{online.includes(p.email) && <i className="live" />}</span>
              <div><b>{p.name}</b><small>{p.title || p.email}</small></div>
              {mode === 'group' && <span className="tick">{on ? <Icon n="check" size={16} /> : null}</span>}
            </button>); })}
          {!others.length && <p className="muted">No one else has portal access yet.</p>}
        </div>
        {err && <div className="err-line" style={{ marginTop: 8 }}>{err}</div>}
        {mode === 'group' && <div className="filters" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn" disabled={busy || !name.trim() || !pick.length} onClick={() => go({ name, color, members: pick })}>Create group{pick.length ? ` (${pick.length + 1})` : ''}</button></div>}
      </div>
    </div>
  );
}

function Thread({ room, me, who, people, online: onlineSeed, title, icon, onBack, onChanged, onLeft }: {
  room: RoomRow; me: string; who: (e: string) => Person; people: Record<string, Person>; online: string[]; title: string; icon: React.ReactNode; onBack: () => void; onChanged: () => void; onLeft: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [online, setOnline] = useState<string[]>(onlineSeed);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [editing, setEditing] = useState<ChatMsg | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(false);
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tag, setTag] = useState(''); const [students, setStudents] = useState<{ id: string; name: string }[] | null>(null);
  const body = useRef<HTMLDivElement>(null); const stick = useRef(true); const since = useRef<string | null>(null);
  const typed = useRef(0); const fileIn = useRef<HTMLInputElement>(null); const ta = useRef<HTMLTextAreaElement>(null);

  const merge = useCallback((add: ChatMsg[]) => {
    if (!add.length) return;
    setMsgs((cur) => {
      const map = new Map(cur.map((m) => [m.id, m]));
      add.forEach((m) => map.set(m.id, m));
      const next = [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      since.current = next.reduce((mx, m) => (m.updated_at > mx ? m.updated_at : mx), since.current || '');
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const j = await api(`/api/chat/rooms/${room.id}${since.current ? `?since=${encodeURIComponent(since.current)}` : ''}`);
      if (!since.current) setMore(j.more);
      merge(j.messages); setMembers(j.members); setOnline(j.online); setLoaded(true);
      window.dispatchEvent(new CustomEvent('chat-room-read', { detail: room.id }));
    } catch { /* offline: next tick */ }
  }, [room.id, merge]);
  useEffect(() => { poll(); const t = setInterval(() => !document.hidden && poll(), 3000); return () => clearInterval(t); }, [poll]);

  useEffect(() => { if (stick.current) body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, loaded]);
  const onScroll = () => { const el = body.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };

  async function loadEarlier() {
    const first = msgs[0]; if (!first) return;
    const j = await api(`/api/chat/rooms/${room.id}?before=${encodeURIComponent(first.created_at)}`);
    stick.current = false; merge(j.messages); setMore(j.more);
  }

  async function send() {
    const t = text.trim(); if ((!t && !file) || busy) return;
    setBusy(true); setErr('');
    try {
      if (editing) { const j = await api(`/api/chat/messages/${editing.id}`, json('PATCH', { body: t })); merge([j.message]); setEditing(null); }
      else {
        let init: RequestInit;
        if (file) { const f = new FormData(); f.set('body', t); f.set('file', await shrink(file)); if (reply) f.set('replyTo', reply.id); if (tag) f.set('applicationId', tag); init = { method: 'POST', body: f }; }
        else init = json('POST', { body: t, replyTo: reply?.id, applicationId: tag || null });
        const j = await api(`/api/chat/rooms/${room.id}`, init); stick.current = true; merge([j.message]);
      }
      setText(''); setFile(null); setReply(null); setTag(''); setEmoji(false); if (ta.current) ta.current.style.height = 'auto'; onChanged();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  const typing = () => { if (Date.now() - typed.current > 3000) { typed.current = Date.now(); api(`/api/chat/rooms/${room.id}`, json('PATCH', { typing: true })).catch(() => {}); } };
  const react = async (m: ChatMsg, e: string) => { setSel(null); try { merge([(await api(`/api/chat/messages/${m.id}`, json('POST', { emoji: e }))).message]); } catch (x) { setErr((x as Error).message); } };
  const del = async (m: ChatMsg) => { setSel(null); if (!confirm('Delete this message for everyone?')) return; try { merge([(await api(`/api/chat/messages/${m.id}`, { method: 'DELETE' })).message]); onChanged(); } catch (x) { setErr((x as Error).message); } };
  const startEdit = (m: ChatMsg) => { setSel(null); setEditing(m); setReply(null); setText(m.body); setFile(null); setTimeout(() => ta.current?.focus(), 0); };
  const startReply = (m: ChatMsg) => { setSel(null); setReply(m); setEditing(null); setTimeout(() => ta.current?.focus(), 0); };
  async function pickStudent() { if (students === null) setStudents(await fetch('/api/chat/students').then((r) => r.json()).then((j) => j.students || []).catch(() => [])); }

  const group = room.kind === 'group', otherEmail = room.members.find((m) => m !== me) || me;
  const otherMem = members.find((m) => m.email === otherEmail);
  const typers = members.filter((m) => m.typing).map((m) => who(m.email).name.split(' ')[0]);
  const lastMine = [...msgs].reverse().find((m) => m.sender === me && !m.deleted_at);
  const sub = typers.length ? <span className="typing">{typers.join(', ')} {typers.length > 1 ? 'are' : 'is'} typing<i>.</i><i>.</i><i>.</i></span>
    : group ? `${room.members.length} members · ${room.members.filter((m) => online.includes(m)).length} online` : online.includes(otherEmail) ? <span className="onl">Active now</span> : who(otherEmail).title || who(otherEmail).email;
  let prevDay = '', prevSender = '', prevAt = 0;

  return (
    <div className="chat">
      <header className="chat-head">
        <button className="iconbtn chat-back" onClick={onBack} aria-label="Back to chats"><Icon n="left" size={18} /></button>
        {icon}
        <button className="chat-title" onClick={() => setInfo(true)}><b>{title}</b><small>{sub}</small></button>
        <button className="iconbtn" onClick={() => setInfo(true)} aria-label="Chat info" title="Chat info"><Icon n="more" size={18} /></button>
      </header>
      <div className="chat-body" ref={body} onScroll={onScroll} onClick={() => { setSel(null); setEmoji(false); }}>
        {more && <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={loadEarlier}>Load earlier messages</button>}
        {!msgs.length && loaded && <div className="chat-empty"><span className="ico"><Icon n="chat" size={24} /></span><b>{group ? `Welcome to ${title}` : `Say hello to ${title.split(' ')[0]}`}</b><span className="muted">{group ? 'Everyone in this group can read these messages.' : 'Messages here are private between the two of you.'}</span></div>}
        {!loaded && <div className="chat-empty"><span className="pspin2" /></div>}
        {msgs.map((m) => {
          const mine = m.sender === me, d = dayLabel(m.created_at), newDay = d !== prevDay;
          const first = newDay || m.sender !== prevSender || new Date(m.created_at).getTime() - prevAt > 5 * 60_000;
          prevDay = d; prevSender = m.sender; prevAt = new Date(m.created_at).getTime();
          const s = who(m.sender), gone = !!m.deleted_at, rx = Object.entries(m.reactions);
          const seen = !group && mine && lastMine?.id === m.id && otherMem && otherMem.last_read_at >= m.created_at;
          return (
            <div key={m.id}>
              {newDay && <div className="chat-day"><span>{d}</span></div>}
              <div className={`mrow ${mine ? 'mine' : 'theirs'} ${first ? 'first' : ''}`}>
                {!mine && group && <span className="mav">{first ? <Avatar name={s.name} url={s.avatar_url} color={s.color} size={30} /> : null}</span>}
                <div className="bubwrap">
                  {!mine && group && first && <span className="sname">{s.name}</span>}
                  <div className={`bub ${gone ? 'gone' : ''} ${sel === m.id ? 'sel' : ''}`} onClick={(e) => { e.stopPropagation(); if (!gone && !(e.target as HTMLElement).closest('a')) setSel(sel === m.id ? null : m.id); }}>
                    {m.reply && <div className="quote"><b>{who(m.reply.sender).name.split(' ')[0]}</b><span>{m.reply.text}</span></div>}
                    {gone ? <p><em>🚫 This message was deleted</em></p> : <>
                      {m.student && <Link href={`/applications/${m.application_id}`} className="stu-chip" onClick={(e) => e.stopPropagation()}><Icon n="file" size={13} /> {m.student}</Link>}
                      {m.att && (m.att.mime.startsWith('image/')
                        ? <a href={m.att.url} target="_blank" rel="noreferrer" className="att-img" onClick={(e) => e.stopPropagation()}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={m.att.url} alt={m.att.name} loading="lazy" /></a>
                        : <a href={m.att.url} target="_blank" rel="noreferrer" className="att-file" onClick={(e) => e.stopPropagation()}><span className="ico"><Icon n="file" size={18} /></span><div><b>{m.att.name}</b><small>{size(m.att.size)}</small></div><Icon n="download" size={16} /></a>)}
                      {m.body && <p><Rich text={m.body} mine={mine} /></p>}
                    </>}
                    <small>{hm(m.created_at)}{m.edited_at && !gone ? ' · edited' : ''}{seen ? ' · Seen' : ''}</small>
                  </div>
                  {rx.length > 0 && <div className="rx">{rx.map(([e, who2]) => <button key={e} className={who2.includes(me) ? 'on' : ''} title={who2.map((x) => who(x).name).join(', ')} onClick={(ev) => { ev.stopPropagation(); react(m, e); }}>{e} {who2.length}</button>)}</div>}
                  {sel === m.id && (
                    <div className="mtools" onClick={(e) => e.stopPropagation()}>
                      <div className="mt-emoji">{EMOJI.map((e) => <button key={e} onClick={() => react(m, e)}>{e}</button>)}</div>
                      <button onClick={() => startReply(m)}>Reply</button>
                      {m.body && <button onClick={() => { navigator.clipboard?.writeText(m.body); setSel(null); }}>Copy</button>}
                      {mine && m.body && <button onClick={() => startEdit(m)}>Edit</button>}
                      {mine && <button className="danger" onClick={() => del(m)}>Delete</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <footer className="chat-foot">
        {err && <div className="err-line">{err} <button className="linkish" onClick={() => setErr('')}>dismiss</button></div>}
        {(reply || editing) && <div className="ctx"><div><b>{editing ? 'Editing message' : `Replying to ${who(reply!.sender).name.split(' ')[0]}`}</b><span>{(editing || reply)!.body || (reply?.att ? `📎 ${reply.att.name}` : '')}</span></div><button className="iconbtn" aria-label="Cancel" onClick={() => { setReply(null); setEditing(null); if (editing) setText(''); }}>×</button></div>}
        {file && <div className="ctx"><div><b>📎 {file.name}</b><span>{size(file.size)}{file.type.startsWith('image/') ? ' · photo will be resized' : ''}</span></div><button className="iconbtn" aria-label="Remove file" onClick={() => setFile(null)}>×</button></div>}
        {tag !== '' || students ? (
          <div className="chat-tag"><select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">About which student? (optional)</option>{(students || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className="iconbtn" aria-label="Remove tag" onClick={() => { setStudents(null); setTag(''); }}>×</button></div>
        ) : null}
        {emoji && <div className="picker">{PICKER.map((e) => <button key={e} onClick={() => { setText((t) => t + e); ta.current?.focus(); }}>{e}</button>)}</div>}
        <div className="chat-row">
          <input ref={fileIn} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setEditing(null); } e.target.value = ''; }} />
          <button className="iconbtn" title="Attach a file or photo" onClick={() => fileIn.current?.click()} disabled={!!editing}><Icon n="upload" size={18} /></button>
          <button className="iconbtn" title="Emoji" onClick={(e) => { e.stopPropagation(); setEmoji((v) => !v); }}>🙂</button>
          <button className="iconbtn" title="Mention a student" onClick={pickStudent} disabled={!!editing}><Icon n="file" size={18} /></button>
          <textarea ref={ta} value={text} rows={1} placeholder={editing ? 'Edit your message…' : `Message ${group ? title : title.split(' ')[0]}…`} maxLength={2000}
            onChange={(e) => { setText(e.target.value); typing(); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') { setReply(null); setEditing(null); } }} />
          <button className="btn chat-send" onClick={send} disabled={busy || (!text.trim() && !file)} aria-label={editing ? 'Save' : 'Send'}><Icon n={editing ? 'check' : 'send'} size={17} /></button>
        </div>
      </footer>
      {info && <InfoPanel room={room} me={me} who={who} people={people} online={online} members={members} title={title} onClose={() => setInfo(false)} onChanged={() => { poll(); onChanged(); }} onLeft={onLeft} />}
    </div>
  );
}

function InfoPanel({ room, me, who, people, online, members, title, onClose, onChanged, onLeft }: { room: RoomRow; me: string; who: (e: string) => Person; people: Record<string, Person>; online: string[]; members: Member[]; title: string; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const group = room.kind === 'group', owner = group && members.find((m) => m.email === me)?.role === 'owner';
  const [name, setName] = useState(room.name || ''); const [err, setErr] = useState(''); const [adding, setAdding] = useState<string[]>([]);
  const mine = members.find((m) => m.email === me);
  const patch = async (b: unknown) => { setErr(''); try { await api(`/api/chat/rooms/${room.id}`, json('PATCH', b)); onChanged(); } catch (e) { setErr((e as Error).message); } };
  const rest = useMemo(() => Object.values(people).filter((p) => !members.some((m) => m.email === p.email.toLowerCase()) && !room.members.includes(p.email.toLowerCase())), [people, members, room.members]);
  const other = !group ? who(room.members.find((m) => m !== me) || me) : null;
  return (
    <div className="info">
      <div className="info-h"><b>{group ? 'Group info' : 'Chat info'}</b><button className="iconbtn" onClick={onClose} aria-label="Close">×</button></div>
      <div className="info-b">
        {other && <div className="tcard" style={{ marginBottom: 16 }}><Avatar name={other.name} url={other.avatar_url} color={other.color} size={64} /><div><b style={{ fontSize: 17 }}>{other.name}</b><div className="muted">{other.title || 'Teammate'}</div><div className="muted" style={{ fontSize: 13 }}>{other.email}</div></div></div>}
        {group && (
          <>
            <label className="muted">Group name</label>
            <div className="filters" style={{ flexWrap: 'nowrap', margin: '6px 0 12px' }}><input value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} maxLength={60} style={{ flex: 1 }} />{owner && <button className="btn sm" onClick={() => patch({ name })} disabled={!name.trim() || name === room.name}>Save</button>}</div>
            {owner && <div className="swatches" style={{ marginBottom: 14 }}>{Object.keys(COLORS).map((k) => <label key={k} className={`sw ${room.color === k ? 'on' : ''}`}><input hidden type="radio" checked={room.color === k} onChange={() => patch({ color: k })} /><i style={{ background: gradient(k), width: 28, height: 28 }} /></label>)}</div>}
            <div className="stat-l" style={{ margin: '6px 0' }}>{room.members.length} members</div>
            {members.map((m) => { const p = who(m.email); return (
              <div key={m.email} className="mem">
                <span className="av-wrap"><Avatar name={p.name} url={p.avatar_url} color={p.color} size={36} />{online.includes(m.email) && <i className="live" />}</span>
                <div><b>{p.name}{m.email === me && ' (you)'}</b><small>{p.title || p.email}</small></div>
                {m.role === 'owner' ? <span className="badge plain">Owner</span> : owner && <button className="btn ghost sm" onClick={() => confirm(`Remove ${p.name}?`) && patch({ remove: m.email })}>Remove</button>}
              </div>); })}
            {owner && rest.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="stat-l" style={{ marginBottom: 6 }}>Add people</div>
                <div className="pick-list" style={{ maxHeight: 180 }}>{rest.map((p) => { const e = p.email.toLowerCase(), on = adding.includes(e); return <button key={e} className={`pick ${on ? 'on' : ''}`} onClick={() => setAdding((a) => (on ? a.filter((x) => x !== e) : [...a, e]))}><Avatar name={p.name} url={p.avatar_url} color={p.color} size={30} /><div><b>{p.name}</b></div><span className="tick">{on && <Icon n="check" size={15} />}</span></button>; })}</div>
                <button className="btn sm" style={{ marginTop: 8 }} disabled={!adding.length} onClick={() => { patch({ add: adding }); setAdding([]); }}>Add {adding.length || ''}</button>
              </div>
            )}
          </>
        )}
        <label className="switch-row"><span>Mute notifications<small className="muted">No unread badge for this chat</small></span><input type="checkbox" checked={!!mine?.muted} onChange={(e) => patch({ muted: e.target.checked })} /></label>
        {group && <button className="btn ghost" style={{ marginTop: 10, color: 'var(--red)' }} onClick={async () => { if (confirm(`Leave “${title}”?`)) { await patch({ leave: true }); onLeft(); } }}>Leave group</button>}
        {err && <div className="err-line" style={{ marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  );
}
