import Link from 'next/link';
import { requireStaff, canSee } from '@/lib/auth';
import { loadStudents } from '@/lib/overview';
import { PROGRESS, STATUSES, STALE_DAYS } from '@/lib/constants';
import { schoolShort } from '@/lib/docs';
import PipelineBoard, { PCard } from '@/components/PipelineBoard';
import Btn from '@/components/Btn';

export const maxDuration = 60;
const DAY = 864e5;

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ q?: string; counselor?: string; school?: string; closed?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const { rows } = await loadStudents();
  const mine = rows.filter((r) => canSee(staff, r.a.counselor));
  const counselors = [...new Set(mine.map((r) => r.a.counselor).filter(Boolean))].sort() as string[];
  const schools = [...new Set(mine.map((r) => schoolShort(r.a.school)).filter(Boolean))].sort();
  const q = (sp.q || '').toLowerCase();
  const now = Date.now();
  const cards: PCard[] = mine
    .filter((r) => (!sp.counselor || (sp.counselor === '__none' ? !r.a.counselor : r.a.counselor === sp.counselor)) && (!sp.school || schoolShort(r.a.school) === sp.school) && (!q || [r.a.name, r.a.email, r.a.programme].some((v) => v?.toLowerCase().includes(q))))
    .map((r) => ({
      id: r.a.application_id, name: r.a.name, school: schoolShort(r.a.school), programme: r.a.programme && r.a.programme.toUpperCase() !== 'N/A' ? r.a.programme : '',
      status: r.a.status, counselor: r.a.counselor, missing: r.missing.length, judged: r.judged,
      unpaid: r.a.in_regent && !/^paid/i.test(r.a.payment || ''), stale: r.a.in_master && now - new Date(r.a.last_activity_at).getTime() > STALE_DAYS * DAY,
      deadlineLeft: r.a.deadline ? Math.ceil((new Date(r.a.deadline + 'T23:59:59').getTime() - now) / DAY) : null,
    }));
  const main = Object.keys(PROGRESS), extra = STATUSES.filter((s) => !main.includes(s));
  const stages = sp.closed ? [...main, ...extra] : [...main, 'Awaiting CAS', 'CAS Request'].filter((s) => STATUSES.includes(s as never));
  const hidden = cards.filter((c) => c.status && !stages.includes(c.status)).length;
  return (
    <>
      <div className="head"><h1>Pipeline</h1><span className="badge plain">{cards.length} students</span></div>
      <p className="sub">Every student by stage. Drag a card to move them forward.</p>
      <form className="card toolbar filters" method="get">
        <div className="search"><input name="q" placeholder="Search students…" defaultValue={sp.q} /></div>
        {staff.role !== 'counselor' && <select name="counselor" defaultValue={sp.counselor || ''}><option value="">All counselors</option><option value="__none">(unassigned)</option>{counselors.map((c) => <option key={c}>{c}</option>)}</select>}
        <select name="school" defaultValue={sp.school || ''}><option value="">All universities</option>{schools.map((c) => <option key={c}>{c}</option>)}</select>
        <label><input type="checkbox" name="closed" value="1" defaultChecked={!!sp.closed} /> show Rejected / Withdrawn</label>
        <Btn>Apply</Btn>{(sp.q || sp.counselor || sp.school || sp.closed) && <Link href="/pipeline" className="muted">Clear</Link>}
      </form>
      {hidden > 0 && <p className="muted">{hidden} student{hidden === 1 ? ' is' : 's are'} Rejected or Withdrawn (hidden). Tick “show Rejected / Withdrawn” to see them.</p>}
      <PipelineBoard cards={cards} stages={stages} />
    </>
  );
}
