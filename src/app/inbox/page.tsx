import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { inboxScope } from '@/lib/inbox';
import Avatar from '@/components/Avatar';

const ago = (iso: string) => { const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

export default async function Inbox({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams, onlyUnread = sp.f === 'unread';
  const scope = await inboxScope(staff);
  let q = admin().from('portal_student_msgs').select('id, application_id, from_student, body, created_at, staff_read_at').order('created_at', { ascending: false }).limit(1500);
  if (scope) q = scope.length ? q.in('application_id', scope) : q.eq('application_id', '__none__');
  const { data: rows } = await q;
  const threads = new Map<string, { last: NonNullable<typeof rows>[number]; unread: number }>();
  for (const m of rows || []) {
    const t = threads.get(m.application_id) || { last: m, unread: 0 };
    if (m.from_student && !m.staff_read_at) t.unread++;
    threads.set(m.application_id, t);
  }
  const ids = [...threads.keys()];
  const { data: apps } = ids.length ? await admin().from('portal_applications').select('application_id, name, school, counselor').in('application_id', ids) : { data: [] };
  const list = ids.map((id) => ({ id, ...threads.get(id)!, app: (apps || []).find((a) => a.application_id === id) })).filter((t) => t.app && (!onlyUnread || t.unread));
  list.sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || b.last.created_at.localeCompare(a.last.created_at));
  const totalUnread = [...threads.values()].reduce((n, t) => n + t.unread, 0);
  return (
    <>
      <div className="page-head"><div><h1>Student inbox</h1><p className="muted">Messages students send from their portal.{totalUnread ? ` ${totalUnread} unread.` : ''}</p></div>
        <div className="filters"><Link className={`btn sm ${onlyUnread ? 'ghost' : ''}`} href="/inbox">All</Link><Link className={`btn sm ${onlyUnread ? '' : 'ghost'}`} href="/inbox?f=unread">Unread</Link></div></div>
      <div className="card" style={{ padding: 0 }}>
        {list.length === 0 && <p className="muted" style={{ padding: 24, margin: 0 }}>{onlyUnread ? 'You’re all caught up.' : 'No student messages yet.'}</p>}
        {list.map((t) => (
          <Link key={t.id} href={`/applications/${encodeURIComponent(t.id)}?tab=messages`} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--line, #e8ecf5)', textDecoration: 'none', color: 'inherit' }}>
            <Avatar name={t.app!.name} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}><b style={{ fontWeight: t.unread ? 700 : 600 }}>{t.app!.name}</b><small className="muted">{ago(t.last.created_at)}</small></div>
              <div className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: t.unread ? 600 : 400 }}>{t.last.from_student ? '' : 'You: '}{t.last.body}</div>
            </div>
            {t.unread > 0 && <span className="n">{t.unread}</span>}
          </Link>
        ))}
      </div>
    </>
  );
}
