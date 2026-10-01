import { requireStaff } from '@/lib/auth';
import Btn from '@/components/Btn';
import { admin } from '@/lib/supabase';
import Link from 'next/link';
import { addStaff, removeStaff } from '../actions';

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const [{ data: staff }] = await Promise.all([
    
    db.from('portal_staff').select('*').order('email'),
  ]);
  return (
    <>
      <h1>Settings</h1>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <div className="card">
        <h2>Counselors</h2>
        <p className="muted" style={{ marginTop: 0 }}>Counselor emails, assignments and digests now live on their own page.</p>
        <Link href="/counselors" className="btn ghost">Manage counselors →</Link>
      </div>

      <div className="card">
        <h2>Portal staff</h2>
        <table>
          <thead><tr><th>Email</th><th>Role</th><th /></tr></thead>
          <tbody>
            {(staff || []).map((s) => (
              <tr key={s.email}><td>{s.email}</td><td>{s.role}</td>
                <td>{me.role === 'admin' && s.email !== me.email && <form action={removeStaff}><input type="hidden" name="email" value={s.email} /><Btn className="ghost">Remove</Btn></form>}</td></tr>
            ))}
          </tbody>
        </table>
        {me.role === 'admin' ? (
          <form action={addStaff} className="filters" style={{ marginTop: 12 }}>
            <input name="email" type="email" placeholder="staff@example.com" required />
            <select name="role"><option value="staff">staff</option><option value="admin">admin</option></select>
            <Btn className="ghost">Allow access</Btn>
            <span className="muted">They also need a login created in Supabase Auth.</span>
          </form>
        ) : <p className="muted">Only admins can add staff.</p>}
      </div>
    </>
  );
}
