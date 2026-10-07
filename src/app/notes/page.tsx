import Link from 'next/link';
import Who from '@/components/Who';
import Avatar from '@/components/Avatar';
import { loadPeople, personFor } from '@/lib/people';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { dateTime, initials } from '@/lib/format';
import Btn from '@/components/Btn';

export default async function Notes({ searchParams }: { searchParams: Promise<{ q?: string; pinned?: string }> }) {
  const people = await loadPeople();
  await requireTeam();
  const sp = await searchParams;
  let query = admin().from('portal_notes').select('*, portal_applications(name, application_id)').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(300);
  if (sp.pinned) query = query.eq('pinned', true);
  const { data } = await query;
  const q = (sp.q || '').toLowerCase();
  const list = (data || []).filter((n) => !q || n.body.toLowerCase().includes(q) || (n.portal_applications as { name?: string } | null)?.name?.toLowerCase().includes(q));
  return (
    <>
      <div className="head"><h1>Notes</h1></div>
      <p className="sub">Every note your team has written, newest first. Pinned notes stay on top.</p>
      <form className="card toolbar filters" method="get"><div className="search"><input name="q" placeholder="Search notes or students…" defaultValue={sp.q} /></div>
        <label><input type="checkbox" name="pinned" value="1" defaultChecked={!!sp.pinned} /> pinned only</label><Btn>Apply</Btn></form>
      <div className="card">
        {list.map((n) => { const a = n.portal_applications as { name: string; application_id: string } | null; return (
          <div key={n.id} className="note"><Avatar name={personFor(people, n.author).name} url={personFor(people, n.author).avatar_url} color={personFor(people, n.author).color} size={34} />
            <div style={{ flex: 1 }}><b>{personFor(people, n.author).name} {n.pinned && '📌'}</b> <span className="muted">on</span> {a ? <Link href={`/applications/${a.application_id}?tab=notes`}><b>{a.name}</b></Link> : '—'}<small>{dateTime(n.created_at)}</small><p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p></div></div>); })}
        {!list.length && <p className="muted" style={{ margin: 0 }}>No notes match.</p>}
      </div>
    </>
  );
}
