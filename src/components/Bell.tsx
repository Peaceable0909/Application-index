import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { Staff } from '@/lib/auth';
import Icon from './Icon';

/** Notification bell: open tasks (high priority first) and applications new since the admin's last visit. */
export default async function Bell({ staff }: { staff: Staff }) {
  const db = admin();
  const [{ data: tasks, count }, { count: fresh }] = await Promise.all([
    db.from('portal_tasks').select('id,title,detail,application_id,priority', { count: 'exact' }).eq('status', 'open').order('priority').order('created_at', { ascending: false }).limit(5),
    staff.last_seen_at
      ? db.from('portal_applications').select('application_id', { count: 'exact', head: true }).eq('has_raw', true).not('submitted_at', 'is', null).gt('created_at', staff.last_seen_at)
      : Promise.resolve({ count: 0 }),
  ]);
  const n = (count || 0);
  return (
    <details className="dd">
      <summary className="iconbtn" aria-label="Notifications"><Icon n="bell" size={19} />{(n > 0 || (fresh || 0) > 0) && <i className="dot" />}</summary>
      <div className="menu" style={{ minWidth: 340 }}>
        <div className="hd">Notifications</div>
        {(fresh || 0) > 0 && <Link href="/applications?view=new"><Icon n="file" /> <span><b>{fresh} new application{fresh === 1 ? '' : 's'}</b><br /><small className="muted">since your last visit</small></span></Link>}
        {(tasks || []).map((t) => (
          <Link key={t.id} href={`/applications/${t.application_id}`}><Icon n={t.priority === 1 ? 'alert' : 'tasks'} /> <span><b>{t.title}</b><br /><small className="muted">{t.detail}</small></span></Link>
        ))}
        {!n && !(fresh || 0) && <div className="hd" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>You’re all caught up.</div>}
        <Link href="/tasks" style={{ justifyContent: 'center', color: 'var(--blue)', fontWeight: 600 }}>View all {n} task{n === 1 ? '' : 's'} →</Link>
      </div>
    </details>
  );
}
