'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { admin, sessionClient } from '@/lib/supabase';
import { guardApp, requireStaff, requireTeam } from '@/lib/auth';
import { callScript, DriveFile } from '@/lib/appsScript';
import { counselorKey, docTypeFromName, dobForMaster, schoolShort } from '@/lib/docs';
import { ALL_DOC_TYPES } from '@/lib/constants';
import { syncAll, syncFolders } from '@/lib/sync';
import { STATUSES } from '@/lib/constants';
import { requestDocs, summarise, digestEmail, sendPaymentReminders, summariseReminders } from '@/lib/requests';
import { sendMail } from '@/lib/mail';
import { audit } from '@/lib/audit';
import { runBackup } from '@/lib/backup';
import { notifyAssigned } from '@/lib/notify';
import { after } from 'next/server';
import { canAccessApp } from '@/lib/auth';
import { docScanEnabled, scanOne } from '@/lib/docscan';
import { draftEmail, PURPOSES, PurposeKey, TONES, ToneKey } from '@/lib/draft';
import { aiOverview, aiStudentSummary, computeFacts, loadStudents, refreshTasks, studentFacts } from '@/lib/overview';

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

// Status/counselor/notes live in the hand-maintained master sheet when the student is in it;
// otherwise they go to the raw Applications sheet. Notes are appended, never overwritten.
async function writeBack(id: string, fields: Record<string, string>, notesAppend?: string, by?: string) {
  const { data: app } = await admin().from('portal_applications')
    .select('in_master, has_raw, master_data').eq('application_id', id).single();
  if (!app) throw new Error('Application not found');
  if (app.in_master && app.master_data) {
    const m = app.master_data as { email: string; name: string; school: string };
    await callScript('updateMaster', { email: m.email, name: m.name, school: m.school, fields, notesAppend, by });
  } else if (app.has_raw) {
    await callScript('updateRow', { applicationId: id, fields, notesAppend, by });
  }
}

