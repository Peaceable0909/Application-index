import { redirect } from 'next/navigation';
import { staffGate } from '@/lib/auth';
import { signOut } from '../../actions';
import { verifyTwoStep } from '../../twoStepActions';
import Logo from '@/components/Logo';
import Btn from '@/components/Btn';

export const metadata = { title: 'Enter your code', robots: { index: false, follow: false } };

export default async function Verify({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const g = await staffGate();
  if (g.state === 'ok') redirect('/');
  if (g.state === 'expired') redirect('/auth/expired');
  if (g.state === 'enroll') redirect('/login/setup');
  if (g.state !== 'needs2fa') redirect('/login');
  return (
    <div className="auth">
      <div className="auth-logo"><Logo height={46} /></div>
      <div className="auth-co">Educational Services</div>
      <h1>Enter your <em>code</em></h1>
      <p className="muted" style={{ margin: 0 }}>Open your authenticator app and type the 6 numbers it shows for WhiteRock.</p>
      <div className="card">
        <form action={verifyTwoStep} className="grid" style={{ gap: 10 }}>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="6-digit code" required autoFocus className="wide" style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
          <Btn className="wide-btn" data-busy="Checking…">Continue</Btn>
          {error && <div className="err">{error}</div>}
        </form>
        <form action={signOut} style={{ marginTop: 12 }}><Btn className="ghost sm">Sign out</Btn></form>
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 12.5 }}>Lost your phone? Ask an admin to reset your two-step sign-in.</p>
      </div>
      <p className="auth-foot">© {new Date().getFullYear()} WhiteRock Educational Services · Team portal</p>
    </div>
  );
}
