'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import type { ThreadMsg } from '@/lib/thread';
import { ALL_DOC_TYPES } from '@/lib/constants';

type Other = { name: string; online: boolean; lastSeen: string | null };
type Local = ThreadMsg & { sending?: boolean; failed?: boolean; localUrl?: string };
const REACTIONS = ['👍', '❤️', '😂', '🙏', '✅', '😮'];
const dayLabel = (iso: string) => { const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5); return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 2 ? 'a moment ago' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

function hl(t: string, q: string): React.ReactNode {
  if (!q) return t;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  return t.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

function linkify(t: string, q = '') {
  return t.split(/(https?:\/\/[^\s]+)/g).map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}{p.length > 50 ? '…' : ''}</a> : hl(p, q));
}

async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif' || f.size < 600_000) return f;
  try {
    const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.82));
    return new File([b], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}

function beep() {
  try { const A = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext, c = new A(), o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.04; o.connect(g); g.connect(c.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25); o.stop(c.currentTime + 0.26); } catch { /* sound is optional */ }
}

function Voice({ m }: { m: Local }) {
  const a = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false), [p, setP] = useState(0);
  return (
    <div className="st-voice">
      <button type="button" onClick={() => { const el = a.current; if (!el) return; if (el.paused) { void el.play(); } else el.pause(); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
      <div className="bar" onClick={(e) => { const el = a.current; if (!el || !el.duration) return; const r = e.currentTarget.getBoundingClientRect(); el.currentTime = ((e.clientX - r.left) / r.width) * el.duration; }}><i style={{ width: `${p * 100}%` }} /></div>
      <span>{m.att?.ms ? mmss(m.att.ms) : '0:00'}</span>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={a} src={m.localUrl || m.att?.url || undefined} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setP(0); }} onTimeUpdate={(e) => setP(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} />
    </div>
  );
}

