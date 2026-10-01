'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';

type Hit = { id: string; name: string; email: string | null; school: string | null; programme: string | null; status: string | null };

export default function TopSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true); } };
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key); window.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', click); };
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      try { const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`); if (r.ok) { setHits(await r.json()); setSel(0); } } catch { /* offline */ }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const go = (h?: Hit) => { setOpen(false); if (h) router.push(`/applications/${h.id}`); else if (q.trim()) router.push(`/applications?q=${encodeURIComponent(q.trim())}`); };

  return (
    <div className="topsearch" ref={box}>
      <Icon n="search" size={18} />
      <input ref={input} value={q} placeholder="Search applications, students, or reference numbers…" aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]); }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }} />
      <kbd>⌘ K</kbd>
      {open && q.trim().length >= 2 && (
        <div className="palette">
          {hits.map((h, i) => (
            <a key={h.id} className={i === sel ? 'sel' : ''} href={`/applications/${h.id}`} onClick={(e) => { e.preventDefault(); go(h); }} onMouseEnter={() => setSel(i)}>
              <span className="avatar sm">{h.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', color: 'var(--ink)' }}>{h.name}</b>
                <small className="muted">{[h.programme, h.school, h.email].filter(Boolean).join(' · ')}</small></span>
              {h.status && <span className="badge plain">{h.status}</span>}
            </a>
          ))}
          {!hits.length && <div className="none">No students match “{q}”.</div>}
          <div className="hint">↑ ↓ to move · Enter to open · Enter on nothing searches all applications</div>
        </div>
      )}
    </div>
  );
}
