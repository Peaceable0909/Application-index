import { admin } from './supabase';
import { sendMail } from './mail';
import { site } from './emailTemplate';
import { checkMeetingUrl, providerName } from './meet';

export type Slot = { id: string; starts_at: string; duration_min: number; trainer: string | null; teams_url: string; capacity: number; notes: string | null; created_by: string; cancelled_at: string | null };
export type Booking = { id: string; slot_id: string; application_id: string; student_email: string; status: 'booked' | 'cancelled' | 'completed' | 'no_show'; booked_by: string | null; feedback: string | null; feedback_visible: boolean; created_at: string };

export const MIN_NOTICE_H = 2;
export const checkTeamsUrl = checkMeetingUrl;   // kept name for older imports; accepts Google Meet and Teams

const fmt = (iso: string, tz: string) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
/** A time written for both of the places students and staff mostly are. */
export const whenText = (iso: string) => `${fmt(iso, 'Africa/Lagos')} Nigeria time · ${new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false })} UK time`;

const ics = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function icsFile(slot: Slot, who: string) {
  const start = new Date(slot.starts_at), end = new Date(start.getTime() + slot.duration_min * 60_000);
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WhiteRock Admissions//Interview training//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${slot.id}-${who.replace(/\W/g, '')}@whiterock`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    'SUMMARY:Interview training (WhiteRock Admissions)', `LOCATION:${ics(slot.teams_url)}`, `DESCRIPTION:${ics(`Join on ${providerName(slot.teams_url)}: ${slot.teams_url}\nSee your booking: ${site()}/student`)}`, `URL:${slot.teams_url}`, 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Interview training starts in 30 minutes', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return Buffer.from(body).toString('base64');
}
export function googleCalUrl(slot: Slot) {
  const start = new Date(slot.starts_at), end = new Date(start.getTime() + slot.duration_min * 60_000);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Interview training (WhiteRock Admissions)')}&dates=${stamp(start)}/${stamp(end)}&details=${encodeURIComponent(`Join on ${providerName(slot.teams_url)}: ${slot.teams_url}`)}&location=${encodeURIComponent(slot.teams_url)}`;
}

export async function activeCount(slotId: string) {
  const { count } = await admin().from('portal_interview_bookings').select('id', { count: 'exact', head: true }).eq('slot_id', slotId).in('status', ['booked', 'completed', 'no_show']);
  return count || 0;
}

/** Books a student into a slot. Students must book at least 2 hours ahead and can hold one upcoming session at a time; staff can book anyone, any time before it starts. */
export async function bookSlotCore(o: { slotId: string; applicationId: string; studentEmail: string; bookedBy: string; asStudent: boolean }): Promise<{ ok: boolean; error?: string; slot?: Slot }> {
  const db = admin();
  const { data: slot } = await db.from('portal_interview_slots').select('*').eq('id', o.slotId).maybeSingle();
  if (!slot || slot.cancelled_at) return { ok: false, error: 'That session is no longer available.' };
  const msAhead = new Date(slot.starts_at).getTime() - Date.now();
  if (msAhead < (o.asStudent ? MIN_NOTICE_H * 3600_000 : 0)) return { ok: false, error: o.asStudent ? `Sessions can be booked up to ${MIN_NOTICE_H} hours before they start.` : 'That session has already started.' };
  const { data: mine } = await db.from('portal_interview_bookings').select('id, slot_id, portal_interview_slots(starts_at, cancelled_at)').eq('application_id', o.applicationId).eq('status', 'booked');
  const upcoming = (mine || []).filter((b) => { const sl = b.portal_interview_slots as unknown as { starts_at: string; cancelled_at: string | null } | null; return sl && !sl.cancelled_at && new Date(sl.starts_at) > new Date(); });
  if (upcoming.some((b) => b.slot_id === o.slotId)) return { ok: false, error: 'You’re already booked into this session.' };
  if (o.asStudent && upcoming.length) return { ok: false, error: 'You already have an upcoming session. Cancel it first if you want a different time.' };
  if ((await activeCount(o.slotId)) >= slot.capacity) return { ok: false, error: 'That session is full.' };
  const { data: ins, error } = await db.from('portal_interview_bookings').insert({ slot_id: o.slotId, application_id: o.applicationId, student_email: o.studentEmail.toLowerCase(), booked_by: o.bookedBy }).select('id').single();
  if (error || !ins) return { ok: false, error: 'Could not book that session. Please try again.' };
  if ((await activeCount(o.slotId)) > slot.capacity) { await db.from('portal_interview_bookings').delete().eq('id', ins.id); return { ok: false, error: 'That session just filled up. Please pick another.' }; }
  return { ok: true, slot: slot as Slot };
}

