import { admin } from './supabase';
import { sendMail } from './mail';
import { site } from './emailTemplate';
import { shownName } from './profile';

const DAILY_CAP = 3;       // never more than 3 automatic emails a day per person
const CHAT_GAP_MIN = 180;  // and at most one per chat every 3 hours

/** True when this (person, kind, ref) was already emailed within `minutes`, or the person's daily cap is used up. */
async function recently(email: string, kind: string, ref: string, minutes: number) {
  const db = admin();
  const since = new Date(Date.now() - minutes * 60_000).toISOString(), day = new Date(Date.now() - 864e5).toISOString();
  const [{ data: hit }, { count }] = await Promise.all([
    db.from('portal_notify_log').select('id').eq('email', email).eq('kind', kind).eq('ref', ref).gte('created_at', since).limit(1),
    db.from('portal_notify_log').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', day),
  ]);
  return !!hit?.length || (count || 0) >= DAILY_CAP;
}
const mark = (email: string, kind: string, ref: string) => admin().from('portal_notify_log').insert({ email, kind, ref });

/** Emails someone about new chat messages, only if they opted in and are away from the portal (once per chat per 3 hours). */
export async function notifyChat(roomId: string, senderEmail: string, preview: string, hasFile: boolean) {
  const db = admin();
  const [{ data: members }, { data: room }, { data: sender }] = await Promise.all([
    db.from('portal_room_members').select('email, muted').eq('room_id', roomId),
    db.from('portal_rooms').select('kind, name').eq('id', roomId).single(),
    db.from('portal_staff').select('email, display_name').eq('email', senderEmail).maybeSingle(),
  ]);
  const from = sender ? shownName(sender) : senderEmail.split('@')[0];
  for (const m of members || []) {
    if (m.email === senderEmail || m.muted) continue;
    const { data: p } = await db.from('portal_staff').select('email, display_name, notify_email, last_active_at').eq('email', m.email).maybeSingle();
    if (!p || p.notify_email !== true) continue;   // opt-in only
    if (p.last_active_at && Date.now() - new Date(p.last_active_at).getTime() < 3 * 60_000) continue;   // they're here
    if (await recently(m.email, 'chat', roomId, CHAT_GAP_MIN)) continue;
    const where = room?.kind === 'group' ? ` in ${room.name}` : '';
    try {
      await sendMail({
        to: m.email, subject: `New message from ${from}${where}`, body: `${from}${where}: ${preview || (hasFile ? 'sent an attachment' : '')}`,
        eyebrow: 'New message', title: `${from} messaged you`, greeting: `Hi ${shownName(p).split(' ')[0]},`, preheader: preview || 'Open the portal to read it.',
        blocks: [{ type: 'quote', from: `${from}${where}`, text: preview ? preview.slice(0, 300) : '📎 Sent an attachment' }],
        cta: { label: 'Open the chat', href: `${site()}/chat?room=${roomId}` }, footerNote: 'Automatic notification, sent at most every 3 hours per chat. Turn off in My profile.',
        sign: { name: 'Admissions Portal', title: 'Notification' },
      });
      await mark(m.email, 'chat', roomId);
    } catch { /* a failed notification must never affect the chat */ }
  }
}

/** Tells a counselor when students are assigned to them (one email for a whole batch). */
export async function notifyAssigned(counselorName: string, students: { id: string; name: string; school: string | null; programme: string | null }[], by: string) {
  if (!students.length) return;
  const db = admin();
  const { data: c } = await db.from('portal_counselors').select('name, email').ilike('name', counselorName).maybeSingle();
  if (!c?.email) return;
  const { data: p } = await db.from('portal_staff').select('notify_email').eq('email', c.email.toLowerCase()).maybeSingle();
  if (!p || p.notify_email !== true) return;   // opt-in only
  const ref = students.map((s) => s.id).sort().join(',').slice(0, 200);
  if (await recently(c.email.toLowerCase(), 'assign', ref, 10)) return;
  const first = c.name.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '');
  try {
    await sendMail({
      to: c.email, subject: students.length === 1 ? `New student assigned: ${students[0].name}` : `${students.length} new students assigned to you`,
      body: `${students.map((s) => s.name).join(', ')} assigned to you.`, eyebrow: 'New assignment', title: students.length === 1 ? 'A new student is yours' : `${students.length} new students are yours`,
      greeting: `Hi ${first},`, preheader: students.map((s) => s.name).slice(0, 3).join(', '), replyTo: by, from: by,
      blocks: [{ type: 'students', rows: students.slice(0, 20).map((s) => ({ name: s.name, meta: [s.school, s.programme && s.programme.toUpperCase() !== 'N/A' ? s.programme : ''].filter(Boolean).join(' · ') })) }],
      cta: { label: 'Open my students', href: `${site()}/my` },
    });
    await mark(c.email.toLowerCase(), 'assign', ref);
  } catch { /* ignore */ }
}
