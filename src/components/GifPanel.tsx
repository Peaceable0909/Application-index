'use client';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

type Gif = { id: string; title: string; preview: string; url: string; w: number; h: number };

/** The GIF tab of the emoji panel: search GIPHY (when the site has a key) or send a GIF saved on the phone. */
export default function GifPanel({ appId, replyTo, onSent, onError, onFile }: { appId: string; replyTo: string | null; onSent: () => void; onError: (m: string) => void; onFile: (f: File) => void }) {
  const [q, setQ] = useState(''), [list, setList] = useState<Gif[] | null>(null), [configured, setConfigured] = useState(true), [busy, setBusy] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/gif/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }); const j = await r.json();
        if (dead) return;
        setConfigured(j.configured !== false); setList(j.results || []); if (!r.ok && j.error) onError(j.error);
      } catch { if (!dead) setList([]); }
    }, q ? 350 : 0);
    return () => { dead = true; clearTimeout(t); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send(g: Gif) {
    if (busy) return;
    setBusy(g.id);
    try {
      const r = await fetch('/api/thread/gif', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: appId, url: g.url, replyTo }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j.ok) onSent(); else onError(j.error || 'Could not send that GIF.');
    } catch { onError('No connection. Check your internet and try again.'); }
    setBusy(null);
  }
  return (
    <div className="gif-panel">
      <div className="gif-bar">
        {configured && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GIFs" aria-label="Search GIFs" />}
        <button type="button" className="gif-own" onClick={() => pick.current?.click()}><Icon n="upload" size={15} className="ic-in" />From your phone</button>
        <input ref={pick} type="file" hidden accept="image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      </div>
      {!configured && <p className="gif-note">GIF search isn’t switched on yet. You can still send a GIF saved on your phone.</p>}
      {configured && list === null && <p className="gif-note">Loading…</p>}
      {configured && list && !list.length && <p className="gif-note">No GIFs found.</p>}
      <div className="gif-grid">
        {(list || []).map((g) => (
          <button key={g.id} type="button" onClick={() => void send(g)} aria-label={g.title || 'Send this GIF'} className={busy === g.id ? 'busy' : ''} disabled={!!busy}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={g.preview} alt=""  style={{ aspectRatio: `${g.w} / ${g.h}` }} />
          </button>
        ))}
      </div>
      {configured && <small className="gif-credit">Powered by GIPHY</small>}
    </div>
  );
}
