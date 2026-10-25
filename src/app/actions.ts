'use server';
import { currentWorkspace } from '@/lib/workspace';
import { redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { admin, sessionClient } from '@/lib/supabase';
import { guardApp, requireStaff, requireTeam } from '@/lib/auth';
import { callScript, DriveFile } from '@/lib/appsScript';
import { counselorKey, docTypeFromName, dobForMaster, progressFor, schoolDisplay, schoolKey, schoolShort, studentKey } from '@/lib/docs';
import { createHash } from 'crypto';
import { ALL_DOC_TYPES, CAS_STATUSES, VISA_STATUSES } from '@/lib/constants';
import { syncAll, syncFolders } from '@/lib/sync';
import { tabArgs } from '@/lib/sheets';
import { writeBack } from '@/lib/sheetWrite';
import { loadContext as loadStageContext } from '@/lib/stageCore';
import { studentAsks } from '@/lib/stageEngine';
import { typeFields } from '@/lib/driveUpload';
import { ensureFolder } from '@/lib/driveFolders';
import { requiredDocs, workspacesFor } from '@/lib/workspace';
import { wsKey } from '@/lib/workspaceCore';
import { STATUSES } from '@/lib/constants';
import { requestDocs, summarise, digestEmail, sendPaymentReminders, summariseReminders } from '@/lib/requests';
import { sendMail } from '@/lib/mail';
import { site, studentSite } from '@/lib/emailTemplate';
import { audit } from '@/lib/audit';
import { ACT_COOKIE, actCookie } from '@/lib/session';
import { addNotice } from '@/lib/notices';
import { shownName } from '@/lib/profile';
import { cleanLabel, resolveLabel } from '@/lib/docLabel';
import { bookSlotCore, emailBooking, emailCounselorBooking, MIN_NOTICE_H } from '@/lib/interviews';
import { checkMeetingUrl } from '@/lib/meet';
import { appsForEmail, currentStudent, isStudentEmail } from '@/lib/student';
import { runBackup } from '@/lib/backup';
import { notifyAssigned } from '@/lib/notify';
import { isRecent, justDid, splitDuplicates } from '@/lib/doubleSubmit';
import { reassign, reassignMany, routeApplications } from '@/lib/assignCore';
import { notifyOwnerByKey, notifyRouting } from '@/lib/assignNotify';
import { after } from 'next/server';
import { canAccessApp } from '@/lib/auth';
import { docScanEnabled, scanOne } from '@/lib/docscan';
import { typeSuggestions } from '@/lib/scanQueue';
import { draftEmail, PURPOSES, PurposeKey, TONES, ToneKey } from '@/lib/draft';
import { aiOverview, aiStudentSummary, computeFacts, loadStudents, refreshTasks, studentFacts } from '@/lib/overview';
import { getCatalog } from '@/lib/moveCatalog';
import { pushPendingMoves } from '@/lib/moveCore';
import { canonicalProgramme, canonicalSchool } from '@/lib/moves';

// redirect() works by throwing; a catch block must pass that through instead of reporting it as an error.
const rethrow = (e: unknown) => { if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e; };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (id: string, msg: string, err = false, returnTo?: string) => {
  const base = returnTo && /^\/(?!\/)/.test(returnTo) ? returnTo : `/applications/${encodeURIComponent(id)}`;
  redirect(`${base}${base.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
};

async function log(applicationId: string, actor: string, kind: string, detail: object = {}) {
  const db = admin();
  await db.from('portal_activity').insert({ application_id: applicationId, actor, kind, detail });
  await db.from('portal_applications').update({ last_activity_at: new Date().toISOString() }).eq('application_id', applicationId);
}

export async function signIn(f: FormData) {
  const sb = await sessionClient();
  const { error } = await sb.auth.signInWithPassword({ email: s(f, 'email'), password: s(f, 'password') });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  (await cookies()).set(ACT_COOKIE, String(Date.now()), actCookie());   // a fresh sign-in restarts the "still here" clock
  redirect('/');
}
export async function signInWithGoogle() {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  const sb = await sessionClient();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${proto}://${host}/auth/callback`, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent(error?.message || 'Google sign-in failed')}`);
  redirect(data.url);
}
/** A signed-in team member sets (or changes) the password they can use next to Google sign-in. The password is typed here and never leaves the sign-in service. */
export async function setPassword(f: FormData) {
  const staff = await requireStaff();
  const pw = String(f.get('password') ?? ''), again = String(f.get('again') ?? '');
  const back = (m: string, err = false) => redirect(`/profile?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}#password`);
  if (pw.length < 10) return back('Use at least 10 characters.', true);
  if (pw !== again) return back('The two passwords don’t match.', true);
  if (pw.toLowerCase().includes(staff.email.split('@')[0].toLowerCase()) && staff.email.split('@')[0].length >= 4) return back('Don’t put your email name inside the password.', true);
  const { error } = await (await sessionClient()).auth.updateUser({ password: pw });
  if (error) return back(/different/i.test(error.message) ? 'That is already your password.' : /reauth|recent/i.test(error.message) ? 'For safety, sign out and sign in again, then set the password.' : `Couldn’t save it: ${error.message}`, true);
  await audit(staff.email, 'password_set', staff.email);
  back('Password saved. You can now sign in with your email and password as well as Google.');
}

/** "Forgot password" on the team sign-in page. The answer is the same whether or not the email has access, so it can't be used to find out who is on the team. */
export async function sendPasswordReset(f: FormData) {
  const email = s(f, 'email').toLowerCase();
  const generic = '/login?notice=' + encodeURIComponent('If that email has portal access, a link to set a new password is on its way. It can take a minute.');
  if (!EMAIL_RE.test(email)) redirect('/login?error=' + encodeURIComponent('Enter your email first.'));
  const { data: row } = await admin().from('portal_staff').select('email').eq('email', email).maybeSingle();
  const jar = await cookies(), tag = createHash('sha1').update(email).digest('hex').slice(0, 16);
  if (row && !justDid(jar.get('pw_reset_last')?.value, tag)) {   // a second tap within a minute does not send a second email (the message shown is the same either way)
    const h = await headers(), host = h.get('x-forwarded-host') || h.get('host'), proto = h.get('x-forwarded-proto') || 'https';
    jar.set('pw_reset', '1', { path: '/', maxAge: 3600, httpOnly: true, secure: true, sameSite: 'lax' });
    jar.set('pw_reset_last', `${tag}:${Date.now()}`, { path: '/', maxAge: 120, httpOnly: true, secure: true, sameSite: 'lax' });
    await (await sessionClient()).auth.resetPasswordForEmail(email, { redirectTo: `${proto}://${host}/auth/callback` });
  }
  redirect(generic);
}

export async function signOut() {
  const sb = await sessionClient();
  await sb.auth.signOut();
  (await cookies()).delete(ACT_COOKIE);
  redirect('/login');
}

export async function syncNow(f: FormData) {
  const ret = s(f, 'returnTo') === '/applications' ? '/applications' : '/';
  await requireTeam();
  let msg: string;
  try {
    const r = await syncAll({ full: f.get('full') === '1' });
    const pending = await pushPendingMoves({ max: 25, budgetMs: 15_000 }).catch(() => ({ tried: 0, done: 0 }));   // moves the sheet missed
    msg = `${pending.done ? `${pending.done} moved student${pending.done === 1 ? '' : 's'} written to Sheet1. ` : ''}Synced ${r.total} students · ${r.formSubmissions} with a form submission · ${r.inMaster} in Sheet1 · ${r.inRegent} in Regent Only · ${r.formOnly} not yet in Sheet1 · ${r.created} new.${r.warnings.length ? ` Warning: ${r.warnings.join('; ')}` : ''}`;
  } catch (e) { rethrow(e); msg = `Sync failed: ${(e as Error).message}`; }
  revalidatePath('/');
  redirect(`${ret}?msg=${encodeURIComponent(msg)}`);
}

// Appends a form-only student to the master sheet. Returns 'added' | 'exists' | error text.
async function pushToMaster(id: string, actor: string, status: string, counselor?: string): Promise<string> {
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('*').eq('application_id', id).single();
  if (!a) return 'Application not found';
  if (a.in_master) return 'exists';
  const r = await callScript<{ exists: boolean; row: number }>('addMaster', {
    ...(await tabArgs(a.workspace)), date: a.submitted_at, name: a.name, email: a.email || '', phone: a.phone || '', school: schoolShort(a.school),
    programme: a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : '', country: a.country || '',
    city: a.city || '', gender: a.gender || '', dob: dobForMaster(a.dob), age: a.age || '',
    counselor: counselor ?? a.counselor ?? '', status,
  });
  await log(id, actor, 'moved_to_master', { row: r.row, status, exists: r.exists });
  return r.exists ? 'exists' : 'added';
}

export async function addToMaster(f: FormData) {
  const staff = await requireTeam();
  const id = s(f, 'id');
  if (!(STATUSES as readonly string[]).includes(s(f, 'status'))) return back(id, 'Choose a status', true);
  try {
    const res = await pushToMaster(id, staff.email, s(f, 'status'), s(f, 'counselor') || undefined);
    await syncAll();
    revalidatePath('/');
    return back(id, res === 'exists' ? 'Already in the master sheet' : 'Added to the master sheet (Sheet1)');
  } catch (e) { rethrow(e); return back(id, `Could not add: ${(e as Error).message}`, true); }
}

