import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { admin } from '@/lib/supabase';
import { loadStudentData } from '@/lib/studentData';
import ChatThread from '@/components/ChatThread';
import Avatar from '@/components/Avatar';

export default async function StudentMessages() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const d = await loadStudentData(me);
  const { data } = await admin().from('portal_student_msgs').select('id, from_student, body, created_at').eq('student_email', me.email).order('created_at').limit(300);
  const c = d.counselor, first = c ? c.display.split(' ')[0] : 'your counselor';
  return (
    <div className="st-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        {c && <Avatar name={c.display} url={c.avatar_url} color={c.color} size={48} />}
        <div><h1 className="st-h1" style={{ margin: 0 }}>{c ? c.display : 'Messages'}</h1><p className="st-sub" style={{ margin: 0 }}>{c ? c.title : 'A counselor will be assigned to you soon.'}</p></div>
      </div>
      <ChatThread as="student" appId={d.cards[0].folderApp.application_id} other={first} msgs={(data || []).map((m) => ({ id: m.id, mine: m.from_student, body: m.body, at: m.created_at }))} />
    </div>
  );
}
