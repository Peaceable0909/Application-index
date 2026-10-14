'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';

type Hit = { id: string; name: string; email: string | null; school: string | null; programme: string | null; status: string | null };
type Cmd = { id: string; label: string; icon: string; group: 'Actions' | 'Go to'; href?: string; run?: () => void; hint?: string };

const GO: [string, string, string][] = [['Overview', '/', 'grid'], ['Applications', '/applications', 'file'], ['Pipeline', '/pipeline', 'bolt'], ['Deadlines', '/calendar', 'clock'], ['Interviews', '/interviews', 'video'], ['Payments', '/payments', 'trend'], ['Reports', '/reports', 'note'], ['Tasks', '/tasks', 'tasks'], ['Student inbox', '/inbox', 'mail'], ['Chat', '/chat', 'chat'], ['Documents', '/documents', 'folder'], ['Counselors', '/counselors', 'users'], ['Messages', '/messages', 'mail'], ['Team', '/team', 'user'], ['Settings', '/settings', 'settings'], ['My profile', '/profile', 'user']];

function toggleDark() {
  const el = document.documentElement, dark = el.getAttribute('data-theme') !== 'dark', accent = el.getAttribute('data-accent') || 'blue';
  el.classList.add('theme-fade'); el.removeAttribute('data-pref'); el.setAttribute('data-theme', dark ? 'dark' : 'light'); setTimeout(() => el.classList.remove('theme-fade'), 450);
  void fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: dark ? 'dark' : 'light', accent }) }).catch(() => {});
}

/** The search box doubles as a command palette: find a student, jump to any page, or run a quick action (⌘K / Ctrl K). */
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

  const cmds = useMemo<Cmd[]>(() => {
    const all: Cmd[] = [
      { id: 'a-add', label: 'Add a student', icon: 'user-plus', group: 'Actions', href: '/applications/new' },
      { id: 'a-msg', label: 'Write a message', icon: 'mail', group: 'Actions', href: '/messages?compose=1' },
      { id: 'a-dark', label: 'Switch dark / light mode', icon: 'spark', group: 'Actions', run: toggleDark, hint: 'Theme' },
      ...GO.map(([label, href, icon]): Cmd => ({ id: `g-${href}`, label, icon, group: 'Go to', href })),
    ];
    const t = q.trim().toLowerCase();
    if (!t) return all.filter((c) => ['a-add', 'a-msg', 'a-dark', 'g-/pipeline', 'g-/tasks', 'g-/chat'].includes(c.id));
    const words = t.split(/\s+/);
    return all.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 6);
  }, [q]);

  const items: ({ kind: 'hit'; h: Hit } | { kind: 'cmd'; c: Cmd })[] = [...(q.trim().length >= 2 ? hits.map((h) => ({ kind: 'hit' as const, h })) : []), ...cmds.map((c) => ({ kind: 'cmd' as const, c }))];
  const run = (i?: number) => {
    const it = items[i ?? sel], term = q.trim();
    setOpen(false); setQ(''); setHits([]); input.current?.blur();
    if (it?.kind === 'hit') router.push(`/applications/${it.h.id}`);
    else if (it?.kind === 'cmd') { if (it.c.run) it.c.run(); else if (it.c.href) router.push(it.c.href); }
    else if (term) router.push(`/applications?q=${encodeURIComponent(term)}`);
  };

  let lastGroup = '';
  return (
    <div className="topsearch" ref={box}>
      <Icon n="search" size={18} />
      <input ref={input} value={q} placeholder="Search students, or jump anywhere…" aria-label="Search or command" autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setSel(0); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(); }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }} />
      <kbd>⌘ K</kbd>
      {open && (
        <div className="palette" role="listbox">
          {items.map((it, i) => {
            const head = it.kind === 'cmd' && it.c.group !== lastGroup ? it.c.group : (it.kind === 'hit' && lastGroup !== 'Students' ? 'Students' : '');
            if (it.kind === 'cmd') lastGroup = it.c.group; else lastGroup = 'Students';
            return (
              <div key={it.kind === 'hit' ? it.h.id : it.c.id}>
                {head && <div className="pal-h">{head === 'Actions' && !q.trim() ? 'Suggestions' : head}</div>}
                {it.kind === 'hit' ? (
                  <a className={i === sel ? 'sel' : ''} role="option" aria-selected={i === sel} href={`/applications/${it.h.id}`} onClick={(e) => { e.preventDefault(); run(i); }} onMouseEnter={() => setSel(i)}>
                    <span className="avatar sm">{it.h.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
                    <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', color: 'var(--ink)' }}>{it.h.name}</b><small className="muted">{[it.h.programme, it.h.school, it.h.email].filter(Boolean).join(' · ')}</small></span>
                    {it.h.status && <span className="badge plain">{it.h.status}</span>}
                  </a>
                ) : (
                  <a className={i === sel ? 'sel' : ''} role="option" aria-selected={i === sel} href={it.c.href || '#'} onClick={(e) => { e.preventDefault(); run(i); }} onMouseEnter={() => setSel(i)}>
                    <span className="pal-ic"><Icon n={it.c.icon} size={16} /></span>
                    <span style={{ flex: 1 }}>{it.c.label}</span>{it.c.hint && <small className="muted">{it.c.hint}</small>}
                  </a>
                )}
              </div>
            );
          })}
          {!items.length && <div className="none">Nothing matches “{q}”. Press Enter to search all applications.</div>}
          <div className="hint">↑ ↓ to move · Enter to open · ⌘ K from anywhere</div>
        </div>
      )}
    </div>
  );
}
