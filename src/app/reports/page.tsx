import Link from 'next/link';
import { requireTeam } from '@/lib/auth';
import { buildReport, defaultRange } from '@/lib/reports';
import { buildFunnel, pct } from '@/lib/funnel';
import { workspacesFor } from '@/lib/workspace';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';

export const maxDuration = 60;

function Bars({ data, unit = '' }: { data: { label: string; n: number; sub?: string }[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return <div className="bars">{data.map((d) => <div key={d.label} className="bar-r"><span className="bl" title={d.label}>{d.label}</span><span className="bt"><i style={{ width: `${Math.max(2, (d.n / max) * 100)}%` }} /></span><span className="bn">{d.n}{unit}{d.sub ? <small>{d.sub}</small> : null}</span></div>)}</div>;
}

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const me = await requireTeam();
  const sp = await searchParams, d = defaultRange();
  const range = { from: /^\d{4}-\d{2}-\d{2}$/.test(sp.from || '') ? sp.from! : d.from, to: /^\d{4}-\d{2}-\d{2}$/.test(sp.to || '') ? sp.to! : d.to };
  const [r, fn] = await Promise.all([buildReport(range), workspacesFor(me).then((ws) => buildFunnel(range, ws.map((w) => w.key)))]);
  const t = fn.total;
  const qs = `from=${range.from}&to=${range.to}`;
  const csvLink = (kind: string) => <a className="btn ghost sm" href={`/api/reports?kind=${kind}&from=${range.from}&to=${range.to}`}><Icon n="download" size={13} /> CSV</a>;
  const csv = (kind: string) => <a className="btn ghost sm" href={`/api/reports?kind=${kind}&${qs}`}><Icon n="download" size={13} /> CSV</a>;
  const kpi = (icon: string, tone: string, label: string, n: string | number, sub?: string) => <div className="sc"><div className={`ico ${tone}`}><Icon n={icon} size={22} /></div><div className="lbl">{label}</div><div className="num">{n}</div>{sub && <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div>}</div>;
  return (
    <>
      <div className="head"><h1>Reports</h1></div>
      <p className="sub">How applications are moving, by university, counselor and month.</p>
      <form className="card toolbar filters" method="get">
        <label>From <input type="date" name="from" defaultValue={range.from} /></label><label>To <input type="date" name="to" defaultValue={range.to} /></label><Btn>Update</Btn>
        <Link href="/reports" className="muted">Last 12 months</Link>
      </form>
      <div className="card">
        <div className="filters" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>From chat to enrolment</h2>{csvLink('funnel_country')}</div>
        <p className="muted" style={{ marginTop: 4 }}>People who started a chat on the website, and students who applied, in this period, followed to where they are now. “Reached an offer” counts a student once they have had an offer, even if they were rejected or withdrew later.</p>
        <Bars data={[
          { label: 'Chats started', n: t.chats },
          { label: 'Chats that became students', n: t.fromChats, sub: t.chats ? ` · ${pct(t.fromChats, t.chats)}% of chats` : '' },
          { label: 'Applications', n: t.students },
          { label: 'Reached an offer', n: t.offers, sub: t.students ? ` · ${pct(t.offers, t.students)}% of applications` : '' },
          { label: 'Enrolled', n: t.enrolled, sub: t.students ? ` · ${pct(t.enrolled, t.students)}% of applications` : '' },
        ]} />
        {fn.byWorkspace.length > 1 && (
          <div className="scroll" style={{ marginTop: 14 }}><table>
            <thead><tr><th>Country</th><th>Chats</th><th>Became students</th><th>Applications</th><th>Offers</th><th>Enrolled</th><th>Offer rate</th><th>Enrolment rate</th></tr></thead>
            <tbody>{fn.byWorkspace.map((w) => <tr key={w.key}><td><b>{w.name}</b></td><td>{w.chats}</td><td>{w.fromChats}{w.chats ? <span className="muted"> ({pct(w.fromChats, w.chats)}%)</span> : null}</td><td>{w.students}</td><td>{w.offers}</td><td>{w.enrolled}</td><td>{pct(w.offers, w.students)}%</td><td>{pct(w.enrolled, w.students)}%</td></tr>)}</tbody>
          </table></div>
        )}
        {fn.byCounselor.length > 0 && (
          <>
            <div className="filters" style={{ justifyContent: 'space-between', marginTop: 16 }}><b>By counselor</b>{csvLink('funnel_counselor')}</div>
            <div className="scroll"><table>
              <thead><tr><th>Counselor</th><th>Students</th><th>Reached an offer</th><th>Enrolled</th><th>Offer rate</th><th>Enrolment rate</th></tr></thead>
              <tbody>{fn.byCounselor.map((c) => <tr key={c.label}><td><b>{c.label}</b></td><td>{c.students}</td><td>{c.offers}</td><td>{c.enrolled}</td><td>{pct(c.offers, c.students)}%</td><td>{pct(c.enrolled, c.students)}%</td></tr>)}</tbody>
            </table></div>
          </>
        )}
      </div>
      <div className="grid g5" style={{ marginBottom: 16 }}>
        {kpi('users', '', 'Applications', r.total, 'in this period')}
        {kpi('trend', 'purple', 'Still active', r.active)}
        {kpi('check-circle', 'green', 'Enrolled', r.enrolled, `${r.conversion}% of applications`)}
        {kpi('file', 'amber', 'Documents complete', r.complete, `${r.incomplete} still missing some`)}
        {kpi('alert', 'red', 'Payments pending', r.unpaid, `${r.paid} paid (Regent)`)}
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card"><div className="filters" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Applications per month</h2>{csv('month')}</div><Bars data={r.byMonth} /></div>
        <div className="card"><div className="filters" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Where students are now</h2>{csv('stage')}</div><Bars data={r.funnel} /></div>
        <div className="card"><div className="filters" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>By university</h2>{csv('university')}</div>
          <Bars data={r.bySchool.map((s) => ({ label: s.label, n: s.total, sub: s.enrolled ? ` · ${s.enrolled} enrolled` : '' }))} /></div>
        <div className="card"><div className="filters" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>By counselor</h2>{csv('counselor')}</div>
          <div className="scroll"><table><thead><tr><th>Counselor</th><th>Students</th><th>Active</th><th>Enrolled</th><th>Attention</th></tr></thead><tbody>{r.byCounselor.map((c) => <tr key={c.label}><td><b>{c.label}</b></td><td>{c.total}</td><td>{c.active}</td><td>{c.enrolled}</td><td>{c.attention ? <span className="badge plain red">{c.attention}</span> : <span className="muted">0</span>}</td></tr>)}</tbody></table></div></div>
      </div>
      <div className="card"><h2>Average time in each stage</h2>
        {r.stageDays.length ? <Bars data={r.stageDays.map((s) => ({ label: s.label, n: s.avg, sub: ` · ${s.n} move${s.n === 1 ? '' : 's'}` }))} unit=" d" /> : <p className="muted" style={{ margin: 0 }}>This fills in as students are moved between stages in the portal. Nothing to measure yet.</p>}
      </div>
    </>
  );
}
