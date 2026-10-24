// Puts one file into a student's Drive folder and records it as one of their documents, filed under the kind the caller names.
import { admin } from './supabase';
import { callScript, DriveFile } from './appsScript';
import { ensureFolder } from './driveFolders';
import { ALL_DOC_TYPES } from './constants';

const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|docx?)$/i;
export const MAX_UPLOAD = 4 * 1024 * 1024;   // a request to the server carries about 4 MB

/** A standard kind is stored as itself; any other kind (a bank statement, a TB certificate) is "Other" carrying its own name, so every view shows it by that name. */
export function typeFields(kind: string): { doc_type: string; type_override: string | null } {
  const std = (ALL_DOC_TYPES as readonly string[]).find((t) => t.toLowerCase() === kind.toLowerCase());
  return std && std !== 'Other' ? { doc_type: std, type_override: null } : { doc_type: 'Other', type_override: kind };
}

export async function uploadToStudentFolder(o: { appId: string; file: File; kind: string; by: string; source: 'app' | 'portal' }): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const { file } = o;
  if (!file.size) return { ok: false, error: 'Choose a file first.' };
  if (!ALLOWED_EXT.test(file.name)) return { ok: false, error: 'Please upload a PDF, a photo (JPG or PNG) or a Word file.' };
  if (file.size > MAX_UPLOAD) return { ok: false, error: 'That file is over 4 MB. Please send a smaller or compressed copy.' };
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('name, drive_folder_id, student_key, workspace').eq('application_id', o.appId).maybeSingle();
  if (!app) return { ok: false, error: 'Application not found.' };
  let folder = app.drive_folder_id || null;
  if (!folder) { const { data: sib } = await db.from('portal_applications').select('drive_folder_id').eq('student_key', app.student_key).not('drive_folder_id', 'is', null).limit(1); folder = sib?.[0]?.drive_folder_id || null; }
  if (!folder && app.workspace !== 'uk') { try { folder = await ensureFolder(o.appId); } catch (e) { return { ok: false, error: `Could not set up the document folder: ${(e as Error).message.slice(0, 120)}` }; } }
  if (!folder) return { ok: false, error: 'This application has no Drive folder yet, so files cannot be stored.' };
  const ext = (file.name.match(/\.[^.]+$/) || ['.pdf'])[0].toLowerCase();
  try {
    const up = await callScript<DriveFile>('uploadFile', { applicationId: o.appId, folderId: folder, name: `${app.name} - ${o.kind}${ext}`, mimeType: file.type || 'application/octet-stream', base64: Buffer.from(await file.arrayBuffer()).toString('base64') });
    await db.from('portal_documents').upsert({ drive_file_id: up.id, application_id: o.appId, name: up.name, ...typeFields(o.kind), mime_type: up.mimeType, size_bytes: up.size, drive_url: up.url, source: o.source, uploaded_by: o.by });
    await db.from('portal_activity').insert({ application_id: o.appId, actor: o.by, kind: 'doc_uploaded', detail: { name: up.name } });
    await db.from('portal_applications').update({ last_activity_at: new Date().toISOString() }).eq('application_id', o.appId);
    return { ok: true, id: up.id, name: up.name };
  } catch (e) { return { ok: false, error: `Upload failed: ${(e as Error).message.slice(0, 160)}` }; }
}
