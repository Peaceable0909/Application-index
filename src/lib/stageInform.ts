// "Inform student": the optional email that tells a student their application moved to a new stage.
//
// It is a second, separate action. Moving the stage never sends anything; the student's dashboard shows the new stage the moment it is saved.
// A counselor can then choose to send this email. It reuses the portal's one email path (sendMail, the portal_messages log, the student's
// in-portal notice) and records on the stage change itself who sent it, when, to which address and whether it worked, which is also what
// stops it going out twice. A failed send leaves the stage as it is and can be tried again.
import { sendMail, signFor } from './mail';
import { addNotice } from './notices';
import { plainToSpec, renderEmail, studentSite } from './emailTemplate';
import { schoolDisplay } from './docs';
import { findStage, studentAsks } from './stageEngine';
import { loadContext } from './stageCore';
import { SENDING_STALE_MS, stageEmailDraft, stageEmailProblem, type InformState } from './stageEmailText';
import type { Db } from './stages';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INFORMABLE = ['move', 'override', 'placed'];

/** The two outside effects of sending, swappable so tests can run without email or push. */
export type InformIO = {
  send?: (m: { to: string; subject: string; body: string; by: string }) => Promise<void>;
  notice?: (m: { to: string; appId: string; subject: string; body: string; by: string }) => Promise<void>;
};
const realSend: NonNullable<InformIO['send']> = async (m) => {
  const spec = plainToSpec(m.body);
  await sendMail({ to: m.to, subject: m.subject, body: m.body, replyTo: m.by, from: m.by, eyebrow: 'Application update', title: m.subject.slice(0, 120), greeting: spec.greeting, blocks: spec.blocks, cta: { label: 'Open my student portal', href: `${studentSite()}/student` } });
};
const realNotice: NonNullable<InformIO['notice']> = (m) => addNotice({ email: m.to, applicationId: m.appId, kind: 'message', title: m.subject, body: m.body.replace(/\s+/g, ' ').slice(0, 220), href: '/student', by: m.by });

export type InformInfo = { historyId: string; stage: string; state: InformState; at: string | null; by: string | null; to: string | null; error: string | null };
type Fail = { ok: false; error: string };

type HistRow = { id: string; application_id: string; to_key: string | null; to_name: string | null; kind: string; moved_at: string; inform_state: InformState; informed_at: string | null; informed_by: string | null; inform_to: string | null; inform_error: string | null };
const HCOLS = 'id, application_id, to_key, to_name, kind, moved_at, inform_state, informed_at, informed_by, inform_to, inform_error';

/** What the stage screens need to show the Inform button for the application's current stage: its latest stage change, if it can be announced. */
export async function latestInformable(db: Db, appId: string, stageKey: string | null): Promise<InformInfo | null> {
  if (!stageKey) return null;
  const { data } = await db.from('portal_stage_history').select(HCOLS).eq('application_id', appId).order('moved_at', { ascending: false }).limit(1);
  const h = (data || [])[0] as HistRow | undefined;
  if (!h || !h.to_key || h.to_key !== stageKey || !INFORMABLE.includes(h.kind)) return null;
  return { historyId: h.id, stage: h.to_name || '', state: h.inform_state, at: h.informed_at, by: h.informed_by, to: h.inform_to, error: h.inform_error };
}

type Target = { hist: HistRow; app: { name: string; preferred_name: string | null; email: string | null; school: string | null; programme: string | null; counselor: string | null }; stageName: string; note: string | null; asks: { label: string; again: boolean }[]; school: string };

/** Loads everything for one stage change and checks it may be announced: it is the application's current stage, and the student has an email address. */
async function target(db: Db, appId: string, historyId: string): Promise<Target | Fail> {
  const { data: h } = await db.from('portal_stage_history').select(HCOLS).eq('id', historyId).eq('application_id', appId).maybeSingle();
  if (!h) return { ok: false, error: 'That stage change was not found for this student.' };
  const hist = h as HistRow;
  if (!hist.to_key || !INFORMABLE.includes(hist.kind)) return { ok: false, error: 'There is nothing to tell the student about this change.' };
  const c = await loadContext(db, appId);
  if ('error' in c) return { ok: false, error: c.error };
  if (c.app.stage_key !== hist.to_key) return { ok: false, error: 'The application has moved on since. Tell the student about its current stage instead.' };
  const { data: later } = await db.from('portal_stage_history').select('id').eq('application_id', appId).gt('moved_at', hist.moved_at).not('to_key', 'is', null).limit(1);
  if ((later || []).length) return { ok: false, error: 'The application has moved on since. Tell the student about its current stage instead.' };
  const { data: a } = await db.from('portal_applications').select('name, preferred_name, email, school, programme, counselor').eq('application_id', appId).maybeSingle();
  if (!a) return { ok: false, error: 'Application not found.' };
  const stage = findStage(c.wf, hist.to_key);
  const asks = studentAsks(c.wf, c.st).map((r) => ({ label: r.label, again: r.status === 'rejected' }));
  return { hist, app: a as Target['app'], stageName: hist.to_name || stage?.name || '', note: stage?.student_note ?? null, asks, school: schoolDisplay(a.school) || c.wf.school_name };
}

export type InformDraft = { ok: true; to: string | null; name: string; subject: string; body: string; info: InformInfo } | Fail;

