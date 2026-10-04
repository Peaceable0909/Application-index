'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from './Icon';

const ITEMS = [
  { href: '/', label: 'Overview', icon: 'grid', exact: true },
  { href: '/applications', label: 'Applications', icon: 'file' },
  { href: '/pipeline', label: 'Pipeline', icon: 'bolt' },
  { href: '/calendar', label: 'Deadlines', icon: 'clock' },
  { href: '/payments', label: 'Payments', icon: 'trend' },
  { href: '/reports', label: 'Reports', icon: 'note' },
  { href: '/tasks', label: 'Tasks', icon: 'tasks', badge: 'tasks' },
  { href: '/chat', label: 'Chat', icon: 'chat', badge: 'chat' },
  { href: '/documents', label: 'Documents', icon: 'folder' },
  { href: '/counselors', label: 'Counselors', icon: 'users' },
  { href: '/messages', label: 'Messages', icon: 'mail' },
  { href: '/notes', label: 'Notes', icon: 'note' },
  { href: '/activity', label: 'Activity', icon: 'clock' },
  { href: '/drive', label: 'Drive matches', icon: 'link' },
  { href: '/team', label: 'Team', icon: 'user' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

const COUNSELOR_ITEMS: typeof ITEMS = [{ href: '/my', label: 'My students', icon: 'users' }, { href: '/pipeline', label: 'Pipeline', icon: 'bolt' }, { href: '/calendar', label: 'Deadlines', icon: 'clock' }, { href: '/chat', label: 'Chat', icon: 'chat', badge: 'chat' }, { href: '/team', label: 'Team', icon: 'user' }];

export default function Nav({ taskCount = 0, chatCount = 0, mobile = false, role = 'staff' }: { taskCount?: number; chatCount?: number; mobile?: boolean; role?: string }) {
  const p = usePathname();
  const [chat, setChat] = useState(chatCount);
  useEffect(() => setChat(chatCount), [chatCount]);
  useEffect(() => { const h = (e: Event) => setChat((e as CustomEvent<number>).detail || 0); window.addEventListener('chat-unread', h); return () => window.removeEventListener('chat-unread', h); }, []);
  const items = role === 'counselor' ? COUNSELOR_ITEMS : ITEMS;
  const on = (i: (typeof ITEMS)[number]) => (i.exact ? p === '/' : p.startsWith(i.href) || (i.href === '/my' && p.startsWith('/applications/')));
  return (
    <nav className={mobile ? 'mnav' : ''}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={on(i) ? 'active' : ''}>
          {!mobile && <Icon n={i.icon} size={19} />}
          <span>{i.label}</span>
          {!mobile && i.badge === 'tasks' && taskCount > 0 && <span className="n">{taskCount > 99 ? '99+' : taskCount}</span>}
          {!mobile && i.badge === 'chat' && chat > 0 && <span className="n">{chat > 99 ? '99+' : chat}</span>}
        </Link>
      ))}
    </nav>
  );
}