export default function ChatThread({ appId, msgs, as, other: otherName, otherInit }: { appId: string; msgs: ThreadMsg[]; as: 'student' | 'staff'; other: string; otherInit?: Other }) {
  const [list, setList] = useState<Local[]>(msgs);
  const [other, setOther] = useState<Other | null>(otherInit || null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Local | null>(null);
  const [file, setFile] = useState<{ f: File; url: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [rec, setRec] = useState<{ ms: number } | null>(null);
  const [away, setAway] = useState(0);
  const [typing, setTyping] = useState(false);
  const [search, setSearch] = useState<{ q: string; i: number } | null>(null);
  const [save, setSave] = useState<{ id: string; type: string; label: string; busy: boolean } | null>(null);
  const [note, setNote] = useState('');
  const lastTyping = useRef(0);
  const box = useRef<HTMLDivElement>(null), end = useRef<HTMLDivElement>(null), ta = useRef<HTMLTextAreaElement>(null), pick = useRef<HTMLInputElement>(null), cam = useRef<HTMLInputElement>(null);
  const near = useRef(true), seen = useRef(new Set(msgs.map((m) => m.id))), mr = useRef<{ rec: MediaRecorder; chunks: Blob[]; t0: number; cancel: boolean; timer: ReturnType<typeof setInterval> } | null>(null);
  const q = `app=${encodeURIComponent(appId)}`, draftKey = `chat-draft-${as}-${appId}`;

  useEffect(() => { try { const d = localStorage.getItem(draftKey); if (d) setText(d); } catch { /* optional */ } }, [draftKey]);
  useEffect(() => { try { if (text) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey); } catch { /* optional */ } }, [text, draftKey]);

  const sync = useCallback(async (markRead: boolean) => {
    try {
      const r = await fetch(`/api/thread?${q}${markRead ? '&read=1' : ''}`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = (await r.json()) as { msgs: ThreadMsg[]; other: Other; typing: boolean };
      const fresh = d.msgs.filter((m) => !m.mine && !seen.current.has(m.id));
      d.msgs.forEach((m) => seen.current.add(m.id));
      setList((cur) => { const pending = cur.filter((m) => m.sending || m.failed); return [...d.msgs, ...pending]; });
      setOther(d.other); setTyping(d.typing);
      if (fresh.length) {
        if (document.visibilityState === 'visible') { beep(); if (!near.current) setAway((n) => n + fresh.length); }
        else { const base = document.title.replace(/^\(\d+\)\s*/, ''); document.title = `(${fresh.length}) ${base}`; }
      }
    } catch { /* offline: try again next tick */ }
  }, [q]);

  useEffect(() => {
    void sync(document.visibilityState === 'visible');
    const t = setInterval(() => { if (document.visibilityState === 'visible') void sync(true); }, 3000);
    const v = () => { if (document.visibilityState === 'visible') { document.title = document.title.replace(/^\(\d+\)\s*/, ''); void sync(true); } };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [sync]);

  useEffect(() => { if (near.current) end.current?.scrollIntoView({ block: 'end' }); }, [list.length]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, []);
  useEffect(() => { const c = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.st-bub')) setMenu(null); }; document.addEventListener('click', c); return () => document.removeEventListener('click', c); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setLightbox(null); setMenu(null); setReply(null); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const onScroll = () => { const el = box.current; if (!el) return; near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; if (near.current) setAway(0); };
  const toBottom = () => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); setAway(0); };

  async function post(o: { body: string; file?: File | null; replyTo?: string | null; ms?: number }, tmpId?: string) {
    const id = tmpId || 'tmp' + Date.now() + Math.random();
    const f = o.file ? await shrink(o.file) : null;
    const local: Local = { id, mine: true, body: o.body, at: new Date().toISOString(), deleted: false, read: false, sending: true,
      kind: !f ? 'text' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'voice' : 'file',
      att: f ? { name: f.name, mime: f.type, size: f.size, url: '', ms: o.ms || null } : null, localUrl: f ? URL.createObjectURL(f) : undefined,
      reply: o.replyTo ? { id: o.replyTo, who: 'them', preview: reply?.body.slice(0, 80) || '' } : null, reactions: {} };
    setList((l) => [...l.filter((m) => m.id !== id), local]); near.current = true;
    const fd = new FormData(); fd.set('appId', appId); fd.set('body', o.body); if (o.replyTo) fd.set('replyTo', o.replyTo); if (f) fd.set('file', f); if (o.ms) fd.set('durationMs', String(o.ms));
    try {
      const r = await fetch('/api/thread', { method: 'POST', body: fd }), d = (await r.json()) as { ok: boolean; error?: string };
      if (!d.ok) throw new Error(d.error || 'Could not send');
      setList((l) => l.filter((m) => m.id !== id)); await sync(false);
    } catch (e) { setErr((e as Error).message); setList((l) => l.map((m) => (m.id === id ? { ...m, sending: false, failed: true } : m))); }
  }

  function send() {
    const body = text.trim();
    if (!body && !file) return;
    setErr(''); void post({ body, file: file?.f, replyTo: reply?.id && !reply.id.startsWith('tmp') ? reply.id : null });
    setText(''); setFile(null); setReply(null); ta.current && (ta.current.style.height = 'auto');
  }

  async function startRec() {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks: Blob[] = [], t0 = Date.now();
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const h = mr.current; if (!h) return; clearInterval(h.timer); mr.current = null; setRec(null);
        if (h.cancel || !chunks.length) return;
        const ms = Date.now() - t0; if (ms < 700) return;
        const type = recorder.mimeType || 'audio/webm';
        void post({ body: '', file: new File(chunks, `voice-note.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type: type.split(';')[0] }), ms });
      };
      const timer = setInterval(() => { setRec({ ms: Date.now() - t0 }); if (Date.now() - t0 > 180_000) stopRec(false); }, 250);
      mr.current = { rec: recorder, chunks, t0, cancel: false, timer }; setRec({ ms: 0 }); recorder.start();
    } catch { setErr('Allow microphone access to send voice notes.'); }
  }
  function stopRec(cancel: boolean) { const h = mr.current; if (!h) return; h.cancel = cancel; if (h.rec.state !== 'inactive') h.rec.stop(); }

  async function doReact(m: Local, emoji: string) {
    setMenu(null);
    setList((l) => l.map((x) => { if (x.id !== m.id) return x; const rx = { ...x.reactions }; const had = rx[emoji]?.me; for (const e of Object.keys(rx)) if (rx[e].me) { rx[e] = { n: rx[e].n - 1, me: false }; if (rx[e].n <= 0) delete rx[e]; } if (!had) rx[emoji] = { n: (rx[emoji]?.n || 0) + 1, me: true }; return { ...x, reactions: rx }; }));
    await fetch(`/api/thread/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: appId, emoji }) }).catch(() => {});
  }
  async function doDelete(m: Local) {
    setMenu(null); if (!confirm('Delete this message for everyone?')) return;
    setList((l) => l.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '', att: null, kind: 'text' } : x)));
    await fetch(`/api/thread/${m.id}?${q}`, { method: 'DELETE' }).catch(() => {});
  }

  const status = other ? (other.online ? 'Active now' : other.lastSeen ? `Last seen ${ago(other.lastSeen)}` : '') : '';
  const sq = search && search.q.trim().length > 1 ? search.q.trim() : '';
  const hits = sq ? list.filter((m) => !m.deleted && `${m.body} ${m.att?.name || ''}`.toLowerCase().includes(sq.toLowerCase())).map((m) => m.id) : [];
  const cur = hits.length ? hits[Math.min(search?.i || 0, hits.length - 1)] : null;
  function step(d: number) { if (!hits.length || !search) return; setSearch({ ...search, i: (Math.min(search.i, hits.length - 1) + d + hits.length) % hits.length }); }
  useEffect(() => { if (cur) document.getElementById(`msg-${cur}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [cur]);
  let lastDay = '';
  return (
    <div className="st-chat">
      <div className="st-chat-head"><b>{otherName}</b>{typing ? <small className="on typing">typing…</small> : status && <small className={other?.online ? 'on' : ''}>{other?.online && <i />}{status}</small>}<button type="button" className="st-x srch" onClick={() => setSearch(search ? null : { q: '', i: 0 })} aria-label="Search this chat"><Icon n="search" size={18} /></button></div>
      {search && <div className="st-search"><input autoFocus value={search.q} onChange={(e) => setSearch({ q: e.target.value, i: 0 })} placeholder="Search messages" onKeyDown={(e) => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setSearch(null); }} /><span>{search.q.trim().length > 1 ? (hits.length ? `${Math.min(search.i, hits.length - 1) + 1} of ${hits.length}` : 'No matches') : ''}</span><button type="button" onClick={() => step(-1)} aria-label="Previous match" disabled={!hits.length}>↑</button><button type="button" onClick={() => step(1)} aria-label="Next match" disabled={!hits.length}>↓</button><button type="button" onClick={() => setSearch(null)} aria-label="Close search">×</button></div>}
      <div className="st-chat-list" ref={box} onScroll={onScroll} aria-live="polite">
        {list.length === 0 && <div className="st-chat-empty"><Icon n="chat" size={28} /><b>Say hello to {otherName}</b><span>Ask a question, send a photo of a document, or record a voice note.</span></div>}
        {list.map((m, i) => {
          const d = dayLabel(m.at), sep = d !== lastDay; lastDay = d;
          const prev = list[i - 1], first = sep || !prev || prev.mine !== m.mine;
          return (
            <div key={m.id} id={`msg-${m.id}`} className={`st-row-msg ${cur === m.id ? 'hit' : ''}`} data-mine={m.mine}>
              {sep && <div className="st-day"><span>{d}</span></div>}
              <div className={`st-bub ${m.mine ? 'mine' : ''} ${m.deleted ? 'gone' : ''} ${first ? 'first' : ''} ${m.failed ? 'failed' : ''} ${menu === m.id ? 'menu-open' : ''}`} onClick={() => { if (!m.deleted && !m.sending) setMenu((cur) => (cur === m.id ? null : m.id)); }}>
                {m.reply && <div className="st-quote"><b>{m.reply.who === 'me' ? 'You' : otherName}</b><span>{m.reply.preview}</span></div>}
                {m.deleted ? <p><em>This message was deleted</em></p> : <>
                  {m.kind === 'image' && m.att && /* eslint-disable-next-line @next/next/no-img-element */ <img className="st-img" src={m.localUrl || m.att.url} alt={m.att.name} loading="lazy" onClick={(e) => { e.stopPropagation(); setLightbox(m.localUrl || m.att!.url); }} />}
                  {m.kind === 'voice' && <Voice m={m} />}
                  {m.kind === 'file' && m.att && <a className="st-file" href={m.att.url ? `${m.att.url}${m.att.url.includes('?') ? '&' : '?'}download=1` : '#'} onClick={(e) => e.stopPropagation()}><span className="ic"><Icon n="file" size={20} /></span><span className="tx"><b>{m.att.name}</b><small>{kb(m.att.size)}</small></span><Icon n="download" size={16} /></a>}
                  {m.body && <p>{linkify(m.body, sq)}</p>}
                </>}
                <small className="meta">{clock(m.at)}{m.mine && !m.deleted && <span className={`tick ${m.read ? 'read' : ''}`}>{m.sending ? '◷' : m.failed ? '!' : m.read ? '✓✓' : '✓'}</span>}</small>
                {Object.keys(m.reactions).length > 0 && <div className="st-rx">{Object.entries(m.reactions).map(([e, v]) => <span key={e} className={v.me ? 'me' : ''}>{e}{v.n > 1 ? ` ${v.n}` : ''}</span>)}</div>}
                {m.failed && <button className="st-retry" onClick={(e) => { e.stopPropagation(); setList((l) => l.filter((x) => x.id !== m.id)); void post({ body: m.body }, undefined); }}>Tap to retry</button>}
                {menu === m.id && (
                  <div className="st-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="em">{REACTIONS.map((e) => <button key={e} onClick={() => doReact(m, e)}>{e}</button>)}</div>
                    <button onClick={() => { setReply(m); setMenu(null); ta.current?.focus(); }}>Reply</button>
                    {as === 'staff' && m.att && m.kind !== 'voice' && /\.(pdf|jpe?g|png|webp|docx?)$/i.test(m.att.name) && <button onClick={() => { setSave({ id: m.id, type: 'Other', label: '', busy: false }); setMenu(null); }}>Save to documents</button>}
                    {m.body && <button onClick={() => { void navigator.clipboard?.writeText(m.body); setMenu(null); }}>Copy</button>}
                    {m.mine && <button className="danger" onClick={() => doDelete(m)}>Delete for everyone</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {typing && <div className="st-row-msg" data-mine="false"><div className="st-bub st-typing"><i /><i /><i /></div></div>}
        <div ref={end} />
      </div>
      {note && <div className="st-note">{note}</div>}
      {away > 0 && <button className="st-jump" onClick={toBottom}>↓ {away} new</button>}
      {err && <div className="st-err" style={{ margin: '0 12px 8px' }}>{err}</div>}
      {reply && <div className="st-replybar"><div><b>{reply.mine ? 'You' : otherName}</b><span>{reply.body.slice(0, 90) || (reply.kind === 'image' ? '📷 Photo' : reply.kind === 'voice' ? '🎤 Voice note' : '📎 File')}</span></div><button onClick={() => setReply(null)} aria-label="Cancel reply">×</button></div>}
      {file && <div className="st-attach">{file.f.type.startsWith('image/') ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={file.url} alt="" /> : <span className="ic"><Icon n="file" size={20} /></span>}<div><b>{file.f.name}</b><small>{kb(file.f.size)}</small></div><button onClick={() => setFile(null)} aria-label="Remove">×</button></div>}
      {rec ? (
        <div className="st-compose rec"><button className="st-x" onClick={() => stopRec(true)} aria-label="Cancel"><Icon n="trash" size={18} /></button><span className="dot" /><b>{mmss(rec.ms)}</b><span className="muted">Recording…</span><button className="st-send" onClick={() => stopRec(false)} aria-label="Send voice note"><Icon n="send" size={18} /></button></div>
      ) : (
        <form className="st-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <button type="button" className="st-x" onClick={(e) => { e.stopPropagation(); pick.current?.click(); }} aria-label="Attach a file"><Icon n="upload" size={19} /></button>
          <button type="button" className="st-x cam" onClick={() => cam.current?.click()} aria-label="Take a photo"><Icon n="camera" size={19} /></button>
          <textarea ref={ta} value={text} rows={1} maxLength={2000} placeholder="Message" onChange={(e) => { setText(e.target.value); if (e.target.value && Date.now() - lastTyping.current > 2500) { lastTyping.current = Date.now(); void fetch('/api/thread/typing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: appId }) }).catch(() => {}); } e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width:700px)').matches) { e.preventDefault(); send(); } }} onPaste={(e) => { const f = Array.from(e.clipboardData.files)[0]; if (f) { e.preventDefault(); setFile({ f, url: URL.createObjectURL(f) }); } }} />
          {text.trim() || file ? <button className="st-send" aria-label="Send"><Icon n="send" size={18} /></button> : <button type="button" className="st-send mic" onClick={startRec} aria-label="Record a voice note">🎤</button>}
        </form>
      )}
      <input ref={pick} type="file" hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile({ f, url: URL.createObjectURL(f) }); e.target.value = ''; }} />
      <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile({ f, url: URL.createObjectURL(f) }); e.target.value = ''; }} />
      {save && (
        <div className="st-lightbox" style={{ cursor: 'default' }} onClick={() => !save.busy && setSave(null)}>
          <div className="st-save" onClick={(e) => e.stopPropagation()}>
            <h3>Save to documents</h3><p>Files this attachment into the student’s Drive folder.</p>
            <select value={save.type} onChange={(e) => setSave({ ...save, type: e.target.value })}>{ALL_DOC_TYPES.map((t) => <option key={t} value={t}>{t === 'Other' ? 'Other (name it)' : t}</option>)}</select>
            {save.type === 'Other' && <input value={save.label} onChange={(e) => setSave({ ...save, label: e.target.value })} maxLength={40} placeholder="e.g. Bank statement" />}
            <div><button type="button" className="st-btn ghost sm" onClick={() => setSave(null)} disabled={save.busy}>Cancel</button><button type="button" className="st-btn sm" disabled={save.busy || (save.type === 'Other' && save.label.trim().length < 2)} onClick={async () => {
              setSave({ ...save, busy: true });
              const r = await fetch(`/api/thread/${save.id}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: appId, docType: save.type, docLabel: save.label }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Network error' })) as { ok: boolean; error?: string };
              setSave(null); setNote(r.ok ? 'Saved to documents ✓' : r.error || 'Could not save'); setTimeout(() => setNote(''), 4000);
            }}>{save.busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}
      {lightbox && <div className="st-lightbox" onClick={() => setLightbox(null)}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={lightbox} alt="" /><button aria-label="Close">×</button></div>}
    </div>
  );
}
