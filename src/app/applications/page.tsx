import Link from 'next/link';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { AppRow, isFormSubmission } from '@/lib/attention';
import { loadStudents } from '@/lib/overview';
import { filterRows, viewPredicates } from '@/lib/filters';
import { REQUIRED_DOCS, STATUSES } from '@/lib/constants';
import { bulkAddToMaster, bulkAssign, bulkEmailCounselors, bulkSetStatus, syncNow } from '../actions';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import { SelectAll, SelectedCount } from '@/components/BulkSelect';
import { statusTone } from '@/lib/ui';

export const maxDuration = 60;

type SP = Record<string, string | undefined>;
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireTeam();
  const sp = await searchParams;
  const [{ rows }, { data: counselorList }] = await Promise.all([
    loadStudents({ dups: !!sp.dups }),
    admin().from('portal_counselors').select('name').eq('active', true).order('name'),
  ]);
  const base = rows.map((r) => r.a);
  const views = viewPredicates(staff.last_seen_at);
  const viewCount = (k: string) => rows.filter(views[k]).length;
  const filtered = filterRows(rows, sp, staff.last_seen_at);

  const options = (k: keyof AppRow) => uniq(base.map((a) => a[k] as string | null));
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !['msg', 'err'].includes(k)) as [string, string][]).toString();
  const here = `/applications${exportQs ? `?${exportQs}` : ''}`;
  const countries = [...new Set(base.map((a) => (a.country || '').toLowerCase()).filter(Boolean))].sort();

  const hasFilters = Object.keys(sp).some((k) => !['msg', 'err'].includes(k) && sp[k]);

  return (
    <>
      <div className="head" style={{ justifyContent: 'space-between' }}>
        <h1>Applications</h1>
        <form action={syncNow} className="filters"><input type="hidden" name="returnTo" value="/applications" /><label className="muted"><input type="checkbox" name="full" value="1" /> full</label><Btn className="ghost">Sync now</Btn></form>
      </div>
      <p className="sub">{filtered.length === base.length ? `${base.length} students` : `${filtered.length} of ${base.length} students`} across both sheets.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <div className="tabs" style={{ marginTop: 0 }}>
        {[['', 'All', base.length], ['new', 'New since last visit', viewCount('new')], ['sheet1', 'Sheet1', viewCount('sheet1')], ['regent', 'Regent Only', viewCount('regent')], ['attention', 'Needs attention', viewCount('attention')], ['missing', 'Missing documents', viewCount('missing')], ['nofolder', 'No Drive folder', viewCount('nofolder')], ['notmaster', 'Not in Sheet1', viewCount('notmaster')]].map(([k, label, n]) => (
          <Link key={k as string} href={k ? `/applications?view=${k}` : '/applications'} className={`tab ${(sp.view || '') === k ? 'active' : ''}`}>{label}<span className="n">{n}</span></Link>
        ))}
      </div>

      <form className="card toolbar filters" method="get">
        {sp.view && <input type="hidden" name="view" value={sp.view} />}
        <div className="search"><input name="q" placeholder="Search students, email, school…" defaultValue={sp.q} /></div>
        <select name="counselor" defaultValue={sp.counselor || ''}><option value="">Counselor</option><option value="__none">(unassigned)</option>{options('counselor').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="school" defaultValue={sp.school || ''}><option value="">University</option>{options('school').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="programme" defaultValue={sp.programme || ''}><option value="">Programme</option>{options('programme').map((o) => <option key={o}>{o}</option>)}</select>
        <select name="country" defaultValue={sp.country || ''}><option value="">Country</option>{countries.map((o) => <option key={o} value={o}>{o.toUpperCase()}</option>)}</select>
        <select name="status" defaultValue={sp.status || ''}><option value="">Status</option><option value="__none">(no status)</option>{STATUSES.map((o) => <option key={o}>{o}</option>)}</select>
        <select name="source" defaultValue={sp.source || ''}>
          <option value="">All sources</option>
          <option value="sheet1">In Sheet1 — all ({viewCount('sheet1')})</option>
          <option value="regent">In Regent Only — all ({viewCount('regent')})</option>
          <option value="form">Submitted via form — all ({rows.filter((r) => isFormSubmission(r.a)).length})</option>
          <option value="both">In Sheet1 and form ({rows.filter((r) => r.a.in_master && isFormSubmission(r.a)).length})</option>
          <option value="sheet1_no_form">In Sheet1, no form ({rows.filter((r) => r.a.in_master && !isFormSubmission(r.a)).length})</option>
          <option value="no_sheet1">Not in Sheet1 ({viewCount('notmaster')})</option>
          <option value="no_regent">Not in Regent Only ({rows.filter((r) => !r.a.in_regent).length})</option>
        </select>
        <select name="payment" defaultValue={sp.payment || ''}><option value="">Payment</option><option value="paid">Paid</option><option value="unpaid">Not paid (Regent)</option></select>
        <select name="interview" defaultValue={sp.interview || ''}><option value="">Interview</option><option value="__none">(none set)</option>{uniq(base.map((a) => a.interview)).map((o) => <option key={o}>{o}</option>)}</select>
        <label><input type="checkbox" name="attention" value="1" defaultChecked={!!sp.attention} /> needs attention</label>
        <label><input type="checkbox" name="dups" value="1" defaultChecked={!!sp.dups} /> duplicates</label>
        <Btn>Apply</Btn>
        {hasFilters && <Link href="/applications" className="muted">Clear</Link>}
      </form>

      <form>
        <input type="hidden" name="returnTo" value={here} />
        <div className="card filters" style={{ padding: '12px 16px', position: 'sticky', top: 74, zIndex: 5 }}>
          <SelectedCount />
          <select name="setStatus" defaultValue=""><option value="" disabled>Set status…</option>{STATUSES.map((o) => <option key={o}>{o}</option>)}</select>
          <Btn className="sm" formAction={bulkSetStatus}>Apply</Btn>
          <span className="muted">|</span>
          <select name="setCounselor" defaultValue=""><option value="" disabled>Assign counselor…</option><option value="__clear">(unassign)</option>{(counselorList || []).map((c) => <option key={c.name}>{c.name}</option>)}</select>
          <Btn className="sm" formAction={bulkAssign}>Apply</Btn>
          <span className="muted">|</span>
          <Btn className="ghost sm" formAction={bulkEmailCounselors}><Icon n="mail" size={14} /> Email their counselors</Btn>
          {filtered.some(({ a }) => !a.in_master) && <><select name="addStatus" defaultValue="New Lead">{STATUSES.map((o) => <option key={o}>{o}</option>)}</select><Btn className="gold sm" formAction={bulkAddToMaster}>Add to Sheet1</Btn></>}
          <span style={{ marginLeft: 'auto' }} className="filters">
            <Btn className="ghost sm" formAction="/api/export" data-busy="Preparing file…"><Icon n="download" size={14} /> Export selected</Btn>
            <a className="btn ghost sm" href={`/api/export?${exportQs}`}><Icon n="download" size={14} /> Export all {filtered.length}</a>
          </span>
        </div>
        <div className="card tablecard">
          <div className="scroll">
            <table className="mcards">
              <thead><tr><th style={{ width: 28 }}><SelectAll /></th><th>Student</th><th>University / Programme</th><th>Counselor</th><th>Status</th><th>Regent</th><th>Documents</th><th>Attention</th><th>Submitted</th></tr></thead>
              <tbody>
                {filtered.map(({ a, missing, reasons, judged, have, submissions }, i) => (
                  <tr key={a.application_id} className="row" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
                    <td className="mc-sel"><input type="checkbox" name="ids" value={a.application_id} aria-label={`Select ${a.name}`} /></td>
                    <td className="mc-name"><Link href={`/applications/${a.application_id}`}><b>{a.name}</b></Link><div className="muted">{[a.email, a.phone].filter(Boolean).join(' · ')}</div>
                      {submissions > 1 && <span className="badge plain">{submissions} submissions</span>}</td>
                    <td data-l="University">{a.school}<div className="muted">{a.programme}</div></td>
                    <td data-l="Counselor">{a.counselor || <span className="muted">—</span>}</td>
                    <td data-l="Status">{a.status ? <span className={`badge plain tone-${statusTone(a.status)}`}>{a.status}</span> : <span className="muted">—</span>}
                      {a.progress != null && <div className="bar" title={`${a.progress}%`}><i style={{ width: `${a.progress}%` }} /></div>}</td>
                    <td data-l="Regent">{a.in_regent ? <div className="chips">{a.opp_id && <span className="badge plain" title="OPP ID">{a.opp_id.replace(/^OPP ID-/i, '')}</span>}
                      {a.payment ? <span className={`badge ${/^paid/i.test(a.payment) ? 'green' : 'amber'}`}>{a.payment}</span> : <span className="badge amber">Unpaid</span>}
                      {a.interview && <span className="badge plain">{a.interview}</span>}</div> : <span className="muted">—</span>}</td>
                    <td data-l="Documents">{judged ? (
                      <Link href={`/applications/${a.application_id}?tab=documents`} style={{ textDecoration: 'none' }} title={missing.length ? `Missing: ${missing.join(', ')}` : 'All required documents present'}>
                        <div className="dots">{REQUIRED_DOCS.map((d) => <i key={d} className={have.has(d) ? 'on' : ''} title={d} />)}</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{REQUIRED_DOCS.length - missing.length}/{REQUIRED_DOCS.length} documents{missing.length ? ` · needs ${missing.slice(0, 2).join(', ')}${missing.length > 2 ? '…' : ''}` : ''}</div>
                      </Link>
                    ) : <Link href={`/applications/${a.application_id}?tab=documents`} className="muted" style={{ fontSize: 12.5 }}>No Drive folder · link one →</Link>}</td>
                    <td data-l="Needs"><div className="chips">{reasons.map((r) => <span key={r} className="badge red">{r}</span>)}</div></td>
                    <td data-l="Submitted">{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString('en-GB') : ''}</td>
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
