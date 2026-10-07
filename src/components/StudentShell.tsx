import Link from 'next/link';
import Mark from './Mark';
import Avatar from './Avatar';
import StudentBell from './StudentBell';
import StudentNav from './StudentNav';
import SwRegister from './SwRegister';
import StudentPing from './StudentPing';
import type { StudentView } from '@/lib/student';
import type { Notice } from '@/lib/notices';

export default function StudentShell({ me, notices, unread, children }: { me: StudentView; notices: Notice[]; unread: number; children: React.ReactNode }) {
  return (
    <div className="stu-shell">
      <header className="st-top">
        <Link href="/student" className="st-brand"><Mark size={36} /><span><b>WhiteRock <em>Admissions</em></b><small>Student portal</small></span></Link>
        <StudentNav variant="top" unread={unread} />
        <div className="st-me"><StudentBell initial={notices} /><Link href="/student/me" aria-label="My profile"><Avatar name={me.name} size={38} /></Link></div>
      </header>
      <main className="st-main">{children}</main>
      <StudentNav variant="bottom" unread={unread} />
      <StudentPing /><SwRegister />
    </div>
  );
}
