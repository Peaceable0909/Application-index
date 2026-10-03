import Link from 'next/link';
import Who from '@/components/Who';
import Avatar from '@/components/Avatar';
import { loadPeople, personFor } from '@/lib/people';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { dateTime } from '@/lib/format';
import Btn from '@/components/Btn';
import { sendMessage } from '../actions';

export default async function Messages({ searchParams }: { searchParams: Promise<{ q?: string; compose?: string; msg?: string; err?: string }> }) {
  const people = await loadPeople();
  await requireTeam();
  const sp = await searchParams;
  const db = admin();
  const [{ data: msgs }, { data: counselors }, { data: students }] = await Promise.all([
    db.from('portal_messages').select('*, portal_applications(name, application_id)').order('created_at', { ascending: false }).limit(300),
    db.from('portal_counselors').select('name,email').not('email', 'is', null).order('name'),
    sp.compose ? db.from('portal_applications').select('application_id,name,email').order('name').limit(2000) : Promise.resolve({ data: [] as { application_id: string; name: string; email: string | null }[] }),
  ]);
  const q = (sp.q || '').toLowerCase();
  const list = (msgs || []).filter((m) => !q || [m.subject, m.to_email, m.body, (m.portal_applications as { name?: string } | null)?.name].some((v) => v?.toLowerCase().includes(q)));

  return (
    <>
      <div className="head" style={{ justifyContent: 'space-between' }}><h1>Messages</h1>{!sp.compose && <Link href="/messages?compose=1" className="btn">New message</Link>}</div>
      <p className="sub">Every email sent from the portal to students and counselors.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}

      {sp.compose && (
        <div className="card">
          <h2>New message</h2>
          <form action={sendMessage} className="grid" style={{ gap: 10, maxWidth: 720 }}>
            <select name="applicationId"><option value="">About a student (optional)…</option>{(students || []).map((s) => <option key={s.application_id} value={s.application_id}>{s.name}</option>)}</select>
            <div className="filters">
              <select name="to" style={{ flex: 1 }}><option value="">Send to…</option>{(counselors || []).map((c) => <option key={c.name} value={c.email!}>Counselor — {c.name} ({c.email})</option>)}</select>
              <input name="custom" type="email" placeholder="…or any email address" style={{ flex: 1 }} />
            </div>
            <input name="subject" placeholder="Subject" className="wide" required />
            <textarea name="body" placeholder="Message" style={{ minHeight: 180 }} required />
            <div className="filters"><Btn>Send</Btn><Link href="/messages" className="muted">Cancel</Link></div>
          </form>
        </div>
      )}

      <form className="card toolbar filters" method="get"><div className="search"><input name="q" placeholder="Search messages…" defaultValue={sp.q} /></div><Btn>Search</Btn></form>
      <div className="card tablecard"><div className="scroll"><table>
        <thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Student</th><th>By</th></tr></thead>
        <tbody>
          {list.map((m, i) => { const a = m.portal_applications as { name: string; application_id: string } | null; return (
            <tr key={m.id} className="row" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(m.created_at)}</td>
              <td>{m.to_email} <span className={`badge plain ${m.to_kind === 'student' ? 'blue' : 'purple'}`}>{m.to_kind}</span></td>
              <td><details><summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink)' }}>{m.subject}</summary><p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }} className="muted">{m.body}</p></details></td>
              <td>{a ? <Link href={`/applications/${a.application_id}?tab=messages`}>{a.name}</Link> : <span className="muted">—</span>}</td>
              <td><Who people={people} email={m.sent_by} size={24} /></td>
            </tr>); })}
          {!list.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 36 }}>No messages yet.</td></tr>}
        </tbody></table></div></div>
    </>
  );
}