// ---- Bulk actions (Applications page) ----
const BULK_MAX = 15; // keeps each run inside the server time limit; run again for the rest
function bulkBack(f: FormData, msg: string, err = false): never {
  const r = s(f, 'returnTo');
  const base = r.startsWith('/applications') && !r.startsWith('/applications/') ? r.split(/[?&](msg|err)=/)[0] : '/applications';
  redirect(`${base}${base.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
}
function pickIds(f: FormData) {
  const all = f.getAll('ids').map(String).filter(Boolean);
  if (!all.length) bulkBack(f, 'Tick at least one student first.', true);
  return { ids: all.slice(0, BULK_MAX), left: Math.max(0, all.length - BULK_MAX) };
}
const leftNote = (n: number) => (n ? ` ${n} more left — run it again.` : '');

export async function bulkAddToMaster(f: FormData) {
  const staff = await requireTeam();
  const { ids, left } = pickIds(f);
  const status = s(f, 'addStatus') || 'New Lead';
  let added = 0, existed = 0, failed = 0;
  for (const id of ids) {
    try { (await pushToMaster(id, staff.email, status)) === 'added' ? added++ : existed++; } catch { failed++; }
  }
  try { await syncAll(); } catch { /* next sync will catch up */ }
  revalidatePath('/applications');
  bulkBack(f, `Added ${added} to Sheet1${existed ? `, ${existed} already there` : ''}${failed ? `, ${failed} failed` : ''}.${leftNote(left)}`);
}

export async function bulkSetStatus(f: FormData) {
  const staff = await requireTeam();
  const status = s(f, 'setStatus');
  if (!(STATUSES as readonly string[]).includes(status)) bulkBack(f, 'Choose a status first.', true);
  const { ids, left } = pickIds(f);
  const db = admin();
  let ok = 0, sheetFail = 0;
  for (const id of ids) {
    const { data: cur } = await db.from('portal_applications').select('status').eq('application_id', id).single();
    await db.from('portal_applications').update({ status }).eq('application_id', id);
    await log(id, staff.email, 'status_change', { from: cur?.status ?? null, to: status });
    try { await writeBack(id, { status }); } catch { sheetFail++; }
    ok++;
  }
  revalidatePath('/applications'); revalidatePath('/');
  bulkBack(f, `Status set to “${status}” for ${ok} student${ok === 1 ? '' : 's'}${sheetFail ? ` (${sheetFail} could not be written to the sheet)` : ''}.${leftNote(left)}`, sheetFail > 0);
}

export async function bulkAssign(f: FormData) {
  const staff = await requireTeam();
  const pick = s(f, 'setCounselor');
  if (!pick) bulkBack(f, 'Choose a counselor first.', true);
  const counselor = pick === '__clear' ? '' : pick;
  const picked = pickIds(f), left = picked.left;
  const ids: string[] = [];
  for (const id of picked.ids) if (await canAccessApp(staff, id)) ids.push(id);   // only students in workspaces this person may open
  const db = admin();
  // one history row per student (who, when, from whom, to whom); students who already belong to this counselor are left alone
  const r = await reassignMany(db, { ids, toKey: counselor ? counselorKey(counselor) : null, actor: staff.email, reason: s(f, 'reason') });
  let sheetFail = 0;
  for (const c of r.changed) {
    await log(c.student.id, staff.email, 'counselor_change', { from: c.from, to: c.to ?? '' });
    try { await writeBack(c.student.id, { counselor: c.to ?? '' }); } catch { sheetFail++; }
  }
  revalidatePath('/applications'); revalidatePath('/counselors'); revalidatePath('/head');
  if (counselor && r.changed.length) { const key = counselorKey(counselor); const students = r.changed.map((c) => c.student); after(() => notifyOwnerByKey(key, students, staff.email)); }
  const ok = r.changed.length;
  bulkBack(f, `${counselor ? `Assigned to ${counselor}` : 'Unassigned'}: ${ok} student${ok === 1 ? '' : 's'}${r.unchanged ? `, ${r.unchanged} already ${counselor ? 'theirs' : 'without a counselor'}` : ''}${r.failed ? `, ${r.failed} could not be changed` : ''}${sheetFail ? ` (${sheetFail} could not be written to the sheet)` : ''}.${leftNote(left)}`, sheetFail > 0 || r.failed > 0);
}

// One email per counselor listing the selected students that belong to them.
export async function bulkEmailCounselors(f: FormData) {
  const staff = await requireTeam();
  const { ids } = pickIds(f);
  const db = admin();
  const [{ rows, all }, { data: counselors }] = await Promise.all([loadStudents({ dups: true }), db.from('portal_counselors').select('*')]);
  const chosen = new Set(ids);
  const byCounselor = new Map<string, typeof rows>();
  for (const r of rows.filter((r) => chosen.has(r.a.application_id))) {
    const k = counselorKey(r.a.counselor); if (!k) continue;
    byCounselor.set(k, [...(byCounselor.get(k) || []), r]);
  }
  void all;
  let sent = 0, students = 0, noEmail: string[] = [];
  for (const [k, list] of byCounselor) {
    const c = (counselors || []).find((x) => x.name_key === k);
    if (!c?.email) { noEmail.push(c?.name || list[0].a.counselor || k); continue; }
    const { subject, body, html } = digestEmail(c.name, list, 'A quick update from admissions on these students.');
    try {
      await sendMail({ to: c.email, subject, body, replyTo: staff.email, from: staff.email, ...html, eyebrow: 'Update from admissions' });
      await db.from('portal_messages').insert({ application_id: null, counselor_name: c.name, to_email: c.email, to_kind: 'counselor', subject, body, sent_by: staff.email });
      sent++; students += list.length;
    } catch { noEmail.push(`${c.name} (send failed)`); }
  }
  revalidatePath('/messages');
  const skipped = noEmail.length ? ` Not emailed (no address or failed): ${noEmail.join(', ')}.` : '';
  bulkBack(f, sent ? `Emailed ${sent} counselor${sent === 1 ? '' : 's'} about ${students} student${students === 1 ? '' : 's'}.${skipped}` : `No emails sent.${skipped || ' The selected students have no counselor.'}`, !sent);
}

export async function updateRegent(f: FormData) {
  const staff = await requireTeam();
  const id = s(f, 'id');
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('in_regent, regent_data, opp_id, payment, interview').eq('application_id', id).single();
  if (!a?.in_regent || !a.regent_data) return back(id, 'This student is not in the Regent Only tab', true, `/applications/${id}?tab=regent`);
  const g = a.regent_data as { email: string; name: string; school: string };
  const fields = { oppId: s(f, 'oppId'), payment: s(f, 'payment'), interview: s(f, 'interview') };
  try { await callScript('updateRegent', { email: g.email, name: g.name, school: g.school, fields }); }
  catch (e) { rethrow(e); return back(id, `Could not update the sheet: ${(e as Error).message}`, true, `/applications/${id}?tab=regent`); }
  await db.from('portal_applications').update({ opp_id: fields.oppId || null, payment: fields.payment || null, interview: fields.interview || null }).eq('application_id', id);
  await log(id, staff.email, 'regent_update', fields);
  revalidatePath('/');
  back(id, 'Regent details saved', false, `/applications/${id}?tab=regent`);
}

export async function updateStatus(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), status = s(f, 'status');
  await guardApp(staff, id);
  if (!(STATUSES as readonly string[]).includes(status)) return back(id, 'Invalid status', true);
  const db = admin();
  const { data: cur } = await db.from('portal_applications').select('status').eq('application_id', id).single();
  await db.from('portal_applications').update({ status }).eq('application_id', id);
  await log(id, staff.email, 'status_change', { from: cur?.status ?? null, to: status });
  const ret = s(f, 'returnTo');
  try { await writeBack(id, { status }); }
  catch (e) { rethrow(e); return back(id, `Saved in portal but sheet write-back failed: ${(e as Error).message}`, true, ret); }
  revalidatePath('/');
  back(id, 'Status updated', false, ret);
}

export async function updateCounselor(f: FormData) {
  const staff = await requireTeam();
  const id = s(f, 'id'), counselor = s(f, 'counselor');
  await guardApp(staff, id);
  const ret = s(f, 'returnTo');
  // the change goes through the assignment system, so it is recorded with who, when and (if the rules pointed elsewhere) that it was an override
  const r = await reassign(admin(), { appId: id, toKey: counselor ? counselorKey(counselor) : null, actor: staff.email, reason: s(f, 'reason') });
  if (!r.ok) return back(id, r.error, true, ret);
  if (r.changed) {
    await log(id, staff.email, 'counselor_change', { from: r.from, to: r.to ?? '' });
    if (r.toKey) { const key = r.toKey, student = r.student; after(() => notifyOwnerByKey(key, [student], staff.email)); }
    try { await writeBack(id, { counselor: r.to ?? '' }); }
    catch (e) { rethrow(e); return back(id, `Saved in portal but sheet write-back failed: ${(e as Error).message}`, true, ret); }
  }
  revalidatePath('/'); revalidatePath('/head');
  back(id, r.changed ? 'Counselor updated' : 'No change: that is already the counselor', false, ret);
}

export async function addNote(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), body = s(f, 'body'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  if (!body) return back(id, 'Note is empty', true, ret);
  await admin().from('portal_notes').insert({ application_id: id, author: staff.email, body, pinned: f.get('pinned') === 'on' });
  await log(id, staff.email, 'note', { preview: body.slice(0, 120) });
  try { await writeBack(id, {}, body, staff.email); } catch { /* portal is the record; sheet mirror is best-effort */ }
  back(id, 'Note added', false, ret);
}

// Writes an email draft with Qwen and stores it for the composer to pre-fill. Nothing is sent.
export async function createDraft(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id');
  await guardApp(staff, id);
  const purpose = (s(f, 'purpose') in PURPOSES ? s(f, 'purpose') : 'custom') as PurposeKey;
  const tone = (s(f, 'tone') in TONES ? s(f, 'tone') : 'friendly') as ToneKey;
  const tab = `/applications/${id}?tab=messages`;
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('name, counselor, programme, school, status, interview, payment').eq('application_id', id).single();
  if (!a) return back(id, 'Student not found', true);
  const { rows, all } = await loadStudents();
  const row = rows.find((r) => r.a.application_id === id) || rows.find((r) => all.some((x) => x.application_id === id && x.student_key === r.a.student_key));
  const first = a.name.trim().split(/\s+/)[0] || 'there';
  try {
    const draft = await draftEmail({
      purpose, tone, instruction: s(f, 'instruction').slice(0, 400),
      facts: { programme: a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : null, university: a.school || null, status: a.status || null,
        documentsMissing: row?.missing || [], documentsChecked: !!row?.judged, interviewStatus: a.interview || null, paymentRecorded: !!a.payment },
      names: { first: first[0].toUpperCase() + first.slice(1).toLowerCase(), counselor: a.counselor || 'there', sender: staff.email.split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim().split(' ')[0].replace(/^./, (c) => c.toUpperCase()) || 'The team' },
    });
    await db.from('portal_ai_cache').upsert({ cache_key: `draft:${id}:${staff.email}`, kind: 'draft', input_hash: draft.at, output: draft, created_at: draft.at });
    return back(id, 'AI draft ready — review and edit it before sending.', false, `${tab}&draft=1`);
  } catch (e) { rethrow(e); return back(id, (e as Error).message, true, tab); }
}

export async function sendCounselorEmail(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  const to = s(f, 'custom') || s(f, 'to'), subject = s(f, 'subject'), body = s(f, 'body');
  if (!EMAIL_RE.test(to)) return back(id, 'Enter a valid email address (counselor emails are managed under Counselors)', true, ret);
  if (staff.role === 'counselor') {   // counselors may email their student (or themselves), not arbitrary addresses
    const { data: a0 } = await admin().from('portal_applications').select('email').eq('application_id', id).single();
    if (![a0?.email, staff.email].filter(Boolean).map((x) => String(x).toLowerCase()).includes(to.toLowerCase())) return back(id, 'You can email the student from here.', true, ret);
  }
  if (!subject || !body) return back(id, 'Subject and message are required', true, ret);
  try { await sendMail({ to, subject, body, replyTo: staff.email, from: staff.email }); }
  catch (e) { rethrow(e); return back(id, `Email failed: ${(e as Error).message}`, true, ret); }
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('email, counselor').eq('application_id', id).maybeSingle();
  const kind = a?.email && a.email.toLowerCase() === to.toLowerCase() ? 'student' : 'counselor';
  if (kind === 'student') await addNotice({ email: to, applicationId: id, kind: 'message', title: subject, body: body.replace(/\s+/g, ' ').slice(0, 220), href: '/student', by: staff.email });
  await db.from('portal_messages').insert({ application_id: id, counselor_name: a?.counselor || null, to_email: to, to_kind: kind, subject, body, sent_by: staff.email });
  await log(id, staff.email, 'email_sent', { to, subject });
  await db.from('portal_ai_cache').delete().eq('cache_key', `draft:${id}:${staff.email}`);
  revalidatePath('/messages');
  back(id, `Email sent to ${to}`, false, ret);
}

export async function uploadDocument(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), docType = s(f, 'docType'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  const file = f.get('file') as File | null;
  if (!file || !file.size) return back(id, 'Choose a file', true, ret);
  const db = admin();
  const { data: app0 } = await db.from('portal_applications').select('name, drive_folder_id, workspace').eq('application_id', id).single();
  if (app0 && !app0.drive_folder_id && app0.workspace !== 'uk') { try { app0.drive_folder_id = await ensureFolder(id); } catch (e) { return back(id, (e as Error).message, true, ret); } }
  const app = app0;
  if (!app?.drive_folder_id) return back(id, 'This application has no Drive folder', true, ret);
  const ext = (file.name.match(/\.[^.]+$/) || ['.pdf'])[0];
  let label: ReturnType<typeof resolveLabel> | null = null;
  if (docType === 'Other') { const l = cleanLabel(s(f, 'docLabel')); if (!l) return back(id, 'Name the kind of document (for example “Bank statement”).', true, ret); label = resolveLabel(l); }
  const name = label ? `${app.name} - ${label.override || label.docType}${ext}` : docType ? `${app.name} - ${docType}${ext}` : file.name;
  try {
    const up = await callScript<DriveFile>('uploadFile', {
      applicationId: id, folderId: app.drive_folder_id, name, mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    });
    await db.from('portal_documents').upsert({
      drive_file_id: up.id, application_id: id, name: up.name, doc_type: label ? label.docType : docTypeFromName(up.name), type_override: label?.override ?? null, mime_type: up.mimeType,
      size_bytes: up.size, drive_url: up.url, source: 'portal', uploaded_by: staff.email,
    });
    await log(id, staff.email, 'doc_uploaded', { name: up.name });
  } catch (e) { rethrow(e); return back(id, `Upload failed: ${(e as Error).message}`, true, ret); }
  back(id, 'Document uploaded to Drive and linked', false, ret);
}

export async function refreshDocuments(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  const { data: app } = await admin().from('portal_applications').select('drive_folder_id, extra_folder_ids').eq('application_id', id).single();
  const folders = [...new Set([app?.drive_folder_id, ...(app?.extra_folder_ids || [])].filter(Boolean) as string[])];
  if (folders.length) await syncFolders([{ id, folders }]);
  back(id, 'Documents refreshed from Drive', false, ret);
}

/** A document type is allowed if it is one of the standard ones or one of this country's required documents. */
async function docTypeOk(appId: string, type: string): Promise<boolean> {
  if ((ALL_DOC_TYPES as readonly string[]).includes(type)) return true;
  const { data } = await admin().from('portal_applications').select('workspace').eq('application_id', appId).maybeSingle();
  return !!data && (await requiredDocs(data.workspace)).includes(type);
}

export async function setDocType(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), fileId = s(f, 'fileId'), type = s(f, 'docType'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  if (!(await docTypeOk(id, type))) return back(id, 'Invalid document type', true, ret);
  let shown: string = type;
  if (type === 'Other') { const l = cleanLabel(s(f, 'docLabel')); if (!l) return back(id, 'Name the kind of document (for example “Bank statement”).', true, ret); shown = resolveLabel(l).override || resolveLabel(l).docType; }
  const { data: doc } = await admin().from('portal_documents').select('name, doc_type, application_id').eq('drive_file_id', fileId).single();
  if (doc) await guardApp(staff, doc.application_id);
  await admin().from('portal_documents').update({ type_override: shown === doc?.doc_type ? null : shown }).eq('drive_file_id', fileId);
  await log(id, staff.email, 'doc_retyped', { name: doc?.name, type: shown });
  back(id, `Marked as ${shown}`, false, ret);
}

// ---- Reminders ----
export async function addReminder(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), due = s(f, 'due'), note = s(f, 'note'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !note) return back(id, 'Pick a date and write what to follow up on.', true, ret);
  await admin().from('portal_reminders').insert({ application_id: id, due_on: due, note: note.slice(0, 300), created_by: staff.email });
  await log(id, staff.email, 'reminder_set', { due, note: note.slice(0, 80) });
  revalidatePath('/'); revalidatePath('/tasks');
  back(id, `Reminder set for ${new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`, false, ret);
}
export async function completeReminder(f: FormData) {
  const staff = await requireStaff();
  const { data: rem } = await admin().from('portal_reminders').select('application_id').eq('id', s(f, 'reminderId')).single();
  if (rem) await guardApp(staff, rem.application_id);
  await admin().from('portal_reminders').update({ status: 'done', done_at: new Date().toISOString() }).eq('id', s(f, 'reminderId'));
  revalidatePath('/'); revalidatePath('/tasks');
  const ret = s(f, 'returnTo');
  redirect(/^\/(?!\/)/.test(ret) ? ret : '/tasks');
}

// ---- Overview, tasks, AI ----
const DAY_MS = 864e5;
const homeOr = (f: FormData | undefined, def = '/tasks') => { const r = f ? s(f, 'returnTo') : ''; return /^\/(?!\/)/.test(r) ? r : def; };

export async function markSeen(f?: FormData) {
  const staff = await requireStaff();
  await admin().from('portal_staff').update({ last_seen_at: new Date().toISOString() }).eq('email', staff.email);
  revalidatePath('/'); revalidatePath('/tasks');
  redirect(homeOr(f));
}

async function closeTask(f: FormData, status: 'done' | 'dismissed' | 'snoozed', days: number) {
  const staff = await requireStaff();
  const db = admin();
  const id = s(f, 'taskId');
  const now = new Date();
  const { data: t } = await db.from('portal_tasks').select('application_id, title').eq('id', id).single();
  if (t?.application_id) await guardApp(staff, t.application_id);
  await db.from('portal_tasks').update({ status, suppress_until: new Date(now.getTime() + days * DAY_MS).toISOString(), resolved_at: now.toISOString(), resolved_by: staff.email, updated_at: now.toISOString() }).eq('id', id);
  if (t?.application_id) await log(t.application_id, staff.email, `task_${status}`, { title: t.title });
  revalidatePath('/');
  revalidatePath('/');
  redirect(homeOr(f));
}
export async function completeTask(f: FormData) { return closeTask(f, 'done', 3); }
export async function dismissTask(f: FormData) { return closeTask(f, 'dismissed', 14); }
export async function snoozeTask(f: FormData) { return closeTask(f, 'snoozed', Math.max(1, Math.min(14, Number(s(f, 'days')) || 1))); }

export async function refreshOverview(f?: FormData) {
  await requireTeam();
  const { rows, all } = await loadStudents();
  await refreshTasks(rows);
  const staff = await requireTeam();
  const facts = await computeFacts(rows, all, staff.last_seen_at);
  const r = await aiOverview(facts, true);
  revalidatePath('/'); revalidatePath('/tasks');
  redirect(`${homeOr(f)}${r.error ? `?err=${encodeURIComponent(r.error)}` : '?msg=Overview+refreshed'}`);
}

export async function generateSummary(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id');
  await guardApp(staff, id);
  const { rows, all } = await loadStudents();
  const row = rows.find((r) => r.a.application_id === id) || rows.find((r) => all.some((x) => x.application_id === id && x.student_key === r.a.student_key));
  if (!row) return back(id, 'Student not found', true);
  const submissions = all.filter((x) => x.student_key === row.a.student_key).length;
  const r = await aiStudentSummary(id, studentFacts(row.a, { have: row.have, docCount: row.docCount, missing: row.missing, judged: row.judged, submissions, required: row.required }), true);
  back(id, r.error ? `AI summary: ${r.error}` : 'AI summary generated', !!r.error);
}

// ---- AI document check (opt-in) ----
export async function scanDocs(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), fileId = s(f, 'fileId'), ret = s(f, 'returnTo') || `/applications/${id}?tab=documents`;
  await guardApp(staff, id);
  if (!docScanEnabled()) return back(id, 'The AI document check is switched off. Turn it on in Settings → AI document check.', true, ret);
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('name, student_key').eq('application_id', id).single();
  if (!app) return back(id, 'Student not found', true, ret);
  const { data: sibs } = await db.from('portal_applications').select('application_id').eq('student_key', app.student_key);
  const { data: docs } = await db.from('portal_documents').select('drive_file_id, application_id, doc_type, type_override, name').in('application_id', (sibs || []).map((x) => x.application_id));
  const { data: done } = await db.from('portal_doc_scans').select('drive_file_id').in('drive_file_id', (docs || []).map((d) => d.drive_file_id));
  const scanned = new Set((done || []).map((d) => d.drive_file_id));
  const todo = (fileId ? (docs || []).filter((d) => d.drive_file_id === fileId) : (docs || []).filter((d) => !scanned.has(d.drive_file_id))).slice(0, 4);
  if (!todo.length) return back(id, 'Nothing new to check.', false, ret);
  let ok = 0, flagged = 0, failure = '';
  for (const d of todo) {
    try { const r = await scanOne({ appId: d.application_id, fileId: d.drive_file_id, filedAs: d.type_override || d.doc_type, studentName: app.name, actor: staff.email }); ok++; if (r.flags.length) flagged++; }
    catch (e) { rethrow(e); failure = (e as Error).message; break; }
  }
  await log(id, staff.email, 'doc_scanned', { count: ok });
  const more = !fileId && (docs || []).length - scanned.size - ok > 0 ? ' Run it again for the remaining files.' : '';
  return back(id, failure ? `Checked ${ok}. Then: ${failure}` : `AI checked ${ok} document${ok === 1 ? '' : 's'}${flagged ? ` — ${flagged} need a look` : ' — nothing unusual'}.${more}`, !!failure, ret);
}

/** Accepts every confident suggestion for a file filed as "Other" (the person can still change any of them afterwards). */
export async function applyTypeSuggestions() {
  const staff = await requireTeam();
  const list = (await typeSuggestions()).filter((x) => x.filedAs === 'Other' && x.confidence >= 0.85);
  const db = admin();
  let n = 0;
  for (const x of list) {
    const { data: doc } = await db.from('portal_documents').select('doc_type').eq('drive_file_id', x.fileId).single();
    await db.from('portal_documents').update({ type_override: x.detected === doc?.doc_type ? null : x.detected }).eq('drive_file_id', x.fileId);
    await log(x.appId, staff.email, 'doc_retyped', { name: x.file, type: x.detected });
    n++;
  }
  revalidatePath('/documents');
  redirect(`/documents?msg=${encodeURIComponent(n ? `Updated the type of ${n} document${n === 1 ? '' : 's'}.` : 'No confident suggestions to apply.')}`);
}

// ---- Linking Google Drive folders ----
type Candidate = { folderId: string; name: string; url: string; parent: string; score: number; exact: boolean; fileCount: number; modified: string };
const docsTab = (id: string) => `/applications/${id}?tab=documents`;

function folderIdFrom(input: string): string | null {
  const t = input.trim();
  const m = /folders\/([A-Za-z0-9_-]{10,})/.exec(t) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(t);
  return m ? m[1] : /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

async function attachFolder(appId: string, folderId: string, actor: string): Promise<number> {
  const db = admin();
  const listed = await callScript<Record<string, DriveFile[] | { error: string }>>('listFiles', { folderIds: [folderId] });
  const files = listed[folderId];
  if (!Array.isArray(files)) throw new Error("Can't open that folder. Share it with the Google account that owns your Apps Script, then try again.");
  const { data: a } = await db.from('portal_applications').select('extra_folder_ids, drive_folder_id').eq('application_id', appId).single();
  if (!a) throw new Error('Student not found');
  const extra = [...new Set([...(a.extra_folder_ids || []), folderId])];
  await db.from('portal_applications').update({
    extra_folder_ids: extra,
    ...(a.drive_folder_id ? {} : { drive_folder_id: folderId, drive_folder_url: `https://drive.google.com/drive/folders/${folderId}` }),
  }).eq('application_id', appId);
  await syncFolders([{ id: appId, folders: [...new Set([a.drive_folder_id, ...extra].filter(Boolean) as string[])] }]);
  await db.from('portal_folder_suggestions').update({ status: 'linked' }).eq('application_id', appId).eq('folder_id', folderId);
  await log(appId, actor, 'folder_linked', { folder: folderId, files: files.length });
  return files.length;
}

