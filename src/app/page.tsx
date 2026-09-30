import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { attentionReasons, AppRow } from '@/lib/attention';
import { missingDocs } from '@/lib/docs';
import { STATUSES } from '@/lib/constants';
import { syncNow } from './actions';

type SP = Record<string, string | undefined>;
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const [{ data: apps }, { data: docs }] = await Promise.all([
    db.from('portal_applications')
      .select('application_id,name,email,school,programme,country,counselor,status,submitted_at,last_activity_at,student_key')
      .order('submitted_at', { ascending: false, nullsFirst: false }).limit(5000),
    db.from('portal_documents').select('application_id,doc_type').limit(50000),
  ]);
  const all = (apps || []) as AppRow[];

  // Documents are pooled per student so duplicate submissions don't look "missing".
  const appToKey = new Map(all.map((a) => [a.application_id, a.student_key]));
  const typesByKey = new Map<string, Set<string>>();
  const countByKey = new Map<string, number>();
  (docs || []).forEach((d) => {
    const k = appToKey.get(d.application_id); if (!k) return;
    (typesByKey.get(k) || typesByKey.set(k, new Set()).get(k)!).add(d.doc_type);
    countByKey.set(k, (countByKey.get(k) || 0) + 1);
  });
  const dupCount = new Map<string, number>();
  all.forEach((a) => dupCount.set(a.student_key, (dupCount.get(a.student_key) || 0) + 1));

  // Newest submission per student unless "show duplicates" is ticked.
  const seen = new Set<string>();
  const base = sp.dups ? all : all.filter((a) => (seen.has(a.student_key) ? false : (seen.add(a.student_key), true)));

  const rows = base.map((a) => {
    const missing = missingDocs(typesByKey.get(a.student_key) || []);
    const reasons = attentionReasons(a, missing, countByKey.get(a.student_key) || 0);
    return { a, missing, reasons };
  });

  const q = (sp.q || '').toLowerCase();
  const filtered = rows.filter(({ a, reasons }) =>
    (!q || [a.name, a.email, a.school, a.programme].some((v) => v?.toLowerCase().includes(q))) &&
    (!sp.counselor || a.counselor === sp.counselor) && (!sp.country || a.country?.toLowerCase() === sp.country.toLowerCase()) &&
    (!sp.school || a.school === sp.school) && (!sp.programme || a.programme === sp.programme) &&
    (!sp.status || (sp.status === '__none' ? !a.status : a.status === sp.status)) &&
    (!sp.attention || reasons.length > 0));

  const attentionTotal = rows.filter((r) => r.reasons.length).length;
  const options = (k: keyof AppRow) => uniq(base.map((a) => a[k] as string | null));
  const countries = [...new Set(base.map((a) => (a.country || '').toLowerCase()).filter(Boolean))].sort();

  return (
    <>
      <h1>Applications</h1>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      <div className="grid g4">
        <div className="card"><div className="muted">Students</div><div className="stat">{base.length}</div></div>
        <div className="card"><div className="muted">Need attention</div><div className="stat" style={{ color: 'var(--red)' }}>{attentionTotal}</div></div>
        <div className="card"><div className="muted">No status yet</div><div className="stat">{base.filter((a) => !a.status).length}</div></div>
        <div className="card">
          <form action={syncNow} className="filters">
            <button>Sync now</button>
            <label><input type="checkbox" name="full" value="1" /> full (all docs)</label>
          </form>
        </div>
      </div>

      <form className="card filters" method="get">
        <input name="q" placeholder="Search name, email, school, programme" defaultValue={sp.q} style={{ minWidth: 260 }} />
        <select name="counselor" defaultValue={sp.counselor || ''}><option value="">All counselors</option>{options('counselor').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="school" defaultValue={sp.school || ''}><option value="">All universities</option>{options('school').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="programme" defaultValue={sp.programme || ''}><option value="">All programmes</option>{options('programme').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="country" defaultValue={sp.country || ''}><option value="">All countries</option>{countries.map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}</select>
        <select name="status" defaultValue={sp.status || ''}><option value="">All statuses</option><option value="__none">(no status)</option>{STATUSES.map((o) => <option key={o}>{o}</option>)}</select>
        <label><input type="checkbox" name="attention" value="1" defaultChecked={!!sp.attention} /> needs attention</label>
        <label><input type="checkbox" name="dups" value="1" defaultChecked={!!sp.dups} /> show duplicate submissions</label>
        <button>Filter</button> <Link href="/">Reset</Link>
      </form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Student</th><th>University / Programme</th><th>Counselor</th><th>Status</th><th>Documents</th><th>Attention</th><th>Submitted</th></tr></thead>
          <tbody>
            {filtered.map(({ a, missing, reasons }) => (
              <tr key={a.application_id} className="row">
                <td><Link href={`/applications/${a.application_id}`}><b>{a.name}</b></Link><div className="muted">{a.email}</div>
                  {dupCount.get(a.student_key)! > 1 && <span className="badge">{dupCount.get(a.student_key)} submissions</span>}</td>
                <td>{a.school}<div className="muted">{a.programme}</div></td>
                <td>{a.counselor || <span className="muted">—</span>}</td>
                <td>{a.status ? <span className="badge">{a.status}</span> : <span className="muted">—</span>}</td>
                <td>{missing.length === 0 ? <span className="badge green">Complete</span> : <span className="badge amber" title={missing.join(', ')}>Missing {missing.length}</span>}</td>
                <td>{reasons.map((r) => <span key={r} className="badge red" style={{ marginRight: 4 }}>{r}</span>)}</td>
                <td className="muted">{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString('en-GB') : ''}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={7} className="muted">No applications match. If this is a new install, press “Sync now”.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
