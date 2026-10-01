'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { admin, sessionClient } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { callScript, DriveFile } from '@/lib/appsScript';
import { counselorKey, docTypeFromName, dobForMaster, schoolShort } from '@/lib/docs';
import { ALL_DOC_TYPES } from '@/lib/constants';
import { syncAll, syncFolders } from '@/lib/sync';
import { STATUSES } from '@/lib/constants';
import { aiOverview, aiStudentSummary, computeFacts, loadStudents, refreshTasks, studentFacts } from '@/lib/overview';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (id: string, msg: string, err = false, returnTo?: string) => {
  const base = returnTo && (returnTo.startsWith(`/applications/${id}`) || returnTo.startsWith('/drive')) ? returnTo : `/applications/${encodeURIComponent(id)}`;
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
  await requireStaff();
  let msg: string;
  try {
    const r = await syncAll({ full: f.get('full') === '1' });
    msg = `Synced ${r.total} students · ${r.formSubmissions} with a form submission · ${r.inMaster} in Sheet1 · ${r.inRegent} in Regent Only · ${r.formOnly} not yet in Sheet1 · ${r.created} new.`;
  } catch (e) { msg = `Sync failed: ${(e as Error).message}`; }
  revalidatePath('/');
  redirect(`/?msg=${encodeURIComponent(msg)}`);
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
  const staff = await requireStaff();
  const id = s(f, 'id');
  if (!(STATUSES as readonly string[]).includes(s(f, 'status'))) return back(id, 'Choose a status', true);
  try {
    const res = await pushToMaster(id, staff.email, s(f, 'status'), s(f, 'counselor') || undefined);
    await syncAll();
    revalidatePath('/');
    return back(id, res === 'exists' ? 'Already in the master sheet' : 'Added to the master sheet (Sheet1)');
  } catch (e) { return back(id, `Could not add: ${(e as Error).message}`, true); }
}

export async function bulkAddToMaster(f: FormData) {
  const staff = await requireStaff();
  const all = f.getAll('ids').map(String).filter(Boolean);
  const ids = all.slice(0, 15); // keep within the server time limit; do the rest in another batch
  const status = s(f, 'status') || 'New Lead';
  if (!ids.length) redirect(`/?source=raw_only&err=${encodeURIComponent('Tick at least one student')}`);
  let added = 0, existed = 0, failed = 0;
  for (const id of ids) {
    try { (await pushToMaster(id, staff.email, status)) === 'added' ? added++ : existed++; } catch { failed++; }
  }
  try { await syncAll(); } catch { /* next sync will catch up */ }
  revalidatePath('/');
  redirect(`/?source=raw_only&msg=${encodeURIComponent(`Added ${added} to the master sheet${existed ? `, ${existed} already there` : ''}${failed ? `, ${failed} failed` : ''}.${all.length > ids.length ? ` ${all.length - ids.length} left — run it again.` : ''}`)}`);
}

export async function updateRegent(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id');
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('in_regent, regent_data, opp_id, payment, interview').eq('application_id', id).single();
  if (!a?.in_regent || !a.regent_data) return back(id, 'This student is not in the Regent Only tab', true, `/applications/${id}?tab=regent`);
  const g = a.regent_data as { email: string; name: string; school: string };
  const fields = { oppId: s(f, 'oppId'), payment: s(f, 'payment'), interview: s(f, 'interview') };
  try { await callScript('updateRegent', { email: g.email, name: g.name, school: g.school, fields }); }
  catch (e) { return back(id, `Could not update the sheet: ${(e as Error).message}`, true, `/applications/${id}?tab=regent`); }
  await db.from('portal_applications').update({ opp_id: fields.oppId || null, payment: fields.payment || null, interview: fields.interview || null }).eq('application_id', id);
  await log(id, staff.email, 'regent_update', fields);
  revalidatePath('/');
  back(id, 'Regent details saved', false, `/applications/${id}?tab=regent`);
}

export async function updateStatus(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), status = s(f, 'status');
  if (!(STATUSES as readonly string[]).includes(status)) return back(id, 'Invalid status', true);
  const db = admin();
  const { data: cur } = await db.from('portal_applications').select('status').eq('application_id', id).single();
  await db.from('portal_applications').update({ status }).eq('application_id', id);
  await log(id, staff.email, 'status_change', { from: cur?.status ?? null, to: status });
  try { await writeBack(id, { status }); }
  catch (e) { return back(id, `Saved in portal but sheet write-back failed: ${(e as Error).message}`, true); }
  revalidatePath('/');
  back(id, 'Status updated');
}