export async function emailBooking(slot: Slot, student: { name: string; email: string; preferred?: string | null }, by: string, kind: 'booked' | 'cancelled' | 'slot_cancelled') {
  const first = (student.preferred || student.name).split(/[\s,]+/)[0];
  if (kind === 'booked') {
    return sendMail({
      to: student.email, subject: `Interview training booked · ${fmt(slot.starts_at, 'Africa/Lagos')}`, body: `Hi ${first},\n\nYour interview training is booked.\n\nWhen: ${whenText(slot.starts_at)}\nLength: ${slot.duration_min} minutes\nJoin on ${providerName(slot.teams_url)}: ${slot.teams_url}\n\nManage your booking: ${site()}/student`,
      eyebrow: 'Interview training', title: 'Your session is booked', greeting: `Hi ${first},`, preheader: `${fmt(slot.starts_at, 'Africa/Lagos')} on ${providerName(slot.teams_url)}`, replyTo: by.includes('@') ? by : '', from: by.includes('@') ? by : undefined,
      blocks: [{ type: 'p', text: 'Your interview training session is confirmed. We’ll practise real interview questions so you feel confident on the day.' },
        { type: 'checklist', title: 'Your session', items: [whenText(slot.starts_at), `${slot.duration_min} minutes on ${providerName(slot.teams_url)}`], tone: 'ok' },
        { type: 'list', items: ['Join from a quiet place with a good connection', 'Have your passport and your CV with you', `Add it to your calendar: ${googleCalUrl(slot)}`] },
        { type: 'note', text: `Need to change it? You can cancel in your student portal up to ${MIN_NOTICE_H} hours before the start.` }],
      cta: { label: `Join on ${providerName(slot.teams_url)}`, href: slot.teams_url },
      attachments: [{ name: 'interview-training.ics', mime: 'text/calendar', base64: icsFile(slot, student.email) }],
    });
  }
  return sendMail({
    to: student.email, subject: 'Your interview training session was cancelled', body: `Hi ${first},\n\nYour interview training on ${whenText(slot.starts_at)} has been cancelled. Please book another time: ${site()}/student`,
    eyebrow: 'Interview training', title: 'Session cancelled', greeting: `Hi ${first},`, preheader: 'Please pick another time.', replyTo: by.includes('@') ? by : '', from: by.includes('@') ? by : undefined,
    blocks: [{ type: 'p', text: `We’re sorry. The session on ${whenText(slot.starts_at)} has been cancelled.` }, { type: 'p', text: 'You can pick another time in your student portal.' }], cta: { label: 'Choose a new time', href: `${site()}/student` },
  });
}

/** Daily: remind students about sessions starting in the next ~28 hours (once each). */
export async function sendInterviewReminders() {
  const db = admin(), now = Date.now();
  const { data: slots } = await db.from('portal_interview_slots').select('*').is('cancelled_at', null).gt('starts_at', new Date(now).toISOString()).lt('starts_at', new Date(now + 28 * 3600_000).toISOString());
  let sent = 0;
  for (const slot of slots || []) {
    const { data: bs } = await db.from('portal_interview_bookings').select('id, student_email, application_id, portal_applications(name, preferred_name)').eq('slot_id', slot.id).eq('status', 'booked').is('reminded_at', null);
    for (const b of bs || []) {
      const a = b.portal_applications as unknown as { name: string; preferred_name: string | null } | null;
      const first = ((a?.preferred_name || a?.name) || 'there').split(/[\s,]+/)[0];
      try {
        await sendMail({ to: b.student_email, subject: `Reminder: interview training ${fmt(slot.starts_at, 'Africa/Lagos')}`, body: `Hi ${first},\n\nA reminder that your interview training is on ${whenText(slot.starts_at)}.\nJoin on ${providerName(slot.teams_url)}: ${slot.teams_url}`, eyebrow: 'Reminder', title: 'Your session is coming up', greeting: `Hi ${first},`, preheader: whenText(slot.starts_at),
          blocks: [{ type: 'checklist', title: 'Coming up', items: [whenText(slot.starts_at), `${slot.duration_min} minutes on ${providerName(slot.teams_url)}`], tone: 'ok' }, { type: 'note', text: 'Please join a couple of minutes early. Have your passport and CV handy.' }], cta: { label: `Join on ${providerName(slot.teams_url)}`, href: slot.teams_url } });
        await db.from('portal_interview_bookings').update({ reminded_at: new Date().toISOString() }).eq('id', b.id); sent++;
      } catch { /* try again tomorrow */ }
    }
  }
  return { sent };
}
