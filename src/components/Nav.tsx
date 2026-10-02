'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from './Icon';

const ITEMS = [
  { href: '/', label: 'Overview', icon: 'grid', exact: true },
  { href: '/applications', label: 'Applications', icon: 'file' },
  { href: '/tasks', label: 'Tasks', icon: 'tasks', badge: 'tasks' },
  { href: '/documents', label: 'Documents', icon: 'folder' },
  { href: '/counselors', label: 'Counselors', icon: 'users' },
  { href: '/messages', label: 'Messages', icon: 'mail' },
  { href: '/notes', label: 'Notes', icon: 'note' },
  { href: '/activity', label: 'Activity', icon: 'clock' },
  { href: '/drive', label: 'Drive matches', icon: 'link' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

const COUNSELOR_ITEMS: typeof ITEMS = [{ href: '/my', label: 'My students', icon: 'users' }];

export default function Nav({ taskCount = 0, mobile = false, role = 'staff' }: { taskCount?: number; mobile?: boolean; role?: string }) {
  const p = usePathname();
  const items = role === 'counselor' ? COUNSELOR_ITEMS : ITEMS;
  const on = (i: (typeof ITEMS)[number]) => (i.exact ? p === '/' : p.startsWith(i.href) || (i.href === '/my' && p.startsWith('/applications/')));
  return (
    <nav className={mobile ? 'mnav' : ''}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={on(i) ? 'active' : ''}>
          {!mobile && <Icon n={i.icon} size={19} />}
          <span>{i.label}</span>
          {!mobile && i.badge === 'tasks' && taskCount > 0 && <span className="n">{taskCount > 99 ? '99+' : taskCount}</span>}
        </Link>
      ))}
    </nav>
  );
}
