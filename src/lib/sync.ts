import { admin } from './supabase';
import { callScript, DriveFile, SheetRow } from './appsScript';
import { counselorKey, docTypeFromName, studentKey } from './docs';

const RECENT_MS = 3 * 24 * 3600 * 1000;

function parseSubmitted(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  const m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}))?/.exec(s); // dd-MM-yyyy HH:mm
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00Z`).toISOString() : null;
}

export async function syncFolders(appIds: { id: string; folder: string }[]) {
  const db = admin();
  for (let i = 0; i < appIds.length; i += 20) {
    const chunk = appIds.slice(i, i + 20);
    const listed = await callScript<Record<string, DriveFile[] | { error: string }>>('listFiles', { folderIds: chunk.map((c) => c.folder) });
    for (const { id, folder } of chunk) {
      const files = listed[folder];
      if (!Array.isArray(files)) continue;
      if (files.length) {
        await db.from('portal_documents').upsert(files.map((f) => ({
          drive_file_id: f.id, application_id: id, name: f.name, doc_type: docTypeFromName(f.name),
          mime_type: f.mimeType, size_bytes: f.size, drive_url: f.url, created_at: f.createdAt,
        })), { onConflict: 'drive_file_id', ignoreDuplicates: false });
      }
      const keep = files.map((f) => f.id);
      const del = db.from('portal_documents').delete().eq('application_id', id);
      await (keep.length ? del.not('drive_file_id', 'in', `(${keep.join(',')})`) : del);
      await db.from('portal_applications').update({ docs_synced_at: new Date().toISOString() }).eq('application_id', id);
    }
  }
}

export async function syncAll(opts: { full?: boolean } = {}) {
  const db = admin();
  const rows = await callScript<SheetRow[]>('listApplications');
  const { data: existing } = await db.from('portal_applications')
    .select('application_id, status, counselor, docs_synced_at, drive_folder_id');
  const known = new Map((existing || []).map((r) => [r.application_id, r]));

  let created = 0;
  const newActivity: object[] = [];
  const upserts = rows.map((r) => {
    const prev = known.get(r.applicationId);
    if (!prev) {
      created++;
      newActivity.push({ application_id: r.applicationId, actor: 'system', kind: 'new_application', detail: { school: r.school, programme: r.programme } });
    }
    return {
      application_id: r.applicationId, sheet_row: r.row, submitted_at: parseSubmitted(r.submittedAt),
      name: r.name, email: r.email || null, phone: r.phone || null, school: r.school || null,
      programme: r.programme || null, country: r.country || null, city: r.city || null, gender: r.gender || null,
      dob: r.dob || null, age: r.age || null,
      // Sheet wins when it has a value (staff may edit it directly); a blank keeps the portal's value.
      counselor: r.counselor || prev?.counselor || null,
      status: r.status || prev?.status || null,
      sheet_notes: r.notes || null,
      drive_folder_id: r.driveFolderId || null,
      drive_folder_url: r.driveFolderId ? `https://drive.google.com/drive/folders/${r.driveFolderId}` : null,
      student_key: studentKey(r.email, r.school, r.name),
      synced_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await db.from('portal_applications').upsert(upserts.slice(i, i + 200), { onConflict: 'application_id' });
    if (error) throw new Error(error.message);
  }
  if (newActivity.length) await db.from('portal_activity').insert(newActivity);

  // Make sure every counselor named in the sheet exists so an email can be attached in Settings.
  const names = new Map<string, string>();
  rows.forEach((r) => { const k = counselorKey(r.counselor); if (k && !names.has(k)) names.set(k, r.counselor.trim()); });
  if (names.size) {
    await db.from('portal_counselors').upsert(
      [...names].map(([name_key, name]) => ({ name_key, name })),
      { onConflict: 'name_key', ignoreDuplicates: true });
  }

  const now = Date.now();
  const needFiles = rows.filter((r) => {
    if (!r.driveFolderId) return false;
    const prev = known.get(r.applicationId);
    const sub = parseSubmitted(r.submittedAt);
    return opts.full || !prev?.docs_synced_at || (sub && now - new Date(sub).getTime() < RECENT_MS);
  }).map((r) => ({ id: r.applicationId, folder: r.driveFolderId }));
  await syncFolders(needFiles);

  return { total: rows.length, created, foldersRefreshed: needFiles.length };
}
