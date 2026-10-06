import { redirect } from 'next/navigation';
import { currentStudent } from '@/lib/student';
import { currentStaff } from '@/lib/auth';
import { requestStudentCode, verifyStudentCode, signInWithGoogle } from '@/app/actions';
import Mark from '@/components/Mark';
import Btn from '@/components/Btn';

export default async function StudentLogin({ searchParams }: { searchParams: Promise<{ step?: string; email?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await currentStudent()) redirect('/student');
  if (await currentStaff()) redirect('/');
  const code = sp.step === 'code' && sp.email;
  return (
    <div className="auth">
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 14 }}><Mark size={46} /></div>
      <h1>Student <em>Portal</em></h1>
      <p className="muted" style={{ margin: 0 }}>{code ? 'Check your email for a 6-digit code.' : 'Track your application and upload your documents.'}</p>
      <div className="card">
        {sp.error && <div className="err" style={{ marginBottom: 14 }}>{sp.error}</div>}
        {code ? (
          <form action={verifyStudentCode} className="grid" style={{ gap: 12 }}>
            <input type="hidden" name="email" value={sp.email} />
            <div className="muted" style={{ fontSize: 13.5 }}>We sent a code to <b style={{ color: 'var(--ink)' }}>{sp.email}</b>. It can take a minute to arrive. Check your spam folder too.</div>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123456" required autoFocus className="wide codein" />
            <Btn className="wide-btn">Sign in</Btn>
            <a href="/student/login" className="muted" style={{ textAlign: 'center', fontSize: 13.5 }}>Use a different email or send a new code</a>
          </form>
        ) : (
          <>
            <form action={requestStudentCode} className="grid" style={{ gap: 12 }}>
              <label className="muted" style={{ fontSize: 13.5 }}>Use the email address you applied with</label>
              <input name="email" type="email" placeholder="you@example.com" required autoFocus className="wide" autoComplete="email" />
              <Btn className="wide-btn" data-busy="Sending code…">Email me a sign-in code</Btn>
            </form>
            <div className="or">or</div>
            <form action={signInWithGoogle}><Btn className="btn-google ghost" data-busy="Opening Google…">Continue with Google</Btn></form>
            <p className="muted" style={{ fontSize: 12.5, margin: '14px 0 0', textAlign: 'center' }}>No password to remember. Staff? <a href="/login">Sign in here</a>.</p>
          </>
        )}
      </div>
    </div>
  );
}
