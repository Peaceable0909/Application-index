'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from './Icon';

type Tab = { href: string; label: string; icon: string; badge?: 'tasks' | 'chat' | 'inbox'; exact?: boolean };
const STAFF: Tab[] = [{ href: '/', label: 'Home', icon: 'grid', exact: true }, { href: '/applications', label: 'Students', icon: 'file' }, { href: '/chat', label: 'Chat', icon: 'chat', badge: 'chat' }, { href: '/tasks', label: 'Tasks', icon: 'tasks', badge: 'tasks' }];
const COUNSELOR: Tab[] = [{ href: '/my', label: 'Mine', icon: 'users' }, { href: '/pipeline', label: 'Pipeline', icon: 'bolt' }, { href: '/chat', label: 'Chat', icon: 'chat', badge: 'chat' }, { href: '/inbox', label: 'Inbox', icon: 'mail', badge: 'inbox' }];

/** Phone-only bottom bar for the team: four main places plus "More", which opens the full menu. */
export default function StaffTabs({ role = 'staff', taskCount = 0, chatCount = 0, inboxCount = 0 }: { role?: string; taskCount?: number; chatCount?: number; inboxCount?: number }) {
  const p = usePathname() || '';
  const [chat, setChat] = useState(chatCount);
  useEffect(() => setChat(chatCount), [chatCount]);
  useEffect(() => { const h = (e: Event) => setChat((e as CustomEvent<number>).detail || 0); window.addEventListener('chat-unread', h); return () => window.removeEventListener('chat-unread', h); }, []);
  const tabs = role === 'counselor' ? COUNSELOR : STAFF;
  const on = (t: Tab) => (t.exact ? p === '/' : p.startsWith(t.href) || (t.href === '/applications' && p.startsWith('/applications')));
  const n = (t: Tab) => (t.badge === 'tasks' ? taskCount : t.badge === 'chat' ? chat : t.badge === 'inbox' ? inboxCount : 0);
  const idx = tabs.findIndex(on);
  return (
    <nav className="stf-tabs" aria-label="Main" style={{ ['--i' as string]: idx < 0 ? 4 : idx }}>
      <span className="pill" aria-hidden />
      {tabs.map((t) => <Link key={t.href} href={t.href} className={on(t) ? 'on' : ''}><Icon n={t.icon} size={22} />{t.label}{n(t) > 0 && <span className="dotn">{n(t) > 9 ? '9+' : n(t)}</span>}</Link>)}
      <button type="button" className={idx < 0 ? 'on' : ''} onClick={() => window.dispatchEvent(new Event('open-menu'))} aria-label="More"><Icon n="more" size={22} />More</button>
    </nav>
  );
}