export async function updateCounselor(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), counselor = s(f, 'counselor');
  const db = admin();
  const { data: cur } = await db.from('portal_applications').select('counselor').eq('application_id', id).single();
  await db.from('portal_applications').update({ counselor: counselor || null }).eq('application_id', id);
  await log(id, staff.email, 'counselor_change', { from: cur?.counselor ?? null, to: counselor });
  try { await writeBack(id, { counselor }); }
  catch (e) { return back(id, `Saved in portal but sheet write-back failed: ${(e as Error).message}`, true); }
  revalidatePath('/');
  back(id, 'Counselor updated');
}

export async function addNote(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), body = s(f, 'body'), ret = s(f, 'returnTo');
  if (!body) return back(id, 'Note is empty', true, ret);
  await admin().from('portal_notes').insert({ application_id: id, author: staff.email, body, pinned: f.get('pinned') === 'on' });
  await log(id, staff.email, 'note', { preview: body.slice(0, 120) });
  try { await writeBack(id, {}, body, staff.email); } catch { /* portal is the record; sheet mirror is best-effort */ }
  back(id, 'Note added', false, ret);
}

export async function sendCounselorEmail(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), to = s(f, 'to'), subject = s(f, 'subject'), body = s(f, 'body');
  if (!EMAIL_RE.test(to)) return back(id, 'Enter a valid counselor email (add it under Settings)', true);
  if (!subject || !body) return back(id, 'Subject and message are required', true);
  try { await callScript('sendEmail', { to, subject, body, replyTo: staff.email }); }
  catch (e) { return back(id, `Email failed: ${(e as Error).message}`, true); }
  await log(id, staff.email, 'email_sent', { to, subject });
  back(id, `Email sent to ${to}`);
}

export async function uploadDocument(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), docType = s(f, 'docType'), ret = s(f, 'returnTo');
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
  } catch (e) { return back(id, `Upload failed: ${(e as Error).message}`, true, ret); }
  back(id, 'Document uploaded to Drive and linked', false, ret);
}

export async function refreshDocuments(f: FormData) {
  await requireStaff();
  const id = s(f, 'id'), ret = s(f, 'returnTo');
  const { data: app } = await admin().from('portal_applications').select('drive_folder_id, extra_folder_ids').eq('application_id', id).single();
  const folders = [...new Set([app?.drive_folder_id, ...(app?.extra_folder_ids || [])].filter(Boolean) as string[])];
  if (folders.length) await syncFolders([{ id, folders }]);
  back(id, 'Documents refreshed from Drive', false, ret);
}

export async function setDocType(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), fileId = s(f, 'fileId'), type = s(f, 'docType'), ret = s(f, 'returnTo');
  if (!(ALL_DOC_TYPES as readonly string[]).includes(type)) return back(id, 'Invalid document type', true, ret);
  const { data: doc } = await admin().from('portal_documents').select('name, doc_type').eq('drive_file_id', fileId).single();
  await admin().from('portal_documents').update({ type_override: type === doc?.doc_type ? null : type }).eq('drive_file_id', fileId);
  await log(id, staff.email, 'doc_retyped', { name: doc?.name, type });
  back(id, `Marked as ${type}`, false, ret);
}

// ---- Overview, tasks, AI ----
const DAY_MS = 864e5;
const homeOr = (f: FormData | undefined, def = '/overview') => { const r = f ? s(f, 'returnTo') : ''; return r === '/' || r.startsWith('/overview') ? r : def; };

export async function markSeen(f?: FormData) {
  const staff = await requireStaff();
  await admin().from('portal_staff').update({ last_seen_at: new Date().toISOString() }).eq('email', staff.email);
  revalidatePath('/'); revalidatePath('/overview');
  redirect(homeOr(f));
}

async function closeTask(f: FormData, status: 'done' | 'dismissed' | 'snoozed', days: number) {
  const staff = await requireStaff();
  const db = admin();
  const id = s(f, 'taskId');
  const now = new Date();
  const { data: t } = await db.from('portal_tasks').select('application_id, title').eq('id', id).single();
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
  await requireStaff();
  const { rows, all } = await loadStudents();
  await refreshTasks(rows);
  const staff = await requireStaff();
  const facts = await computeFacts(rows, all, staff.last_seen_at);
  const r = await aiOverview(facts, true);
  revalidatePath('/'); revalidatePath('/overview');
  redirect(`${homeOr(f)}${r.error ? `?err=${encodeURIComponent(r.error)}` : '?msg=Overview+refreshed'}`);
}

