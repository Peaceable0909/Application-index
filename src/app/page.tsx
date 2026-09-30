import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { attentionReasons, AppRow } from '@/lib/attention';
import { missingDocs } from '@/lib/docs';
import { STATUSES } from '@/lib/constants';
import { bulkAddToMaster, syncNow } from './actions';
import Btn from '@/components/Btn';
import { statusTone } from '@/lib/ui';

export const maxDuration = 60;

type SP = Record<string, string | undefined>;
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const [{ data: apps }, { data: docs }] = await Promise.all([
    db.from('portal_applications')
      .select('application_id,name,email,school,programme,country,counselor,status,submitted_at,last_activity_at,student_key,in_master,has_raw,progress,in_regent,payment,interview,opp_id')
      .order('submitted_at', { ascending: false, nullsFirst: false }).limit(5000),
    db.from('portal_documents').select('application_id,doc_type,type_override').limit(50000),
  ]);
  const all = (apps || []) as AppRow[];

  // Documents are pooled per student so duplicate submissions don't look "missing".
  const appToKey = new Map(all.map((a) => [a.application_id, a.student_key]));
  const typesByKey = new Map<string, Set<string>>();
  const countByKey = new Map<string, number>();
  (docs || []).forEach((d) => {
    const k = appToKey.get(d.application_id); if (!k) return;
    (typesByKey.get(k) || typesByKey.set(k, new Set()).get(k)!).add(d.type_override || d.doc_type);
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
    (!sp.source || (sp.source === 'raw_only' ? !a.in_master : sp.source === 'master_only' ? !a.has_raw : a.in_master && a.has_raw)) &&
    (!sp.regent || (sp.regent === 'in' ? a.in_regent : sp.regent === 'paid' ? /paid/i.test(a.payment || '') && !/un|not/i.test(a.payment || '')
      : sp.regent === 'unpaid' ? a.in_regent && !/^paid/i.test(a.payment || '') : /to be booked/i.test(a.interview || ''))) &&
    (!sp.attention || reasons.length > 0));

  const attentionTotal = rows.filter((r) => r.reasons.length).length;
  const options = (k: keyof AppRow) => uniq(base.map((a) => a[k] as string | null));
  const countries = [...new Set(base.map((a) => (a.country || '').toLowerCase()).filter(Boolean))].sort();

  const hasFilters = Object.keys(sp).some((k) => !['msg', 'err'].includes(k) && sp[k]);

  return (
    <>
      <div className="head"><h1>Applications</h1></div>
      <p className="sub">{filtered.length === base.length ? `${base.length} students` : `${filtered.length} of ${base.length} students`} across both sheets.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card rise" style={{ '--i': 0 } as React.CSSProperties}><div className="stat-l">Students</div><div className="stat">{base.length}</div></div>
        <Link href="/?attention=1" className="card rise" style={{ '--i': 1, textDecoration: 'none' } as React.CSSProperties}><div className="stat-l">Need attention</div><div className="stat warn">{attentionTotal}</div></Link>
        <Link href="/?status=__none" className="card rise" style={{ '--i': 2, textDecoration: 'none' } as React.CSSProperties}><div className="stat-l">No status yet</div><div className="stat">{base.filter((a) => !a.status).length}</div></Link>
        <div className="card rise" style={{ '--i': 3 } as React.CSSProperties}>
          <div className="stat-l">Data</div>
          <form action={syncNow} className="filters" style={{ marginTop: 12 }}>
            <Btn>Sync now</Btn>
            <label className="muted"><input type="checkbox" name="full" value="1" /> full</label>
          </form>
        </div>
      </div>

      <form className="card toolbar filters" method="get">
        <div className="search"><input name="q" placeholder="Search students, email, school…" defaultValue={sp.q} /></div>
        <select name="counselor" defaultValue={sp.counselor || ''}><option value="">Counselor</option>{options('counselor').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="school" defaultValue={sp.school || ''}><option value="">University</option>{options('school').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="programme" defaultValue={sp.programme || ''}><option value="">Programme</option>{options('programme').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="country" defaultValue={sp.country || ''}><option value="">Country</option>{countries.map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}</select>
        <select name="status" defaultValue={sp.status || ''}><option value="">Status</option><option value="__none">(no status)</option>{STATUSES.map((o) => <option key={o}>{o}</option>)}</select>
        <select name="regent" defaultValue={sp.regent || ''}><option value="">Regent</option><option value="in">In Regent Only</option><option value="paid">Paid</option><option value="unpaid">In Regent, not paid</option><option value="interview">Interview to book</option></select>
        <select name="source" defaultValue={sp.source || ''}><option value="">Source</option><option value="both">In both sheets</option><option value="raw_only">Form only</option><option value="master_only">Master sheet only</option></select>
        <label><input type="checkbox" name="attention" value="1" defaultChecked={!!sp.attention} /> needs attention</label>
        <label><input type="checkbox" name="dups" value="1" defaultChecked={!!sp.dups} /> duplicates</label>
        <Btn>Apply</Btn>
        {hasFilters && <Link href="/" className="muted">Clear</Link>}
      </form>

      <form action={bulkAddToMaster}>
        {filtered.some(({ a }) => !a.in_master && a.has_raw) && (
          <div className="card gold filters" style={{ padding: '14px 16px' }}>
            <b>Move form-only students into the master sheet</b>
            <span className="muted">tick rows, then</span>
            <select name="status" defaultValue="New Lead">{STATUSES.map((o) => <option key={o}>{o}</option>)}</select>
            <Btn className="gold">Add selected</Btn>
            <span className="muted">Up to 15 at a time · counselor comes from the form</span>
          </div>
        )}
        <div className="card tablecard">
          <div className="scroll">
            <table>
              <thead><tr><th style={{ width: 28 }} /><th>Student</th><th>University / Programme</th><th>Counselor</th><th>Status</th><th>Regent</th><th>Documents</th><th>Attention</th><th>Submitted</th></tr></thead>
              <tbody>
                {filtered.map(({ a, missing, reasons }, i) => (
                  <tr key={a.application_id} className="row" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
                    <td>{!a.in_master && a.has_raw && <input type="checkbox" name="ids" value={a.application_id} />}</td>
                    <td><Link href={`/applications/${a.application_id}`}><b>{a.name}</b></Link><div className="muted">{a.email}</div>
                      {dupCount.get(a.student_key)! > 1 && <span className="badge plain">{dupCount.get(a.student_key)} submissions</span>}</td>
                    <td>{a.school}<div className="muted">{a.programme}</div></td>
                    <td>{a.counselor || <span className="muted">—</span>}</td>
                    <td>{a.status ? <span className={`badge ${`tone-${statusTone(a.status)}`}`}>{a.status}</span> : <span className="muted">—</span>}
                      {a.progress != null && <div className="bar" title={`${a.progress}%`}><i style={{ width: `${a.progress}%` }} /></div>}</td>
                    <td>{a.in_regent ? <div className="chips">{a.opp_id && <span className="badge plain" title="OPP ID">{a.opp_id.replace(/^OPP ID-/i, '')}</span>}
                      {a.payment ? <span className={`badge ${/^paid/i.test(a.payment) ? 'green' : 'amber'}`}>{a.payment}</span> : <span className="badge amber">Unpaid</span>}
                      {a.interview && <span className="badge plain">{a.interview}</span>}</div> : <span className="muted">—</span>}</td>
                    <td>{missing.length === 0 ? <span className="badge green">Complete</span> : <span className="badge amber" title={missing.join(', ')}>Missing {missing.length}</span>}</td>
                    <td><div className="chips">{reasons.map((r) => <span key={r} className="badge red">{r}</span>)}</div></td>
                    <td className="muted">{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString('en-GB') : ''}</td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={9} className="muted" style={{ padding: 40, textAlign: 'center' }}>No applications match. If this is a new install, press “Sync now”.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </form>
    </>
  );
}
