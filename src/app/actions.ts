'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { admin, sessionClient } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { callScript, DriveFile } from '@/lib/appsScript';
import { counselorKey, docTypeFromName } from '@/lib/docs';
import { syncAll, syncFolders } from '@/lib/sync';
import { STATUSES } from '@/lib/constants';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (id: string, msg: string, err = false) =>
  redirect(`/applications/${encodeURIComponent(id)}?${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);

async function log(applicationId: string, actor: string, kind: string, detail: object = {}) {
  const db = admin();
  await db.from('portal_activity').insert({ application_id: applicationId, actor, kind, detail });
  await db.from('portal_applications').update({ last_activity_at: new Date().toISOString() }).eq('application_id', applicationId);
}

export async function signIn(f: FormData) {
  const sb = await sessionClient();
  const { error } = await sb.auth.signInWithPassword({ email: s(f, 'email'), password: s(f, 'password') });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
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
    msg = `Synced ${r.total} applications (${r.created} new).`;
  } catch (e) { msg = `Sync failed: ${(e as Error).message}`; }
  revalidatePath('/');
  redirect(`/?msg=${encodeURIComponent(msg)}`);
}

export async function updateStatus(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), status = s(f, 'status');
  if (!(STATUSES as readonly string[]).includes(status)) return back(id, 'Invalid status', true);
  const db = admin();
  const { data: cur } = await db.from('portal_applications').select('status').eq('application_id', id).single();
  await db.from('portal_applications').update({ status }).eq('application_id', id);
  await log(id, staff.email, 'status_change', { from: cur?.status ?? null, to: status });
  try { await callScript('updateRow', { applicationId: id, fields: { status } }); }
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
  try { await callScript('updateRow', { applicationId: id, fields: { counselor } }); }
  catch (e) { return back(id, `Saved in portal but sheet write-back failed: ${(e as Error).message}`, true); }
  revalidatePath('/');
  back(id, 'Counselor updated');
}

export async function addNote(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), body = s(f, 'body');
  if (!body) return back(id, 'Note is empty', true);
  await admin().from('portal_notes').insert({ application_id: id, author: staff.email, body, pinned: f.get('pinned') === 'on' });
  await log(id, staff.email, 'note', { preview: body.slice(0, 120) });
  try { await callScript('updateRow', { applicationId: id, fields: { notes: body } }); } catch { /* portal is the record; sheet mirror is best-effort */ }
  back(id, 'Note added');
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
  const id = s(f, 'id'), docType = s(f, 'docType');
  const file = f.get('file') as File | null;
  if (!file || !file.size) return back(id, 'Choose a file', true);
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('name, drive_folder_id').eq('application_id', id).single();
  if (!app?.drive_folder_id) return back(id, 'This application has no Drive folder', true);
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
  } catch (e) { return back(id, `Upload failed: ${(e as Error).message}`, true); }
  back(id, 'Document uploaded to Drive and linked');
}

export async function refreshDocuments(f: FormData) {
  await requireStaff();
  const id = s(f, 'id');
  const { data: app } = await admin().from('portal_applications').select('drive_folder_id').eq('application_id', id).single();
  if (app?.drive_folder_id) await syncFolders([{ id, folder: app.drive_folder_id }]);
  back(id, 'Documents refreshed from Drive');
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
