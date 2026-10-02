import { Fragment } from 'react';
import Link from 'next/link';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import Btn from '@/components/Btn';
import { aiOverview, computeFacts, FACT_LABELS, loadStudents, refreshTasks } from '@/lib/overview';
import { completeReminder, completeTask, dismissTask, markSeen, refreshOverview, snoozeTask } from '../actions';

export const maxDuration = 60;

const KIND_ORDER = ['no_documents', 'review_new', 'missing_docs', 'ready_next', 'interview_book', 'no_counselor', 'stale', 'add_to_sheet1', 'incomplete_info'];
const KIND_LABEL: Record<string, string> = {
  no_documents: 'Possible upload problems', review_new: 'New applications to review', missing_docs: 'Missing documents', ready_next: 'Ready for the next stage',
  interview_book: 'Interviews to book', no_counselor: 'Assign a counselor', stale: 'Follow-ups', add_to_sheet1: 'Add to Sheet1', incomplete_info: 'Incomplete details',
};
const ago = (t: string) => { const m = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

function describe(kind: string, d: Record<string, string>) {
  switch (kind) {
    case 'new_application': return 'New application received';
    case 'imported_from_sheet': return 'Found in the sheets';
    case 'status_change': return `Status ${d.from || '—'} → ${d.to}`;
    case 'counselor_change': return `Counselor → ${d.to || '—'}`;
    case 'payment_change': return `Payment → ${d.to || '—'}`;
    case 'interview_change': return `Interview → ${d.to || '—'}`;
    case 'doc_uploaded': return `Document uploaded`;
    case 'email_sent': return `Emailed ${d.to}`;
    case 'moved_to_master': return 'Added to Sheet1';
    case 'folder_linked': return 'Drive folder linked';
    case 'task_done': return `Task done: ${d.title}`;
    default: return kind.replace(/_/g, ' ');
  }
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string; all?: string }> }) {
  const staff = await requireTeam();
  const sp = await searchParams;
  const db = admin();

  let lastSeen = staff.last_seen_at;
  if (!lastSeen) { lastSeen = new Date().toISOString(); await db.from('portal_staff').update({ last_seen_at: lastSeen }).eq('email', staff.email); }

  const { rows, all } = await loadStudents();
  await refreshTasks(rows);
  const facts = await computeFacts(rows, all, lastSeen);
  const ai = await aiOverview(facts);

  const { data: reminders } = await db.from('portal_reminders').select('id,application_id,due_on,note,portal_applications(name)').eq('status', 'pending').order('due_on').limit(100);
  const [{ data: tasks }, { data: activity }] = await Promise.all([
    db.from('portal_tasks').select('*').eq('status', 'open').order('priority').order('created_at', { ascending: false }).limit(500),
    db.from('portal_activity').select('id,kind,actor,detail,created_at,application_id,portal_applications(name)').order('created_at', { ascending: false }).limit(14),
  ]);
  const groups = KIND_ORDER.map((k) => ({ k, items: (tasks || []).filter((t) => t.kind === k) })).filter((g) => g.items.length);
  const perGroup = sp.all ? 200 : 6;
  const stat = (label: string, n: number, href: string, tone = '') => (
    <Link href={href} className="card rise" style={{ textDecoration: 'none' }}><div className="stat-l">{label}</div><div className={`stat ${tone}`}>{n}</div></Link>
  );

  return (
    <>
      <div className="head"><h1>Tasks</h1></div>
      <p className="sub">Since your last visit · {new Date(lastSeen).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      {(reminders || []).length > 0 && (
        <div className="card">
          <h2>Reminders</h2>
          {(reminders || []).map((r) => {
            const nm = (r.portal_applications as unknown as { name: string } | null)?.name || 'Student';
            const today = new Date().toISOString().slice(0, 10);
            return (
              <div key={r.id} className="filters" style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ flex: 1 }}><Link href={`/applications/${r.application_id}`}>{nm}: {r.note}</Link></div>
                <span className={`badge plain ${r.due_on < today ? 'red' : r.due_on === today ? 'amber' : ''}`}>{r.due_on < today ? 'Overdue · ' : ''}{new Date(r.due_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                <form action={completeReminder}><input type="hidden" name="reminderId" value={r.id} /><input type="hidden" name="returnTo" value="/tasks" /><Btn className="sm">Done</Btn></form>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid g5" style={{ marginBottom: 16 }}>
        {stat('New applications', facts.newApplicationsSinceLastVisit, '/applications?view=new')}
        {stat('Need attention', facts.needAttention, '/applications?view=attention', 'warn')}
        {stat('Missing documents', facts.missingDocuments, '/applications?view=missing')}
        {stat('Interviews to book', facts.interviewsToBook, '/applications?interview=To%20be%20booked%20for%20interview')}
        {stat('Open tasks', facts.openTasks, '#tasks')}
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid">
          <div className="card">
            <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>AI overview</h2>
              <form action={refreshOverview}><Btn className="ghost sm">Refresh</Btn></form>
            </div>
            {ai.data ? (
              <>
                <p style={{ fontSize: 15.5, lineHeight: 1.6, margin: '0 0 10px' }}>{ai.data.overview}</p>
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                  <span className="badge amber plain">AI-written</span> from the confirmed numbers below · {ai.at ? ago(ai.at) : ''}{ai.stale ? ' · numbers have changed since — press Refresh' : ''}
                </p>
              </>
            ) : <p className="muted" style={{ margin: 0 }}>{ai.error ? `AI overview unavailable: ${ai.error}` : 'No AI overview yet.'} The confirmed numbers below are always accurate.</p>}
            {ai.error && ai.data && <p className="err" style={{ fontSize: 12.5, marginBottom: 0 }}>{ai.error}</p>}
          </div>

          <div className="card">
            <h2>Confirmed numbers</h2>
            <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
              {Object.entries(FACT_LABELS).map(([k, label]) => (<Fragment key={k}><dt>{label}</dt><dd style={{ textAlign: 'right', fontWeight: 600 }}>{facts[k] ?? 0}</dd></Fragment>))}
            </dl>
            <form action={markSeen} style={{ marginTop: 14 }}><Btn className="ghost">Mark everything as seen</Btn></form>
          </div>

          <div className="card" style={{ borderStyle: 'dashed' }}>
            <h2>Interviews</h2>
            <p className="muted" style={{ margin: 0 }}>Interview recordings, reviews and pass/fail results live in your separate interview app (Uk-interview-prep), which isn’t connected to this portal yet. Once it is, they’ll appear here.</p>
          </div>
        </div>

        <div className="grid" id="tasks">
          <div className="card">
            <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>To-do list</h2>
              <span className="muted">{(tasks || []).length} open</span>
            </div>
            {!groups.length && <p className="muted">Nothing needs doing right now.</p>}
            {groups.map((g, i) => (
              <details key={g.k} open={i < 3} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{KIND_LABEL[g.k]} <span className="badge plain">{g.items.length}</span></summary>
                {g.items.slice(0, perGroup).map((t) => (
                  <div key={t.id} style={{ padding: '8px 0 4px' }}>
                    <Link href={`/applications/${t.application_id}${t.kind === 'missing_docs' || t.kind === 'no_documents' ? '?tab=documents' : ''}`}>{t.title}</Link>
                    {t.priority === 1 && <> <span className="badge red plain">high</span></>}
                    <div className="muted" style={{ fontSize: 12.5 }}>{t.detail}</div>
                    <div className="filters" style={{ marginTop: 6, gap: 6 }}>
                      <form action={completeTask}><input type="hidden" name="taskId" value={t.id} /><Btn className="sm">Done</Btn></form>
                      <form action={snoozeTask}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="days" value="1" /><Btn className="ghost sm">Snooze 1 day</Btn></form>
                      <form action={dismissTask}><input type="hidden" name="taskId" value={t.id} /><Btn className="ghost sm">Not needed</Btn></form>
                    </div>
                  </div>
                ))}
                {g.items.length > perGroup && <p className="muted" style={{ margin: '8px 0 0' }}><Link href="/tasks?all=1">Show all {g.items.length}</Link></p>}
              </details>
            ))}
          </div>

          <div className="card">
            <h2>Recent activity</h2>
            <ul className="tl">
              {(activity || []).map((a) => {
                const app = a.portal_applications as unknown as { name: string } | null;
                return <li key={a.id}><Link href={`/applications/${a.application_id}`}>{app?.name || 'Student'}</Link> — {describe(a.kind, a.detail as Record<string, string>)}<div className="muted">{a.actor} · {ago(a.created_at)}</div></li>;
              })}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
