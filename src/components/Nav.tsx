'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const p = usePathname();
  const items = [
    { href: '/overview', label: 'Overview', on: p.startsWith('/overview') },
    { href: '/', label: 'Applications', on: p === '/' || p.startsWith('/applications') },
    { href: '/drive', label: 'Drive matches', on: p.startsWith('/drive') },
    { href: '/settings', label: 'Settings', on: p.startsWith('/settings') },
  ];
  return (
    <nav className="nav">
      {items.map((i) => <Link key={i.href} href={i.href} className={i.on ? 'active' : ''}>{i.label}</Link>)}
    </nav>
  );
}
