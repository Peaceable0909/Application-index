import { requireStaff } from '@/lib/auth';
import Btn from '@/components/Btn';
import { admin } from '@/lib/supabase';
import { addCounselor, addStaff, removeStaff, saveCounselor } from '../actions';

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const [{ data: counselors }, { data: staff }] = await Promise.all([
    db.from('portal_counselors').select('*').order('name'),
    db.from('portal_staff').select('*').order('email'),
  ]);
  return (
    <>
      <h1>Settings</h1>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <div className="card">
        <h2>Counselor emails</h2>
        <p className="muted">Counselors found in the sheet appear here automatically. Add each one’s email so you can message them about their students.</p>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Active</th><th /></tr></thead>
          <tbody>
            {(counselors || []).map((c) => (
              <tr key={c.id}>
                <td colSpan={4} style={{ padding: 0 }}>
                  <form action={saveCounselor} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px' }}>
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="name" value={c.name} />
                    <b style={{ width: 180 }}>{c.name}</b>
                    <input name="email" type="email" defaultValue={c.email || ''} placeholder="counselor@example.com" style={{ flex: 1 }} />
                    <label><input type="checkbox" name="active" defaultChecked={c.active} /> active</label>
                    <Btn>Save</Btn>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addCounselor} className="filters" style={{ marginTop: 12 }}>
          <input name="name" placeholder="New counselor name" required />
          <input name="email" type="email" placeholder="email" />
          <Btn className="ghost">Add counselor</Btn>
        </form>
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
