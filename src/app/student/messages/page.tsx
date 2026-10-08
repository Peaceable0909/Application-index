import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { actor, loadThread } from '@/lib/thread';
import { loadStudentData } from '@/lib/studentData';
import ChatThread from '@/components/ChatThread';

export default async function StudentMessages() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const d = await loadStudentData(me);
  const a = await actor(d.cards[0].folderApp.application_id);
  const t = a ? await loadThread(a, false) : { msgs: [], other: undefined };
  const c = d.counselor, first = c ? c.display.split(' ')[0] : 'your counselor';
  return (
    <ChatThread as="student" appId={d.cards[0].folderApp.application_id} other={first} msgs={t.msgs} otherInit={t.other}
      backHref="/student" title={c ? c.display : 'Your counselor'} avatar={c ? { name: c.display, url: c.avatar_url, color: c.color } : undefined} />
  );
}
