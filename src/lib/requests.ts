import { admin } from './supabase';
import { sendMail, signFor } from './mail';
import { addNotice } from './notices';
import { site, studentSite } from './emailTemplate';
import { counselorKey, schoolShort } from './docs';
import { FINAL_STATUSES, REQUIRED_DOCS } from './constants';
import { loadStudents } from './overview';
import type { SRow } from './overview';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_DAYS = 3;
const firstName = (n: string) => (n.split(',').length > 1 ? n.split(',')[1] : n).trim().split(/\s+/)[0] || 'there';
const plain = (n: string) => n.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '');
const tidy = (v: string | null) => (v && v.toUpperCase() !== 'N/A' ? v : '');

/** Fixed-wording request: only lists what the portal has verified is missing. No AI, no invention. */
export function docRequestEmail(r: SRow, replyTo: string) {
  const a = r.a;
  const uni = [schoolShort(a.school), tidy(a.programme)].filter(Boolean).join(' · ');
  const n = r.missing.length, total = REQUIRED_DOCS.length;
  const subject = `Documents needed for your application${a.school ? ` — ${schoolShort(a.school)}` : ''}`;
  const body = `Hi ${firstName(a.preferred_name || a.name)},\n\nWe're preparing your application${uni ? ` (${uni})` : ''} and still need the following ${n === 1 ? 'document' : 'documents'}:\n\n${r.missing.map((d) => `• ${d}`).join('\n')}\n\nYou can upload ${n === 1 ? 'it' : 'them'} in your student portal (${studentSite()}/student/login, sign in with this email address) or reply to this email with clear scans or photos attached.\n\nIf you've already sent any of these, just let us know and we'll check.`;
  const html = {
    eyebrow: 'Documents needed', title: n === 1 ? 'One document to go' : `${n} documents to go`, greeting: `Hi ${firstName(a.preferred_name || a.name)},`, preheader: `We still need ${r.missing.join(', ')} to move your application forward.`,
    blocks: [
      { type: 'p' as const, text: `Thank you for applying${uni ? ` to ${uni}` : ''}. We’re preparing your application and need ${n === 1 ? 'one more document' : 'a few more documents'} from you before we can submit it.` },
      { type: 'checklist' as const, title: n === 1 ? 'Still needed' : 'Still needed', items: r.missing, received: total - n, total },
      { type: 'p' as const, text: 'The quickest way is to upload them in your student portal. Sign in with this email address (we’ll send you a code, there is no password). You can also reply to this email with clear scans or photos attached.' },
      { type: 'note' as const, text: 'Already sent one of these? Just reply and tell us. We’ll check right away.' },
    ],
    cta: { label: 'Upload my documents', href: `${studentSite()}/student/login` },
  };
  return { subject, body, html };
}

type Result = { sent: number; skipped: { name: string; why: string }[] };

/** Emails students their own missing-document list. Skips anyone with no address, nothing missing, or asked recently. */
export async function requestDocs(rows: SRow[], actor: string, force = false): Promise<Result> {
  const db = admin();
  const { data: counselors } = await db.from('portal_counselors').select('name,name_key,email');
  const since = new Date(Date.now() - COOLDOWN_DAYS * 864e5).toISOString();
  const ids = rows.map((r) => r.a.application_id);
  const { data: recent } = ids.length && !force ? await db.from('portal_messages').select('application_id').eq('to_kind', 'student').like('subject', 'Documents needed%').gte('created_at', since).in('application_id', ids) : { data: [] };
  const asked = new Set((recent || []).map((m) => m.application_id));
  const out: Result = { sent: 0, skipped: [] };
  for (const r of rows) {
    const a = r.a, skip = (why: string) => out.skipped.push({ name: a.name, why });
    if (a.status && FINAL_STATUSES.includes(a.status)) { skip('already finished'); continue; }
    if (!r.judged) { skip('documents not checked yet'); continue; }
    if (!r.missing.length) { skip('nothing missing'); continue; }
    if (!a.email || !EMAIL_RE.test(a.email)) { skip('no email address'); continue; }
    if (asked.has(a.application_id)) { skip(`asked in the last ${COOLDOWN_DAYS} days`); continue; }
    const c = (counselors || []).find((x) => x.name_key === counselorKey(a.counselor));
    const reply = c?.email || actor;
    const { subject, body, html } = docRequestEmail(r, reply);
    try {
      await sendMail({ to: a.email, subject, body, replyTo: reply, from: reply, ...html });
      await addNotice({ email: a.email, applicationId: a.application_id, kind: 'docs', title: `Documents needed: ${r.missing.join(', ')}`, body: 'Please upload them in the Documents section of your student portal.', href: '/student#documents', by: actor });
      await db.from('portal_messages').insert({ application_id: a.application_id, counselor_name: c?.name || null, to_email: a.email, to_kind: 'student', subject, body, sent_by: actor });
      await db.from('portal_activity').insert({ application_id: a.application_id, actor, kind: 'email_sent', detail: { to: a.email, subject } });
      out.sent++;
    } catch { skip('send failed'); }
  }
  return out;
}

