import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { Staff } from '@/lib/auth';
import { counselorKey, schoolShort } from '@/lib/docs';
import { loadStudents } from '@/lib/overview';
import { REQUIRED_DOCS, FINAL_STATUSES } from '@/lib/constants';
import { IN_PROGRESS, ago, describeActivity, initials, shortDate } from '@/lib/format';
import { statusTone } from '@/lib/ui';
import { bulkRequestDocs, completeReminder, completeTask, grantCounselorAccess, revokeCounselorAccess, sendDigest, snoozeTask } from '@/app/actions';
import Icon from './Icon';
import Btn from './Btn';
import { firstWord, shownName } from '@/lib/profile';
import Avatar from './Avatar';

type SP = { view?: string; q?: string; msg?: string; err?: string };
const VIEWS = [['', 'All'], ['attention', 'Needs attention'], ['missing', 'Missing documents'], ['progress', 'In progress'], ['done', 'Finished']] as const;

/**
 * One counselor's workload: their students, what needs attention, their tasks and reminders.
 * mode "self"  = the counselor looking at their own board (sees nothing else in the portal).
 * mode "admin" = a team member looking at a counselor's board (adds digest + access controls).
 */
export default async function CounselorBoard({ staff, ckey, mode, basePath, sp }: { staff: Staff; ckey: string; mode: 'self' | 'admin'; basePath: string; sp: SP }) {
  const db = admin();
  const [{ rows }, { data: c }] = await Promise.all([loadStudents(), db.from('portal_counselors').select('*').eq('name_key', ckey).maybeSingle()]);
  const mine = rows.filter((r) => counselorKey(r.a.counselor) === ckey);
  const name = c?.name || mine[0]?.a.counselor || ckey;
  const ids = mine.map((r) => r.a.application_id);
  const today = new Date().toISOString().slice(0, 10);
  const isFinal = (s: string | null) => !!s && FINAL_STATUSES.includes(s);

  const [{ data: tasks }, { data: reminders }, { data: activity }, { data: access }] = await Promise.all([
    ids.length ? db.from('portal_tasks').select('*, portal_applications(name)').eq('status', 'open').in('application_id', ids).order('priority').order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as never[] }),
    ids.length ? db.from('portal_reminders').select('id,application_id,due_on,note,portal_applications(name)').eq('status', 'pending').in('application_id', ids).order('due_on').limit(6) : Promise.resolve({ data: [] as never[] }),
    ids.length ? db.from('portal_activity').select('id,kind,detail,created_at,application_id,portal_applications(name)').in('application_id', ids).order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as never[] }),
    c?.email ? db.from('portal_staff').select('role, display_name, avatar_url, color, title').eq('email', c.email.toLowerCase()).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const live = mine.filter((r) => !isFinal(r.a.status));
  const attention = live.filter((r) => r.reasons.length);
  const missing = live.filter((r) => r.judged && r.missing.length);
  const progress = live.filter((r) => r.a.status && IN_PROGRESS.includes(r.a.status));
  const due = (reminders || []).filter((r) => r.due_on <= today).length;

  const q = (sp.q || '').toLowerCase();
  const pred: Record<string, (r: (typeof mine)[number]) => boolean> = { attention: (r) => !isFinal(r.a.status) && r.reasons.length > 0, missing: (r) => !isFinal(r.a.status) && r.judged && r.missing.length > 0, progress: (r) => !!r.a.status && IN_PROGRESS.includes(r.a.status), done: (r) => isFinal(r.a.status) };
  const counts: Record<string, number> = { '': mine.length, attention: mine.filter(pred.attention).length, missing: mine.filter(pred.missing).length, progress: mine.filter(pred.progress).length, done: mine.filter(pred.done).length };
  const list = mine.filter((r) => (!sp.view || !pred[sp.view] || pred[sp.view](r)) && (!q || [r.a.name, r.a.email, r.a.programme, r.a.school].some((v) => v?.toLowerCase().includes(q))))
    .sort((x, y) => Number(y.reasons.length > 0) - Number(x.reasons.length > 0) || new Date(y.a.last_activity_at).getTime() - new Date(x.a.last_activity_at).getTime());
  const tabHref = (v: string) => `${basePath}${v ? `?view=${v}` : ''}`;
  const stat = (icon: string, tone: string, label: string, n: number, href?: string) => {
    const inner = (<><div className={`ico ${tone}`}><Icon n={icon} size={22} /></div><div className="lbl">{label}</div><div className="num">{n}</div></>);
    return href ? <Link href={href} className="sc rise">{inner}</Link> : <div className="sc rise">{inner}</div>;
  };

  return (
    <>
      {mode === 'admin' && <Link href="/counselors" className="crumb"><Icon n="left" size={15} /> Back to Counselors</Link>}
      <div className="head" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="sh">
          <Avatar name={mode === 'self' ? shownName(staff) : (access?.display_name || name)} url={mode === 'self' ? staff.avatar_url : access?.avatar_url} color={mode === 'self' ? staff.color : access?.color} size={76} />
          <div>
            {mode === 'self' && <div className="eyebrow">Welcome back, {firstWord(staff)}</div>}
            <h1>{mode === 'self' ? 'Your students' : name}</h1>
            <div className="meta">{mode === 'admin' ? `Counselor view${c?.email ? ` · ${c.email}` : ' · no email saved'}` : `${live.length} active student${live.length === 1 ? '' : 's'} assigned to you`}</div>
          </div>
        </div>
        {mode === 'admin' && c && (
          <div className="filters">
            {access?.role === 'counselor'
              ? <><span className="badge plain green">Has portal access</span><form action={revokeCounselorAccess}><input type="hidden" name="id" value={c.id} /><Btn className="ghost sm">Remove access</Btn></form></>
              : <form action={grantCounselorAccess}><input type="hidden" name="id" value={c.id} /><Btn className="ghost sm" disabled={!c.email}><Icon n="user-plus" size={14} /> Give portal access</Btn></form>}
            <form action={sendDigest}><input type="hidden" name="id" value={c.id} /><Btn className="sm" disabled={!c.email || !attention.length}><Icon n="send" size={14} /> Send digest</Btn></form>
          </div>
        )}
      </div>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      {missing.length > 0 && (
        <form action={bulkRequestDocs} className="card filters" style={{ padding: '12px 16px' }}>
          <input type="hidden" name="returnTo" value={basePath} />
          {missing.slice(0, 15).map((r) => <input key={r.a.application_id} type="hidden" name="ids" value={r.a.application_id} />)}
          <span style={{ flex: 1, minWidth: 200 }}><b style={{ color: 'var(--ink)' }}>{missing.length} student{missing.length === 1 ? ' is' : 's are'} missing documents.</b> <span className="muted">Email each one exactly what’s missing{missing.length > 15 ? ' (first 15 — run again for the rest)' : ''}.</span></span>
          <Btn data-busy="Emailing students…"><Icon n="send" size={14} /> Ask students for missing docs</Btn>
        </form>
      )}
      <div className="grid g5" style={{ margin: '20px 0 16px' }}>
        {stat('users', '', 'Active students', live.length)}
        {stat('alert', 'red', 'Need attention', attention.length, tabHref('attention'))}
        {stat('file', 'amber', 'Missing documents', missing.length, tabHref('missing'))}
        {stat('check-circle', 'green', 'In progress', progress.length, tabHref('progress'))}
        {stat('clock', 'purple', 'Reminders due', due)}
      </div>

      <div className="split">
        <div>
          <div className="tabs" style={{ marginTop: 0 }}>
            {VIEWS.map(([k, label]) => <Link key={k} href={tabHref(k)} className={`tab ${(sp.view || '') === k ? 'active' : ''}`}>{label}<span className="n">{counts[k]}</span></Link>)}
          </div>
          <form className="card toolbar filters" method="get">
            {sp.view && <input type="hidden" name="view" value={sp.view} />}
            <div className="search"><input name="q" placeholder="Search your students…" defaultValue={sp.q} /></div><Btn>Search</Btn>
            {sp.q && <Link href={tabHref(sp.view || '')} className="muted">Clear</Link>}
          </form>
          <div className="card tablecard"><div className="scroll"><table className="mcards">
            <thead><tr><th>Student</th><th>Programme</th><th>Status</th><th>Documents</th><th>Needs</th><th>Updated</th></tr></thead>
            <tbody>
              {list.map(({ a, have, missing: miss, judged, reasons }, i) => (
                <tr key={a.application_id} className="row" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
                  <td className="mc-name"><Link href={`/applications/${a.application_id}`}><div className="who-c"><span className="avatar sm">{initials(a.name)}</span><div><b>{a.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{a.email || a.phone || ''}</div></div></div></Link></td>
                  <td data-l="Programme">{a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : <span className="muted">—</span>}<div className="muted" style={{ fontSize: 12.5 }}>{schoolShort(a.school)}</div></td>
                  <td data-l="Status">{a.status ? <span className={`badge plain tone-${statusTone(a.status)}`}>{a.status}</span> : <span className="muted">—</span>}{a.progress != null && <div className="bar"><i style={{ width: `${a.progress}%` }} /></div>}</td>
                  <td data-l="Documents">{judged ? <div title={miss.length ? `Missing: ${miss.join(', ')}` : 'Complete'}><div className="dots">{REQUIRED_DOCS.map((d) => <i key={d} className={have.has(d) ? 'on' : ''} title={d} />)}</div><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{REQUIRED_DOCS.length - miss.length}/{REQUIRED_DOCS.length}{miss.length ? ` · needs ${miss.slice(0, 2).join(', ')}${miss.length > 2 ? '…' : ''}` : ''}</div>{miss.length > 0 && a.email && !isFinal(a.status) && <form action={bulkRequestDocs} style={{ marginTop: 6 }}><input type="hidden" name="returnTo" value={basePath} /><input type="hidden" name="ids" value={a.application_id} /><Btn className="ghost sm" data-busy="Emailing…">Remind student</Btn></form>}</div> : <span className="muted" style={{ fontSize: 12.5 }}>Not checked</span>}</td>
                  <td data-l="Needs"><div className="chips">{reasons.filter((r) => !/Not in master|No counselor/.test(r)).slice(0, 3).map((r) => <span key={r} className="badge plain red">{r}</span>)}</div></td>
                  <td data-l="Updated" className="muted" style={{ whiteSpace: 'nowrap' }}>{ago(a.last_activity_at)}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 36 }}>{mine.length ? 'No students match.' : 'No students are assigned yet.'}</td></tr>}
            </tbody>
          </table></div></div>
        </div>

        <div>
          <div className="card">
            <h2><Icon n="tasks" size={17} /> Tasks</h2>
            {!(tasks || []).length && <p className="muted" style={{ margin: 0 }}>Nothing needs doing right now.</p>}
            {(tasks || []).map((t) => (
              <div key={t.id} style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                <Link href={`/applications/${t.application_id}${t.kind === 'missing_docs' || t.kind === 'no_documents' ? '?tab=documents' : ''}`}>{t.title}</Link>{t.priority === 1 && <> <span className="badge plain red">high</span></>}
                <div className="filters" style={{ marginTop: 6, gap: 6 }}>
                  <form action={completeTask}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="returnTo" value={basePath} /><Btn className="sm">Done</Btn></form>
                  <form action={snoozeTask}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="days" value="1" /><input type="hidden" name="returnTo" value={basePath} /><Btn className="ghost sm">Snooze</Btn></form>
                </div>
              </div>
            ))}
          </div>
          {(reminders || []).length > 0 && (
            <div className="card">
              <h2><Icon n="clock" size={17} /> Reminders</h2>
              {(reminders || []).map((r) => {
                const nm = (r.portal_applications as unknown as { name: string } | null)?.name || 'Student';
                return (
                  <div key={r.id} className="filters" style={{ padding: '8px 0', borderTop: '1px solid var(--line)', flexWrap: 'nowrap' }}>
                    <div style={{ flex: 1 }}><Link href={`/applications/${r.application_id}`}>{nm}</Link>: {r.note}<div className="muted" style={{ fontSize: 12.5 }}>{r.due_on < today ? 'Overdue · ' : ''}{shortDate(r.due_on)}</div></div>
                    <form action={completeReminder}><input type="hidden" name="reminderId" value={r.id} /><input type="hidden" name="returnTo" value={basePath} /><Btn className="ghost sm">Done</Btn></form>
                  </div>
                );
              })}
            </div>
          )}
          <div className="card">
            <h2><Icon n="clock" size={17} /> Recent activity</h2>
            <ul className="feed">
              {(activity || []).map((a) => { const d = describeActivity(a.kind, a.detail as Record<string, string>); const nm = (a.portal_applications as unknown as { name: string } | null)?.name || 'Student';
                return <li key={a.id}><span className={`ico ${d.tone}`}><Icon n={d.icon} size={17} /></span><div><b>{d.title}</b><small>{nm}</small></div><time>{ago(a.created_at)}</time></li>; })}
              {!(activity || []).length && <li className="muted">No activity yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