async function scanApps(apps: { application_id: string; name: string }[]): Promise<number> {
  const db = admin();
  if (!apps.length) return 0;
  const found = await callScript<Record<string, Candidate[]>>('searchFolders', { students: apps.map((a) => ({ id: a.application_id, name: a.name })) });
  const { data: used } = await db.from('portal_applications').select('drive_folder_id, extra_folder_ids');
  const usedSet = new Set((used || []).flatMap((u) => [u.drive_folder_id, ...(u.extra_folder_ids || [])]).filter(Boolean));
  let n = 0;
  for (const a of apps) {
    const rows = (found[a.application_id] || []).filter((c) => !usedSet.has(c.folderId)).map((c) => ({
      application_id: a.application_id, folder_id: c.folderId, folder_name: c.name, folder_url: c.url, parent_name: c.parent || null,
      score: c.score, exact: c.exact, file_count: c.fileCount, modified_at: c.modified,
    }));
    if (rows.length) await db.from('portal_folder_suggestions').upsert(rows, { onConflict: 'application_id,folder_id', ignoreDuplicates: true });
    n += rows.length;
    await db.from('portal_applications').update({ drive_scan_at: new Date().toISOString() }).eq('application_id', a.application_id);
  }
  return n;
}

export async function scanDrive() {
  await requireTeam();
  const { data: apps } = await admin().from('portal_applications').select('application_id, name')
    .is('drive_folder_id', null).order('drive_scan_at', { ascending: true, nullsFirst: true }).limit(12);
  let msg: string;
  try { const n = await scanApps(apps || []); msg = `Searched Drive for ${(apps || []).length} students — ${n} possible folders found.`; }
  catch (e) { rethrow(e); msg = `Drive search failed: ${(e as Error).message}`; }
  revalidatePath('/drive');
  redirect(`/drive?msg=${encodeURIComponent(msg)}`);
}

export async function scanStudent(f: FormData) {
  await requireTeam();
  const id = s(f, 'id');
  const { data: a } = await admin().from('portal_applications').select('application_id, name').eq('application_id', id).single();
  try { const n = a ? await scanApps([a]) : 0; return back(id, n ? `Found ${n} possible folder${n > 1 ? 's' : ''} — check below and link the right one.` : 'No matching folders found. Paste the folder link instead.', false, docsTab(id)); }
  catch (e) { rethrow(e); return back(id, `Drive search failed: ${(e as Error).message}`, true, docsTab(id)); }
}

export async function linkFolder(f: FormData) {
  const staff = await requireTeam();
  const id = s(f, 'id'), ret = s(f, 'returnTo') || docsTab(id);
  const folderId = folderIdFrom(s(f, 'folder'));
  if (!folderId) return back(id, 'That doesn’t look like a Google Drive folder link or ID', true, ret);
  try { const n = await attachFolder(id, folderId, staff.email); revalidatePath('/'); revalidatePath('/drive'); return back(id, `Folder linked — ${n} file${n === 1 ? '' : 's'} found`, false, ret); }
  catch (e) { rethrow(e); return back(id, (e as Error).message, true, ret); }
}

export async function dismissSuggestion(f: FormData) {
  await requireTeam();
  const id = s(f, 'id'), ret = s(f, 'returnTo') || '/drive';
  await admin().from('portal_folder_suggestions').update({ status: 'dismissed' }).eq('id', s(f, 'sid'));
  revalidatePath('/drive');
  redirect(ret.startsWith('/') ? ret : `/applications/${id}`);
}