export async function generateSummary(f: FormData) {
  await requireStaff();
  const id = s(f, 'id');
  const { rows, all } = await loadStudents();
  const row = rows.find((r) => r.a.application_id === id) || rows.find((r) => all.some((x) => x.application_id === id && x.student_key === r.a.student_key));
  if (!row) return back(id, 'Student not found', true);
  const submissions = all.filter((x) => x.student_key === row.a.student_key).length;
  const r = await aiStudentSummary(id, studentFacts(row.a, { have: row.have, docCount: row.docCount, missing: row.missing, judged: row.judged, submissions }), true);
  back(id, r.error ? `AI summary: ${r.error}` : 'AI summary generated', !!r.error);
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
  await requireStaff();
  const { data: apps } = await admin().from('portal_applications').select('application_id, name')
    .is('drive_folder_id', null).order('drive_scan_at', { ascending: true, nullsFirst: true }).limit(12);
  let msg: string;
  try { const n = await scanApps(apps || []); msg = `Searched Drive for ${(apps || []).length} students — ${n} possible folders found.`; }
  catch (e) { msg = `Drive search failed: ${(e as Error).message}`; }
  revalidatePath('/drive');
  redirect(`/drive?msg=${encodeURIComponent(msg)}`);
}

export async function scanStudent(f: FormData) {
  await requireStaff();
  const id = s(f, 'id');
  const { data: a } = await admin().from('portal_applications').select('application_id, name').eq('application_id', id).single();
  try { const n = a ? await scanApps([a]) : 0; return back(id, n ? `Found ${n} possible folder${n > 1 ? 's' : ''} — check below and link the right one.` : 'No matching folders found. Paste the folder link instead.', false, docsTab(id)); }
  catch (e) { return back(id, `Drive search failed: ${(e as Error).message}`, true, docsTab(id)); }
}

export async function linkFolder(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), ret = s(f, 'returnTo') || docsTab(id);
  const folderId = folderIdFrom(s(f, 'folder'));
  if (!folderId) return back(id, 'That doesn’t look like a Google Drive folder link or ID', true, ret);
  try { const n = await attachFolder(id, folderId, staff.email); revalidatePath('/'); revalidatePath('/drive'); return back(id, `Folder linked — ${n} file${n === 1 ? '' : 's'} found`, false, ret); }
  catch (e) { return back(id, (e as Error).message, true, ret); }
}

export async function dismissSuggestion(f: FormData) {
  await requireStaff();
  const id = s(f, 'id'), ret = s(f, 'returnTo') || '/drive';
  await admin().from('portal_folder_suggestions').update({ status: 'dismissed' }).eq('id', s(f, 'sid'));
  revalidatePath('/drive');
  redirect(ret.startsWith('/') ? ret : `/applications/${id}`);
}

export async function unlinkFolder(f: FormData) {
  const staff = await requireStaff();
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
  const staff = await requireStaff();
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
export async function saveCounselor(f: FormData) {
  await requireStaff();
  const email = s(f, 'email');
  if (email && !EMAIL_RE.test(email)) redirect(`/settings?err=${encodeURIComponent('Invalid email for ' + s(f, 'name'))}`);
  await admin().from('portal_counselors').update({ email: email || null, active: f.get('active') === 'on' }).eq('id', s(f, 'id'));
  revalidatePath('/settings');
  redirect('/settings?msg=Saved');
}
export async function addCounselor(f: FormData) {
  await requireStaff();
  const name = s(f, 'name'), email = s(f, 'email');
  if (!name) redirect('/settings?err=Name+required');
  if (email && !EMAIL_RE.test(email)) redirect('/settings?err=Invalid+email');
  await admin().from('portal_counselors').upsert({ name, name_key: counselorKey(name), email: email || null }, { onConflict: 'name_key' });
  redirect('/settings?msg=Counselor+saved');
}
export async function addStaff(f: FormData) {
  const me = await requireStaff();
  if (me.role !== 'admin') redirect('/settings?err=Admins+only');
  const email = s(f, 'email').toLowerCase();
  if (!EMAIL_RE.test(email)) redirect('/settings?err=Invalid+email');
  await admin().from('portal_staff').upsert({ email, role: s(f, 'role') === 'admin' ? 'admin' : 'staff' });
  redirect('/settings?msg=Staff+added');
}
export async function removeStaff(f: FormData) {
  const me = await requireStaff();
  const email = s(f, 'email');
  if (me.role !== 'admin' || email === me.email) redirect('/settings?err=Not+allowed');
  await admin().from('portal_staff').delete().eq('email', email);
  redirect('/settings?msg=Removed');
}
