'use server';
import { revalidatePath } from 'next/cache';
import { requireStaff, canAccessApp } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { postMessage } from '@/lib/thread';
import { sendMail } from '@/lib/mail';

const KINDS = ['reply', 'docs', 'passport', 'interview', 'follow_up'] as const;
const kindsOf = (f: FormData) => String(f.get('kinds') || '').split(',').filter((k): k is (typeof KINDS)[number] => (KINDS as readonly string[]).includes(k));
type Res = { ok: boolean; error?: string };

/** Sends the (edited) follow-up as a chat message, or as an email, and remembers it so the same reminder isn't offered again too soon. */
export async function sendNudge(f: FormData): Promise<Res> {
  const staff = await requireStaff();
  const appId = String(f.get('appId') || ''), body = String(f.get('body') || '').trim().slice(0, 2000), channel = f.get('channel') === 'email' ? 'email' : 'chat', kinds = kindsOf(f);
  if (!appId || !(await canAccessApp(staff, appId))) return { ok: false, error: 'You can’t write to that student.' };
  if (body.length < 3) return { ok: false, error: 'Write the message first.' };
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('name, email').eq('application_id', appId).maybeSingle();
  const email = app?.email?.trim().toLowerCase();
  if (!app || !email) return { ok: false, error: 'This student has no email on file, so there is nobody to send to.' };
  if (channel === 'chat') {
    const r = await postMessage({ role: 'staff', email: staff.email, appId, studentEmail: email, staff }, { body });
    if (!r.ok) return { ok: false, error: r.error || 'Could not send.' };
  } else {
    try { await sendMail({ to: email, subject: 'An update on your application', body, replyTo: staff.email, from: staff.email, eyebrow: 'Message' }); }
    catch (e) { return { ok: false, error: `The email could not be sent: ${(e as Error).message}` }; }
    await db.from('portal_messages').insert({ application_id: appId, to_email: email, to_kind: 'student', subject: 'An update on your application', body, sent_by: staff.email });
  }
  if (kinds.length) await db.from('portal_nudges').insert(kinds.map((kind) => ({ application_id: appId, kind, channel, by: staff.email })));
  await db.from('portal_activity').insert({ application_id: appId, actor: staff.email, kind: 'nudge_sent', detail: { channel, kinds } });
  revalidatePath('/outreach');
  return { ok: true };
}

/** "Not today": hides the reminder for a few days. */
export async function skipNudge(f: FormData): Promise<Res> {
  const staff = await requireStaff();
  const appId = String(f.get('appId') || ''), kinds = kindsOf(f), days = Math.min(30, Math.max(1, Number(f.get('days')) || 3));
  if (!appId || !(await canAccessApp(staff, appId))) return { ok: false, error: 'Not allowed.' };
  if (kinds.length) await admin().from('portal_nudges').insert(kinds.map((kind) => ({ application_id: appId, kind, channel: 'skipped', by: staff.email, skip_until: new Date(Date.now() + days * 864e5).toISOString() })));
  revalidatePath('/outreach');
  return { ok: true };
}
