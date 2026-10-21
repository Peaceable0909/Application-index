import { admin } from './supabase';
import { sendMail, signFor } from './mail';
import { site } from './emailTemplate';
import { audit } from './audit';
import { buildWeekly, pct, type Week, type Weekly } from './funnel';
import { listWorkspaces } from './workspace';
import type { Block } from './emailTemplate';

export type WeeklyCfg = { on: boolean; emails: string[]; last_sent: string | null };
const EMPTY: WeeklyCfg = { on: false, emails: [], last_sent: null };
export const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function weeklyConfig(): Promise<WeeklyCfg> {
  const { data } = await admin().from('portal_settings').select('value').eq('key', 'weekly_report').maybeSingle();
  const v = (data?.value || {}) as Partial<WeeklyCfg>;
  return { on: v.on === true, emails: Array.isArray(v.emails) ? v.emails.filter((e) => typeof e === 'string' && EMAIL_OK.test(e)) : [], last_sent: v.last_sent || null };
}
export async function saveWeeklyConfig(patch: Partial<WeeklyCfg>, by: string) {
  const next = { ...(await weeklyConfig()), ...patch };
  await admin().from('portal_settings').upsert({ key: 'weekly_report', value: next, updated_by: by, updated_at: new Date().toISOString() });
  return next;
}

const delta = (now: number, before: number) => (now === before ? 'same as last week' : now > before ? `up ${now - before} on last week` : `down ${before - now} on last week`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The weekly summary written for someone who wants the picture in under a minute. Plain words, no icons. */
export function weeklyEmail(w: Weekly) {
  const t = w.thisWeek, p = w.lastWeek, r = w.recent.total;
  const day = new Date(w.now).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `Weekly summary: ${plural(t.students, 'new student')}, ${plural(t.offers, 'offer')}, ${plural(t.enrolled, 'enrolment')}`;
  const headline: string[] = [
    `New chats from the website: ${t.chats} (${delta(t.chats, p.chats)})`,
    `New students: ${t.students} (${delta(t.students, p.students)})`,
    `Students who reached an offer: ${t.offers} (${delta(t.offers, p.offers)})`,
    `Enrolled: ${t.enrolled} (${delta(t.enrolled, p.enrolled)})`,
    `Active students right now: ${w.active}`,
  ];
  const line = (k: string, x: Week) => `${k}: ${plural(x.chats, 'chat')}, ${plural(x.students, 'new student')}, ${plural(x.offers, 'offer')}, ${plural(x.enrolled, 'enrolment')}`;
  const countries = w.byWorkspace.length > 1 ? w.byWorkspace.map((c) => line(c.name, c.thisWeek)) : [];
  const funnel = `Over the last 90 days: ${plural(r.chats, 'chat')} started${r.chats ? `, ${r.fromChats} became students (${pct(r.fromChats, r.chats)}%)` : ''}. Of ${plural(r.students, 'student')} who applied, ${r.offers} reached an offer (${pct(r.offers, r.students)}%) and ${r.enrolled} enrolled (${pct(r.enrolled, r.students)}%).`;
  const body = [`Weekly summary for the week to ${day}.`, '', ...headline, ...(countries.length ? ['', 'By country:', ...countries] : []), '', funnel, '', `Full report: ${site()}/reports`].join('\n');
  const blocks: Block[] = [
    { type: 'p', text: `Here is how the last seven days went, compared with the seven before.` },
    { type: 'list', items: headline },
    ...(countries.length ? [{ type: 'steps' as const, title: 'By country', items: countries }] : []),
    { type: 'note', text: funnel },
  ];
  return { subject, body, blocks, preheader: `${plural(t.students, 'new student')}, ${plural(t.offers, 'offer')}, ${plural(t.enrolled, 'enrolment')} this week.`, title: 'Your weekly summary', greeting: 'Hello,' };
}

async function send(to: string, w: Weekly) {
  const e = weeklyEmail(w);
  await sendMail({ to, subject: e.subject, body: e.body, eyebrow: 'Weekly summary', title: e.title, greeting: e.greeting, preheader: e.preheader, blocks: e.blocks, cta: { label: 'Open the full report', href: `${site()}/reports` }, sign: await signFor(null, 'WhiteRock Educational Services'), footerNote: 'Sent every Monday morning. An admin can change who gets it in Settings.' });
}

/** Runs from the daily job: on Mondays, sends the summary once to the people an admin chose (off until they switch it on). */
export async function sendWeeklyReport(): Promise<{ skipped?: string; sent?: number }> {
  const cfg = await weeklyConfig();
  if (!cfg.on || !cfg.emails.length) return { skipped: 'weekly summary is off' };
  const now = new Date();
  if (now.getUTCDay() !== 1) return { skipped: 'not Monday' };
  if (cfg.last_sent && now.getTime() - Date.parse(cfg.last_sent) < 5 * 864e5) return { skipped: 'already sent this week' };
  // claim this week first, so two overlapping calls cannot both send
  await saveWeeklyConfig({ last_sent: now.toISOString() }, 'weekly summary');
  const w = await buildWeekly((await listWorkspaces()).filter((s) => s.active).map((s) => s.key), now);
  let sent = 0;
  for (const to of cfg.emails) { try { await send(to, w); sent++; } catch { /* one bad address must not stop the rest */ } }
  await audit('system', 'weekly_report_sent', `${sent}/${cfg.emails.length}`);
  return { sent };
}

/** "Send me a preview": the same email to one person, without counting as this week's send. */
export async function sendWeeklyPreview(to: string, keys: string[]) {
  await send(to, await buildWeekly(keys, new Date()));
}
