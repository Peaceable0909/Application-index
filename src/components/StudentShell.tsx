import StudentTopBar from './StudentTopBar';
import StudentNav from './StudentNav';
import SwRegister from './SwRegister';
import StudentPing from './StudentPing';
import StudentFrame from './StudentFrame';
import PullToRefresh from './PullToRefresh';
import type { StudentView } from '@/lib/student';
import type { Notice } from '@/lib/notices';

export default function StudentShell({ me, notices, unread, children }: { me: StudentView; notices: Notice[]; unread: number; children: React.ReactNode }) {
  return (
    <StudentFrame>
      <StudentTopBar name={me.name} avatarUrl={me.avatar_url} notices={notices} unread={unread} />
      <main className="st-main">{children}</main>
      <StudentNav variant="bottom" unread={unread} />
      <StudentPing /><SwRegister /><PullToRefresh />
    </StudentFrame>
  );
}
