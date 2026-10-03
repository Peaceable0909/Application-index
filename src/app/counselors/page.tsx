import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { loadPeople } from '@/lib/people';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { loadStudents } from '@/lib/overview';
import { counselorKey } from '@/lib/docs';
import { ago, initials } from '@/lib/format';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import { addCounselor, saveCounselor, sendDigest } from '../actions';

export default async function Counselors({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const people = await loadPeople();
  await requireTeam();
  const sp = await searchParams;
  const db = admin();
  const [{ rows }, { data: counselors }, { data: msgs }] = await Promise.all([
    loadStudents(),
    db.from('portal_counselors').select('*').order('name'),
    db.from('portal_messages').select('counselor_name,created_at').eq('to_kind', 'counselor').order('created_at', { ascending: false }).limit(300),
  ]);
  const live = rows.filter((r) => !(r.a.status && ['Enrolled', 'Rejected', 'Withdrawn'].includes(r.a.status)));
  const unassigned = live.filter((r) => !r.a.counselor).length;

  return (
    <>
      <div className="head"><h1>Counselors</h1></div>
      <p className="sub">Who handles which students, their email, and a one-click summary of what needs attention.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}
      {unassigned > 0 && <div className="card gold"><b>{unassigned} student{unassigned === 1 ? '' : 's'} have no counselor.</b> <Link href="/applications?counselor=__none">Assign them →</Link></div>}

      <div className="grid g3">
        {(counselors || []).map((c, i) => {
          const mine = rows.filter((r) => counselorKey(r.a.counselor) === c.name_key);
          const liveMine = mine.filter((r) => live.includes(r));
          const attention = liveMine.filter((r) => r.reasons.length).length, missing = liveMine.filter((r) => r.judged && r.missing.length).length;
          const last = (msgs || []).find((m) => m.counselor_name === c.name);
          return (
            <div key={c.id} className="card rise" style={{ '--i': i } as React.CSSProperties}>
              <div className="who-c" style={{ marginBottom: 14 }}><Avatar name={c.name} url={people.get((c.email || '').toLowerCase())?.avatar_url} color={people.get((c.email || '').toLowerCase())?.color} size={44} /><div><b style={{ fontSize: 16 }}>{c.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{c.active ? 'Active' : 'Inactive'}{last ? ` · last emailed ${ago(last.created_at)}` : ''}</div></div></div>
              <div className="grid g3" style={{ gap: 8, marginBottom: 14 }}>
                <div><div className="stat-l">Students</div><div className="stat" style={{ fontSize: 24 }}>{mine.length}</div></div>
                <div><div className="stat-l">Attention</div><div className={`stat ${attention ? 'warn' : ''}`} style={{ fontSize: 24 }}>{attention}</div></div>
                <div><div className="stat-l">Missing docs</div><div className="stat" style={{ fontSize: 24 }}>{missing}</div></div>
              </div>
              <form action={saveCounselor} className="grid" style={{ gap: 8 }}>
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="name" value={c.name} />
                <input name="email" type="email" defaultValue={c.email || ''} placeholder="counselor@example.com" className="wide" />
                <div className="filters" style={{ justifyContent: 'space-between' }}><label className="muted"><input type="checkbox" name="active" defaultChecked={c.active} /> active</label><Btn className="ghost sm">Save email</Btn></div>
              </form>
              <div className="filters" style={{ marginTop: 12 }}>
                <Link href={`/counselors/${encodeURIComponent(c.name_key)}`} className="btn sm"><Icon n="eye" size={14} /> Open board</Link>
                <Link href={`/applications?counselor=${encodeURIComponent(c.name)}`} className="btn ghost sm"><Icon n="users" size={14} /> Students</Link>
                <form action={sendDigest}><input type="hidden" name="id" value={c.id} /><Btn className="sm" disabled={!c.email || !attention}><Icon n="send" size={14} /> Send digest</Btn></form>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Add a counselor</h2>
        <form action={addCounselor} className="filters"><input name="name" placeholder="Name" required /><input name="email" type="email" placeholder="Email" /><Btn className="ghost">Add counselor</Btn></form>
        <p className="muted" style={{ marginBottom: 0 }}>Counselors found in your sheets appear here automatically — just add their email. “Send digest” emails them a list of their students that need attention.</p>
      </div>
    </>
  );
}
