import Link from 'next/link';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { STATUSES } from '@/lib/constants';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import { createApplication } from '../../actions';

export const maxDuration = 60;

export default async function NewApplication({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireTeam();
  const sp = await searchParams;
  const { data: counselors } = await admin().from('portal_counselors').select('name').eq('active', true).order('name');
  const f = (label: string, input: React.ReactNode) => <label className="grid" style={{ gap: 6 }}><span className="muted">{label}</span>{input}</label>;
  return (
    <>
      <Link href="/applications" className="crumb"><Icon n="left" size={15} /> Back to Applications</Link>
      <div className="head"><h1>Add a new application</h1></div>
      <p className="sub">Adds the student as a new row at the bottom of Sheet1 and opens their record here.</p>
      {sp.err && <div className="card err">{sp.err}</div>}
      <div className="card" style={{ maxWidth: 820 }}>
        <form action={createApplication} className="grid g2" style={{ gap: 16 }}>
          {f('Full name *', <input name="name" required />)}
          {f('Email', <input name="email" type="email" />)}
          {f('Phone', <input name="phone" />)}
          {f('University', <input name="school" list="schools" placeholder="e.g. RCL" /> )}
          <datalist id="schools"><option value="RCL" /><option value="CCCU" /><option value="BPP University" /><option value="York St John University" /></datalist>
          {f('Programme', <input name="programme" />)}
          {f('Country', <input name="country" defaultValue="Nigeria" />)}
          {f('City', <input name="city" />)}
          {f('Gender', <select name="gender"><option value="">—</option><option>Male</option><option>Female</option></select>)}
          {f('Date of birth', <input name="dob" type="date" />)}
          {f('Age', <input name="age" />)}
          {f('Counselor', <select name="counselor"><option value="">Unassigned</option>{(counselors || []).map((c) => <option key={c.name}>{c.name}</option>)}</select>)}
          {f('Status', <select name="status" defaultValue="New Lead">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>)}
          <div style={{ gridColumn: '1 / -1' }}><Btn className="primary lg">Add to Sheet1</Btn></div>
        </form>
      </div>
    </>
  );
}
