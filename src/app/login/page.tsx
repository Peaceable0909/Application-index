import { signIn } from '../actions';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 380, margin: '80px auto' }}>
      <h1>Staff sign in</h1>
      <form action={signIn} className="grid">
        <input name="email" type="email" placeholder="Email" required className="wide" />
        <input name="password" type="password" placeholder="Password" required className="wide" />
        <button>Sign in</button>
        {error && <div className="err">{error}</div>}
      </form>
    </div>
  );
}
