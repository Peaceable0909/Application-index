import './globals.css';
import Link from 'next/link';
import { Inter, Instrument_Serif } from 'next/font/google';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { appIdsFor } from '@/lib/auth';
import { inboxUnread } from '@/lib/inbox';
import Mark from '@/components/Mark';
import Nav from '@/components/Nav';
import TopSearch from '@/components/TopSearch';
import Bell from '@/components/Bell';
import UserMenu from '@/components/UserMenu';
import NavProgress from '@/components/NavProgress';
import MobileMenu from '@/components/MobileMenu';
import Presence from '@/components/Presence';
import { unreadTotal } from '@/lib/chat';
import { currentStudent } from '@/lib/student';
import StudentShell from '@/components/StudentShell';
import { noticesFor } from '@/lib/notices';
import './student.css';
import './themes.css';
import './whatsapp.css';
import { cookies } from 'next/headers';
import { COOKIE, parseTheme } from '@/lib/theme';

const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });

export const metadata = { title: 'Admissions Portal', description: 'Applications, documents and counselors in one place.', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'WhiteRock', statusBarStyle: 'default' as const }, icons: { apple: '/pwa/icon-192.png' } };
export const viewport = { themeColor: '#0d1f4d' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  const student = staff ? null : await currentStudent();
  // the person's look: cookie first (no flash), else what they saved on another device
  const email = (staff?.email || student?.email || '').toLowerCase();
  const cookieTheme = (await cookies()).get(COOKIE)?.value;
  const db = admin();
  // these don't depend on each other, so they run side by side instead of one after another
  const [themeRow, studentNotices, studentUnread, taskCount, chatCount, inboxCount] = await Promise.all([
    !cookieTheme && email ? db.from('portal_theme_prefs').select('mode, accent').eq('email', email).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    student ? noticesFor(student) : Promise.resolve([]),
    student ? db.from('portal_student_msgs').select('id', { count: 'exact', head: true }).eq('student_email', student.email).eq('from_student', false).is('student_read_at', null).then((r) => r.count || 0) : Promise.resolve(0),
    staff ? (async () => {
      const q = db.from('portal_tasks').select('id', { count: 'exact', head: true }).eq('status', 'open');
      return (staff.role === 'counselor' ? await q.in('application_id', await appIdsFor(staff.counselor_key)) : await q).count || 0;
    })() : Promise.resolve(0),
    staff ? unreadTotal(staff.email).catch(() => 0) : Promise.resolve(0),
    staff ? inboxUnread(staff).catch(() => 0) : Promise.resolve(0),
  ]);
  const theme = themeRow ? parseTheme(`${themeRow.mode}.${themeRow.accent}`) : parseTheme(cookieTheme);
  return (
    <html lang="en" className={`${ui.variable} ${display.variable}`} data-theme={theme.mode === 'system' ? 'light' : theme.mode} data-accent={theme.accent} {...(theme.mode === 'system' ? { 'data-pref': 'system' } : {})} suppressHydrationWarning>
      <head>
        {/* runs before first paint: "Auto" follows the phone/computer setting, and keeps following it */}
        <script dangerouslySetInnerHTML={{ __html: "try{var e=document.documentElement;var t=+localStorage.getItem('wr_splash')||0;if(Date.now()-t<108e5)e.classList.add('no-splash');else localStorage.setItem('wr_splash',String(Date.now()));if(e.getAttribute('data-pref')==='system'){var m=matchMedia('(prefers-color-scheme: dark)'),f=function(){e.setAttribute('data-theme',m.matches?'dark':'light')};f();m.addEventListener('change',f)}}catch(x){}" }} />
      </head>
      <body>
        <div className="splash" aria-hidden>
          <div className="splash-in"><Mark draw /><div className="splash-word">Admissions <em>Portal</em></div><div className="splash-line" /></div>
        </div>
        <NavProgress />
        {staff && <Presence />}
        {staff ? (
          <div className="shell">
            <aside className="side">
              <Link href="/" className="brand"><Mark size={36} inverse /><span><b>Admissions <em>Portal</em></b><small>WhiteRock Admissions</small></span></Link>
              <Nav taskCount={taskCount} chatCount={chatCount} inboxCount={inboxCount} role={staff.role} />
              <div className="tag">More opportunities.<br />Brighter futures.</div>
            </aside>
            <div className="maincol">
              <header className="topbar"><MobileMenu /><TopSearch /><div className="topright"><Bell staff={staff} /><UserMenu staff={staff} /></div></header>
              <main>{children}</main>
            </div>
          </div>
        ) : student ? <StudentShell me={student} notices={studentNotices} unread={studentUnread}>{children}</StudentShell> : <main style={{ maxWidth: 'none' }}>{children}</main>}
      </body>
    </html>
  );
}