export async function unlinkFolder(f: FormData) {
  const staff = await requireTeam();
  const id = s(f, 'id'), folderId = s(f, 'folderId');
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('extra_folder_ids, drive_folder_id, raw_data').eq('application_id', id).single();
  const rawFolder = (a?.raw_data as { driveFolderId?: string } | null)?.driveFolderId || null;
  if (!a || folderId === rawFolder) return back(id, 'The form’s own folder can’t be unlinked', true, docsTab(id));
  const extra = (a.extra_folder_ids || []).filter((x: string) => x !== folderId);
  const primary = rawFolder || extra[0] || null;
  await db.from('portal_applications').update({ extra_folder_ids: extra, drive_folder_id: primary, drive_folder_url: primary ? `https://drive.google.com/drive/folders/${primary}` : null }).eq('application_id', id);
  const folders = [...new Set([rawFolder, ...extra].filter(Boolean) as string[])];
  if (folders.length) await syncFolders([{ id, folders }]); else await db.from('portal_documents').delete().eq('application_id', id);
  await log(id, staff.email, 'folder_unlinked', { folder: folderId });
  revalidatePath('/');
  back(id, 'Folder unlinked', false, docsTab(id));
}

// Link every student whose search found exactly one folder with their full name.
export async function linkExactMatches() {
  const staff = await requireTeam();
  const db = admin();
  const { data: sugg } = await db.from('portal_folder_suggestions').select('id, application_id, folder_id, exact').eq('status', 'new');
  const byApp = new Map<string, { folder_id: string; exact: boolean }[]>();
  (sugg || []).forEach((x) => byApp.set(x.application_id, [...(byApp.get(x.application_id) || []), x]));
  let linked = 0, failed = 0;
  for (const [appId, list] of [...byApp].slice(0, 10)) {
    const exact = list.filter((x) => x.exact);
    if (exact.length !== 1) continue;
    try { await attachFolder(appId, exact[0].folder_id, staff.email); linked++; } catch { failed++; }
  }
  revalidatePath('/'); revalidatePath('/drive');
  redirect(`/drive?msg=${encodeURIComponent(`Linked ${linked} folders${failed ? `, ${failed} failed` : ''}. (10 at a time — run again for more.)`)}`);
}

// ---- Settings ----
export async function testConnection() {
  await requireTeam();
  const t0 = Date.now();
  try {
    await callScript('listFiles', { folderIds: [] });   // lightest command the script supports
    redirect(`/settings?msg=${encodeURIComponent(`Apps Script is connected (${Date.now() - t0} ms).`)}`);
  } catch (e) {
    rethrow(e);
    redirect(`/settings?err=${encodeURIComponent((e as Error).message)}`);
  }
}

export async function saveCounselor(f: FormData) {
  await requireTeam();
  const email = s(f, 'email'), ret = s(f, 'returnTo') || '/counselors';
  if (email && !EMAIL_RE.test(email)) redirect(`${ret}?err=${encodeURIComponent('Invalid email for ' + s(f, 'name'))}`);
  await admin().from('portal_counselors').update({ email: email || null, active: f.get('active') === 'on' }).eq('id', s(f, 'id'));
  revalidatePath('/counselors');
  redirect(`${ret}?msg=Saved`);
}
export async function addCounselor(f: FormData) {
  await requireTeam();
  const name = s(f, 'name'), email = s(f, 'email'), ret = s(f, 'returnTo') || '/counselors';
  if (!name) redirect(`${ret}?err=Name+required`);
  if (email && !EMAIL_RE.test(email)) redirect(`${ret}?err=Invalid+email`);
  await admin().from('portal_counselors').upsert({ name, name_key: counselorKey(name), email: email || null }, { onConflict: 'name_key' });
  redirect(`${ret}?msg=Counselor+saved`);
}

// Lets a counselor sign in (with Google, using their saved email) and see only their own students.
export async function grantCounselorAccess(f: FormData) {
  const me0 = await requireTeam();
  const db = admin();
  const { data: c } = await db.from('portal_counselors').select('*').eq('id', s(f, 'id')).single();
  if (!c?.email) redirect('/counselors?err=' + encodeURIComponent('Save the counselor’s email first.'));
  const email = c.email.toLowerCase();
  const { data: ex } = await db.from('portal_staff').select('role').eq('email', email).maybeSingle();
  if (ex && ex.role !== 'counselor') redirect('/counselors?err=' + encodeURIComponent(`${email} already has team access.`));
  await db.from('portal_staff').upsert({ email, role: 'counselor', counselor_key: c.name_key });
  await audit(me0.email, 'counselor_access_granted', email, { counselor: c.name });
  revalidatePath('/counselors');
  redirect(`/counselors?msg=${encodeURIComponent(`${c.name} can now sign in with ${email} and will see only their own students.`)}`);
}
export async function grantAllCounselorAccess() {
  const me0 = await requireTeam();
  const db = admin();
  const [{ data: cs }, { data: staff }] = await Promise.all([db.from('portal_counselors').select('name, name_key, email, active').not('email', 'is', null), db.from('portal_staff').select('email, role')]);
  const have = new Map((staff || []).map((r) => [r.email.toLowerCase(), r.role]));
  const add = (cs || []).filter((c) => c.email && c.active !== false && !have.has(c.email.toLowerCase())).map((c) => ({ email: c.email!.toLowerCase(), role: 'counselor', counselor_key: c.name_key }));
  if (add.length) { await db.from('portal_staff').upsert(add); await audit(me0.email, 'counselor_access_granted', add.map((a) => a.email).join(', '), { count: add.length }); }
  const skipped = (cs || []).filter((c) => c.email && have.has(c.email.toLowerCase())).length;
  revalidatePath('/counselors');
  redirect(`/counselors?msg=${encodeURIComponent(add.length ? `Access given to ${add.length} counselor${add.length === 1 ? '' : 's'}: ${add.map((a) => a.email).join(', ')}.${skipped ? ` ${skipped} already had access.` : ''}` : 'Everyone with an email already has access.')}`);
}
export async function revokeCounselorAccess(f: FormData) {
  const me1 = await requireTeam();
  const db = admin();
  const { data: c } = await db.from('portal_counselors').select('email').eq('id', s(f, 'id')).single();
  if (c?.email) { await db.from('portal_staff').delete().eq('email', c.email.toLowerCase()).eq('role', 'counselor'); await audit(me1.email, 'counselor_access_removed', c.email); }
  revalidatePath('/counselors');
  redirect('/counselors?msg=Access+removed');
}

// Email a counselor the list of their students that need attention.
export async function sendDigest(f: FormData) {
  const staff = await requireTeam();
  const db = admin();
  const { data: c } = await db.from('portal_counselors').select('*').eq('id', s(f, 'id')).single();
  if (!c?.email) redirect('/counselors?err=' + encodeURIComponent(`Add an email for ${c?.name || 'this counselor'} first`));
  const { rows } = await loadStudents();
  const mine = rows.filter((r) => counselorKey(r.a.counselor) === c.name_key && r.reasons.length && !(r.a.status && ['Enrolled', 'Rejected', 'Withdrawn'].includes(r.a.status)));
  if (!mine.length) redirect(`/counselors?msg=${encodeURIComponent(`${c.name} has no students needing attention — nothing sent.`)}`);
  const { subject, body, html } = digestEmail(c.name, mine);
  try { await sendMail({ to: c.email, subject, body, replyTo: staff.email, from: staff.email, ...html, eyebrow: 'Students needing attention' }); }
  catch (e) { redirect(`/counselors?err=${encodeURIComponent(`Email failed: ${(e as Error).message}`)}`); }
  await db.from('portal_messages').insert({ application_id: null, counselor_name: c.name, to_email: c.email, to_kind: 'counselor', subject, body, sent_by: staff.email });
  revalidatePath('/messages');
  redirect(`/counselors?msg=${encodeURIComponent(`Digest sent to ${c.name} (${mine.length} students).`)}`);
}

// Free-form message from the Messages page (optionally tied to a student).
export async function sendMessage(f: FormData) {
  const staff = await requireTeam();
  const to = s(f, 'custom') || s(f, 'to'), subject = s(f, 'subject'), body = s(f, 'body'), appId = s(f, 'applicationId') || null;
  if (!EMAIL_RE.test(to) || !subject || !body) redirect('/messages?compose=1&err=' + encodeURIComponent('Recipient, subject and message are required'));
  try { await sendMail({ to, subject, body, replyTo: staff.email, from: staff.email, eyebrow: 'Message' }); }
  catch (e) { redirect('/messages?compose=1&err=' + encodeURIComponent(`Email failed: ${(e as Error).message}`)); }
  const db = admin();
  const { data: c } = await db.from('portal_counselors').select('name').eq('email', to).maybeSingle();
  await db.from('portal_messages').insert({ application_id: appId, counselor_name: c?.name || null, to_email: to, to_kind: c ? 'counselor' : appId ? 'student' : 'other', subject, body, sent_by: staff.email });
  if (appId) await log(appId, staff.email, 'email_sent', { to, subject });
  revalidatePath('/messages');
  redirect(`/messages?msg=${encodeURIComponent(`Email sent to ${to}`)}`);
}

