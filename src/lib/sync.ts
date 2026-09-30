import { createHash } from 'crypto';
import { admin } from './supabase';
import { callScript, DriveFile, MasterRow, RegentRow, SheetRow } from './appsScript';
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
          mime_type: f.mimeType, size_bytes: f.size, drive_url: f.url, created_at: f.createdAt, folder_path: f.path || null,
        })), { onConflict: 'drive_file_id', ignoreDuplicates: false });
      }
      const keep = files.map((f) => f.id);
      const del = db.from('portal_documents').delete().eq('application_id', id);
      await (keep.length ? del.not('drive_file_id', 'in', `(${keep.join(',')})`) : del);
      await db.from('portal_applications').update({ docs_synced_at: new Date().toISOString() }).eq('application_id', id);
    }
  }
}

/** Finds a student's row in a sheet: exact (email+school), then a unique email, then a unique name. */
function makeFinder<T extends { name: string; email: string; school: string }>(rows: T[]) {
  const byKey = new Map<string, T>(), byEmail = new Map<string, T[]>(), byName = new Map<string, T[]>();
  let dupes = 0;
  rows.forEach((m) => {
    const k = studentKey(m.email, m.school, m.name);
    if (byKey.has(k)) { dupes++; return; }
    byKey.set(k, m);
    const e = normEmail(m.email); if (e) byEmail.set(e, [...(byEmail.get(e) || []), m]);
    const n = normName(m.name); if (n) byName.set(n, [...(byName.get(n) || []), m]);
  });
  const only = (xs?: T[]) => (xs && xs.length === 1 ? xs[0] : undefined);
  return {
    dupes, unique: [...byKey.values()],
    find: (x: { name: string; email: string; school: string }) =>
      byKey.get(studentKey(x.email, x.school, x.name)) || only(byEmail.get(normEmail(x.email))) || only(byName.get(normName(x.name))),
  };
}

const isStub = (id: string) => /^(stub|master|regent):/.test(id);

/**
 * Three sources, one student record:
 *  - Sheet1 (hand-maintained): status, counselor, notes, programme.
 *  - Regent Only: OPP ID, payment, interview booking (and its own status/notes, shown for comparison).
 *  - Applications (raw form log): submission time, contact details, Drive documents.
 * A student found in only some of them still appears, flagged, so nothing is hidden.
 */
