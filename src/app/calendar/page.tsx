import Link from 'next/link';
import { requireStaff, canSee } from '@/lib/auth';
import { loadStudents } from '@/lib/overview';
import { schoolShort } from '@/lib/docs';
import { FINAL_STATUSES } from '@/lib/constants';
import Icon from '@/components/Icon';

export const maxDuration = 60;
const DAY = 864e5;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default async function Calendar({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const now = new Date();
  const [y, mo] = /^\d{4}-\d{2}$/.test(sp.m || '') ? sp.m!.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const first = new Date(y, mo - 1, 1), daysIn = new Date(y, mo, 0).getDate(), lead = (first.getDay() + 6) % 7;   // Monday-first
  const prev = new Date(y, mo - 2, 1), next = new Date(y, mo, 1);
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const { rows } = await loadStudents();
  const mine = rows.filter((r) => canSee(staff, r.a.counselor) && !(r.a.status && FINAL_STATUSES.includes(r.a.status)));
  const byDay = new Map<string, { id: string; name: string; school: string; risk: boolean }[]>();
  for (const r of mine) {
    if (!r.a.deadline) continue;
    const risk = r.missing.length > 0 || (r.a.in_regent && !/^paid/i.test(r.a.payment || ''));
    const arr = byDay.get(r.a.deadline) || []; arr.push({ id: r.a.application_id, name: r.a.name, school: schoolShort(r.a.school), risk }); byDay.set(r.a.deadline, arr);
  }
  const intakes = new Map<string, number>();
  mine.forEach((r) => { if (r.a.intake) intakes.set(r.a.intake, (intakes.get(r.a.intake) || 0) + 1); });
  const thisIntake = intakes.get(ym(first)) || 0;

  const upcoming = mine.filter((r) => r.a.deadline).map((r) => ({ r, left: Math.ceil((new Date(r.a.deadline! + 'T23:59:59').getTime() - now.getTime()) / DAY) }))
    .filter((x) => x.left <= 45).sort((a, b) => a.left - b.left).slice(0, 40);
  const noDeadline = mine.filter((r) => !r.a.deadline).length;
  const today = iso(now);
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, i) => i - lead + 1);

  return (
    <>
      <div className="head" style={{ justifyContent: 'space-between' }}>
        <h1>Deadlines</h1>
        <div className="filters">
          <Link href={`/calendar?m=${ym(prev)}`} className="iconbtn" aria-label="Previous month"><Icon n="left" size={16} /></Link>
          <b style={{ minWidth: 150, textAlign: 'center', color: 'var(--ink)' }}>{first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
          <Link href={`/calendar?m=${ym(next)}`} className="iconbtn" aria-label="Next month"><Icon n="right" size={16} /></Link>
          <Link href="/calendar" className="btn ghost sm">Today</Link>
        </div>
      </div>
      <p className="sub">Application deadlines{thisIntake ? ` · ${thisIntake} student${thisIntake === 1 ? '' : 's'} starting this month` : ''}. Set a student’s intake and deadline on their page.</p>
      <div className="split">
        <div className="card cal">
          <div className="cal-h">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
          <div className="cal-g">
            {cells.map((n, i) => {
              if (n < 1 || n > daysIn) return <div key={i} className="cal-c off" />;
              const key = `${y}-${String(mo).padStart(2, '0')}-${String(n).padStart(2, '0')}`, ev = byDay.get(key) || [];
              return (
                <div key={i} className={`cal-c ${key === today ? 'today' : ''}`}>
                  <span className="cal-n">{n}</span>
                  {ev.slice(0, 3).map((e) => <Link key={e.id} href={`/applications/${encodeURIComponent(e.id)}`} className={`cal-e ${e.risk ? 'risk' : ''}`} title={`${e.name} · ${e.school}`}>{e.name.split(' ')[0]}</Link>)}
                  {ev.length > 3 && <span className="cal-more">+{ev.length - 3} more</span>}
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}><span className="kt warn">amber</span> = deadline with documents or payment still outstanding</div>
        </div>
        <div>
          <div className="card">
            <h2><Icon n="clock" size={17} /> Coming up</h2>
            {!upcoming.length && <p className="muted" style={{ margin: 0 }}>No deadlines in the next 45 days.</p>}
            {upcoming.map(({ r, left }) => {
              const bits = [r.missing.length ? `Missing ${r.missing.join(', ')}` : '', r.a.in_regent && !/^paid/i.test(r.a.payment || '') ? 'Payment not received' : ''].filter(Boolean);
              return (
                <div key={r.a.application_id} className="dl-row">
                  <span className={`kt ${left < 0 ? 'bad' : left <= 7 ? 'warn' : ''}`}>{left < 0 ? `${-left}d overdue` : left === 0 ? 'Today' : `${left}d`}</span>
                  <div><Link href={`/applications/${encodeURIComponent(r.a.application_id)}`}><b>{r.a.name}</b></Link><div className="muted" style={{ fontSize: 12.5 }}>{[schoolShort(r.a.school), new Date(r.a.deadline! + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</div>{bits.length > 0 && <div style={{ fontSize: 12.5, color: '#b45309' }}>{bits.join(' · ')}</div>}</div>
                </div>
              );
            })}
          </div>
          {[...intakes].length > 0 && (
            <div className="card"><h2>Intakes</h2>
              {[...intakes].sort().map(([k, n]) => <div key={k} className="filters" style={{ justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--line)' }}><span>{new Date(k + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span><span className="badge plain">{n} student{n === 1 ? '' : 's'}</span></div>)}
            </div>
          )}
          {noDeadline > 0 && <p className="muted" style={{ fontSize: 13 }}>{noDeadline} active student{noDeadline === 1 ? ' has' : 's have'} no deadline set yet.</p>}
        </div>
      </div>
    </>
  );
}
