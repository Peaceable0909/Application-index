import './globals.css';
import Link from 'next/link';
import { Inter, Instrument_Serif } from 'next/font/google';
import { currentStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { appIdsFor } from '@/lib/auth';
import Mark from '@/components/Mark';
import Nav from '@/components/Nav';
import TopSearch from '@/components/TopSearch';
import Bell from '@/components/Bell';
import UserMenu from '@/components/UserMenu';
import NavProgress from '@/components/NavProgress';
import MobileMenu from '@/components/MobileMenu';

const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });

export const metadata = { title: 'Peaceable Portal', description: 'Applications, documents and counselors in one place.' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  let taskCount = 0, chatCount = 0;
  if (staff) {
    const q = admin().from('portal_tasks').select('id', { count: 'exact', head: true }).eq('status', 'open');
    chatCount = (await admin().from('portal_chat').select('id', { count: 'exact', head: true }).eq('to_email', staff.email).is('read_at', null)).count || 0;
    taskCount = (staff.role === 'counselor' ? await q.in('application_id', await appIdsFor(staff.counselor_key)) : await q).count || 0;
  }
  return (
    <html lang="en" className={`${ui.variable} ${display.variable}`}>
      <body>
        <div className="splash" aria-hidden>
          <div className="splash-in"><Mark draw /><div className="splash-word">Peaceable <em>Portal</em></div><div className="splash-line" /></div>
        </div>
        <NavProgress />
        {staff ? (
          <div className="shell">
            <aside className="side">
              <Link href="/" className="brand"><Mark size={36} inverse /><span><b>Peaceable <em>Portal</em></b><small>Application Portal</small></span></Link>
              <Nav taskCount={taskCount} chatCount={chatCount} role={staff.role} />
              <div className="tag">More opportunities.<br />Brighter futures.</div>
            </aside>
            <div className="maincol">
              <header className="topbar"><MobileMenu /><TopSearch /><div className="topright"><Bell staff={staff} /><UserMenu staff={staff} /></div></header>
              <main>{children}</main>
            </div>
          </div>
        ) : <main style={{ maxWidth: 'none' }}>{children}</main>}
      </body>
    </html>
  );
}
