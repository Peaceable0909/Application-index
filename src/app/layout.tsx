import './globals.css';
import Link from 'next/link';
import { currentStaff } from '@/lib/auth';
import { signOut } from './actions';

export const metadata = { title: 'WhiteRock Portal' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  return (
    <html lang="en">
      <body>
        {staff && (
          <header className="top">
            <Link href="/" className="brand">WhiteRock Portal</Link>
            <Link href="/">Applications</Link>
            <Link href="/settings">Settings</Link>
            <span className="sp" />
            <span>{staff.email}</span>
            <form action={signOut}><button className="ghost">Sign out</button></form>
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