/** The email as it would be sent, for the counselor to read and edit. Always goes to the address on the student's application. */
export async function draftInform(db: Db, appId: string, historyId: string): Promise<InformDraft> {
  const t = await target(db, appId, historyId);
  if ('ok' in t) return t;
  const first = (t.app.preferred_name || t.app.name || 'there').split(/[\s,]+/).filter(Boolean)[0] || 'there';
  const d = stageEmailDraft({ first, school: t.school, programme: t.app.programme, stage: t.stageName, note: t.note, asks: t.asks, counselor: t.app.counselor });
  const to = t.app.email && EMAIL_RE.test(t.app.email.trim()) ? t.app.email.trim().toLowerCase() : null;
  return { ok: true, to, name: t.app.name, subject: d.subject, body: d.body, info: { historyId, stage: t.stageName, state: t.hist.inform_state, at: t.hist.informed_at, by: t.hist.informed_by, to: t.hist.inform_to, error: t.hist.inform_error } };
}

/** The designed email for the text as it stands now (what the student would see), signed by the person sending it. */
export async function previewInform(db: Db, appId: string, historyId: string, by: string, subject: string, body: string): Promise<{ ok: true; html: string } | Fail> {
  const t = await target(db, appId, historyId);
  if ('ok' in t) return t;
  const spec = plainToSpec(body);
  const html = renderEmail({ preheader: body.replace(/\s+/g, ' ').slice(0, 110), eyebrow: 'Application update', title: subject.slice(0, 120), greeting: spec.greeting, blocks: spec.blocks, cta: { label: 'Open my student portal', href: `${studentSite()}/student` }, sign: await signFor(by) });
  return { ok: true, html };
}

/**
 * Sends it. Exactly one caller can win the claim on a stage change (first never-sent, then failed, then lost "sending"), so a double click, a
 * second browser tab or a retry cannot send it twice. Once it is sent, it stays sent.
 */
export async function sendInform(db: Db, o: { appId: string; historyId: string; by: string; subject: string; body: string }, io: InformIO = {}): Promise<{ ok: true; to: string; at: string } | Fail> {
  const subject = o.subject.trim(), body = o.body.trim();
  const bad = stageEmailProblem(subject, body);
  if (bad) return { ok: false, error: bad };
  const t = await target(db, o.appId, o.historyId);
  if ('ok' in t) return t;
  const to = t.app.email && EMAIL_RE.test(t.app.email.trim()) ? t.app.email.trim().toLowerCase() : null;
  if (!to) return { ok: false, error: 'This student has no email address on their application, so there is nobody to send it to. Add one first.' };
  if (t.hist.inform_state === 'sent') return { ok: false, error: `The student was already informed${t.hist.informed_at ? ` on ${new Date(t.hist.informed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Nothing was sent again.` };

  const at = new Date().toISOString(), stale = new Date(Date.now() - SENDING_STALE_MS).toISOString();
  const claim = { inform_state: 'sending', informed_at: at, informed_by: o.by, inform_to: to, inform_subject: subject.slice(0, 200), inform_error: null };
  const attempt = () => db.from('portal_stage_history').update(claim).eq('id', o.historyId).eq('application_id', o.appId);
  const tries = [() => attempt().is('inform_state', null), () => attempt().eq('inform_state', 'failed'), () => attempt().eq('inform_state', 'sending').lt('informed_at', stale)];
  let won = false;
  for (const t of tries) {
    const { data } = await t().select('id');
    if ((data || []).length) { won = true; break; }
  }
  if (!won) return { ok: false, error: 'This update is already being sent, or was just sent. Nothing was sent again.' };

  try {
    await (io.send ?? realSend)({ to, subject, body, by: o.by });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await db.from('portal_stage_history').update({ inform_state: 'failed', inform_error: msg }).eq('id', o.historyId);
    return { ok: false, error: `The stage is updated, but the email could not be sent: ${msg}. You can try again.` };
  }

  // After a successful send, record it everywhere it belongs. None of this may fail the action: the email has gone.
  let messageId: string | null = null;
  try {
    const { data: m } = await db.from('portal_messages').insert({ application_id: o.appId, counselor_name: t.app.counselor || null, to_email: to, to_kind: 'student', subject, body, sent_by: o.by }).select('id').maybeSingle();
    messageId = (m?.id as string | undefined) ?? null;
  } catch { /* the log is a record only */ }
  for (let n = 0; n < 3; n++) {   // the email has gone: make sure it is recorded as sent, or a later retry could send it again
    const { error } = await db.from('portal_stage_history').update({ inform_state: 'sent', inform_error: null, inform_message_id: messageId }).eq('id', o.historyId);
    if (!error) break;
  }
  try { await db.from('portal_activity').insert({ application_id: o.appId, actor: o.by, kind: 'stage_informed', detail: { stage: t.stageName, to } }); } catch { /* record only */ }
  try { await (io.notice ?? realNotice)({ to, appId: o.appId, subject, body, by: o.by }); } catch { /* the portal notice is a bonus */ }
  return { ok: true, to, at };
}

/** Used by tests and the admin tools: is this stage change waiting to be announced, in progress, done, or failed? */
export const informLabel = (s: InformState) => (s === 'sent' ? 'Student informed' : s === 'sending' ? 'Sending' : s === 'failed' ? 'Email failed' : 'Student not informed');
