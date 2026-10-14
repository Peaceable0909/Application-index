'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Mark from './Mark';
import Avatar from './Avatar';
import StudentBell from './StudentBell';
import StudentNav from './StudentNav';
import type { Notice } from '@/lib/notices';

const TITLES: [string, string][] = [['/student/interview/credibility', 'Credibility training'], ['/student/interview', 'Interview'], ['/student/documents', 'Documents'], ['/student/messages', 'Messages'], ['/student/me', 'Me'], ['/student', 'Home']];

/** The student app's top bar: translucent, grows a hairline once you scroll, and the brand name gives way to the page title (like a large-title navigation bar). */
export default function StudentTopBar({ name, notices, unread }: { name: string; notices: Notice[]; unread: number }) {
  const path = usePathname() || '';
  const title = TITLES.find(([p]) => path === p || path.startsWith(p + '/'))?.[1] || '';
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 34);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [path]);
  return (
    <header className="st-top" data-scrolled={scrolled ? '1' : '0'}>
      <Link href="/student" className="st-brand"><Mark size={36} /><span><b>WhiteRock <em>Admissions</em></b><small>Student portal</small></span>{title && <span className="st-top-title" aria-hidden>{title}</span>}</Link>
      <StudentNav variant="top" unread={unread} />
      <div className="st-me"><StudentBell initial={notices} /><Link href="/student/me" aria-label="My profile"><Avatar name={name} size={38} /></Link></div>
    </header>
  );
}
