import './globals.css';
import Link from 'next/link';
import { Inter, Instrument_Serif } from 'next/font/google';
import { currentStaff } from '@/lib/auth';
import { signOut } from './actions';
import Mark from '@/components/Mark';
import Nav from '@/components/Nav';
import Btn from '@/components/Btn';

const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });

export const metadata = { title: 'Peaceable Portal', description: 'Applications, documents and counselors in one place.' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  return (
    <html lang="en" className={`${ui.variable} ${display.variable}`}>
      <body>
        <div className="splash" aria-hidden>
          <div className="splash-in">
            <Mark draw />
            <div className="splash-word">Peaceable <em>Portal</em></div>
            <div className="splash-line" />
          </div>
        </div>
        {staff && (
          <header className="top">
            <Link href="/" className="brand"><Mark size={28} /><span>Peaceable <em>Portal</em></span></Link>
            <Nav />
            <span className="sp" />
            <span className="who"><i>{staff.email[0]}</i><span>{staff.email}</span></span>
            <form action={signOut}><Btn className="ghost sm">Sign out</Btn></form>
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
