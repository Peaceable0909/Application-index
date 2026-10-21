import { redirect } from 'next/navigation';
import { staffGate } from '@/lib/auth';
import { signOut } from '../../actions';
import Logo from '@/components/Logo';
import Btn from '@/components/Btn';
import TwoStepSetup from '@/components/TwoStepSetup';

export const metadata = { title: 'Set up two-step sign-in', robots: { index: false, follow: false } };

/** Shown when an admin has made the authenticator code compulsory and this person has not set it up yet. */
export default async function Setup() {
  const g = await staffGate();
  if (g.state === 'ok') redirect('/');
  if (g.state === 'expired') redirect('/auth/expired');
  if (g.state === 'needs2fa') redirect('/login/verify');
  if (g.state !== 'enroll') redirect('/login');
  return (
    <div className="auth">
      <div className="auth-logo"><Logo height={46} /></div>
      <div className="auth-co">Educational Services</div>
      <h1>Set up <em>two-step</em> sign-in</h1>
      <p className="muted" style={{ margin: 0 }}>Students’ passports and certificates are in here, so your admin now asks for a code from your phone as well as your usual sign-in. It takes about a minute.</p>
      <div className="card">
        <TwoStepSetup next="/" />
        <form action={signOut} style={{ marginTop: 14 }}><Btn className="ghost sm">Sign out</Btn></form>
      </div>
      <p className="auth-foot">© {new Date().getFullYear()} WhiteRock Educational Services · Team portal</p>
    </div>
  );
}
