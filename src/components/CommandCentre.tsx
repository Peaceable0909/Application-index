import Link from 'next/link';
import { admin } from '@/lib/supabase';
import { Staff } from '@/lib/auth';
import { aiOverview, AppFull, computeFacts, refreshTasks, SRow } from '@/lib/overview';
import { completeReminder, completeTask, markSeen, refreshOverview, snoozeTask } from '@/app/actions';
import Btn from './Btn';

const ago = (t: string) => { const m = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** The AI overview, key numbers and top tasks shown at the top of the main dashboard. */
export default async function CommandCentre({ staff, rows, all }: { staff: Staff; rows: SRow[]; all: AppFull[] }) {
  const db = admin();
  let lastSeen = staff.last_seen_at;
  if (!lastSeen) { lastSeen = new Date().toISOString(); await db.from('portal_staff').update({ last_seen_at: lastSeen }).eq('email', staff.email); }

  await refreshTasks(rows);
  const facts = await computeFacts(rows, all, lastSeen);
  const ai = await aiOverview(facts);
  const { data: due } = await db.from('portal_reminders').select('id,application_id,due_on,note,portal_applications(name)').eq('status', 'pending').lte('due_on', new Date().toISOString().slice(0, 10)).order('due_on').limit(5);
  const { data: tasks } = await db.from('portal_tasks').select('*').eq('status', 'open').order('priority').order('created_at', { ascending: false }).limit(6);

  return (
    <>
      <div className="grid g2" style={{ marginBottom: 16, alignItems: 'start' }}>
        <div className="card ai">
          <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}><span className="spark" aria-hidden>✦</span> AI overview <span className="badge blue plain" style={{ marginLeft: 6 }}>beta</span></h2>
            <div className="filters" style={{ gap: 6 }}>
              <form action={refreshOverview}><input type="hidden" name="returnTo" value="/" /><Btn className="ghost sm">Refresh</Btn></form>
              <form action={markSeen}><input type="hidden" name="returnTo" value="/" /><Btn className="ghost sm">Mark as seen</Btn></form>
            </div>
          </div>
          {ai.data ? (
            <>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, margin: '0 0 10px' }}>{ai.data.overview}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                <span className="badge amber plain">AI-written</span> from the confirmed numbers above · {ai.at ? ago(ai.at) : ''}{ai.stale ? ' · numbers changed since — press Refresh' : ''}
              </p>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{ai.error ? `AI overview unavailable: ${ai.error}` : 'No AI overview yet — press Refresh.'} The numbers above are always accurate.</p>
          )}
          {ai.error && ai.data && <p className="err" style={{ fontSize: 12.5, marginBottom: 0 }}>{ai.error}</p>}
        </div>

        <div className="card">
          <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Today’s tasks</h2>
            <Link href="/tasks" className="muted">View all {facts.openTasks} →</Link>
          </div>
          {!(tasks || []).length && !(due || []).length && <p className="muted" style={{ margin: 0 }}>Nothing needs doing right now.</p>}
          {(due || []).map((r) => {
            const nm = (r.portal_applications as unknown as { name: string } | null)?.name || 'Student';
            const over = r.due_on < new Date().toISOString().slice(0, 10);
            return (
              <div key={r.id} style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }} className="filters">
                <div style={{ flex: 1, minWidth: 180 }}>
                  <Link href={`/applications/${r.application_id}`}>{nm}: {r.note}</Link> <span className={`badge plain ${over ? 'red' : 'amber'}`}>{over ? 'Overdue' : 'Reminder · today'}</span>
                  <div className="muted" style={{ fontSize: 12.5 }}>Follow-up set for {new Date(r.due_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                </div>
                <form action={completeReminder}><input type="hidden" name="reminderId" value={r.id} /><input type="hidden" name="returnTo" value="/" /><Btn className="sm">Done</Btn></form>
              </div>
            );
          })}
          {(tasks || []).map((t) => (
            <div key={t.id} style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }} className="filters">
              <div style={{ flex: 1, minWidth: 180 }}>
                <Link href={`/applications/${t.application_id}${t.kind === 'missing_docs' || t.kind === 'no_documents' ? '?tab=documents' : ''}`}>{t.title}</Link>
                {t.priority === 1 && <> <span className="badge red plain">high</span></>}
                <div className="muted" style={{ fontSize: 12.5 }}>{t.detail}</div>
              </div>
              <form action={completeTask}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="returnTo" value="/" /><Btn className="sm">Done</Btn></form>
              <form action={snoozeTask}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="days" value="1" /><input type="hidden" name="returnTo" value="/" /><Btn className="ghost sm">Snooze</Btn></form>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function CommandCentreSkeleton() {
  return (
    <>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="card"><div className="sk" style={{ width: 120, height: 16 }} /><div className="sk" style={{ width: '90%', height: 14, marginTop: 16 }} /><div className="sk" style={{ width: '70%', height: 14, marginTop: 8 }} /></div>
        <div className="card"><div className="sk" style={{ width: 120, height: 16 }} /><div className="sk" style={{ width: '80%', height: 14, marginTop: 16 }} /><div className="sk" style={{ width: '60%', height: 14, marginTop: 8 }} /></div>
      </div>
    </>
  );
}
