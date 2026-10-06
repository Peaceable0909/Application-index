import Link from 'next/link';
import Mark from './Mark';
import Icon from './Icon';
import { studentSignOut } from '@/app/actions';
import StudentBell from './StudentBell';
import type { StudentView } from '@/lib/student';
import type { Notice } from '@/lib/notices';

export default function StudentShell({ me, notices, children }: { me: StudentView; notices: Notice[]; children: React.ReactNode }) {
  return (
    <div className="stu-shell">
      <header className="stu-top">
        <Link href="/student" className="brand"><Mark size={34} /><span><b>WhiteRock <em>Admissions</em></b><small>Student Portal</small></span></Link>
        <div className="stu-me"><StudentBell initial={notices} /><span className="pic" style={{ width: 36, height: 36, fontSize: 13, background: 'linear-gradient(135deg,#0f2a63,#2b5fb8)' }}>{me.name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
          <div><b>{me.name.split(/[\s,]+/)[0]}</b><small>{me.email}</small></div>
          <form action={studentSignOut}><button className="iconbtn" aria-label="Sign out" title="Sign out"><Icon n="logout" size={17} /></button></form></div>
      </header>
      <main className="stu-main">{children}</main>
    </div>
  );
}
