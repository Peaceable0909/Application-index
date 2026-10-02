import { Suspense } from 'react';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { loadStudents } from '@/lib/overview';
import { FINAL_STATUSES } from '@/lib/constants';
import { statusTone } from '@/lib/ui';
import { schoolShort } from '@/lib/docs';
import { ago, AWAITING, describeActivity, IN_PROGRESS, initials, shortDate } from '@/lib/format';
import CommandCentre, { CommandCentreSkeleton } from '@/components/CommandCentre';
import Icon from '@/components/Icon';
import Btn from '@/components/Btn';
import { niceName } from '@/components/UserMenu';
import { syncNow } from './actions';

export const maxDuration = 60;

export default async function Overview({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const { rows, all } = await loadStudents();
  const live = rows.filter((r) => !(r.a.status && FINAL_STATUSES.includes(r.a.status)));

  // Daily snapshot so each card can show "vs last 7 days" once there is history.
  const now = {
    total: rows.length,
    awaiting: live.filter((r) => r.a.has_raw && (!r.a.status || AWAITING.includes(r.a.status))).length,
    missing: live.filter((r) => r.judged && r.docCount > 0 && r.missing.length).length,
    in_progress: live.filter((r) => r.a.status && IN_PROGRESS.includes(r.a.status)).length,
  };
  const today = new Date().toISOString().slice(0, 10);
  await db.from('portal_snapshots').upsert({ day: today, ...now }, { onConflict: 'day' });
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const { data: prev } = await db.from('portal_snapshots').select('*').lte('day', weekAgo).order('day', { ascending: false }).limit(1).maybeSingle();
  const delta = (k: 'total' | 'awaiting' | 'missing' | 'in_progress', goodWhenDown = false) => {
    if (!prev || !prev[k]) return <div className="delta"><small>trend starts after 7 days of data</small></div>;
    const pct = Math.round(((now[k] - prev[k]) / prev[k]) * 100);
    const up = pct >= 0, good = goodWhenDown ? !up : up;
    return <div className={`delta ${good ? 'up' : 'down'}`}><Icon n="trend" size={14} /> {up ? '+' : ''}{pct}% <small>vs. last 7 days</small></div>;
  };

  const { data: activity } = await db.from('portal_activity').select('id,kind,detail,created_at,application_id,portal_applications(name)').order('created_at', { ascending: false }).limit(6);
  // Real form submissions first (newest first), then anything else the sheets know about.
  const isForm = (r: (typeof rows)[number]) => r.a.has_raw && !!r.a.submitted_at;
  const byDate = (k: 'submitted_at' | 'created_at') => (x: (typeof rows)[number], y: (typeof rows)[number]) => new Date(y.a[k] || 0).getTime() - new Date(x.a[k] || 0).getTime();
  const recent = [...rows.filter(isForm).sort(byDate('submitted_at')), ...rows.filter((r) => !isForm(r)).sort(byDate('created_at'))].slice(0, 8);
  const card = (icon: string, tone: string, label: string, n: number, href: string, d: React.ReactNode, i: number) => (
    <Link href={href} className="sc rise" style={{ '--i': i } as React.CSSProperties}><div className={`ico ${tone}`}><Icon n={icon} size={22} /></div><div className="lbl">{label}</div><div className="num">{n}</div>{d}</Link>
  );

  return (
    <>
      <div className="head" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Welcome back, {niceName(staff.email)}</div>
          <h1>Here’s what’s happening today</h1>
          <p className="sub" style={{ marginBottom: 20 }}>Manage applications, review documents and keep track of your students — all in one place.</p>
        </div>
        <div className="filters">
          <span className="muted">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <form action={syncNow} className="filters"><input type="hidden" name="returnTo" value="/" /><Btn className="ghost sm">Sync now</Btn></form>
        </div>
      </div>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <div className="split">
        <div>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            {card('file', '', 'Total Applications', now.total, '/applications', delta('total'), 0)}
            {card('clock', 'amber', 'Awaiting Review', now.awaiting, '/applications?view=new', delta('awaiting', true), 1)}
            {card('alert', 'red', 'Missing Documents', now.missing, '/applications?view=missing', delta('missing', true), 2)}
            {card('check-circle', 'green', 'In Progress', now.in_progress, '/applications?status=Offer%20Received', delta('in_progress'), 3)}
          </div>

          <Suspense fallback={<CommandCentreSkeleton />}><CommandCentre staff={staff} rows={rows} all={all} /></Suspense>

          <div className="card tablecard">
            <div className="th"><h2>Recent Applications</h2><Link href="/applications">View all →</Link></div>
            <div className="scroll">
              <table>
                <thead><tr><th>Student</th><th>Program</th><th>School</th><th>City</th><th>Status</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {recent.map(({ a, missing, judged }, i) => (
                    <tr key={a.application_id} className="row" style={{ '--i': i } as React.CSSProperties}>
                      <td><Link href={`/applications/${a.application_id}`}><div className="who-c"><span className="avatar sm">{initials(a.name)}</span><b>{a.name}</b></div></Link></td>
                      <td>{a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : <span className="muted">—</span>}</td>
                      <td>{schoolShort(a.school) || '—'}</td>
                      <td className="muted">{(a as unknown as { city?: string }).city || a.country || '—'}</td>
                      <td><div className="chips">
                        {a.status ? <span className={`badge plain tone-${statusTone(a.status)}`}>{a.status}</span> : <span className="badge plain">New</span>}
                        {judged && missing.length > 0 && <span className="badge plain red">Missing Docs</span>}
                      </div></td>
                      <td className="muted">{shortDate(a.submitted_at)}</td>
                      <td><Link href={`/applications/${a.application_id}`} className="iact" aria-label="Open"><Icon n="more" /></Link></td>
                    </tr>
                  ))}
                  {!recent.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 36 }}>No applications yet — press “Sync now”.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="banner" style={{ marginTop: 16 }}>
            <span className="ico" style={{ margin: 0 }}><Icon n="spark" size={22} /></span>
            <div className="grow"><b>Smarter Application Management</b><div className="muted">AI-powered insights, automated checks and task suggestions help you spot issues early and move applications forward faster.</div></div>
            <Link href="/tasks" className="btn ghost">View tasks</Link>
          </div>
        </div>

        <div>
          <div className="hero"><small>PEACEABLE EDUCATIONAL SERVICES</small><h3>Supporting. Guiding. Building Futures.</h3></div>
          <div className="card">
            <h2><Icon n="bolt" size={18} className="spark" /> Quick Actions</h2>
            {[
              ['user-plus', '', 'Add New Application', 'Manually add a student application', '/applications/new'],
              ['upload', 'green', 'Upload Document', 'Add documents to an existing application', '/documents#upload'],
              ['mail', 'amber', 'Send Email', 'Contact students or counselors', '/messages?compose=1'],
              ['users', 'purple', 'Assign Counselor', 'Set or change counselor assignment', '/applications?counselor=__none'],
            ].map(([icon, tone, t, s, href]) => (
              <Link key={t} href={href} className="qa"><span className={`ico ${tone}`}><Icon n={icon} size={19} /></span><span><b>{t}</b><small>{s}</small></span><Icon n="right" size={16} /></Link>
            ))}
          </div>
          <div className="card">
            <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 6 }}><h2 style={{ margin: 0 }}><Icon n="clock" size={18} className="spark" /> Recent Activity</h2><Link href="/activity">View all →</Link></div>
            <ul className="feed">
              {(activity || []).map((a) => {
                const d = describeActivity(a.kind, a.detail as Record<string, string>);
                const app = a.portal_applications as unknown as { name: string } | null;
                return <li key={a.id}><span className={`ico ${d.tone}`}><Icon n={d.icon} size={17} /></span><div><b>{d.title}</b><small>{app?.name || 'Student'}</small></div><time>{ago(a.created_at)}</time></li>;
              })}
              {!(activity || []).length && <li className="muted">No activity yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
