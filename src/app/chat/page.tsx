import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { loadPeople, personFor } from '@/lib/people';
import { counselorKey } from '@/lib/docs';
import { ago } from '@/lib/format';
import Avatar from '@/components/Avatar';
import ChatThread, { Msg } from '@/components/ChatThread';
import Icon from '@/components/Icon';

export const dynamic = 'force-dynamic';

export default async function Chat({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  const db = admin();
  const people = await loadPeople();
  const others = [...people.values()].filter((p) => p.email.toLowerCase() !== me.email).sort((a, b) => a.name.localeCompare(b.name));

  // every message I'm part of, newest first → conversation list
  const { data: all } = await db.from('portal_chat').select('from_email, to_email, body, created_at, read_at').or(`from_email.eq.${me.email},to_email.eq.${me.email}`).order('created_at', { ascending: false }).limit(600);
  const convo = new Map<string, { last: string; at: string; mine: boolean; unread: number }>();
  for (const m of all || []) {
    const o = (m.from_email === me.email ? m.to_email : m.from_email).toLowerCase();
    const c = convo.get(o) || { last: m.body, at: m.created_at, mine: m.from_email === me.email, unread: 0 };
    if (m.to_email === me.email && !m.read_at) c.unread++;
    convo.set(o, c);
  }
  const withEmail = (sp.with || '').toLowerCase();
  const active = withEmail ? people.get(withEmail) : null;

  let initial: Msg[] = [], students: { id: string; name: string }[] = [];
  if (active && active.email.toLowerCase() !== me.email) {
    const { data } = await db.from('portal_chat').select('id, from_email, to_email, body, application_id, created_at, read_at, portal_applications(name)')
      .or(`and(from_email.eq.${me.email},to_email.eq.${active.email.toLowerCase()}),and(from_email.eq.${active.email.toLowerCase()},to_email.eq.${me.email})`).order('created_at', { ascending: true }).limit(300);
    initial = (data || []).map((m) => ({ ...(m as unknown as Msg), student: (m.portal_applications as unknown as { name: string } | null)?.name ?? null }));
    await db.from('portal_chat').update({ read_at: new Date().toISOString() }).eq('to_email', me.email).eq('from_email', active.email.toLowerCase()).is('read_at', null);
    const { data: apps } = await db.from('portal_applications').select('application_id, name, counselor').order('name');
    students = (apps || []).filter((a) => me.role !== 'counselor' || (!!me.counselor_key && counselorKey(a.counselor) === me.counselor_key)).map((a) => ({ id: a.application_id, name: a.name }));
  }

  const threads = [...convo.entries()].sort((a, b) => b[1].at.localeCompare(a[1].at));
  const fresh = others.filter((p) => !convo.has(p.email.toLowerCase()));
  return (
    <>
      <div className="head"><h1>Chat</h1></div>
      <p className="sub">Private messages between teammates and counselors.</p>
      <div className={`chatapp ${active ? 'open' : ''}`}>
        <aside className="chat-list card">
          {threads.map(([email, c]) => { const p = personFor(people, email); return (
            <Link key={email} href={`/chat?with=${encodeURIComponent(email)}`} className={`chat-item ${withEmail === email ? 'on' : ''}`}>
              <Avatar name={p.name} url={p.avatar_url} color={p.color} size={44} />
              <div><b>{p.name}</b><small>{c.mine ? 'You: ' : ''}{c.last}</small></div>
              <span className="when">{ago(c.at)}{c.unread > 0 && <i className="n">{c.unread}</i>}</span>
            </Link>); })}
          {fresh.length > 0 && <div className="chat-sec">{threads.length ? 'Start a new chat' : 'Say hello'}</div>}
          {fresh.map((p) => (
            <Link key={p.email} href={`/chat?with=${encodeURIComponent(p.email.toLowerCase())}`} className={`chat-item ${withEmail === p.email.toLowerCase() ? 'on' : ''}`}>
              <Avatar name={p.name} url={p.avatar_url} color={p.color} size={44} />
              <div><b>{p.name}</b><small>{p.title || 'Teammate'}</small></div>
            </Link>
          ))}
          {!threads.length && !fresh.length && <p className="muted" style={{ padding: 16, margin: 0 }}>No one else has portal access yet.</p>}
        </aside>
        <section className="chat-pane card">
          {active ? <ChatThread key={active.email} me={me.email} other={active} initial={initial} students={students} /> : (
            <div className="chat-empty"><span className="ico"><Icon n="mail" size={26} /></span><b>Pick someone to chat with</b><span className="muted">Conversations are private to the two people in them.</span></div>
          )}
        </section>
      </div>
    </>
  );
}
