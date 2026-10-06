'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import type { Notice } from '@/lib/notices';

const ICON: Record<string, string> = { docs: 'file', payment: 'alert', offer: 'check-circle', interview: 'video', message: 'mail' };
const ago = (iso: string) => { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`; };

/** Everything the team has asked of the student or told them by email, kept here too. */
export default function StudentBell({ initial }: { initial: Notice[] }) {
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = list.filter((n) => !n.read && !n.done).length;

  useEffect(() => {
    const pull = () => { if (!document.hidden) fetch('/api/student/notices', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.notices && setList(j.notices)).catch(() => {}); };
    const t = setInterval(pull, 60_000); document.addEventListener('visibilitychange', pull);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', pull); };
  }, []);
  useEffect(() => { const h = (e: MouseEvent) => { if (open && box.current && !box.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);

  function toggle() {
    const next = !open; setOpen(next);
    if (next && unread) { fetch('/api/student/notices', { method: 'POST' }).catch(() => {}); setTimeout(() => setList((l) => l.map((n) => ({ ...n, read: true }))), 1500); }
  }
  return (
    <div className="sbell" ref={box}>
      <button className="iconbtn" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} onClick={toggle}><Icon n="bell" size={18} />{unread > 0 && <span className="sbadge2">{unread > 9 ? '9+' : unread}</span>}</button>
      {open && (
        <div className="spanel">
          <div className="sp-h"><b>Notifications</b><span className="muted">Also sent to your email</span></div>
          {!list.length && <p className="muted" style={{ padding: 16, margin: 0 }}>Nothing yet. When your counselor asks you for something, it will appear here.</p>}
          {list.map((n) => (
            <div key={n.id} className={`sp-i ${!n.read && !n.done ? 'new' : ''} ${n.done ? 'done' : ''}`}>
              <span className="sp-ico"><Icon n={n.done ? 'check' : ICON[n.kind] || 'mail'} size={16} /></span>
              <div>
                <b>{n.title}</b>
                {n.body && <div className="muted" style={{ fontSize: 12.5 }}>{n.body}</div>}
                <div className="sp-f"><small>{ago(n.created_at)}</small>{n.done ? <small className="ok-t">Done ✓</small> : n.href ? <Link href={n.href} onClick={() => setOpen(false)}>Open →</Link> : null}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
