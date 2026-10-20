import { admin } from './supabase';
import { loadStudents } from './overview';
import { inboxList } from './inbox';
import { canSee, type Staff } from './auth';
import { currentWorkspace } from './workspace';
import { FINAL_STATUSES, STALE_DAYS } from './constants';
import { isFormSubmission } from './attention';

// The daily follow-up list: students who need a message today, with the reason, found from what the portal already knows.
// Nothing is sent from here. A person picks a student, the Brain drafts the message, the person edits and sends it (or skips it).
export type Kind = 'reply' | 'docs' | 'passport' | 'interview' | 'follow_up';
export type Reason = { kind: Kind; text: string };
export type Nudge = { appId: string; name: string; school: string | null; email: string | null; counselor: string | null; reasons: Reason[]; missing: string[]; priority: number; at: string | null };

export const KIND_LABEL: Record<Kind, string> = { reply: 'Waiting for your reply', docs: 'Documents', passport: 'Passport', interview: 'Interview', follow_up: 'No news lately' };
const RANK: Record<Kind, number> = { reply: 0, docs: 1, passport: 2, interview: 3, follow_up: 4 };
const COOLDOWN_DAYS: Record<Kind, number> = { reply: 0, docs: 3, passport: 14, interview: 3, follow_up: 5 };
const DAY = 864e5;

/** Everyone this person should write to today, most urgent first. Counselors only get their own students. */
export async function outreachList(staff: Staff): Promise<Nudge[]> {
  const db = admin(), ws = await currentWorkspace(), now = Date.now();
  const { rows, all } = await loadStudents({ workspace: ws });
  const live = rows.filter((r) => !(r.a.status && FINAL_STATUSES.includes(r.a.status)) && canSee(staff, r.a.counselor) && r.a.email);
  if (!live.length) return [];
  const byApp = new Map(all.map((a) => [a.application_id, a.student_key]));
  const rowByKey = new Map(live.map((r) => [r.a.student_key, r]));

  const [{ data: sent }, { data: scans }, convos] = await Promise.all([
    db.from('portal_nudges').select('application_id, kind, channel, skip_until, created_at, portal_applications!inner(workspace)').eq('portal_applications.workspace', ws).gte('created_at', new Date(now - 30 * DAY).toISOString()).limit(5000),
    db.from('portal_doc_scans').select('application_id, expiry_date, detected_type, portal_applications!inner(workspace)').eq('portal_applications.workspace', ws).eq('detected_type', 'Passport').not('expiry_date', 'is', null).limit(3000),
    inboxList(staff).catch(() => []),
  ]);

  // reminders already sent or skipped recently, per student and kind
  const quiet = new Map<string, Set<Kind>>();
  for (const n of sent || []) {
    const key = byApp.get(n.application_id); if (!key) continue;
    const until = n.channel === 'skipped' ? (n.skip_until ? new Date(n.skip_until).getTime() : 0) : new Date(n.created_at).getTime() + COOLDOWN_DAYS[n.kind as Kind] * DAY;
    if (until > now) (quiet.get(key) || quiet.set(key, new Set()).get(key)!).add(n.kind as Kind);
  }
  const hold = (key: string, k: Kind) => quiet.get(key)?.has(k);
  const out = new Map<string, Nudge>();
  const add = (key: string, r: (typeof live)[number], reason: Reason, extra: Partial<Nudge> = {}) => {
    if (hold(key, reason.kind)) return;
    const cur = out.get(key) || { appId: r.a.application_id, name: r.a.name, school: r.a.school, email: r.a.email, counselor: r.a.counselor, reasons: [], missing: [], priority: 9, at: null };
    cur.reasons.push(reason); cur.priority = Math.min(cur.priority, RANK[reason.kind]); Object.assign(cur, extra);
    out.set(key, cur);
  };

  for (const r of live) {
    const key = r.a.student_key, days = r.a.submitted_at ? Math.floor((now - new Date(r.a.submitted_at).getTime()) / DAY) : 0;
    if (r.judged && r.missing.length && (r.docCount > 0 || (isFormSubmission(r.a) && days >= 2))) add(key, r, { kind: 'docs', text: r.docCount === 0 ? 'No documents received yet' : `Still missing: ${r.missing.join(', ')}` }, { missing: r.missing });
    if (/to be booked/i.test(r.a.interview || '')) add(key, r, { kind: 'interview', text: 'Interview still to be booked' });
  }
  for (const s of scans || []) {
    const key = byApp.get(s.application_id), r = key ? rowByKey.get(key) : null; if (!key || !r || !s.expiry_date) continue;
    const left = Math.floor((new Date(s.expiry_date).getTime() - now) / DAY);
    if (left < 183) add(key, r, { kind: 'passport', text: left < 0 ? `Passport expired on ${niceDate(s.expiry_date)}` : `Passport expires in ${left} days (${niceDate(s.expiry_date)})` });
  }
  for (const c of convos) {
    const key = byApp.get(c.appId), r = key ? rowByKey.get(key) : null;
    if (!key || !r || c.mine || Date.now() - new Date(c.at).getTime() < 4 * 3600_000) continue;
    add(key, r, { kind: 'reply', text: `Wrote ${ago(c.at)} and hasn’t had an answer: “${c.preview.slice(0, 80)}”` }, { at: c.at });
  }
  for (const r of live) {
    const key = r.a.student_key;
    if (out.has(key) || hold(key, 'follow_up')) continue;
    const idle = Math.floor((now - new Date(r.a.last_activity_at).getTime()) / DAY);
    if (idle >= STALE_DAYS * 2) add(key, r, { kind: 'follow_up', text: `No activity for ${idle} days` });
  }
  return [...out.values()].map((n) => ({ ...n, reasons: n.reasons.sort((a, b) => RANK[a.kind] - RANK[b.kind]) })).sort((a, b) => a.priority - b.priority || (a.at || '').localeCompare(b.at || '') || a.name.localeCompare(b.name));
}

const niceDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
function ago(iso: string) { const h = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3600_000)); return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; }

/** What the Brain is asked to cover for these reasons. The message is always checked and edited by a person before it goes out. */
export function instructionFor(n: Nudge): string {
  const parts = n.reasons.map((r) => {
    if (r.kind === 'reply') return 'Answer what the student last wrote, using only what we know.';
    if (r.kind === 'docs') return n.missing.length ? `Ask them kindly to send the missing documents: ${n.missing.join(', ')}. Name each one exactly.` : 'Say we have not received any documents yet and ask them to upload them.';
    if (r.kind === 'passport') return `Politely mention their passport: ${r.text}. Many universities want at least 6 months of validity, so ask them to renew if needed. Write any date as day, month name, year.`;
    if (r.kind === 'interview') return 'Remind them the next step is booking their interview, and that they can do it in the portal.';
    return 'Check in warmly, ask if they need any help, and mention what is still open on their file.';
  });
  return `Write one short chat message that covers only these points, in this order: ${parts.map((p, i) => `(${i + 1}) ${p}`).join(' ')} Keep it friendly and under 90 words.`;
}