// Adds a student by hand. The student is saved in the portal first, so it always works; the Sheet1 row is a second step.
// If Google is unhappy the record stays and can be sent to the sheet later ("Add to master sheet" on the student).
// The id is the same one the sync gives a sheet-only student, so when the Sheet1 row appears it merges into this record.
export async function createApplication(f: FormData) {
  const staff = await requireTeam();
  const fail = (m: string): never => redirect('/applications/new?err=' + encodeURIComponent(m));
  const name = s(f, 'name').replace(/\s+/g, ' '), email = s(f, 'email').toLowerCase();
  if (!name) fail('Please enter the student’s name.');
  if (email && !EMAIL_RE.test(email)) fail('That email address does not look right.');
  const status = (STATUSES as readonly string[]).includes(s(f, 'status')) ? s(f, 'status') : 'New Lead';
  // spell the school and programme the way the portal already does, so "bpp" and "BPP University" do not become two schools
  const cat = await getCatalog();
  const school = canonicalSchool(s(f, 'school'), cat) || null, counselor = s(f, 'counselor') || null;
  const addWs = await currentWorkspace();
  const key = wsKey(addWs, studentKey(email, school, name));
  const id = 'stub:' + createHash('sha1').update(key).digest('hex').slice(0, 16);
  const db = admin();

  // Same student already here? Open them instead of making a second copy.
  const { data: same } = email
    ? await db.from('portal_applications').select('application_id, school').eq('workspace', addWs).ilike('email', email.replace(/[\\%_]/g, '\\$&'))
    : await db.from('portal_applications').select('application_id, school').eq('student_key', key);
  const dupe = (same || []).find((a) => !email || !schoolKey(a.school) || !schoolKey(school) || schoolKey(a.school) === schoolKey(school));
  if (dupe) redirect(`/applications/${encodeURIComponent(dupe.application_id)}?msg=${encodeURIComponent('That student is already in the portal, so I opened their record.')}`);

  const now = new Date().toISOString();
  const fields = {
    phone: s(f, 'phone'), programme: canonicalProgramme(s(f, 'programme'), schoolKey(school), cat), country: s(f, 'country'), city: s(f, 'city'),
    gender: s(f, 'gender'), dob: dobForMaster(s(f, 'dob')), age: s(f, 'age'),
  };
  const { error } = await db.from('portal_applications').upsert({
    application_id: id, workspace: addWs, name, email: email || null, school, counselor, status, progress: progressFor(status), submitted_at: now,
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v || null])),
    student_key: key, in_master: false, in_regent: false, has_raw: false, synced_at: now, last_activity_at: now,
  }, { onConflict: 'application_id' });
  if (error) fail(`Could not save the student: ${error.message}`);
  await log(id, staff.email, 'student_added', { school, programme: fields.programme || null });
  if (counselor) after(() => notifyAssigned(counselor, [{ id, name, school, programme: fields.programme || null }], staff.email));
  // No counselor picked: the responsibilities decide (a counselor picked by hand is kept and recorded).
  let owner = counselor;
  try {
    const routed = await routeApplications(db, { ids: [id], actor: staff.email, mode: 'new' });
    owner = counselor || routed.assigned[0]?.counselorName || null;
    after(() => notifyRouting(routed));
  } catch { /* the student is saved; the queue on the Team Head page picks them up */ }

  // Step two: the Sheet1 row. A failure here never loses the student.
  let sheet = '', sheetFailed = false;
  try {
    const r = await callScript<{ exists: boolean; row: number }>('addMaster', {
      ...(await tabArgs(addWs)), date: now, name, email, ...fields, school: schoolShort(school), counselor: owner || '', status,
    });
    await log(id, staff.email, 'moved_to_master', { row: r.row, status, exists: r.exists });
    try { await syncAll(); } catch { /* the next sync links the row */ }
    sheet = r.exists ? ' They were already in Sheet1, so nothing was duplicated.' : ' Also added to Sheet1.';
  } catch (e) {
    rethrow(e); sheetFailed = true;
    sheet = ` Sheet1 was not updated (${(e as Error).message}). Open “Add to master sheet” on this student to try again.`;
  }

  let invited = '';
  if (f.get('invite') === '1' && email) {
    try { const r = await inviteStudentsCore([{ id }], staff.email, true); invited = r.sent ? ' Invitation emailed.' : ' The invitation was not sent.'; }
    catch { invited = ' The invitation was not sent.'; }
  } else if (email) invited = ' They can sign in to the student portal with that email.';

  revalidatePath('/'); revalidatePath('/applications');
  const msg = `${name} was added to the portal.${sheet}${invited}`;
  redirect(`/applications/${encodeURIComponent(id)}?${sheetFailed ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
}

export async function addStaff(f: FormData) {
  const me = await requireTeam();
  if (me.role !== 'admin') redirect('/settings?err=Admins+only');
  const email = s(f, 'email').toLowerCase();
  if (!EMAIL_RE.test(email)) redirect('/settings?err=Invalid+email');
  const role = s(f, 'role') === 'admin' ? 'admin' : 'staff';
  await admin().from('portal_staff').upsert({ email, role });
  await audit(me.email, 'staff_added', email, { role });
  redirect('/settings?msg=Staff+added');
}
export async function removeStaff(f: FormData) {
  const me = await requireTeam();
  const email = s(f, 'email');
  if (me.role !== 'admin' || email === me.email) redirect('/settings?err=Not+allowed');
  await admin().from('portal_staff').delete().eq('email', email);
  await audit(me.email, 'staff_removed', email);
  redirect('/settings?msg=Removed');
}

// Emails students their own list of missing documents (fixed wording, verified facts only).
// Team: from the Applications bulk bar. Counselors: only their own students, from their board.
export async function bulkRequestDocs(f: FormData) {
  const staff = await requireStaff();
  const asTeam = staff.role !== 'counselor';
  const all = f.getAll('ids').map(String).filter(Boolean).slice(0, BULK_MAX);
  const returnTo = s(f, 'returnTo');
  const fail = (m: string): never => (asTeam ? bulkBack(f, m, true) : back('', m, true, returnTo || '/my'));
  if (!all.length) fail('Pick at least one student first.');
  const allowed: string[] = [];
  for (const id of all) if (await canAccessApp(staff, id)) allowed.push(id);
  const chosen = new Set(allowed);
  const { rows } = await loadStudents();
  let res;
  try { res = await requestDocs(rows.filter((r) => chosen.has(r.a.application_id)), staff.email); }
  catch (e) { rethrow(e); fail(`Could not send: ${(e as Error).message}`); return; }
  revalidatePath('/messages');
  const msg = summarise(res);
  if (asTeam) bulkBack(f, msg, !res.sent);
  back('', msg, !res.sent, returnTo || '/my');
}

// ---- profiles ----
const clip = (v: string, n: number) => v.replace(/\s+/g, ' ').trim().slice(0, n);

export async function saveProfile(f: FormData) {
  const staff = await requireStaff();
  const { COLORS } = await import('@/lib/profile');
  const color = s(f, 'color');
  const phone = clip(s(f, 'phone'), 30);
  if (phone && !/^[+\d][\d\s().-]{5,}$/.test(phone)) redirect('/profile?err=' + encodeURIComponent('That phone number doesn’t look right.'));
  // role, bio, responsibilities and duties can be locked by an admin; a locked field is not on the form and keeps its stored value
  const { profileTextPatch } = await import('@/lib/profileRules');
  const { profileLocks } = await import('@/lib/profileLocks');
  const { data: cur } = await admin().from('portal_staff').select('title, bio, responsibilities, duties, also_supports').eq('email', staff.email).maybeSingle();
  const sent = (k: string) => (f.has(k) ? String(f.get(k) ?? '') : undefined);
  const { patch } = profileTextPatch((cur || {}) as never, { title: sent('title'), bio: sent('bio'), responsibilities: sent('responsibilities'), duties: sent('duties'), also_supports: sent('also_supports') }, { role: staff.role, locks: await profileLocks() });
  const { error } = await admin().from('portal_staff').update({
    display_name: clip(s(f, 'display_name'), 60) || null,
    ...patch,
    phone: phone || null,
    color: COLORS[color] ? color : 'navy',
    notify_email: f.get('notify_email') === 'on',
    updated_at: new Date().toISOString(),
  }).eq('email', staff.email);
  if (error) redirect('/profile?err=' + encodeURIComponent(`Could not save: ${error.message}`));
  revalidatePath('/', 'layout');
  redirect('/profile?msg=' + encodeURIComponent('Profile saved.'));
}

export async function uploadAvatar(f: FormData) {
  const staff = await requireStaff();
  const file = f.get('photo');
  if (!(file instanceof File) || !file.size) redirect('/profile?err=' + encodeURIComponent('Choose a photo first.'));
  if (file.size > 1_000_000) redirect('/profile?err=' + encodeURIComponent('That photo is too large (max 1 MB).'));
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = buf[0] === 0xff && buf[1] === 0xd8 ? ['jpg', 'image/jpeg'] : buf.subarray(1, 4).toString() === 'PNG' ? ['png', 'image/png'] : buf.subarray(8, 12).toString() === 'WEBP' ? ['webp', 'image/webp'] : null;
  if (!kind) redirect('/profile?err=' + encodeURIComponent('Please use a JPG, PNG or WebP photo.'));
  const db = admin();
  const path = `${staff.email.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.${kind![0]}`;
  const up = await db.storage.from('avatars').upload(path, buf, { contentType: kind![1], upsert: true });
  if (up.error) redirect('/profile?err=' + encodeURIComponent(`Upload failed: ${up.error.message}`));
  const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  if (staff.avatar_url) { const old = staff.avatar_url.split('/avatars/')[1]; if (old) await db.storage.from('avatars').remove([old]); }
  await db.from('portal_staff').update({ avatar_url: url, updated_at: new Date().toISOString() }).eq('email', staff.email);
  revalidatePath('/', 'layout');
  redirect('/profile?msg=' + encodeURIComponent('Photo updated.'));
}

export async function removeAvatar() {
  const staff = await requireStaff();
  const db = admin();
  if (staff.avatar_url) { const old = staff.avatar_url.split('/avatars/')[1]; if (old) await db.storage.from('avatars').remove([old]); }
  await db.from('portal_staff').update({ avatar_url: null, updated_at: new Date().toISOString() }).eq('email', staff.email);
  revalidatePath('/', 'layout');
  redirect('/profile?msg=' + encodeURIComponent('Photo removed.'));
}

// Sends the three sample emails to the signed-in person so they can see the real thing in their inbox.
export async function sendTestEmails() {
  const staff = await requireTeam();
  const { sampleSpec } = await import('@/lib/emailSamples');
  try {
    for (const kind of ['student', 'digest', 'custom']) {
      const { subject, body, ...spec } = sampleSpec(kind);
      await sendMail({ to: staff.email, subject, body, replyTo: staff.email, from: staff.email, ...spec });
    }
  } catch (e) { rethrow(e); redirect('/settings?err=' + encodeURIComponent(`Test email failed: ${(e as Error).message}`)); }
  redirect('/settings?msg=' + encodeURIComponent(`Three sample emails sent to ${staff.email}. Check your inbox (and spam).`));
}

// Pipeline board: move one student to a new stage (no redirect, so the board can update in place).
export async function moveStatus(id: string, status: string): Promise<{ ok: boolean; error?: string; sheet?: boolean }> {
  const staff = await requireStaff();
  if (!(await canAccessApp(staff, id))) return { ok: false, error: 'That student isn’t assigned to you.' };
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'Unknown stage.' };
  const db = admin();
  const { data: cur } = await db.from('portal_applications').select('status').eq('application_id', id).single();
  if (cur?.status === status) return { ok: true };
  await db.from('portal_applications').update({ status }).eq('application_id', id);
  await log(id, staff.email, 'status_change', { from: cur?.status ?? null, to: status });
  let sheet = true;
  try { await writeBack(id, { status }); } catch { sheet = false; }
  revalidatePath('/'); revalidatePath('/applications');
  return { ok: true, sheet };
}

// Intake month + application deadline (kept in the portal; the Google Sheet has no column for them).
export async function saveDates(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  const intake = s(f, 'intake'), deadline = s(f, 'deadline');
  if (intake && !/^\d{4}-\d{2}$/.test(intake)) return back(id, 'Intake should be a month.', true, ret);
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return back(id, 'Deadline should be a date.', true, ret);
  await admin().from('portal_applications').update({ intake: intake || null, deadline: deadline || null }).eq('application_id', id);
  await log(id, staff.email, 'dates_updated', { intake, deadline });
  revalidatePath('/calendar'); revalidatePath('/');
  back(id, 'Dates saved', false, ret);
}

// Payments page: remind selected unpaid students.
export async function bulkPaymentReminders(f: FormData) {
  const staff = await requireTeam();
  const ids = f.getAll('ids').map(String).filter(Boolean).slice(0, BULK_MAX);
  if (!ids.length) redirect('/payments?err=' + encodeURIComponent('Tick at least one student first.'));
  const chosen = new Set(ids);
  const { rows } = await loadStudents();
  let res;
  try { res = await sendPaymentReminders(rows.filter((r) => chosen.has(r.a.application_id)), staff.email); }
  catch (e) { rethrow(e); redirect('/payments?err=' + encodeURIComponent(`Could not send: ${(e as Error).message}`)); }
  revalidatePath('/messages');
  redirect(`/payments?${res.sent ? 'msg' : 'err'}=${encodeURIComponent(summariseReminders(res))}`);
}

// Student page: send one student a document request or payment reminder again (ignores the "asked recently" pause).
export async function sendStudentReminder(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), kind = s(f, 'kind'), ret = s(f, 'returnTo') || `/applications/${encodeURIComponent(id)}?tab=messages`;
  await guardApp(staff, id);
  const { rows } = await loadStudents();
  const row = rows.find((r) => r.a.application_id === id);
  if (!row) return back(id, 'Student not found', true, ret);
  let res;
  try { res = kind === 'payment' ? await sendPaymentReminders([row], staff.email, true) : await requestDocs([row], staff.email, true); }
  catch (e) { rethrow(e); return back(id, `Could not send: ${(e as Error).message}`, true, ret); }
  revalidatePath('/messages');
  back(id, res.sent ? (kind === 'payment' ? 'Payment reminder sent.' : 'Document request sent.') : `Not sent: ${res.skipped.map((x) => x.why).join('; ') || 'nothing to send'}.`, !res.sent, ret);
}

export async function backupNow() {
  const me = await requireTeam();
  if (me.role !== 'admin') redirect('/settings?err=Admins+only');
  try { const r = await runBackup(me.email); redirect('/settings?msg=' + encodeURIComponent(`Backup saved: ${r.name}${r.failed.length ? ` (some tables failed: ${r.failed.join('; ')})` : ''}.`)); }
  catch (e) { rethrow(e); redirect('/settings?err=' + encodeURIComponent(`Backup failed: ${(e as Error).message}`)); }
}

// Extracted text page: read one document's full text out through Drive OCR and keep it. Called one file at a time so the page can show progress.
export async function extractFile(fileId: string): Promise<{ ok: boolean; chars?: number; error?: string }> {
  const staff = await requireStaff();
  const db = admin();
  const { data: doc } = await db.from('portal_documents').select('drive_file_id, application_id').eq('drive_file_id', fileId).maybeSingle();
  if (!doc || !(await canAccessApp(staff, doc.application_id))) return { ok: false, error: 'Not found' };
  const row = { drive_file_id: fileId, application_id: doc.application_id, extracted_by: staff.email, extracted_at: new Date().toISOString() };
  try {
    const r = await callScript<{ text: string; chars: number; truncated: boolean; method: string }>('extractFull', { fileId });
    await db.from('portal_doc_text').upsert({ ...row, text: r.text, chars: r.chars, truncated: r.truncated, method: r.method, error: r.chars < 5 ? 'No readable text was found. The scan may be too faint, rotated, or a picture without writing.' : null });
    return { ok: true, chars: r.chars };
  } catch (e) {
    const msg = (e as Error).message.replace(/^Apps Script:\s*/, '').slice(0, 300);
    await db.from('portal_doc_text').upsert({ ...row, text: '', chars: 0, truncated: false, method: null, error: /unknown action/i.test(msg) ? 'Your Apps Script needs the newest PortalApi.gs (it is missing “extractFull”).' : msg });
    return { ok: false, error: msg };
  }
}

// ================= Student portal =================
const STUDENT_CODE_LIMIT = 5;   // sign-in codes per email per hour

/** Step 1: email a sign-in code (its length is set in Supabase, so nothing here assumes 6 or 8 digits). Same reply whether or not the address is on file, so nobody can probe who has applied. */
export async function requestStudentCode(f: FormData) {
  const email = s(f, 'email').toLowerCase();
  if (!EMAIL_RE.test(email)) redirect('/student/login?error=' + encodeURIComponent('Enter a valid email address.'));
  const db = admin();
  const known = await isStudentEmail(email);
  if (known) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from('portal_notify_log').select('id', { count: 'exact', head: true }).eq('email', email).eq('kind', 'student_code').gte('created_at', since);
    if ((count || 0) >= STUDENT_CODE_LIMIT) redirect('/student/login?error=' + encodeURIComponent('Too many codes requested. Please wait a little and try again.'));
    await db.auth.admin.createUser({ email, email_confirm: true }).catch(() => null);   // no-op if they already exist
    const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    const code = data?.properties?.email_otp;
    if (error || !code) redirect('/student/login?error=' + encodeURIComponent('Could not create a code. Please try again in a minute.'));
    try {
      const apps = await appsForEmail(email);
      await sendMail({
        to: email, subject: `${code} is your sign-in code`, body: `Your sign-in code is ${code}. It expires in 60 minutes.`, eyebrow: 'Student portal', title: 'Your sign-in code', greeting: `Hi ${apps[0].name.split(/[\s,]+/)[0]},`, preheader: `Your code is ${code}`,
        blocks: [{ type: 'p', text: 'Use this code to sign in to your student portal.' }, { type: 'code', code: code!, note: 'It expires in 60 minutes and works once.' }, { type: 'note', text: 'If you didn’t ask for this, you can ignore this email. Nobody can sign in without the code.' }],
        sign: { name: 'WhiteRock Educational Services', title: 'Student portal' }, footerNote: 'This is an automatic message about your student portal sign-in.',
      });
      await db.from('portal_notify_log').insert({ email, kind: 'student_code', ref: null });
    } catch { redirect('/student/login?error=' + encodeURIComponent('We couldn’t send the email right now. Please try again shortly.')); }
  }
  redirect(`/student/login?step=code&email=${encodeURIComponent(email)}`);
}

/** Step 2: check the code and sign them in. */
export async function verifyStudentCode(f: FormData) {
  const email = s(f, 'email').toLowerCase(), code = s(f, 'code').replace(/\D/g, '');
  const back2 = (m: string): never => redirect(`/student/login?step=code&email=${encodeURIComponent(email)}&error=${encodeURIComponent(m)}`);
  if (code.length < 6 || code.length > 10) back2('Enter the code from your email.');
  if (!(await isStudentEmail(email))) back2('That code didn’t work. Request a new one.');
  const { error } = await (await sessionClient()).auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) back2('That code didn’t work or has expired. Request a new one.');
  redirect('/student');
}

export async function studentSignOut() {
  await (await sessionClient()).auth.signOut();
  redirect('/student/login');
}

const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|docx?)$/i;
const sniff = (b: Buffer) => (b.subarray(0, 4).toString() === '%PDF' ? 'pdf' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.subarray(1, 4).toString() === 'PNG' ? 'png' : b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : b.subarray(0, 2).toString() === 'PK' ? 'docx' : b[0] === 0xd0 && b[1] === 0xcf ? 'doc' : null);

/** A student uploads one document into their own Drive folder. Returns a result instead of redirecting so the page can update in place. */
export async function studentUpload(f: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await currentStudent();
  if (!me) return { ok: false, error: 'Please sign in again.' };
  const appId = s(f, 'appId'), docType = s(f, 'docType'), file = f.get('file');
  if (!me.ids.includes(appId)) return { ok: false, error: 'That application isn’t yours.' };
  // A document the school's stage is asking for right now is filed exactly as asked (so "TB certificate" is never mistaken for a degree certificate).
  let asked: string | null = null;
  if (s(f, 'reqType')) {
    const c = await loadStageContext(admin(), appId);
    const hit = 'error' in c ? undefined : studentAsks(c.wf, c.st).find((a) => a.docType && a.docType.toLowerCase() === s(f, 'reqType').toLowerCase());
    if (!hit) return { ok: false, error: 'That document is not being asked for right now.' };
    asked = hit.docType;
  }
  if (!asked && !(await docTypeOk(appId, docType))) return { ok: false, error: 'Choose what kind of document this is.' };
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'Choose a file first.' };
  if (!ALLOWED_EXT.test(file.name)) return { ok: false, error: 'Please upload a PDF, photo (JPG/PNG) or Word file.' };
  if (file.size > 4 * 1024 * 1024) return { ok: false, error: 'That file is over 4 MB. Please send a smaller or compressed copy.' };
  const buf = Buffer.from(await file.arrayBuffer());
  if (!sniff(buf)) return { ok: false, error: 'That doesn’t look like a PDF, photo or Word file.' };
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('name, drive_folder_id, student_key, workspace').eq('application_id', appId).single();
  let folder = app?.drive_folder_id || null;
  if (!folder && app) { const { data: sib } = await db.from('portal_applications').select('drive_folder_id').eq('student_key', app.student_key).not('drive_folder_id', 'is', null).limit(1); folder = sib?.[0]?.drive_folder_id || null; }
  if (!folder && app && app.workspace !== 'uk') { try { folder = await ensureFolder(appId); } catch (e) { return { ok: false, error: `Couldn’t set up your document folder: ${(e as Error).message.slice(0, 120)}` }; } }
  if (!folder || !app) return { ok: false, error: 'Uploads aren’t switched on for your application yet. Please message your counselor.' };
  const day = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from('portal_documents').select('drive_file_id', { count: 'exact', head: true }).eq('uploaded_by', me.email).gte('created_at', day);
  if ((count || 0) >= 25) return { ok: false, error: 'You’ve reached today’s upload limit. Please try again tomorrow.' };
  const ext = (file.name.match(/\.[^.]+$/) || ['.pdf'])[0].toLowerCase();
  let label: ReturnType<typeof resolveLabel> | null = null;
  if (!asked && docType === 'Other') { const l = cleanLabel(s(f, 'docLabel')); if (!l) return { ok: false, error: 'Please name the kind of document, for example “Bank statement”.' }; label = resolveLabel(l); }
  const askedFields = asked ? typeFields(asked) : null;
  const name = `${app.name} - ${asked ?? (label ? label.override || label.docType : docType)}${ext}`;
  try {
    const up = await callScript<DriveFile>('uploadFile', { applicationId: appId, folderId: folder, name, mimeType: file.type || 'application/octet-stream', base64: buf.toString('base64') });
    await db.from('portal_documents').upsert({ drive_file_id: up.id, application_id: appId, name: up.name, doc_type: askedFields ? askedFields.doc_type : label ? label.docType : docType, type_override: askedFields ? askedFields.type_override : label?.override ?? null, mime_type: up.mimeType, size_bytes: up.size, drive_url: up.url, source: 'portal', uploaded_by: me.email });
    await log(appId, me.email, 'doc_uploaded', { name: up.name, by: 'student' });
  } catch (e) { return { ok: false, error: `Upload failed. Please try again. (${(e as Error).message.slice(0, 120)})` }; }
  revalidatePath('/student'); revalidatePath('/');
  return { ok: true };
}

/** A student writes to their counselor. Delivered as an email to the counselor (replies go straight to the student) and kept in the message history. */
export async function studentMessage(f: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await currentStudent();
  if (!me) return { ok: false, error: 'Please sign in again.' };
  const appId = s(f, 'appId'), body = s(f, 'body').slice(0, 1500);
  if (!me.ids.includes(appId)) return { ok: false, error: 'That application isn’t yours.' };
  if (body.length < 3) return { ok: false, error: 'Write your message first.' };
  const db = admin();
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await db.from('portal_messages').select('id', { count: 'exact', head: true }).eq('sent_by', me.email).gte('created_at', since);
  if ((count || 0) >= 5) return { ok: false, error: 'You’ve sent a few messages today already. Your counselor will reply soon.' };
  const { data: app } = await db.from('portal_applications').select('name, school, programme, counselor').eq('application_id', appId).single();
  const { data: c } = app?.counselor ? await db.from('portal_counselors').select('name, email').eq('name_key', counselorKey(app.counselor)).maybeSingle() : { data: null };
  let to = c?.email || null;
  if (!to) { const { data: a } = await db.from('portal_staff').select('email').eq('role', 'admin').limit(1); to = a?.[0]?.email || null; }
  if (!to) return { ok: false, error: 'We couldn’t find who to send this to. Please try again later.' };
  const subject = `Message from ${app!.name}${app!.school ? ` (${schoolShort(app!.school)})` : ''}`;
  try {
    await sendMail({ to, subject, body: `${app!.name} wrote:\n\n${body}`, eyebrow: 'Student message', title: `${app!.name.split(/[\s,]+/)[0]} sent you a message`, greeting: c ? `Hi ${c.name.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '')},` : 'Hello,', preheader: body.slice(0, 100), replyTo: me.email, sign: { name: app!.name, title: [schoolShort(app!.school), app!.programme].filter(Boolean).join(' · ') || 'Student', email: me.email },
      blocks: [{ type: 'quote', from: `${app!.name} · ${me.email}`, text: body }], cta: { label: 'Open their file', href: `${site()}/applications/${encodeURIComponent(appId)}?tab=messages` } });
  } catch { return { ok: false, error: 'We couldn’t send that just now. Please try again.' }; }
  await db.from('portal_messages').insert({ application_id: appId, counselor_name: c?.name || null, to_email: to, to_kind: 'counselor', subject, body, sent_by: me.email });
  await log(appId, me.email, 'email_sent', { to, subject });
  return { ok: true };
}

/** Team: invite students to the student portal (one branded email each; paused for a week after an invite). */
async function inviteStudentsCore(rowsIn: { id: string }[], actor: string, force = false) {
  const db = admin(), out = { sent: 0, skipped: [] as { name: string; why: string }[] };
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const ids = rowsIn.map((r) => r.id);
  const { data: apps } = await db.from('portal_applications').select('application_id, name, email, school, counselor').in('application_id', ids);
  const { data: recent } = force ? { data: [] } : await db.from('portal_messages').select('application_id').like('subject', 'Your student portal%').gte('created_at', since).in('application_id', ids);
  const asked = new Set((recent || []).map((m) => m.application_id));
  const done = new Set<string>();
  for (const a of apps || []) {
    const skip = (why: string) => out.skipped.push({ name: a.name, why });
    if (!a.email || !EMAIL_RE.test(a.email)) { skip('no email address'); continue; }
    if (done.has(a.email.toLowerCase())) { skip('same email already invited'); continue; }
    if (asked.has(a.application_id)) { skip('invited in the last 7 days'); continue; }
    const { data: c } = a.counselor ? await db.from('portal_counselors').select('name, email').eq('name_key', counselorKey(a.counselor)).maybeSingle() : { data: null };
    const subject = 'Your student portal is ready';
    const body = `Hi ${a.name.split(/[\s,]+/)[0]},\n\nYour student portal is ready. Sign in with ${a.email} to see where your application is, upload your documents and message your counselor.\n\n${studentSite()}/student/login`;
    try {
      await sendMail({ to: a.email, subject, body, eyebrow: 'Student portal', title: 'Your student portal is ready', greeting: `Hi ${a.name.split(/[\s,]+/)[0]},`, preheader: 'See your application progress and upload your documents.', replyTo: c?.email || actor, from: c?.email || actor,
        blocks: [{ type: 'p', text: `Track your application, upload documents and message your counselor. Sign in with ${a.email}; we’ll email you a code, there is no password.` }], cta: { label: 'Open my student portal', href: `${studentSite()}/student/login` } });
      await db.from('portal_messages').insert({ application_id: a.application_id, counselor_name: c?.name || null, to_email: a.email, to_kind: 'student', subject, body, sent_by: actor });
      await log(a.application_id, actor, 'email_sent', { to: a.email, subject });
      done.add(a.email.toLowerCase()); out.sent++;
    } catch { skip('send failed'); }
  }
  return out;
}

export async function bulkInviteStudents(f: FormData) {
  const staff = await requireTeam();
  const { ids, left } = pickIds(f);
  let res;
  try { res = await inviteStudentsCore(ids.map((id) => ({ id })), staff.email); }
  catch (e) { rethrow(e); bulkBack(f, `Could not send: ${(e as Error).message}`, true); }
  revalidatePath('/messages');
  const why = new Map<string, string[]>(); res.skipped.forEach((x) => why.set(x.why, [...(why.get(x.why) || []), x.name]));
  const parts = [...why].map(([w, n]) => `${n.length} ${w}${n.length <= 3 ? ` (${n.join(', ')})` : ''}`);
  bulkBack(f, `${res.sent ? `Invited ${res.sent} student${res.sent === 1 ? '' : 's'} to the student portal.` : 'No invitations sent.'}${parts.length ? ` Skipped: ${parts.join('; ')}.` : ''}${leftNote(left)}`, !res.sent);
}

export async function inviteOneStudent(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), ret = s(f, 'returnTo') || `/applications/${encodeURIComponent(id)}?tab=messages`;
  await guardApp(staff, id);
  let res;
  try { res = await inviteStudentsCore([{ id }], staff.email, true); }
  catch (e) { rethrow(e); return back(id, `Could not send: ${(e as Error).message}`, true, ret); }
  revalidatePath('/messages');
  back(id, res.sent ? 'Invitation sent.' : `Not sent: ${res.skipped.map((x) => x.why).join('; ')}.`, !res.sent, ret);
}

/** A student updates the few details they own: phone, city and what they like to be called. Written to the portal and to your Google Sheet. */
export async function studentSaveDetails(f: FormData): Promise<{ ok: boolean; error?: string; sheet?: boolean }> {
  const me = await currentStudent();
  if (!me) return { ok: false, error: 'Please sign in again.' };
  const clean = (v: string, n: number) => v.replace(/\s+/g, ' ').trim().slice(0, n);
  const phone = clean(s(f, 'phone'), 30), city = clean(s(f, 'city'), 60), preferred = clean(s(f, 'preferred'), 40);
  if (phone && !/^[+\d][\d\s().-]{6,}$/.test(phone)) return { ok: false, error: 'That phone number doesn’t look right. Include your country code, like +234…' };
  if (city && !/^[\p{L}\p{M}][\p{L}\p{M}\s'.,-]*$/u.test(city)) return { ok: false, error: 'City should only contain letters.' };
  if (preferred && !/^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u.test(preferred)) return { ok: false, error: 'Preferred name should only contain letters.' };
  const db = admin();
  let sheet = true;
  for (const a of me.apps) {
    const { data: cur } = await db.from('portal_applications').select('phone, city').eq('application_id', a.application_id).single();
    await db.from('portal_applications').update({ phone: phone || null, city: city || null, preferred_name: preferred || null }).eq('application_id', a.application_id);
    const fields: Record<string, string> = {};
    if ((cur?.phone || '') !== phone) fields.phone = phone;
    if ((cur?.city || '') !== city) fields.city = city;
    if (Object.keys(fields).length) { try { await writeBack(a.application_id, fields); } catch { sheet = false; } }
  }
  await log(me.apps[0].application_id, me.email, 'details_updated', { fields: 'contact details', by: 'student' });
  revalidatePath('/student'); revalidatePath('/applications');
  return { ok: true, sheet };
}

// ================= Offer & visa tracking =================
export async function saveOffer(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), ret = `/applications/${encodeURIComponent(id)}?tab=offer`;
  await guardApp(staff, id);
  const date = (k: string) => { const v = s(f, k); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const pick = (k: string, ok: readonly string[]) => { const v = s(f, k); return ok.includes(v) ? v : null; };
  let conditions: { text: string; met: boolean; due?: string | null }[] = [];
  try { const raw = JSON.parse(s(f, 'conditions') || '[]'); if (Array.isArray(raw)) conditions = raw.slice(0, 20).map((c) => ({ text: String(c.text || '').replace(/\s+/g, ' ').trim().slice(0, 200), met: !!c.met, due: /^\d{4}-\d{2}-\d{2}$/.test(c.due || '') ? c.due : null })).filter((c) => c.text); } catch { /* ignore bad json */ }
  const docId = s(f, 'offer_doc_id') || null;
  const row = {
    application_id: id, offer_type: pick('offer_type', ['Conditional', 'Unconditional']), offer_date: date('offer_date'), offer_doc_id: docId, conditions, deposit_due: date('deposit_due'),
    cas_status: pick('cas_status', CAS_STATUSES), cas_applied_date: date('cas_applied_date'), cas_received_date: date('cas_received_date'),
    visa_status: pick('visa_status', VISA_STATUSES), visa_applied_date: date('visa_applied_date'), visa_biometrics_date: date('visa_biometrics_date'), visa_decision_date: date('visa_decision_date'),
    student_note: s(f, 'student_note').slice(0, 600) || null, visible_to_student: f.get('visible') === 'on', updated_by: staff.email, updated_at: new Date().toISOString(),
  };
  const db = admin();
  const { error } = await db.from('portal_offers').upsert(row);
  if (error) return back(id, `Could not save: ${error.message}`, true, ret);
  await log(id, staff.email, 'offer_updated', { offer: row.offer_type || '', cas: row.cas_status || '', visa: row.visa_status || '' });
  let extra = '';
  if (f.get('notify') === 'on') {
    const { data: a } = await db.from('portal_applications').select('name, email, preferred_name, counselor').eq('application_id', id).single();
    // the same update emailed a moment ago (a repeated click, a second tab) is not sent again
    const { data: lastMail } = a?.email ? await db.from('portal_messages').select('created_at').eq('application_id', id).eq('to_kind', 'student').eq('subject', 'An update on your application').order('created_at', { ascending: false }).limit(1).maybeSingle() : { data: null };
    if (isRecent(lastMail?.created_at)) extra = ' The student was already emailed a moment ago, so a second email was not sent.';
    else if (a?.email && EMAIL_RE.test(a.email) && row.visible_to_student) {
      try {
        const first = (a.preferred_name || a.name).split(/[\s,]+/)[0];
        const bits = [row.offer_type ? `${row.offer_type} offer` : '', row.cas_status && row.cas_status !== 'Not started' ? `CAS: ${row.cas_status}` : '', row.visa_status && row.visa_status !== 'Not started' ? `Visa: ${row.visa_status}` : ''].filter(Boolean);
        await sendMail({ to: a.email, subject: 'An update on your application', body: `Hi ${first},\n\nThere is an update on your application${bits.length ? `: ${bits.join(' · ')}` : ''}.\n\nSign in to your student portal to see the details: ${studentSite()}/student/login`, replyTo: staff.email, from: staff.email, eyebrow: 'Application update', title: 'There’s an update on your application', greeting: `Hi ${first},`, preheader: bits.join(' · ') || 'See the latest in your student portal.',
          blocks: [...(!bits.length && !row.student_note ? [{ type: 'p' as const, text: 'Your counselor updated your offer and visa progress.' }] : []), ...(bits.length ? [{ type: 'list' as const, items: bits }] : []), ...(row.student_note ? [{ type: 'quote' as const, from: 'Note from your counselor', text: row.student_note }] : [])], cta: { label: 'See my progress', href: `${studentSite()}/student/login` } });
        await addNotice({ email: a.email, applicationId: id, kind: 'offer', title: 'An update on your offer and visa', body: bits.join(' · ') || 'Your counselor updated your progress.', href: '/student#offer', by: staff.email });
        await db.from('portal_messages').insert({ application_id: id, to_email: a.email, to_kind: 'student', subject: 'An update on your application', body: bits.join(' · ') || 'Offer & visa update', sent_by: staff.email });
        extra = ' The student was emailed.';
      } catch { extra = ' (The email to the student could not be sent.)'; }
    }
  }
  revalidatePath('/student');
  back(id, `Offer & visa saved.${extra}`, false, ret);
}

// ================= Interview training =================
const backTo = (path: string, msg: string, err = false): never => redirect(`${path}${path.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);

/** Books one student into a session, then emails the student and their counselor (and the trainer). */
async function inviteToSlot(staff: { email: string; role: string; counselor_key: string | null }, slotId: string, appId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const db = admin();
  if (!(await canAccessApp(staff as never, appId))) return { ok: false, error: 'not your student' };
  const { data: a } = await db.from('portal_applications').select('application_id, name, email, school, programme, status, counselor, preferred_name').eq('application_id', appId).single();
  if (!a) return { ok: false, error: 'student not found' };
  if (!a.email || !EMAIL_RE.test(a.email)) return { ok: false, name: a.name, error: 'no email address' };
  const r = await bookSlotCore({ slotId, applicationId: appId, studentEmail: a.email, bookedBy: staff.email, asStudent: false });
  if (!r.ok) return { ok: false, name: a.name, error: r.error };
  await log(appId, staff.email, 'interview_booked', { when: r.slot!.starts_at });
  try { await emailBooking(r.slot!, { name: a.name, email: a.email, preferred: a.preferred_name }, staff.email, 'booked'); } catch { /* booking stands */ }
  await emailCounselorBooking(r.slot!, a, staff.email).catch(() => []);
  return { ok: true, name: a.name };
}

export async function createInterviewSlots(f: FormData) {
  const staff = await requireStaff();
  let starts: string[] = [];
  try { const raw = JSON.parse(s(f, 'starts') || '[]'); if (Array.isArray(raw)) starts = raw.map(String); } catch { /* ignore */ }
  starts = starts.map((x) => new Date(x)).filter((d) => !isNaN(d.getTime()) && d.getTime() > Date.now()).map((d) => d.toISOString()).slice(0, 12);
  if (!starts.length) backTo('/interviews', 'Pick a date and time in the future.', true);
  const duration = Math.max(10, Math.min(240, Number(s(f, 'duration')) || 45)), capacity0 = Math.max(1, Math.min(20, Number(s(f, 'capacity')) || 1));
  const invites = [...new Set(f.getAll('invite').map(String).filter(Boolean))].slice(0, 20);
  const trainer = s(f, 'trainer') || staff.email, notes = s(f, 'notes').slice(0, 300) || null;
  const auto = s(f, 'link_mode') !== 'paste';
  let pasted: string | null = null;
  if (!auto) { pasted = checkMeetingUrl(s(f, 'teams_url')); if (!pasted) backTo('/interviews', 'Paste a Google Meet link (like https://meet.google.com/abc-defg-hij) or a Microsoft Teams link.', true); }
  // A second click, a second tab or Enter pressed twice must not make a second session, a second Meet link or a second round of emails.
  const slotWs = await currentWorkspace();
  const { data: recent } = await admin().from('portal_interview_slots').select('starts_at, trainer, created_by, created_at').eq('workspace', slotWs).eq('created_by', staff.email).is('cancelled_at', null).gte('created_at', new Date(Date.now() - 150_000).toISOString());
  const { fresh, dupes } = splitDuplicates(starts, recent || [], { who: staff.email, trainer });
  if (!fresh.length) backTo('/interviews', 'That session was already created a moment ago, so a second copy was not made and nobody was emailed twice.');
  starts = fresh;
  const rows: { starts_at: string; teams_url: string; calendar_event_id: string | null }[] = [];
  for (const starts_at of starts) {
    if (!auto) { rows.push({ starts_at, teams_url: pasted!, calendar_event_id: null }); continue; }
    try {
      const m = await callScript<{ url: string; eventId: string }>('createMeet', { startsAt: starts_at, durationMin: duration, summary: 'Interview training (WhiteRock Educational Services)', description: 'Interview practice session for a student.' });
      rows.push({ starts_at, teams_url: m.url, calendar_event_id: m.eventId });
    } catch (e) {
      rethrow(e);
      const msg = (e as Error).message;
      for (const r of rows) if (r.calendar_event_id) { try { await callScript('deleteMeet', { eventId: r.calendar_event_id }); } catch { /* best effort */ } }
      backTo('/interviews', /unknown action/i.test(msg) ? 'Your Apps Script needs the newest PortalApi.gs (it is missing “createMeet”). Or choose “Paste a link” instead.' : /Calendar is not defined|Calendar\.Events/i.test(msg) ? 'Switch on the Google Calendar service in Apps Script (Services → + → Google Calendar API), then try again. Or choose “Paste a link” instead.' : `Could not create a Google Meet link: ${msg.replace(/^Apps Script:\s*/, '').slice(0, 160)}`, true);
    }
  }
  const capacity = Math.max(capacity0, invites.length);
  const { data: made, error } = await admin().from('portal_interview_slots').insert(rows.map((r) => ({ ...r, workspace: slotWs, duration_min: duration, trainer, capacity, notes, created_by: staff.email }))).select('id, starts_at').order('starts_at');
  if (error) backTo('/interviews', `Could not create the sessions: ${error.message}`, true);
  const invited: string[] = [], skipped: string[] = [];
  if (invites.length && made?.length) for (const appId of invites) { const r = await inviteToSlot(staff, made[0].id, appId); if (r.ok) invited.push(r.name!); else skipped.push(`${r.name || 'a student'} (${r.error})`); }
  await audit(staff.email, 'interview_slots_created', `${starts.length} session(s)`, { first: starts[0] });
  revalidatePath('/interviews'); revalidatePath('/student');
  backTo('/interviews', `${starts.length} session${starts.length === 1 ? '' : 's'} created.${invited.length ? ` Invited ${invited.join(', ')}: they and their counselors have been emailed.` : ' Students can book them now.'}${skipped.length ? ` Not invited: ${skipped.join('; ')}.` : ''}${dupes.length ? ` ${dupes.length === 1 ? 'One session was' : `${dupes.length} sessions were`} already created a moment ago and was not made again.` : ''}`, skipped.length > 0 && !invited.length);
}

export async function cancelInterviewSlot(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'slotId'), db = admin();
  const { data: slot } = await db.from('portal_interview_slots').select('*').eq('id', id).maybeSingle();
  if (!slot) backTo('/interviews', 'Session not found.', true);
  if (staff.role === 'counselor' && slot!.created_by !== staff.email && slot!.trainer !== staff.email) backTo('/interviews', 'You can only cancel your own sessions.', true);
  await db.from('portal_interview_slots').update({ cancelled_at: new Date().toISOString() }).eq('id', id);
  if (slot!.calendar_event_id) { try { await callScript('deleteMeet', { eventId: slot!.calendar_event_id }); } catch { /* the session is cancelled either way */ } }
  const { data: bs } = await db.from('portal_interview_bookings').select('id, student_email, portal_applications(name, preferred_name)').eq('slot_id', id).eq('status', 'booked');
  await db.from('portal_interview_bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('slot_id', id).eq('status', 'booked');
  let told = 0;
  for (const b of bs || []) { const a = b.portal_applications as unknown as { name: string; preferred_name: string | null } | null; try { await emailBooking(slot as never, { name: a?.name || 'there', email: b.student_email, preferred: a?.preferred_name }, staff.email, 'slot_cancelled'); told++; } catch { /* ignore */ } }
  revalidatePath('/interviews'); revalidatePath('/student');
  backTo('/interviews', `Session cancelled${told ? `, and ${told} student${told === 1 ? ' was' : 's were'} emailed` : ''}.`);
}

export async function staffBookStudent(f: FormData) {
  const staff = await requireStaff();
  const slotId = s(f, 'slotId'), appId = s(f, 'appId');
  if (!appId) backTo('/interviews', 'Choose a student first.', true);
  const r = await inviteToSlot(staff, slotId, appId);
  revalidatePath('/interviews'); revalidatePath('/student');
  if (!r.ok) backTo('/interviews', `${r.name ? `${r.name}: ` : ''}${r.error}`, true);
  backTo('/interviews', `${r.name} is booked. They and their counselor have been emailed the meeting link.`);
}

export async function setBookingStatus(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'bookingId'), status = s(f, 'status'), db = admin();
  const { data: b } = await db.from('portal_interview_bookings').select('id, application_id').eq('id', id).maybeSingle();
  if (!b) backTo('/interviews', 'Booking not found.', true);
  await guardApp(staff, b!.application_id);
  if (!['booked', 'completed', 'no_show', 'cancelled'].includes(status)) backTo('/interviews', 'Unknown status.', true);
  await db.from('portal_interview_bookings').update({ status, feedback: s(f, 'feedback').slice(0, 1000) || null, feedback_visible: f.get('visible') === 'on', ...(status === 'cancelled' ? { cancelled_at: new Date().toISOString() } : {}) }).eq('id', id);
  await log(b!.application_id, staff.email, 'interview_updated', { status });
  revalidatePath('/interviews'); revalidatePath('/student');
  backTo(s(f, 'tab') === 'past' ? '/interviews?tab=past' : '/interviews', 'Saved.');
}