export const summarise = (r: Result) => {
  const why = new Map<string, string[]>();
  r.skipped.forEach((s) => why.set(s.why, [...(why.get(s.why) || []), s.name]));
  const parts = [...why].map(([w, n]) => `${n.length} ${w}${n.length <= 3 ? ` (${n.join(', ')})` : ''}`);
  return r.sent ? `Asked ${r.sent} student${r.sent === 1 ? '' : 's'} for their missing documents.${parts.length ? ` Skipped: ${parts.join('; ')}.` : ''}` : `No requests sent.${parts.length ? ` Skipped: ${parts.join('; ')}.` : ''}`;
};

export function digestEmail(name: string, mine: SRow[], intro = 'Here are your students who need attention right now.') {
  const subject = `${mine.length} student${mine.length === 1 ? '' : 's'} need attention`;
  const lines = mine.slice(0, 40).map((r) => `• ${r.a.name} (${[schoolShort(r.a.school), r.a.status || 'no status'].filter(Boolean).join(', ')}): ${r.reasons.join('; ')}${r.missing.length ? ` — missing ${r.missing.join(', ')}` : ''}`);
  const body = `Hi ${plain(name)},\n\n${intro}\n\n${lines.join('\n')}${mine.length > 40 ? `\n…and ${mine.length - 40} more.` : ''}\n\nPlease follow up where you can.\n\nOpen your students: ${site()}/my`;
  const html = {
    eyebrow: 'Weekly digest', title: `${mine.length} student${mine.length === 1 ? '' : 's'} need${mine.length === 1 ? 's' : ''} your attention`, greeting: `Hi ${plain(name)},`, preheader: `${mine.slice(0, 3).map((r) => r.a.name).join(', ')}${mine.length > 3 ? ` and ${mine.length - 3} more` : ''}`,
    blocks: [
      { type: 'p' as const, text: intro },
      { type: 'students' as const, title: `Needs attention · ${mine.length}`, rows: mine.slice(0, 25).map((r) => ({ name: r.a.name, meta: [schoolShort(r.a.school), tidy(r.a.programme)].filter(Boolean).join(' · '), status: r.a.status || undefined, needs: [...r.reasons.filter((x) => !/Not in master|No counselor/.test(x)), ...(r.missing.length ? [`Missing: ${r.missing.join(', ')}`] : [])].join(' · ') || undefined })) },
      ...(mine.length > 25 ? [{ type: 'note' as const, text: `…and ${mine.length - 25} more in the portal.` }] : []),
      { type: 'p' as const, text: 'Please follow up where you can. Everything is one tap away in the portal.' },
    ],
    cta: { label: 'Open my students', href: `${site()}/my` },
  };
  return { subject, body, html };
}

/** Monday-morning digest to every counselor with an address and something to act on (opt-in: WEEKLY_DIGEST=on). */
export async function sendWeeklyDigests() {
  if (process.env.WEEKLY_DIGEST !== 'on') return { skipped: 'WEEKLY_DIGEST is off' };
  const db = admin();
  const [{ rows }, { data: counselors }] = await Promise.all([loadStudents(), db.from('portal_counselors').select('*')]);
  const since = new Date(Date.now() - 6 * 864e5).toISOString();
  let sent = 0;
  for (const c of counselors || []) {
    if (!c.email) continue;
    const mine = rows.filter((r) => counselorKey(r.a.counselor) === c.name_key && r.reasons.length && !(r.a.status && FINAL_STATUSES.includes(r.a.status)));
    if (!mine.length) continue;
    const { data: done } = await db.from('portal_messages').select('id').eq('to_email', c.email).eq('sent_by', 'weekly digest').gte('created_at', since).limit(1);
    if (done?.length) continue;
    const { subject, body, html } = digestEmail(c.name, mine);
    try {
      await sendMail({ to: c.email, subject: `Weekly: ${subject}`, body, sign: await signFor(null, 'WhiteRock Admissions'), ...html });
      await db.from('portal_messages').insert({ application_id: null, counselor_name: c.name, to_email: c.email, to_kind: 'counselor', subject: `Weekly: ${subject}`, body, sent_by: 'weekly digest' });
      sent++;
    } catch { /* one failure shouldn't stop the rest */ }
  }
  return { sent };
}