export async function signIn(f: FormData) {
  const sb = await sessionClient();
  const { error } = await sb.auth.signInWithPassword({ email: s(f, 'email'), password: s(f, 'password') });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect('/overview');
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
export async function signOut() {
  const sb = await sessionClient();
  await sb.auth.signOut();
  redirect('/login');
}

export async function syncNow(f: FormData) {
  const ret = s(f, 'returnTo') === '/applications' ? '/applications' : '/';
  await requireTeam();
  let msg: string;
  try {
    const r = await syncAll({ full: f.get('full') === '1' });
    msg = `Synced ${r.total} students · ${r.formSubmissions} with a form submission · ${r.inMaster} in Sheet1 · ${r.inRegent} in Regent Only · ${r.formOnly} not yet in Sheet1 · ${r.created} new.`;
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
    date: a.submitted_at, name: a.name, email: a.email || '', phone: a.phone || '', school: schoolShort(a.school),
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
  const { ids, left } = pickIds(f);
  const db = admin();
  let ok = 0, sheetFail = 0;
  const assigned: { id: string; name: string; school: string | null; programme: string | null }[] = [];
  for (const id of ids) {
    const { data: cur } = await db.from('portal_applications').select('counselor, name, school, programme').eq('application_id', id).single();
    await db.from('portal_applications').update({ counselor: counselor || null }).eq('application_id', id);
    await log(id, staff.email, 'counselor_change', { from: cur?.counselor ?? null, to: counselor });
    if (counselor && cur && cur.counselor !== counselor) assigned.push({ id, name: cur.name, school: cur.school, programme: cur.programme });
    try { await writeBack(id, { counselor }); } catch { sheetFail++; }
    ok++;
  }
  revalidatePath('/applications'); revalidatePath('/counselors');
  if (counselor && assigned.length) after(() => notifyAssigned(counselor, assigned, staff.email));
  bulkBack(f, `${counselor ? `Assigned to ${counselor}` : 'Unassigned'}: ${ok} student${ok === 1 ? '' : 's'}${sheetFail ? ` (${sheetFail} could not be written to the sheet)` : ''}.${leftNote(left)}`, sheetFail > 0);
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
  const db = admin();
  const { data: cur } = await db.from('portal_applications').select('counselor').eq('application_id', id).single();
  await db.from('portal_applications').update({ counselor: counselor || null }).eq('application_id', id);
  await log(id, staff.email, 'counselor_change', { from: cur?.counselor ?? null, to: counselor });
  if (counselor && counselor !== cur?.counselor) { const { data: st } = await db.from('portal_applications').select('name, school, programme').eq('application_id', id).single(); if (st) after(() => notifyAssigned(counselor, [{ id, ...st }], staff.email)); }
  const ret = s(f, 'returnTo');
  try { await writeBack(id, { counselor }); }
  catch (e) { rethrow(e); return back(id, `Saved in portal but sheet write-back failed: ${(e as Error).message}`, true, ret); }
  revalidatePath('/');
  back(id, 'Counselor updated', false, ret);
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
  const { data: app } = await db.from('portal_applications').select('name, drive_folder_id').eq('application_id', id).single();
  if (!app?.drive_folder_id) return back(id, 'This application has no Drive folder', true, ret);
  const ext = (file.name.match(/\.[^.]+$/) || ['.pdf'])[0];
  const name = docType && docType !== 'Other' ? `${app.name} - ${docType}${ext}` : file.name;
  try {
    const up = await callScript<DriveFile>('uploadFile', {
      applicationId: id, folderId: app.drive_folder_id, name, mimeType: file.type,
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    });
    await db.from('portal_documents').upsert({
      drive_file_id: up.id, application_id: id, name: up.name, doc_type: docTypeFromName(up.name), mime_type: up.mimeType,
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

export async function setDocType(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), fileId = s(f, 'fileId'), type = s(f, 'docType'), ret = s(f, 'returnTo');
  await guardApp(staff, id);
  if (!(ALL_DOC_TYPES as readonly string[]).includes(type)) return back(id, 'Invalid document type', true, ret);
  const { data: doc } = await admin().from('portal_documents').select('name, doc_type, application_id').eq('drive_file_id', fileId).single();
  if (doc) await guardApp(staff, doc.application_id);
  await admin().from('portal_documents').update({ type_override: type === doc?.doc_type ? null : type }).eq('drive_file_id', fileId);
  await log(id, staff.email, 'doc_retyped', { name: doc?.name, type });
  back(id, `Marked as ${type}`, false, ret);
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
  revalidatePath('/overview');
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
  const r = await aiStudentSummary(id, studentFacts(row.a, { have: row.have, docCount: row.docCount, missing: row.missing, judged: row.judged, submissions }), true);
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
    redirect(`/settings?msg=${encodeURIComponent(`Apps Script is connected ✓ (${Date.now() - t0} ms).`)}`);
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

// Adds a student by hand: a new row in Sheet1, then a sync so the portal shows it.
export async function createApplication(f: FormData) {
  const staff = await requireTeam();
  const name = s(f, 'name'), email = s(f, 'email').toLowerCase();
  if (!name) redirect('/applications/new?err=Name+is+required');
  if (email && !EMAIL_RE.test(email)) redirect('/applications/new?err=Invalid+email');
  const status = s(f, 'status') || 'New Lead';
  try {
    const r = await callScript<{ exists: boolean }>('addMaster', {
      date: new Date().toISOString(), name, email, phone: s(f, 'phone'), school: schoolShort(s(f, 'school')), programme: s(f, 'programme'),
      country: s(f, 'country'), city: s(f, 'city'), gender: s(f, 'gender'), dob: dobForMaster(s(f, 'dob')), age: s(f, 'age'), counselor: s(f, 'counselor'), status,
    });
    await syncAll();
    const db = admin();
    const q = email ? db.from('portal_applications').select('application_id').ilike('email', email) : db.from('portal_applications').select('application_id').ilike('name', name);
    const { data: hit } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (hit) { await log(hit.application_id, staff.email, 'moved_to_master', { status, exists: r.exists }); redirect(`/applications/${hit.application_id}?msg=${encodeURIComponent(r.exists ? 'Already in Sheet1 — opened the existing record' : 'Student added to Sheet1')}`); }
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw e;
    redirect('/applications/new?err=' + encodeURIComponent((e as Error).message));
  }
  redirect('/applications?msg=Student+added');
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
  const { error } = await admin().from('portal_staff').update({
    display_name: clip(s(f, 'display_name'), 60) || null,
    title: clip(s(f, 'title'), 80) || null,
    phone: phone || null,
    bio: s(f, 'bio').trim().slice(0, 400) || null,
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
