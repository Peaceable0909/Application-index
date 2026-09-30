import { currentStaff } from '@/lib/auth';
import { sessionClient } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { signIn, signInWithGoogle, signOut } from '../actions';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await currentStaff()) redirect('/');
  const { data } = await (await sessionClient()).auth.getUser();
  const blocked = data.user?.email;
  return (
    <div className="card" style={{ maxWidth: 380, margin: '80px auto' }}>
      <h1>Staff sign in</h1>
      {blocked && (
        <div className="err" style={{ marginBottom: 12 }}>
          {blocked} is not on the staff list. Ask an admin to add it in Settings.
          <form action={signOut}><button className="ghost" style={{ marginTop: 8 }}>Sign out</button></form>
        </div>
      )}
      <form action={signInWithGoogle}><button style={{ width: '100%' }}>Continue with Google</button></form>
      <p className="muted" style={{ textAlign: 'center' }}>or</p>
      <form action={signIn} className="grid">
        <input name="email" type="email" placeholder="Email" required className="wide" />
        <input name="password" type="password" placeholder="Password" required className="wide" />
        <button className="ghost">Sign in with password</button>
        {error && <div className="err">{error}</div>}
      </form>
    </div>
  );
}
