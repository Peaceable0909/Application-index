import Link from 'next/link';
import { requireTeam } from '@/lib/auth';
import { loadStudents } from '@/lib/overview';
import { admin } from '@/lib/supabase';
import { schoolShort } from '@/lib/docs';
import { FINAL_STATUSES } from '@/lib/constants';
import { isPaid } from '@/lib/requests';
import { ago } from '@/lib/format';
import { bulkPaymentReminders } from '../actions';
import { SelectAll, SelectedCount } from '@/components/BulkSelect';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';

export const maxDuration = 60;
const DAY = 864e5;

export default async function Payments({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; msg?: string; err?: string }> }) {
  await requireTeam();
  const sp = await searchParams, db = admin();
  const { rows } = await loadStudents();
  const reg = rows.filter((r) => r.a.in_regent && !(r.a.status && ['Rejected', 'Withdrawn'].includes(r.a.status)));
  const paid = reg.filter((r) => isPaid(r.a.payment)), unpaid = reg.filter((r) => !isPaid(r.a.payment));
  const { data: sent } = await db.from('portal_messages').select('application_id, created_at').eq('to_kind', 'student').like('subject', 'Payment reminder%').order('created_at', { ascending: false }).limit(1000);
  const lastSent = new Map<string, string>(); (sent || []).forEach((m) => { if (m.application_id && !lastSent.has(m.application_id)) lastSent.set(m.application_id, m.created_at); });
  const q = (sp.q || '').toLowerCase(), view = sp.view || 'unpaid';
  const list = (view === 'paid' ? paid : view === 'all' ? reg : unpaid).filter((r) => !q || [r.a.name, r.a.email, r.a.opp_id, r.a.school].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => new Date(a.a.submitted_at || a.a.created_at).getTime() - new Date(b.a.submitted_at || b.a.created_at).getTime());
  const waiting = unpaid.filter((r) => Date.now() - new Date(r.a.submitted_at || r.a.created_at).getTime() > 14 * DAY).length;
  const noEmail = unpaid.filter((r) => !r.a.email).length;
  const pct = reg.length ? Math.round((paid.length / reg.length) * 100) : 0;
  const tab = (k: string, label: string, n: number) => <Link key={k} href={`/payments?view=${k}`} className={`tab ${view === k ? 'active' : ''}`}>{label}<span className="n">{n}</span></Link>;
  return (
    <>
      <div className="head"><h1>Payments</h1></div>
      <p className="sub">Regent Only students and whether their payment has come in.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="sc"><div className="ico green"><Icon n="check-circle" size={22} /></div><div className="lbl">Paid</div><div className="num">{paid.length}</div></div>
        <div className="sc"><div className="ico amber"><Icon n="alert" size={22} /></div><div className="lbl">Not paid yet</div><div className="num">{unpaid.length}</div></div>
        <div className="sc"><div className="ico red"><Icon n="clock" size={22} /></div><div className="lbl">Waiting over 2 weeks</div><div className="num">{waiting}</div></div>
        <div className="sc"><div className="lbl">Paid so far</div><div className="num">{pct}%</div><div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div></div>
      </div>
      <div className="tabs" style={{ marginTop: 0 }}>{tab('unpaid', 'Not paid', unpaid.length)}{tab('paid', 'Paid', paid.length)}{tab('all', 'All', reg.length)}</div>
      <form className="card toolbar filters" method="get"><input type="hidden" name="view" value={view} /><div className="search"><input name="q" placeholder="Search name, email or OPP ID…" defaultValue={sp.q} /></div><Btn>Search</Btn>{sp.q && <Link href={`/payments?view=${view}`} className="muted">Clear</Link>}</form>
      <form action={bulkPaymentReminders}>
        {view !== 'paid' && <div className="card filters bulkbar" style={{ padding: '12px 16px' }}><SelectedCount /><Btn className="sm" data-busy="Emailing students…"><Icon n="send" size={14} /> Send payment reminder</Btn><span className="muted" style={{ fontSize: 13 }}>Same wording for everyone, no amounts. Students reminded in the last 5 days are skipped.{noEmail ? ` ${noEmail} have no email.` : ''}</span></div>}
        <div className="card tablecard"><div className="scroll"><table className="mcards">
          <thead><tr><th style={{ width: 28 }}>{view !== 'paid' && <SelectAll />}</th><th>Student</th><th>University</th><th>OPP ID</th><th>Payment</th><th>Waiting</th><th>Last reminder</th></tr></thead>
          <tbody>
            {list.map((r, i) => { const a = r.a, since = a.submitted_at || a.created_at, days = Math.floor((Date.now() - new Date(since).getTime()) / DAY), ok = isPaid(a.payment); return (
              <tr key={a.application_id} className="row" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
                <td className="mc-sel">{!ok && <input type="checkbox" name="ids" value={a.application_id} aria-label={`Select ${a.name}`} />}</td>
                <td className="mc-name"><Link href={`/applications/${encodeURIComponent(a.application_id)}?tab=regent`}><b>{a.name}</b></Link><div className="muted">{a.email || 'no email'}</div></td>
                <td data-l="University">{schoolShort(a.school)}<div className="muted">{a.programme}</div></td>
                <td data-l="OPP ID">{a.opp_id ? a.opp_id.replace(/^OPP ID-/i, '') : <span className="muted">—</span>}</td>
                <td data-l="Payment"><span className={`badge ${ok ? 'green' : 'amber'}`}>{a.payment || 'Unpaid'}</span></td>
                <td data-l="Waiting">{ok ? <span className="muted">—</span> : <span className={days > 14 ? 'warn-t' : ''}>{days} day{days === 1 ? '' : 's'}</span>}</td>
                <td data-l="Last reminder" className="muted">{lastSent.get(a.application_id) ? ago(lastSent.get(a.application_id)!) : '—'}</td>
              </tr>); })}
            {!list.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 36 }}>{view === 'unpaid' ? 'Everyone in Regent Only has paid. 🎉' : 'Nothing here.'}</td></tr>}
          </tbody></table></div></div>
      </form>
    </>
  );
}
