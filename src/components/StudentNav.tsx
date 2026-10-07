'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from './Icon';

const ITEMS = [
  { href: '/student', label: 'Home', icon: 'grid', exact: true },
  { href: '/student/documents', label: 'Documents', icon: 'file' },
  { href: '/student/messages', label: 'Messages', icon: 'chat', badge: true },
  { href: '/student/interview', label: 'Interview', icon: 'video' },
  { href: '/student/me', label: 'Me', icon: 'user' },
];

/** Sliding pill on desktop (top) and a floating tab bar on phones (bottom). */
export default function StudentNav({ unread = 0, variant }: { unread?: number; variant: 'top' | 'bottom' }) {
  const p = usePathname();
  const idx = Math.max(0, ITEMS.findIndex((i) => (i.exact ? p === i.href : p.startsWith(i.href))));
  const on = (i: (typeof ITEMS)[number]) => (i.exact ? p === i.href : p.startsWith(i.href));
  if (variant === 'bottom') return (
    <nav className="st-tabs" aria-label="Main" style={{ ['--i' as string]: idx }}>
      <span className="pill" aria-hidden />
      {ITEMS.map((i) => <Link key={i.href} href={i.href} className={on(i) ? 'on' : ''}><Icon n={i.icon} size={21} />{i.label}{i.badge && unread > 0 && <span className="dotn">{unread > 9 ? '9+' : unread}</span>}</Link>)}
    </nav>
  );
  return (
    <nav className="st-links" aria-label="Main" style={{ ['--i' as string]: idx }}>
      <span className="pill" aria-hidden style={{ width: `calc((100% - 10px) / ${ITEMS.length})`, transform: `translateX(${idx * 100}%)` }} />
      {ITEMS.map((i) => <Link key={i.href} href={i.href} className={on(i) ? 'on' : ''} style={{ flex: 1, justifyContent: 'center' }}><Icon n={i.icon} size={17} />{i.label}{i.badge && unread > 0 && <span className="dotn">{unread > 9 ? '9+' : unread}</span>}</Link>)}
    </nav>
  );
}