export async function studentBookSlot(slotId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await currentStudent();
  if (!me) return { ok: false, error: 'Please sign in again.' };
  const app = me.apps[0];
  const r = await bookSlotCore({ slotId, applicationId: app.application_id, studentEmail: me.email, bookedBy: me.email, asStudent: true });
  if (!r.ok) return { ok: false, error: r.error };
  await log(app.application_id, me.email, 'interview_booked', { when: r.slot!.starts_at, by: 'student' });
  try { await emailBooking(r.slot!, { name: app.name, email: me.email, preferred: app.preferred_name }, r.slot!.trainer || r.slot!.created_by, 'booked'); } catch { /* the booking stands */ }
  revalidatePath('/student'); revalidatePath('/interviews');
  return { ok: true };
}

export async function studentCancelBooking(bookingId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await currentStudent();
  if (!me) return { ok: false, error: 'Please sign in again.' };
  const db = admin();
  const { data: b } = await db.from('portal_interview_bookings').select('id, application_id, status, portal_interview_slots(starts_at)').eq('id', bookingId).maybeSingle();
  if (!b || !me.ids.includes(b.application_id) || b.status !== 'booked') return { ok: false, error: 'Booking not found.' };
  const start = (b.portal_interview_slots as unknown as { starts_at: string } | null)?.starts_at;
  if (!start || new Date(start).getTime() - Date.now() < MIN_NOTICE_H * 3600_000) return { ok: false, error: `Sessions can only be cancelled up to ${MIN_NOTICE_H} hours before they start. Please message your counselor.` };
  await db.from('portal_interview_bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', bookingId);
  await log(b.application_id, me.email, 'interview_cancelled', { when: start, by: 'student' });
  revalidatePath('/student'); revalidatePath('/interviews');
  return { ok: true };
}

