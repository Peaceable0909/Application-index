import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth';
import { sessionClient } from '@/lib/supabase';
import { signIn, signInWithGoogle, signOut } from '../actions';
import Mark from '@/components/Mark';
import Btn from '@/components/Btn';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await currentStaff()) redirect('/');
  const { data } = await (await sessionClient()).auth.getUser();
  const blocked = data.user?.email;
  return (
    <div className="auth">
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 14 }}><Mark size={46} /></div>
      <h1>Peaceable <em>Portal</em></h1>
      <p className="muted" style={{ margin: 0 }}>Sign in to manage applications.</p>
      <div className="card">
        {blocked && (
          <div className="err" style={{ marginBottom: 14 }}>
            {blocked} isn’t on the staff list. Ask an admin to add it in Settings.
            <form action={signOut} style={{ marginTop: 8 }}><Btn className="ghost sm">Sign out</Btn></form>
          </div>
        )}
        <form action={signInWithGoogle}>
          <Btn className="btn-google">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </Btn>
        </form>
        <div className="or">or</div>
        <form action={signIn} className="grid" style={{ gap: 10 }}>
          <input name="email" type="email" placeholder="Email" required className="wide" />
          <input name="password" type="password" placeholder="Password" required className="wide" />
          <Btn className="ghost wide-btn">Sign in with password</Btn>
          {error && <div className="err">{error}</div>}
        </form>
      </div>
    </div>
  );
}
