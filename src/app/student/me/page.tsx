import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { loadStudentData } from '@/lib/studentData';
import { studentSignOut } from '@/app/actions';
import StudentDetails from '@/components/StudentDetails';
import InstallApp from '@/components/InstallApp';
import PushToggle from '@/components/PushToggle';
import ThemePicker from '@/components/ThemePicker';
import { cookies } from 'next/headers';
import { COOKIE, parseTheme } from '@/lib/theme';
import Avatar from '@/components/Avatar';

const FAQ: [string, string][] = [
  ['How do I know my documents were received?', 'The Documents page shows a green tick next to each one, and your counselor is told straight away.'],
  ['Can I upload from my phone?', 'Yes. Tap Scan, photograph each page, and we’ll turn them into a single PDF.'],
  ['Who can see my documents?', 'Only your counselors. Nothing is shared with other students.'],
  ['What happens after I get an offer?', 'Your Home page shows each step, from conditions through to visa, as your counselor updates it. Ask in Messages if anything is unclear.'],
  ['How do I sign in again?', 'Use the same email address. We’ll send a fresh code; there’s no password.'],
];

export default async function StudentMe() {
  if (await currentStaff()) redirect('/');
  const me = await currentStudent();
  if (!me) redirect('/student/login');
  const theme = parseTheme((await cookies()).get(COOKIE)?.value);
  const d = await loadStudentData(me), a0 = d.a0;
  const refId = a0.opp_id || a0.student_ref || `PP-${a0.application_id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`;
  const locked: [string, string][] = [['Name', a0.name], ['Email', me.email], ['Country', a0.country || ''], ['Reference', refId], ['Applied', a0.submitted_at ? new Date(a0.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '']];
  return (
    <div className="st-page">
      <div className="st-prof" style={{ ['--i' as string]: 0 }}>
        <Avatar name={me.name} size={92} />
        <h1 className="st-h1">{me.name}</h1>
        <p className="st-sub">{me.email}</p>
        <span className="st-chip">{refId}</span>
      </div>
      <div style={{ ['--i' as string]: 1 }}><StudentDetails locked={locked} phone={a0.phone || ''} city={a0.city || ''} preferred={a0.preferred_name || ''} /></div>
      <div style={{ ['--i' as string]: 2 }}><h2 className="st-gh">Look &amp; feel</h2><section className="st-card"><p className="st-sub">Pick a theme and an accent colour. It is saved to your account.</p><ThemePicker initial={theme} /></section></div>
      <div style={{ ['--i' as string]: 3 }}><h2 className="st-gh">Notifications</h2><section className="st-card"><p className="st-sub">Get an alert on this device when your counselor replies, calls, or something needs your attention.</p><PushToggle /></section></div>
      <div style={{ ['--i' as string]: 4 }}><h2 className="st-gh">Keep it on your phone</h2><section className="st-card"><p className="st-sub">Add the portal to your home screen so it opens like an app.</p><InstallApp /></section></div>
      <div style={{ ['--i' as string]: 5 }}><h2 className="st-gh">Help</h2><section className="st-card st-faqs">
        {FAQ.map(([q, a]) => <details key={q} className="st-faq"><summary>{q}</summary><p>{a}</p></details>)}
      </section></div>
      <form action={studentSignOut} style={{ ['--i' as string]: 6 }}><button className="st-signout">Sign out</button></form>
      <p className="st-foot">Extravel · made with care</p>
    </div>
  );
}