// ================= Student checklist =================
export async function studentToggleChecklist(id: string): Promise<{ ok: boolean }> {
  const me = await currentStudent();
  if (!me) return { ok: false };
  const db = admin();
  const { data: it } = await db.from('portal_checklist').select('id, application_id, done').eq('id', id).maybeSingle();
  if (!it || !me.ids.includes(it.application_id)) return { ok: false };
  await db.from('portal_checklist').update({ done: !it.done, done_at: !it.done ? new Date().toISOString() : null }).eq('id', id);
  await log(it.application_id, me.email, !it.done ? 'checklist_done' : 'checklist_undone', { by: 'student' });
  revalidatePath('/student'); revalidatePath('/applications');
  return { ok: true };
}




export async function staffAddChecklist(f: FormData): Promise<{ ok: boolean; error?: string }> {
  const st = await requireStaff();
  const appId = s(f, 'appId'), text = s(f, 'text').trim().slice(0, 140), due = s(f, 'due') || null;
  await guardApp(st, appId);
  if (text.length < 3) return { ok: false, error: 'Describe the task first.' };
  const db = admin();
  const { error } = await db.from('portal_checklist').insert({ application_id: appId, text, due, created_by: st.email });
  if (error) return { ok: false, error: 'Could not add it.' };
  const { data: app } = await db.from('portal_applications').select('email').eq('application_id', appId).maybeSingle();
  if (app?.email) { try { await addNotice({ email: app.email.toLowerCase(), applicationId: appId, kind: 'message', title: 'New item on your checklist', body: text, href: '/student', by: st.email }); } catch { /* optional */ } }
  await log(appId, st.email, 'checklist_add', { text });
  revalidatePath(`/applications/${appId}`); revalidatePath('/student');
  return { ok: true };
}

