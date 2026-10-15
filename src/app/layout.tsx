import './globals.css';
import Link from 'next/link';
import { Inter, Instrument_Serif } from 'next/font/google';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { appIdsFor } from '@/lib/auth';
import { inboxUnread } from '@/lib/inbox';
import Logo from '@/components/Logo';
import Splash from '@/components/Splash';
import RealtimeNudge from '@/components/RealtimeNudge';
import Nav from '@/components/Nav';
import TopSearch from '@/components/TopSearch';
import Bell from '@/components/Bell';
import UserMenu from '@/components/UserMenu';
import NavProgress from '@/components/NavProgress';
import MobileMenu from '@/components/MobileMenu';
import StaffTabs from '@/components/StaffTabs';
import Haptics from '@/components/Haptics';
import AppBadge from '@/components/AppBadge';
import ThemeColor from '@/components/ThemeColor';
import Presence from '@/components/Presence';
import { unreadTotal } from '@/lib/chat';
import { currentStudent } from '@/lib/student';
import StudentShell from '@/components/StudentShell';
import { CallProvider } from '@/components/CallProvider';
import CallOverlay from '@/components/CallOverlay';
import { noticesFor } from '@/lib/notices';
import './student.css';
import './themes.css';
import './whatsapp.css';
import './calls.css';
import './ios.css';
import { cookies } from 'next/headers';
import { COOKIE, parseTheme } from '@/lib/theme';
import { site } from '@/lib/emailTemplate';

const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });

const blurb = 'Applications, documents and counselors in one place.';
export const metadata = {
  metadataBase: new URL(site()),
  title: { default: 'Extravel', template: '%s · Extravel' },
  description: blurb,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Extravel', statusBarStyle: 'default' as const },
  icons: { icon: [{ url: '/brand/favicon.png', type: 'image/png' }], apple: '/brand/apple-touch-icon.png' },
  openGraph: { siteName: 'Extravel', title: 'Extravel', description: blurb, images: [{ url: '/brand/og.png', width: 1200, height: 630 }] },
  twitter: { card: 'summary_large_image' as const, title: 'Extravel', description: blurb, images: ['/brand/og.png'] },
};
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
        <script dangerouslySetInnerHTML={{ __html: "try{var e=document.documentElement;setTimeout(function(){if(!window.__sp)e.classList.add('no-splash')},7e3);var t=+localStorage.getItem('wr_splash')||0;if(Date.now()-t<108e5)e.classList.add('no-splash');else localStorage.setItem('wr_splash',String(Date.now()));if(e.getAttribute('data-pref')==='system'){var m=matchMedia('(prefers-color-scheme: dark)'),f=function(){e.setAttribute('data-theme',m.matches?'dark':'light')};f();m.addEventListener('change',f)}}catch(x){}" }} />
      </head>
      <body>
        <Splash />
        <NavProgress />
        <CallProvider enabled={!!(staff || student)}>
        {staff && <Presence />}
        {staff ? (
          <div className="shell">
            <aside className="side">
              <Link href="/" className="brand" aria-label="Extravel home"><Logo light height={52} alt="" /><small>Team portal</small></Link>
              <Nav taskCount={taskCount} chatCount={chatCount} inboxCount={inboxCount} role={staff.role} />
              <div className="tag">More opportunities.<br />Brighter futures.</div>
            </aside>
            <div className="maincol">
              <header className="topbar"><MobileMenu /><TopSearch /><div className="topright"><Bell staff={staff} /><UserMenu staff={staff} /></div></header>
              <main>{children}</main>
            </div>
            <StaffTabs role={staff.role} taskCount={taskCount} chatCount={chatCount} inboxCount={inboxCount} />
          </div>
        ) : student ? <StudentShell me={student} notices={studentNotices} unread={studentUnread}>{children}</StudentShell> : <main style={{ maxWidth: 'none' }}>{children}</main>}
        {(staff || student) && <RealtimeNudge />}
        {(staff || student) && <CallOverlay />}
        {(staff || student) && <Haptics />}
        {(staff || student) && <ThemeColor />}
        {student ? <AppBadge count={studentUnread + studentNotices.filter((n) => !n.read && !n.done).length} /> : staff ? <AppBadge count={chatCount + inboxCount} /> : null}
        </CallProvider>
      </body>
    </html>
  );
}