// ---- payment reminders (Regent) ----
const PAY_COOLDOWN_DAYS = 5;
export const isPaid = (p: string | null) => /^paid/i.test((p || '').trim());

export function paymentReminderEmail(r: SRow, replyTo: string) {
  const a = r.a, uni = [schoolShort(a.school), tidy(a.programme)].filter(Boolean).join(' · ');
  const ref = a.opp_id ? a.opp_id.replace(/^OPP ID-/i, '') : '';
  const subject = `Payment reminder${a.school ? ` — ${schoolShort(a.school)}` : ''}`;
  const body = `Hi ${firstName(a.preferred_name || a.name)},\n\nOur records show the payment for your application${uni ? ` (${uni})` : ''} has not been received yet.${ref ? `\n\nReference: ${ref}` : ''}\n\nOnce you have paid, please reply to this email with your proof of payment so we can move your application forward. If you have already paid, just let us know and we'll check straight away.`;
  const html = {
    eyebrow: 'Payment reminder', title: 'Payment still pending', greeting: `Hi ${firstName(a.preferred_name || a.name)},`, preheader: 'We have not received the payment for your application yet.',
    blocks: [
      { type: 'p' as const, text: `Our records show the payment for your application${uni ? ` to ${uni}` : ''} has not been received yet.` },
      ...(ref ? [{ type: 'students' as const, rows: [{ name: uni || 'Your application', meta: `Reference: ${ref}`, status: 'Payment pending' }] }] : []),
      { type: 'p' as const, text: 'Once you have paid, please reply to this email with your proof of payment so we can move your application forward.' },
      { type: 'note' as const, text: 'Already paid? Just reply and tell us. We’ll check straight away.' },
    ],
    cta: replyTo ? { label: 'Send proof of payment', href: `mailto:${replyTo}?subject=${encodeURIComponent('Proof of payment — ' + a.name)}` } : undefined,
  };
  return { subject, body, html };
}

export async function sendPaymentReminders(rows: SRow[], actor: string, force = false): Promise<Result> {
  const db = admin();
  const { data: counselors } = await db.from('portal_counselors').select('name,name_key,email');
  const since = new Date(Date.now() - PAY_COOLDOWN_DAYS * 864e5).toISOString();
  const ids = rows.map((r) => r.a.application_id);
  const { data: recent } = ids.length && !force ? await db.from('portal_messages').select('application_id').eq('to_kind', 'student').like('subject', 'Payment reminder%').gte('created_at', since).in('application_id', ids) : { data: [] };
  const asked = new Set((recent || []).map((m) => m.application_id));
  const out: Result = { sent: 0, skipped: [] };
  for (const r of rows) {
    const a = r.a, skip = (why: string) => out.skipped.push({ name: a.name, why });
    if (!a.in_regent) { skip('not in Regent Only'); continue; }
    if (isPaid(a.payment)) { skip('already paid'); continue; }
    if (a.status && FINAL_STATUSES.includes(a.status)) { skip('already finished'); continue; }
    if (!a.email || !EMAIL_RE.test(a.email)) { skip('no email address'); continue; }
    if (asked.has(a.application_id)) { skip(`reminded in the last ${PAY_COOLDOWN_DAYS} days`); continue; }
    const c = (counselors || []).find((x) => x.name_key === counselorKey(a.counselor));
    const reply = c?.email || actor, { subject, body, html } = paymentReminderEmail(r, reply);
    try {
      await sendMail({ to: a.email, subject, body, replyTo: reply, from: reply, ...html });
      await addNotice({ email: a.email, applicationId: a.application_id, kind: 'payment', title: 'Payment reminder', body: 'We haven’t received the payment for your application yet. Reply to the email with your proof of payment.', href: '/student#application', by: actor });
      await db.from('portal_messages').insert({ application_id: a.application_id, counselor_name: c?.name || null, to_email: a.email, to_kind: 'student', subject, body, sent_by: actor });
      await db.from('portal_activity').insert({ application_id: a.application_id, actor, kind: 'email_sent', detail: { to: a.email, subject } });
      out.sent++;
    } catch { skip('send failed'); }
  }
  return out;
}
export const summariseReminders = (r: Result) => summarise(r).replace('for their missing documents', 'a payment reminder').replace('Asked', 'Reminded');
