import Link from 'next/link';
import { requireStaff, canSee } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { loadPeople } from '@/lib/people';
import { cancelInterviewSlot, createInterviewSlots, setBookingStatus, staffBookStudent } from '../actions';
import { whenText } from '@/lib/interviews';
import LocalTime from '@/components/LocalTime';
import SlotForm from '@/components/SlotForm';
import Fold from '@/components/Fold';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';

export const maxDuration = 60;
const LABEL: Record<string, string> = { booked: 'Booked', completed: 'Done', no_show: 'No-show', cancelled: 'Cancelled' };

export default async function Interviews({ searchParams }: { searchParams: Promise<{ tab?: string; msg?: string; err?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams, db = admin(), past = sp.tab === 'past', now = new Date();
  const people = await loadPeople();
  let q = db.from('portal_interview_slots').select('*').is('cancelled_at', null);
  q = past ? q.lt('starts_at', now.toISOString()).gt('starts_at', new Date(now.getTime() - 60 * 864e5).toISOString()).order('starts_at', { ascending: false }) : q.gte('starts_at', new Date(now.getTime() - 3600_000).toISOString()).order('starts_at');
  const { data: slots } = await q.limit(60);
  const ids = (slots || []).map((s) => s.id);
  const { data: bks } = ids.length ? await db.from('portal_interview_bookings').select('*, portal_applications(name, school, counselor)').in('slot_id', ids).neq('status', 'cancelled') : { data: [] };
  const { data: apps } = await db.from('portal_applications').select('application_id, name, email, school, counselor, student_key').not('email', 'is', null).order('name').limit(600);
  const seen = new Set<string>();
  const bookable = (apps || []).filter((a) => a.email !== 'test@example.com' && canSee(staff, a.counselor) && !seen.has(a.student_key) && seen.add(a.student_key));
  const { data: last } = await db.from('portal_interview_slots').select('teams_url').order('created_at', { ascending: false }).limit(1);
  const staffPeople = [...people.values()].filter((p) => true).map((p) => ({ email: p.email.toLowerCase(), name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  const upcomingCount = past ? 0 : (slots || []).length;
  return (
    <>
      <div className="head"><h1>Interview training</h1>{!past && <span className="badge plain">{upcomingCount} upcoming</span>}</div>
      <p className="sub">Sessions students can book, each with a Microsoft Teams link. Students get a confirmation with a calendar invite, and a reminder the day before.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}{sp.err && <div className="card err">{sp.err}</div>}
      <Fold label="New session" icon="video"><SlotForm action={createInterviewSlots} people={staffPeople} defaultTrainer={staff.email} defaultUrl={last?.[0]?.teams_url || ''} /></Fold>
      <div className="tabs" style={{ marginTop: 0 }}><Link href="/interviews" className={`tab ${!past ? 'active' : ''}`}>Upcoming</Link><Link href="/interviews?tab=past" className={`tab ${past ? 'active' : ''}`}>Past</Link></div>
      {!(slots || []).length && <div className="card muted">{past ? 'No sessions in the last 60 days.' : 'No upcoming sessions. Create one above and students can start booking.'}</div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        {(slots || []).map((sl) => {
          const list = (bks || []).filter((b) => b.slot_id === sl.id), trainer = people.get((sl.trainer || '').toLowerCase());
          const free = sl.capacity - list.filter((b) => b.status !== 'cancelled').length;
          return (
            <div key={sl.id} className="card slotcard">
              <div className="sl-head"><div><b style={{ fontSize: 17, color: 'var(--ink)' }}><LocalTime iso={sl.starts_at} long /></b><div className="muted" style={{ fontSize: 12.5 }}>{sl.duration_min} min · {whenText(sl.starts_at)}</div></div>
                <span className={`badge ${free > 0 ? 'green' : 'plain'}`}>{free > 0 ? `${free} of ${sl.capacity} free` : 'Full'}</span></div>
              <div className="filters" style={{ margin: '10px 0' }}><a className="btn sm" href={sl.teams_url} target="_blank" rel="noreferrer"><Icon n="video" size={14} /> Open Teams link</a><span className="muted" style={{ fontSize: 13 }}>Trainer: {trainer?.name || sl.trainer || '—'}</span></div>
              {sl.notes && <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{sl.notes}</div>}
              {list.map((b) => {
                const a = b.portal_applications as unknown as { name: string; school: string | null; counselor: string | null } | null, mine = canSee(staff, a?.counselor ?? null);
                return (
                  <div key={b.id} className="bk">
                    <div className="bk-top"><b>{mine ? a?.name : 'Booked (another counselor’s student)'}</b>{mine && <Link href={`/applications/${encodeURIComponent(b.application_id)}`} className="muted" style={{ fontSize: 12.5 }}>open</Link>}<span className={`badge plain ${b.status === 'completed' ? 'green' : b.status === 'no_show' ? 'red' : ''}`}>{LABEL[b.status]}</span></div>
                    {mine && (
                      <details><summary className="muted" style={{ cursor: 'pointer', fontSize: 12.5 }}>Mark / feedback</summary>
                        <form action={setBookingStatus} className="grid" style={{ gap: 8, marginTop: 8 }}>
                          <input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="tab" value={past ? 'past' : ''} />
                          <select name="status" defaultValue={b.status}><option value="booked">Booked</option><option value="completed">Completed</option><option value="no_show">No-show</option><option value="cancelled">Cancel booking</option></select>
                          <textarea name="feedback" defaultValue={b.feedback || ''} rows={3} maxLength={1000} placeholder="Feedback on how it went (strengths, what to practise)…" style={{ width: '100%', height: 'auto', padding: '8px 10px' }} />
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="visible" defaultChecked={b.feedback_visible} /> Show this feedback to the student</label>
                          <Btn className="sm">Save</Btn>
                        </form></details>
                    )}
                  </div>
                );
              })}
              {!past && (
                <div className="sl-actions">
                  {free > 0 && (
                    <form action={staffBookStudent} className="filters" style={{ flexWrap: 'nowrap' }}>
                      <input type="hidden" name="slotId" value={sl.id} />
                      <select name="appId" defaultValue="" style={{ flex: 1, minWidth: 0 }}><option value="">Book a student…</option>{bookable.map((a) => <option key={a.application_id} value={a.application_id}>{a.name}</option>)}</select><Btn className="ghost sm">Book</Btn>
                    </form>
                  )}
                  {(staff.role !== 'counselor' || sl.created_by === staff.email || sl.trainer === staff.email) && (
                    <form action={cancelInterviewSlot}><input type="hidden" name="slotId" value={sl.id} /><Btn className="ghost sm" data-busy="Cancelling…">Cancel this session{list.length ? ` (emails ${list.length})` : ''}</Btn></form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
