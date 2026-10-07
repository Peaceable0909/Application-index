import { admin } from './supabase';
import { REQUIRED_DOCS } from './constants';
import { counselorKey } from './docs';
import { googleCalUrl, MIN_NOTICE_H } from './interviews';
import { providerName } from './meet';
import type { Offer } from './offer';
import type { StudentApp, StudentDoc, StudentView } from './student';
import type { MyBooking, SlotView } from '@/components/StudentInterviews';

export type Counselor = { name: string; email: string | null; display: string; title: string; avatar_url: string | null; color: string | null } | null;
export type Card = { a: StudentApp; ids: string[]; docs: StudentDoc[]; folderApp: StudentApp; counselor: Counselor; missing: string[]; offer: Offer | null; canUpload: boolean };
export type CheckItem = { id: string; application_id: string; text: string; due: string | null; done: boolean };

/** Everything the student screens need, loaded once per page. */
export async function loadStudentData(me: StudentView) {
  const db = admin();
  const [{ data: counselors }, { data: offerRows }, { data: profiles }, { data: checklist }, { count: unreadMsgs }] = await Promise.all([
    db.from('portal_counselors').select('name, name_key, email'),
    db.from('portal_offers').select('*').in('application_id', me.ids).eq('visible_to_student', true),
    db.from('portal_staff').select('email, display_name, avatar_url, color, title'),
    db.from('portal_checklist').select('id, application_id, text, due, done').in('application_id', me.ids).order('created_at'),
    db.from('portal_student_msgs').select('id', { count: 'exact', head: true }).eq('student_email', me.email).eq('from_student', false).is('student_read_at', null),
  ]);

  const byKey = new Map<string, StudentApp[]>();
  me.apps.forEach((a) => byKey.set(a.student_key, [...(byKey.get(a.student_key) || []), a]));
  const cards: Card[] = [...byKey.values()].map((list) => {
    const a = list[0], ids = list.map((x) => x.application_id);
    const docs = me.docs.filter((d) => ids.includes(d.application_id));
    const folderApp = list.find((x) => x.drive_folder_id) || a;
    const c = (counselors || []).find((x) => x.name_key === counselorKey(a.counselor));
    const p = c?.email ? (profiles || []).find((x) => x.email.toLowerCase() === c.email!.toLowerCase()) : null;
    const counselor: Counselor = c ? { name: c.name, email: c.email, display: p?.display_name || c.name, title: p?.title || 'Admissions Counselor', avatar_url: p?.avatar_url || null, color: p?.color || null } : null;
    const offer = ((offerRows || []).filter((o) => ids.includes(o.application_id)).sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0] as unknown as Offer | undefined) || null;
    return { a, ids, docs, folderApp, counselor, missing: REQUIRED_DOCS.filter((t) => !docs.some((d) => d.type === t)), offer, canUpload: !!folderApp.drive_folder_id };
  });

  // interview training
  const { data: openSlots } = await db.from('portal_interview_slots').select('*').is('cancelled_at', null).gt('starts_at', new Date(Date.now() + MIN_NOTICE_H * 3600_000).toISOString()).lt('starts_at', new Date(Date.now() + 28 * 864e5).toISOString()).order('starts_at').limit(40);
  const { data: allB } = (openSlots || []).length ? await db.from('portal_interview_bookings').select('slot_id, status').in('slot_id', (openSlots || []).map((x) => x.id)).in('status', ['booked', 'completed', 'no_show']) : { data: [] };
  const { data: myB } = await db.from('portal_interview_bookings').select('*, portal_interview_slots(*)').in('application_id', me.ids).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(30);
  const mine = (myB || []).map((b): MyBooking | null => {
    const sl = b.portal_interview_slots as unknown as { id: string; starts_at: string; duration_min: number; teams_url: string; notes: string | null; cancelled_at: string | null } | null;
    return sl && !sl.cancelled_at ? { id: b.id, starts_at: sl.starts_at, duration_min: sl.duration_min, teams_url: sl.teams_url, provider: providerName(sl.teams_url), notes: sl.notes, status: b.status, feedback: b.feedback_visible ? b.feedback : null, canCancel: new Date(sl.starts_at).getTime() - Date.now() >= MIN_NOTICE_H * 3600_000, gcal: googleCalUrl(sl as never) } : null;
  }).filter(Boolean) as MyBooking[];
  const upcoming = mine.filter((b) => b.status === 'booked' && new Date(b.starts_at).getTime() + b.duration_min * 60_000 > Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = mine.filter((b) => !upcoming.includes(b) && (b.status !== 'booked' || new Date(b.starts_at) < new Date())).sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 5);
  const slots: SlotView[] = (openSlots || []).map((x) => ({ id: x.id, starts_at: x.starts_at, duration_min: x.duration_min, notes: x.notes, free: x.capacity - (allB || []).filter((b) => b.slot_id === x.id).length })).filter((x) => x.free > 0);

  const a0 = me.apps[0];
  return { cards, checklist: (checklist || []) as CheckItem[], interview: { slots, upcoming, past }, unreadMsgs: unreadMsgs || 0, a0, first: a0.preferred_name || me.name.split(/[\s,]+/).filter(Boolean)[0] || 'there', counselor: cards[0]?.counselor || null };
}
export type StudentData = Awaited<ReturnType<typeof loadStudentData>>;

/** The single most useful thing for this student to do right now. */
export function nextUp(d: StudentData): { title: string; sub: string; href: string; cta: string; tone: 'todo' | 'soon' | 'clear' } {
  for (const c of d.cards) if (c.missing.length && c.canUpload) return { title: c.missing.length === 1 ? `Upload your ${c.missing[0]}` : `Upload ${c.missing.length} documents`, sub: c.missing.slice(0, 4).join(' · ') + (c.missing.length > 4 ? '…' : ''), href: '/student/documents', cta: 'Upload now', tone: 'todo' };
  const nextI = d.interview.upcoming[0];
  if (nextI && new Date(nextI.starts_at).getTime() - Date.now() < 36 * 3600_000) return { title: 'Your interview training is coming up', sub: 'Join from a quiet place, with your passport and CV to hand.', href: '/student/interview', cta: 'See details', tone: 'soon' };
  for (const c of d.cards) { if (c.a.in_regent && !/^paid/i.test(c.a.payment || '')) return { title: 'Your payment hasn’t been received yet', sub: 'Reply to your counselor with your proof of payment.', href: '/student/messages', cta: 'Message counselor', tone: 'todo' }; }
  for (const c of d.cards) { const open = (c.offer?.conditions || []).filter((x) => !x.met).length; if (open) return { title: `${open} offer condition${open === 1 ? '' : 's'} left to meet`, sub: 'See what the university needs from you.', href: '/student#offer', cta: 'View conditions', tone: 'todo' }; }
  const due = d.checklist.filter((x) => !x.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))[0];
  if (due) return { title: due.text, sub: due.due ? `Due ${new Date(due.due + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : 'On your checklist', href: '/student', cta: 'Open checklist', tone: 'todo' };
  if (!nextI && d.interview.slots.length) return { title: 'Book your interview training', sub: `${d.interview.slots.length} time${d.interview.slots.length === 1 ? '' : 's'} available`, href: '/student/interview', cta: 'Choose a time', tone: 'soon' };
  return { title: 'You’re all caught up', sub: 'Nothing needed from you right now. We’ll let you know when that changes.', href: '/student/messages', cta: 'Message counselor', tone: 'clear' };
}
