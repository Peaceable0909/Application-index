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

export default async function Activity({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const people = await loadPeople();
  await requireTeam();
  const sp = await searchParams;
  let q = admin().from('portal_activity').select('id,kind,actor,detail,created_at,application_id,portal_applications(name)').order('created_at', { ascending: false }).limit(250);
  if (sp.kind) q = q.eq('kind', sp.kind);
  const { data } = await q;
  const days = new Map<string, NonNullable<typeof data>>();
  (data || []).forEach((a) => { const k = new Date(a.created_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); days.set(k, [...(days.get(k) || []), a]); });
  return (
    <>
      <div className="head"><h1>Activity</h1></div>
      <p className="sub">A running log of everything that happens in the portal — by staff, by the sheets, and by the system.</p>
      <form className="card toolbar filters" method="get">
        <select name="kind" defaultValue={sp.kind || ''}><option value="">All activity</option>{KINDS.map((k) => <option key={k} value={k}>{describeActivity(k, {}).title.replace(/ ·.*/, '')}</option>)}</select><Btn>Filter</Btn>
      </form>
      {[...days].map(([day, items]) => (
        <div key={day} className="card">
          <h2>{day}</h2>
          <ul className="feed">
            {items.map((a) => { const d = describeActivity(a.kind, a.detail as Record<string, string>); const app = a.portal_applications as unknown as { name: string } | null; return (
              <li key={a.id}><span className={`ico ${d.tone}`}><Icon n={d.icon} size={17} /></span><div><b>{d.title}</b><small><Link href={`/applications/${a.application_id}`}>{app?.name || 'Student'}</Link> · <Who people={people} email={a.actor} size={18} bare /></small></div><time>{dateTime(a.created_at)}</time></li>); })}
          </ul>
        </div>
      ))}
      {!days.size && <div className="card muted">No activity yet.</div>}
    </>
  );
}
