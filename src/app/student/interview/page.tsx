import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { loadStudentData } from '@/lib/studentData';
import StudentInterviews from '@/components/StudentInterviews';
import Link from 'next/link';
import Icon from '@/components/Icon';

const PREP = ['Quiet room, good light, and a stable connection', 'Passport and CV close by', 'Headphones if you have them', 'Join five minutes early and test your sound'];
const QUESTIONS = ['Tell me about yourself and your background', 'Why this course, and why this university?', 'What are your plans after you graduate?', 'How will you pay for your studies?', 'Why do you want to study abroad rather than at home?', 'What do you know about the city you’ll be living in?'];

export default async function StudentInterview() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const d = await loadStudentData(me);
  return (
    <div className="st-page">
      <h1 className="st-h1">Interview practice</h1>
      <p className="st-sub">A friendly mock interview with your counselor, so the real one feels familiar.</p>
      {(
        <Link href="/student/interview/credibility" className="st-card cr-entry">
          <span className="ic"><Icon n="video" size={24} /></span>
          <span className="tx"><b>Credibility Test Training</b><small>Watch the video, practise real questions and get scored feedback.</small></span>
          <Icon n="right" size={20} />
        </Link>
      )}
      <StudentInterviews slots={d.interview.slots} upcoming={d.interview.upcoming} past={d.interview.past} hasUpcoming={d.interview.upcoming.length > 0} />
      <section className="st-card" style={{ '--i': 1 } as React.CSSProperties}>
        <h2>Before you join</h2>
        <ul className="st-tips" style={{ margin: '10px 0 0', paddingLeft: 18 }}>{PREP.map((p) => <li key={p}>{p}</li>)}</ul>
      </section>
      <section className="st-card" style={{ '--i': 2 } as React.CSSProperties}>
        <h2>Questions to think about</h2>
        <p className="st-sub">Commonly asked. Answer in your own words; there is no script.</p>
        <ul className="st-tips" style={{ margin: 0, paddingLeft: 18 }}>{QUESTIONS.map((q) => <li key={q}>{q}</li>)}</ul>
      </section>
    </div>
  );
}
