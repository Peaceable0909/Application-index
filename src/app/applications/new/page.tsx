import Link from 'next/link';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { STATUSES } from '@/lib/constants';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import { createApplication } from '../../actions';
import { getCatalog } from '@/lib/moveCatalog';

export const maxDuration = 60;

export default async function NewApplication({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireTeam();
  const sp = await searchParams;
  const [{ data: counselors }, catalog] = await Promise.all([admin().from('portal_counselors').select('name').eq('active', true).order('name'), getCatalog()]);
  const programmes = [...new Set(catalog.schools.flatMap((s) => s.programmes.map((p) => p.name)))].sort();
  const f = (label: string, input: React.ReactNode) => <label className="grid" style={{ gap: 6 }}><span className="muted">{label}</span>{input}</label>;
  return (
    <>
      <Link href="/applications" className="crumb"><Icon n="left" size={15} /> Back to Applications</Link>
      <div className="head"><h1>Add a student</h1></div>
      <p className="sub">Saves the student in the portal straight away, adds them to Sheet1 as well, and opens their record.</p>
      {sp.err && <div className="card err">{sp.err}</div>}
      <div className="card" style={{ maxWidth: 820 }}>
        <form action={createApplication} className="grid g2" style={{ gap: 16 }}>
          {f('Full name *', <input name="name" required autoFocus autoComplete="off" />)}
          {f('Email', <input name="email" type="email" autoComplete="off" />)}
          {f('Phone', <input name="phone" />)}
          {f('University', <input name="school" list="schools" placeholder="e.g. RCL" /> )}
          <datalist id="schools">{catalog.schools.map((s) => <option key={s.key} value={s.name} />)}</datalist>
          {f('Programme', <input name="programme" list="programmes" autoComplete="off" />)}
          <datalist id="programmes">{programmes.map((n) => <option key={n} value={n} />)}</datalist>
          {f('Country', <input name="country" defaultValue="Nigeria" />)}
          {f('City', <input name="city" />)}
          {f('Gender', <select name="gender"><option value="">—</option><option>Male</option><option>Female</option></select>)}
          {f('Date of birth', <input name="dob" type="date" />)}
          {f('Age', <input name="age" />)}
          {f('Counselor', <select name="counselor"><option value="">Unassigned</option>{(counselors || []).map((c) => <option key={c.name}>{c.name}</option>)}</select>)}
          {f('Status', <select name="status" defaultValue="New Lead">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>)}
          <label className="muted" style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="invite" value="1" style={{ width: 'auto' }} /> Email them an invitation to the student portal (needs an email address)</label>
          <div style={{ gridColumn: '1 / -1' }}><Btn className="primary lg">Add student</Btn></div>
        </form>
      </div>
    </>
  );
}
