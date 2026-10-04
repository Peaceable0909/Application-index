import Link from 'next/link';
import Who from '@/components/Who';
import Avatar from '@/components/Avatar';
import { loadPeople, personFor } from '@/lib/people';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { dateTime, describeActivity } from '@/lib/format';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';

const KINDS = ['new_application', 'status_change', 'counselor_change', 'doc_uploaded', 'email_sent', 'note', 'moved_to_master', 'folder_linked', 'payment_change', 'interview_change', 'task_done'];

export default async function Activity({ searchParams }: { searchParams: Promise<{ kind?: string; actor?: string; from?: string; to?: string; tab?: string }> }) {
  const people = await loadPeople();
  await requireTeam();
  const sp = await searchParams;
  const admin_ = sp.tab === 'admin';
  const dayStart = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : null), dayEnd = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59Z` : null);
  const { data: actors } = await admin().from('portal_staff').select('email');
  const { data: audits } = admin_ ? await (() => { let a = admin().from('portal_audit').select('id, actor, action, target, detail, created_at').order('created_at', { ascending: false }).limit(300); if (sp.actor) a = a.eq('actor', sp.actor); if (dayStart(sp.from)) a = a.gte('created_at', dayStart(sp.from)!); if (dayEnd(sp.to)) a = a.lte('created_at', dayEnd(sp.to)!); return a; })() : { data: [] as never[] };
  let q = admin().from('portal_activity').select('id,kind,actor,detail,created_at,application_id,portal_applications(name)').order('created_at', { ascending: false }).limit(250);
  if (sp.kind) q = q.eq('kind', sp.kind);
  if (sp.actor) q = q.eq('actor', sp.actor);
  if (dayStart(sp.from)) q = q.gte('created_at', dayStart(sp.from)!);
  if (dayEnd(sp.to)) q = q.lte('created_at', dayEnd(sp.to)!);
  const { data } = await q;
  const days = new Map<string, NonNullable<typeof data>>();
  (data || []).forEach((a) => { const k = new Date(a.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); days.set(k, [...(days.get(k) || []), a]); });
  return (
    <>
      <div className="head"><h1>Activity</h1></div>
      <p className="sub">A running log of everything that happens in the portal — by staff, by the sheets, and by the system.</p>
      <div className="tabs" style={{ marginTop: 0 }}>
        <Link href="/activity" className={`tab ${!admin_ ? 'active' : ''}`}>Student activity</Link>
        <Link href="/activity?tab=admin" className={`tab ${admin_ ? 'active' : ''}`}>Admin log</Link>
      </div>
      <form className="card toolbar filters" method="get">
        {admin_ && <input type="hidden" name="tab" value="admin" />}
        {!admin_ && <select name="kind" defaultValue={sp.kind || ''}><option value="">All activity</option>{KINDS.map((k) => <option key={k} value={k}>{describeActivity(k, {}).title.replace(/ ·.*/, '')}</option>)}</select>}
        <select name="actor" defaultValue={sp.actor || ''}><option value="">Everyone</option>{(actors || []).map((a) => <option key={a.email} value={a.email}>{personFor(people, a.email).name}</option>)}</select>
        <label>From <input type="date" name="from" defaultValue={sp.from} /></label><label>To <input type="date" name="to" defaultValue={sp.to} /></label>
        <Btn>Filter</Btn>{(sp.kind || sp.actor || sp.from || sp.to) && <Link href={admin_ ? '/activity?tab=admin' : '/activity'} className="muted">Clear</Link>}
        <a className="btn ghost sm" style={{ marginLeft: 'auto' }} href={`/api/activity-csv?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`}><Icon n="download" size={13} /> CSV</a>
      </form>
      {admin_ && (
        <div className="card tablecard"><div className="scroll"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th></tr></thead>
          <tbody>
            {(audits || []).map((a) => <tr key={a.id}><td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(a.created_at)}</td><td><Who people={people} email={a.actor} size={22} /></td><td><b>{String(a.action).replace(/_/g, ' ')}</b></td><td className="muted">{a.target || '—'}</td></tr>)}
            {!(audits || []).length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 30 }}>No admin actions logged yet. Access changes and backups appear here.</td></tr>}
          </tbody></table></div></div>
      )}
      {!admin_ && [...days].map(([day, items]) => (
        <div key={day} className="card">
          <h2>{day}</h2>
          <ul className="feed">
            {items.map((a) => { const d = describeActivity(a.kind, a.detail as Record<string, string>); const app = a.portal_applications as unknown as { name: string } | null; return (
              <li key={a.id}><span className={`ico ${d.tone}`}><Icon n={d.icon} size={17} /></span><div><b>{d.title}</b><small><Link href={`/applications/${a.application_id}`}>{app?.name || 'Student'}</Link> · <Who people={people} email={a.actor} size={18} bare /></small></div><time>{dateTime(a.created_at)}</time></li>); })}
          </ul>
        </div>
      ))}
      {!admin_ && !days.size && <div className="card muted">No activity yet.</div>}
    </>
  );
}
