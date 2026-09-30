import { createHash } from 'crypto';
import { admin } from './supabase';
import { callScript, DriveFile, MasterRow, SheetRow } from './appsScript';
import { canonicalStatus, counselorKey, docTypeFromName, normEmail, normName, progressFor, schoolDisplay, studentKey } from './docs';

const RECENT_MS = 3 * 24 * 3600 * 1000;

function parseSubmitted(s: string): string | null {
  if (!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(s.trim()); // dd-MM-yyyy HH:mm (form log)
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00Z`).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
const looksLikeDate = (s: string) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(s.trim()) || /^\d{4}-\d{2}-\d{2}T/.test(s.trim());
const pick = (...v: (string | null | undefined)[]) => v.map((x) => (x || '').trim()).find((x) => x && x.toUpperCase() !== 'N/A') || null;

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

/**
 * Merge rule:
 *  - Sheet1 (hand-maintained) is authoritative for status, counselor, notes, programme and student ID.
 *  - Applications (raw form log) is authoritative for submission time, contact details and Drive documents.
 *  - A student in only one sheet still appears (flagged), so nothing is hidden.
 */
export async function syncAll(opts: { full?: boolean } = {}) {
  const db = admin();
  const [raw, master] = await Promise.all([callScript<SheetRow[]>('listApplications'), callScript<MasterRow[]>('listMaster')]);

  // Index master rows: exact (email+school), then email only, then name only.
  const byKey = new Map<string, MasterRow>(), byEmail = new Map<string, MasterRow[]>(), byName = new Map<string, MasterRow[]>();
  let masterDupes = 0;
  master.forEach((m) => {
    const k = studentKey(m.email, m.school, m.name);
    if (byKey.has(k)) { masterDupes++; return; }
    byKey.set(k, m);
    const e = normEmail(m.email); if (e) byEmail.set(e, [...(byEmail.get(e) || []), m]);
    const n = normName(m.name); if (n) byName.set(n, [...(byName.get(n) || []), m]);
  });
  const only = <T,>(xs?: T[]) => (xs && xs.length === 1 ? xs[0] : undefined);
  const findMaster = (r: SheetRow) =>
    byKey.get(studentKey(r.email, r.school, r.name)) || only(byEmail.get(normEmail(r.email))) || only(byName.get(normName(r.name)));

  const { data: existing } = await db.from('portal_applications')
    .select('application_id, status, counselor, docs_synced_at, has_raw, in_master, student_key');
  const known = new Map((existing || []).map((r) => [r.application_id, r]));

  const usedMaster = new Set<MasterRow>();
  const activity: object[] = [];
  let created = 0, changedBySheet = 0;

  const build = (id: string, r: SheetRow | null, m: MasterRow | null) => {
    const prev = known.get(id);
    const status = canonicalStatus(m?.status || '') || canonicalStatus(r?.status || '') || prev?.status || null;
    const ref = m && m.studentIdOrDate && !looksLikeDate(m.studentIdOrDate) ? m.studentIdOrDate.trim() : null;
    const submitted = r ? parseSubmitted(r.submittedAt) : m && looksLikeDate(m.studentIdOrDate) ? parseSubmitted(m.studentIdOrDate) : null;
    const school = schoolDisplay(pick(r?.school, m?.school));
    const name = pick(m?.name, r?.name) || 'Unknown';
    if (!prev) {
      created++;
      activity.push({ application_id: id, actor: 'system', kind: r ? 'new_application' : 'imported_from_master', detail: { school, programme: pick(m?.programme, r?.programme) } });
    } else if (prev.status && status && prev.status !== status) {
      changedBySheet++;
      activity.push({ application_id: id, actor: 'sheet', kind: 'status_change', detail: { from: prev.status, to: status } });
    }
    return {
      application_id: id, sheet_row: r?.row ?? null, master_row: m?.row ?? null,
      submitted_at: submitted, name, email: pick(r?.email, m?.email), phone: pick(r?.phone, m?.phone),
      school, programme: pick(m?.programme, r?.programme), country: pick(m?.country, r?.country),
      city: pick(r?.city, m?.city), gender: pick(r?.gender, m?.gender), dob: pick(r?.dob, m?.dob), age: pick(r?.age, m?.age),
      counselor: pick(m?.counselor, r?.counselor, prev?.counselor),
      status, progress: progressFor(status), student_ref: ref, sheet_notes: pick(m?.notes, r?.notes),
      drive_folder_id: r?.driveFolderId || null,
      drive_folder_url: r?.driveFolderId ? `https://drive.google.com/drive/folders/${r.driveFolderId}` : null,
      student_key: studentKey(pick(r?.email, m?.email), school, name),
      in_master: !!m, has_raw: !!r, master_data: m, raw_data: r, synced_at: new Date().toISOString(),
    };
  };

  const rows = raw.map((r) => { const m = findMaster(r) || null; if (m) usedMaster.add(m); return build(r.applicationId, r, m); });
  const rawKeys = new Set(rows.map((r) => r.student_key));
  const masterOnly = master.filter((m) => !usedMaster.has(m) && byKey.get(studentKey(m.email, m.school, m.name)) === m).map((m) => {
    const key = studentKey(m.email, m.school, m.name);
    return build('master:' + createHash('sha1').update(key).digest('hex').slice(0, 16), null, m);
  });
  const all = [...rows, ...masterOnly];

  for (let i = 0; i < all.length; i += 100) {
    const { error } = await db.from('portal_applications').upsert(all.slice(i, i + 100), { onConflict: 'application_id' });
    if (error) throw new Error(error.message);
  }
  if (activity.length) await db.from('portal_activity').insert(activity);

  // A master-only student who later submits the form: move their notes/history onto the real application, then drop the stub.
  const latestByKey = new Map<string, string>();
  rows.forEach((r) => { if (!latestByKey.has(r.student_key)) latestByKey.set(r.student_key, r.application_id); });
  for (const [id, prev] of known) {
    if (!id.startsWith('master:') || !prev.student_key || !rawKeys.has(prev.student_key)) continue;
    const target = latestByKey.get(prev.student_key)!;
    await db.from('portal_notes').update({ application_id: target }).eq('application_id', id);
    await db.from('portal_activity').update({ application_id: target }).eq('application_id', id);
    await db.from('portal_applications').delete().eq('application_id', id);
  }

  // Counselors: make sure each name exists so an email can be attached in Settings.
  const names = new Map<string, string>();
  all.forEach((r) => { const k = counselorKey(r.counselor); if (k && !names.has(k)) names.set(k, (r.counselor || '').trim()); });
  if (names.size) {
    await db.from('portal_counselors').upsert([...names].map(([name_key, name]) => ({ name_key, name })),
      { onConflict: 'name_key', ignoreDuplicates: true });
  }

  const now = Date.now();
  const needFiles = rows.filter((r) => {
    if (!r.drive_folder_id) return false;
    const prev = known.get(r.application_id);
    return opts.full || !prev?.docs_synced_at || (r.submitted_at && now - new Date(r.submitted_at).getTime() < RECENT_MS);
  }).map((r) => ({ id: r.application_id, folder: r.drive_folder_id! }));
  await syncFolders(needFiles);

  return {
    total: all.length, created, inBoth: rows.filter((r) => r.in_master).length,
    rawOnly: rows.filter((r) => !r.in_master).length, masterOnly: masterOnly.length,
    statusChangedInSheet: changedBySheet, masterDuplicateRows: masterDupes, foldersRefreshed: needFiles.length,
  };
}
