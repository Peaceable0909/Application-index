import { admin } from './supabase';
import { callScript } from './appsScript';
import { counselorKey, schoolShort } from './docs';
import { FINAL_STATUSES } from './constants';
import { loadStudents } from './overview';
import type { SRow } from './overview';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_DAYS = 3;
const firstName = (n: string) => (n.split(',').length > 1 ? n.split(',')[1] : n).trim().split(/\s+/)[0] || 'there';
const plain = (n: string) => n.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '');
const tidy = (v: string | null) => (v && v.toUpperCase() !== 'N/A' ? v : '');

/** Plain, fixed-wording request: only lists what the portal has verified is missing. No AI, no invention. */
export function docRequestEmail(r: SRow, sender: string) {
  const a = r.a;
  const uni = [schoolShort(a.school), tidy(a.programme)].filter(Boolean).join(' · ');
  const subject = `Documents needed for your application${a.school ? ` — ${schoolShort(a.school)}` : ''}`;
  const body = `Hi ${firstName(a.name)},\n\nWe're preparing your application${uni ? ` (${uni})` : ''} and still need the following ${r.missing.length === 1 ? 'document' : 'documents'}:\n\n${r.missing.map((d) => `• ${d}`).join('\n')}\n\nPlease reply to this email with clear scans or photos attached (PDF preferred) and we'll add ${r.missing.length === 1 ? 'it' : 'them'} to your file.\n\nIf you've already sent any of these, just let us know and we'll check.\n\nBest regards,\n${plain(sender)}\nPeaceable Admissions`;
  return { subject, body };
}

type Result = { sent: number; skipped: { name: string; why: string }[] };

/** Emails students their own missing-document list. Skips anyone with no address, nothing missing, or asked recently. */
export async function requestDocs(rows: SRow[], actor: string): Promise<Result> {
  const db = admin();
  const { data: counselors } = await db.from('portal_counselors').select('name,name_key,email');
  const since = new Date(Date.now() - COOLDOWN_DAYS * 864e5).toISOString();
  const ids = rows.map((r) => r.a.application_id);
  const { data: recent } = ids.length ? await db.from('portal_messages').select('application_id').eq('to_kind', 'student').like('subject', 'Documents needed%').gte('created_at', since).in('application_id', ids) : { data: [] };
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
    const { subject, body } = docRequestEmail(r, c?.name || actor.split('@')[0]);
    try {
      await callScript('sendEmail', { to: a.email, subject, body, replyTo: c?.email || actor });
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

export function digestEmail(name: string, mine: SRow[], signOff: string) {
  const lines = mine.slice(0, 40).map((r) => `• ${r.a.name} (${[schoolShort(r.a.school), r.a.status || 'no status'].filter(Boolean).join(', ')}): ${r.reasons.join('; ')}${r.missing.length ? ` — missing ${r.missing.join(', ')}` : ''}`);
  return {
    subject: `${mine.length} student${mine.length === 1 ? '' : 's'} need attention`,
    body: `Hi ${plain(name)},\n\nHere are your students who need attention right now:\n\n${lines.join('\n')}${mine.length > 40 ? `\n…and ${mine.length - 40} more.` : ''}\n\nPlease follow up where you can.\n\nThanks,\n${signOff}`,
  };
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
    const { subject, body } = digestEmail(c.name, mine, 'Peaceable Portal');
    try {
      await callScript('sendEmail', { to: c.email, subject: `Weekly: ${subject}`, body, replyTo: '' });
      await db.from('portal_messages').insert({ application_id: null, counselor_name: c.name, to_email: c.email, to_kind: 'counselor', subject: `Weekly: ${subject}`, body, sent_by: 'weekly digest' });
      sent++;
    } catch { /* one failure shouldn't stop the rest */ }
  }
  return { sent };
}
