'use server';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { EMAIL_OK, saveWeeklyConfig, sendWeeklyPreview } from '@/lib/weeklyReport';
import { workspacesFor } from '@/lib/workspace';

const back = (m: string, err = false): never => redirect(`/settings?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}#weekly`);

/** Admins: who gets the Monday summary, and whether it is on. */
export async function saveWeeklySummary(f: FormData) {
  const me = await requireTeam();
  if (me.role !== 'admin') return back('Only admins can change this.', true);
  const emails = [...new Set(String(f.get('emails') || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = emails.find((e) => !EMAIL_OK.test(e));
  if (bad) return back(`“${bad}” does not look like an email address.`, true);
  if (emails.length > 5) return back('Please keep it to 5 people or fewer.', true);
  const on = f.get('on') === '1';
  if (on && !emails.length) return back('Add at least one email address to turn it on.', true);
  await saveWeeklyConfig({ on, emails }, me.email);
  await audit(me.email, on ? 'weekly_report_on' : 'weekly_report_off', emails.join(', ') || null);
  back(on ? `Saved. The summary goes to ${emails.join(', ')} every Monday morning.` : 'Saved. The weekly summary is off.');
}

/** Admins: send the summary to yourself now, to see what it looks like. */
export async function previewWeeklySummary() {
  const me = await requireTeam();
  if (me.role !== 'admin') return back('Only admins can do this.', true);
  try { await sendWeeklyPreview(me.email, (await workspacesFor(me)).map((w) => w.key)); }
  catch (e) { return back(`Could not send the preview: ${(e as Error).message.slice(0, 160)}`, true); }
  back(`A preview is on its way to ${me.email}.`);
}