export async function staffRemoveChecklist(id: string): Promise<{ ok: boolean }> {
  const st = await requireStaff();
  const db = admin();
  const { data: row } = await db.from('portal_checklist').select('application_id').eq('id', id).maybeSingle();
  if (!row) return { ok: false };
  await guardApp(st, row.application_id);
  await db.from('portal_checklist').delete().eq('id', id);
  revalidatePath(`/applications/${row.application_id}`); revalidatePath('/student');
  return { ok: true };
}


// ---- New-student chat: turn a lead into a student record ----
/** Staff: makes the visitor a student of this workspace (their chat summary and needs become a pinned note) and adds them to the country's sheet tab. */
export async function convertLead(f: FormData) {
  const staff = await requireTeam();
  const leadId = s(f, 'leadId');
  const db = admin();
  const { data: lead } = await db.from('portal_leads').select('*').eq('id', leadId).maybeSingle();
  if (!lead) redirect('/leads?err=' + encodeURIComponent('That lead was not found.'));
  if (!(await workspacesFor(staff)).some((w) => w.key === lead.workspace)) redirect('/leads?err=' + encodeURIComponent('You don’t have access to that workspace.'));
  if (lead.converted_app) redirect(`/applications/${encodeURIComponent(lead.converted_app)}?msg=${encodeURIComponent('This lead is already a student.')}`);
  const name = (lead.name || '').trim();
  if (name.length < 2) redirect(`/leads?lead=${leadId}&err=${encodeURIComponent('Add their name first (type it in the box under “Details”).')}`);
  const email = (lead.email || '').trim().toLowerCase() || null;
  const key = wsKey(lead.workspace, studentKey(email, null, name));
  const id = 'stub:' + createHash('sha1').update(key).digest('hex').slice(0, 16);
  const { data: same } = email ? await db.from('portal_applications').select('application_id').eq('workspace', lead.workspace).ilike('email', email.replace(/[\\%_]/g, '\\$&')) : { data: [] as { application_id: string }[] };
  const existing = same?.[0]?.application_id || null;
  const appId = existing || id;
  const now = new Date().toISOString();
  if (!existing) {
    const { error } = await db.from('portal_applications').upsert({
      application_id: id, workspace: lead.workspace, name, email, phone: lead.phone || null, status: 'New Lead', progress: progressFor('New Lead'), submitted_at: now,
      ...((lead.profile as Record<string, string> | null)?.school ? { school: (lead.profile as Record<string, string>).school } : {}), ...((lead.profile as Record<string, string> | null)?.programme ? { programme: (lead.profile as Record<string, string>).programme } : {}), ...((lead.profile as Record<string, string> | null)?.country ? { country: (lead.profile as Record<string, string>).country } : {}),
      student_key: key, in_master: false, in_regent: false, has_raw: false, synced_at: now, last_activity_at: now,
      ...(lead.source ? { source: lead.source, source_by: 'chat' } : {}),
    }, { onConflict: 'application_id' });
    if (error) redirect(`/leads?lead=${leadId}&err=${encodeURIComponent(`Could not save the student: ${error.message}`)}`);
    await log(id, staff.email, 'student_added', { from: 'new-student chat' });
    try { const routed = await routeApplications(db, { ids: [id], actor: staff.email, mode: 'new' }); after(() => notifyRouting(routed)); }
    catch { /* the student is saved; the queue on the Team Head page picks them up */ }
  }
  const body = ['From the new-student chat', lead.interest ? `Wants: ${lead.interest}` : '', ...(['level', 'qualifications', 'previousSchool', 'other'] as const).flatMap((k) => { const v = (lead.profile as Record<string, string> | null)?.[k]; return v ? [`${{ level: 'Study level', qualifications: 'Qualifications', previousSchool: 'Previous school', other: 'Other' }[k]}: ${v}`] : []; }), lead.summary || '', (lead.needs as string[] | null)?.length ? `Needs:\n${(lead.needs as string[]).map((n) => `- ${n}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  await db.from('portal_notes').upsert({ application_id: appId, author: 'ai', body, pinned: true, ai_key: 'lead' }, { onConflict: 'application_id,ai_key' });
  if (email) await db.from('portal_student_memory').upsert({ student_email: email, summary: lead.summary || '', needs: lead.needs || [], interests: lead.interest ? { wants: lead.interest } : {}, updated_at: now }, { onConflict: 'student_email', ignoreDuplicates: true });
  if (existing && lead.source) await db.from('portal_applications').update({ source: lead.source, source_by: 'chat' }).eq('application_id', appId).is('source', null);   // keep what the form or a person already recorded
  await db.from('portal_leads').update({ converted_app: appId, status: 'converted', staff_read_at: now }).eq('id', leadId);
  let sheet = '';
  if (!existing) { const r = await pushToMaster(appId, staff.email, 'New Lead').catch((e: Error) => `failed: ${e.message}`); sheet = r === 'added' ? ' Also added to the sheet.' : r === 'exists' ? '' : ` The sheet row was not added (${r}). Use “Add to master sheet” on the student to try again.`; }
  revalidatePath('/leads'); revalidatePath('/applications');
  redirect(`/applications/${encodeURIComponent(appId)}?msg=${encodeURIComponent(`${name} is now a student.${sheet}`)}`);
}