export async function syncAll(opts: { full?: boolean } = {}) {
  const db = admin();
  const [raw, master, regent] = await Promise.all([
    callScript<SheetRow[]>('listApplications'), callScript<MasterRow[]>('listMaster'), callScript<RegentRow[]>('listRegent'),
  ]);
  const M = makeFinder(master), G = makeFinder(regent);

  const { data: existing } = await db.from('portal_applications')
    .select('application_id, status, counselor, docs_synced_at, student_key, payment, interview');
  const known = new Map((existing || []).map((r) => [r.application_id, r]));

  const usedM = new Set<MasterRow>(), usedG = new Set<RegentRow>();
  const activity: object[] = [];
  let created = 0, changedBySheet = 0;

  const build = (id: string, r: SheetRow | null, m: MasterRow | null, g: RegentRow | null) => {
    const prev = known.get(id);
    const status = canonicalStatus(m?.status || '') || canonicalStatus(g?.status || '') || canonicalStatus(r?.status || '') || prev?.status || null;
    const ref = m && m.studentIdOrDate && !looksLikeDate(m.studentIdOrDate) ? m.studentIdOrDate.trim() : null;
    const submitted = r ? parseSubmitted(r.submittedAt)
      : m && looksLikeDate(m.studentIdOrDate) ? parseSubmitted(m.studentIdOrDate)
      : g ? parseSubmitted(g.date) : null;
    const school = schoolDisplay(pick(r?.school, m?.school, g?.school));
    const name = pick(m?.name, g?.name, r?.name) || 'Unknown';
    const payment = pick(g?.payment), interview = pick(g?.interview);
    if (!prev) {
      created++;
      activity.push({ application_id: id, actor: 'system', kind: r ? 'new_application' : 'imported_from_sheet', detail: { school, programme: pick(m?.programme, g?.programme, r?.programme) } });
    } else {
      if (prev.status && status && prev.status !== status) {
        changedBySheet++;
        activity.push({ application_id: id, actor: 'sheet', kind: 'status_change', detail: { from: prev.status, to: status } });
      }
      if (g && prev.payment !== payment && (prev.payment || payment)) activity.push({ application_id: id, actor: 'sheet', kind: 'payment_change', detail: { from: prev.payment, to: payment } });
      if (g && prev.interview !== interview && (prev.interview || interview)) activity.push({ application_id: id, actor: 'sheet', kind: 'interview_change', detail: { from: prev.interview, to: interview } });
    }
    return {
      application_id: id, sheet_row: r?.row ?? null, master_row: m?.row ?? null, regent_row: g?.row ?? null,
      submitted_at: submitted, name, email: pick(r?.email, m?.email, g?.email), phone: pick(r?.phone, m?.phone, g?.phone),
      school, programme: pick(m?.programme, g?.programme, r?.programme), country: pick(m?.country, g?.country, r?.country),
      city: pick(r?.city, m?.city, g?.city), gender: pick(r?.gender, m?.gender, g?.gender), dob: pick(r?.dob, m?.dob), age: pick(r?.age, m?.age),
      counselor: pick(m?.counselor, g?.counselor, r?.counselor, prev?.counselor),
      status, progress: progressFor(status), student_ref: ref, sheet_notes: pick(m?.notes, g?.notes, r?.notes),
      opp_id: pick(g?.oppId), payment, interview,
      drive_folder_id: r?.driveFolderId || null,
      drive_folder_url: r?.driveFolderId ? `https://drive.google.com/drive/folders/${r.driveFolderId}` : null,
      student_key: studentKey(pick(r?.email, m?.email, g?.email), school, name),
      in_master: !!m, in_regent: !!g, has_raw: !!r, master_data: m, regent_data: g, raw_data: r, synced_at: new Date().toISOString(),
    };
  };

  const rows = raw.map((r) => {
    const m = M.find(r) || null, g = G.find(r) || null;
    if (m) usedM.add(m); if (g) usedG.add(g);
    return build(r.applicationId, r, m, g);
  });
  const rawKeys = new Set(rows.map((r) => r.student_key));

  // Students with no form submission: one stub per student, gathering Sheet1 + Regent Only together.
  const stubs = new Map<string, ReturnType<typeof build>>();
  const stubFor = (m: MasterRow | null, g: RegentRow | null) => {
    const key = studentKey(pick(m?.email, g?.email), schoolDisplay(pick(m?.school, g?.school)), pick(m?.name, g?.name) || '');
    const id = 'stub:' + createHash('sha1').update(key).digest('hex').slice(0, 16);
    if (!stubs.has(id)) stubs.set(id, build(id, null, m, g));
  };
  M.unique.filter((m) => !usedM.has(m)).forEach((m) => { const g = G.find(m) || null; if (g) usedG.add(g); stubFor(m, g); });
  G.unique.filter((g) => !usedG.has(g)).forEach((g) => stubFor(null, g));
  const all = [...rows, ...stubs.values()];

  for (let i = 0; i < all.length; i += 100) {
    const { error } = await db.from('portal_applications').upsert(all.slice(i, i + 100), { onConflict: 'application_id' });
    if (error) throw new Error(error.message);
  }
  if (activity.length) await db.from('portal_activity').insert(activity);

  // Keep notes/history when a stub becomes a real application (form submitted) or its id scheme changes.
  const latestByKey = new Map<string, string>();
  rows.forEach((r) => { if (!latestByKey.has(r.student_key)) latestByKey.set(r.student_key, r.application_id); });
  const stubByKey = new Map([...stubs.values()].map((s) => [s.student_key, s.application_id]));
  for (const [id, prev] of known) {
    if (!isStub(id) || !prev.student_key) continue;
    const target = latestByKey.get(prev.student_key) || stubByKey.get(prev.student_key);
    if (!target || target === id) continue;
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
    total: all.length, created, formSubmissions: rows.length,
    inMaster: all.filter((r) => r.in_master).length, inRegent: all.filter((r) => r.in_regent).length,
    formOnly: rows.filter((r) => !r.in_master).length, noForm: stubs.size,
    statusChangedInSheet: changedBySheet, foldersRefreshed: needFiles.length,
  };
}
