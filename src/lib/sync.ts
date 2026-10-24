import { createHash } from 'crypto';
import { admin } from './supabase';
import { refreshTasks } from './overview';
import { callScript, DriveFile, MasterRow, RegentRow, SheetRow } from './appsScript';
import { canonicalStatus, counselorKey, docTypeFromName, normEmail, normName, progressFor, schoolDisplay, schoolKey, studentKey } from './docs';
import { pick, resolveMoved, type Moved } from './moves';
import { sourceFromNotes } from './sources';
import { pushPendingMoves } from './moveCore';
import { writeBack } from './sheetWrite';
import { isPlaceholderCounselor } from './assignEngine';
import { recordSheetOwner, routeApplications } from './assignCore';
import { notifyRouting } from './assignNotify';
import { listMasterFor } from './sheets';
import { DEFAULT_WS, wsKey } from './workspaceCore';
import type { Workspace } from './workspace';

const RECENT_MS = 3 * 24 * 3600 * 1000;

function parseSubmitted(s: string): string | null {
  if (!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(s.trim()); // dd-MM-yyyy HH:mm (form log)
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00Z`).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
const looksLikeDate = (s: string) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(s.trim()) || /^\d{4}-\d{2}-\d{2}T/.test(s.trim());

export async function syncFolders(apps: { id: string; folders: string[] }[]) {
  const db = admin();
  for (let i = 0; i < apps.length; i += 10) {
    const chunk = apps.slice(i, i + 10);
    const listed = await callScript<Record<string, DriveFile[] | { error: string }>>('listFiles', { folderIds: [...new Set(chunk.flatMap((c) => c.folders))] });
    for (const { id, folders } of chunk) {
      const results = folders.map((f) => listed[f]);
      if (results.some((r) => !Array.isArray(r))) continue; // a folder failed to list: keep what we have
      const files = (results as DriveFile[][]).flat();
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
  // Same name at a different university is a different application, so a name-only match must agree on school.
  const sameSchool = (a: string, b: string) => !schoolKey(a) || !schoolKey(b) || schoolKey(a) === schoolKey(b);
  return {
    dupes, unique: [...byKey.values()],
    find: (x: { name: string; email: string; school: string }) => {
      const hit = byKey.get(studentKey(x.email, x.school, x.name)) || only(byEmail.get(normEmail(x.email)));
      if (hit) return hit;
      const byN = only(byName.get(normName(x.name)));
      return byN && sameSchool(x.school, byN.school) ? byN : undefined;
    },
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
async function syncWorkspace(w: Workspace, opts: { full?: boolean } = {}) {
  const db = admin(), isDefault = w.key === DEFAULT_WS;
  // The original workspace reads the form log, Sheet1 and Regent Only. Any other country reads its own tab only.
  const [raw, master, regent] = isDefault
    ? await Promise.all([callScript<SheetRow[]>('listApplications'), callScript<MasterRow[]>('listMaster'), callScript<RegentRow[]>('listRegent')])
    : [[] as SheetRow[], await listMasterFor<MasterRow>(w.key, w.master_tab), [] as RegentRow[]];
  const M = makeFinder(master), G = makeFinder(regent);
  const sKey = (email: string | null, school: string | null, name: string) => wsKey(w.key, studentKey(email, school, name));

  const { data: existing } = await db.from('portal_applications')
    .select('application_id, status, counselor, docs_synced_at, student_key, payment, interview, extra_folder_ids, moved, source, source_by').eq('workspace', w.key);
  const known = new Map((existing || []).map((r) => [r.application_id, r]));

  const stubIdByKey = new Map<string, string>();
  for (const [kid, prev] of known) if (kid.startsWith('stub:') && prev.student_key) stubIdByKey.set(prev.student_key, kid);

  const usedM = new Set<MasterRow>(), usedG = new Set<RegentRow>();
  const activity: object[] = [];
  let created = 0, changedBySheet = 0;
  const touched: string[] = [];
  const newIds: string[] = [];                                                            // applications seen for the first time: routed to a counselor below
  const ownerChanges: { id: string; from: string | null; to: string | null }[] = [];     // the sheet named a different counselor

  const build = (id: string, r: SheetRow | null, m: MasterRow | null, g: RegentRow | null) => {
    const prev = known.get(id);
    const status = canonicalStatus(m?.status || '') || canonicalStatus(g?.status || '') || canonicalStatus(r?.status || '') || prev?.status || null;
    const ref = m && m.studentIdOrDate && !looksLikeDate(m.studentIdOrDate) ? m.studentIdOrDate.trim() : null;
    const submitted = r ? parseSubmitted(r.submittedAt)
      : m && looksLikeDate(m.studentIdOrDate) ? parseSubmitted(m.studentIdOrDate)
      : g ? parseSubmitted(g.date) : null;
    // A school or programme changed in the portal stays until the sheet catches up (or someone edits the sheet after the move).
    const sheetSchool = schoolDisplay(pick(r?.school, m?.school, g?.school)), sheetProgramme = pick(m?.programme, g?.programme, r?.programme);
    const mv = resolveMoved({ school: sheetSchool, programme: sheetProgramme }, prev?.moved as Moved | null);
    const school = schoolDisplay(mv.school);
    const programme = mv.programme;
    const name = pick(m?.name, g?.name, r?.name) || 'Unknown';
    // The document form writes "Lead source: Instagram" into the notes. Keep it as the student's source and hide the tag from the notes.
    const tagged = [m?.notes, g?.notes, r?.notes].map((n) => sourceFromNotes(n)).find((x) => x.source);
    const fromForm = tagged?.source ?? null;
    const source = prev?.source_by && prev.source_by.includes('@') ? prev.source : fromForm ?? prev?.source ?? null;   // a person's choice in the portal always wins
    const sourceBy = prev?.source_by && prev.source_by.includes('@') ? prev.source_by : fromForm ? 'form' : prev?.source_by ?? null;
    const payment = pick(g?.payment);
    const rawInterview = pick(g?.interview); // "To Be Booked for interview" / "...Interview" are the same thing
    const interview = rawInterview && /to be booked/i.test(rawInterview) ? 'To be booked for interview' : rawInterview;
    const skey = sKey(pick(r?.email, m?.email, g?.email), school, name);
    // The owner: a real name on the sheet wins; otherwise the one we already have. The form's "I don't have a counselor yet" never replaces an owner
    // the rules (or a person) gave, and a student who had a hand-made stub keeps the stub's counselor when the form arrives.
    const sheetOwner = [m?.counselor, g?.counselor, r?.counselor].map((c) => (c || '').trim()).find((c) => c && !isPlaceholderCounselor(c)) || null;
    const inherited = prev ? null : known.get(stubIdByKey.get(skey) ?? '')?.counselor ?? null;
    const heldOwner = [prev?.counselor, inherited].find((c) => c && !isPlaceholderCounselor(c)) || null;
    const counselor = sheetOwner || heldOwner || pick(m?.counselor, g?.counselor, r?.counselor, prev?.counselor);
    if (!prev) {
      created++; newIds.push(id);
      activity.push({ application_id: id, actor: 'system', kind: r ? 'new_application' : 'imported_from_sheet', detail: { school, programme: pick(m?.programme, g?.programme, r?.programme) } });
    } else {
      if (sheetOwner && sheetOwner !== prev.counselor) ownerChanges.push({ id, from: prev.counselor ?? null, to: sheetOwner });
      if (prev.status && status && prev.status !== status) {
        changedBySheet++; touched.push(id);
        activity.push({ application_id: id, actor: 'sheet', kind: 'status_change', detail: { from: prev.status, to: status } });
      }
      if (g && prev.payment !== payment && (prev.payment || payment)) activity.push({ application_id: id, actor: 'sheet', kind: 'payment_change', detail: { from: prev.payment, to: payment } });
      if (g && prev.interview !== interview && (prev.interview || interview)) activity.push({ application_id: id, actor: 'sheet', kind: 'interview_change', detail: { from: prev.interview, to: interview } });
      mv.dropped.filter((d) => d.why === 'sheet-changed').forEach((d) => activity.push({ application_id: id, actor: 'sheet', kind: 'move_reset', detail: { field: d.kind, value: d.kind === 'school' ? school : programme } }));
    }
    return {
      application_id: id, workspace: w.key, sheet_row: r?.row ?? null, master_row: m?.row ?? null, regent_row: g?.row ?? null,
      submitted_at: submitted, name, email: pick(r?.email, m?.email, g?.email), phone: pick(r?.phone, m?.phone, g?.phone),
      school, programme, moved: mv.moved, country: pick(m?.country, g?.country, r?.country),
      city: pick(r?.city, m?.city, g?.city), gender: pick(r?.gender, m?.gender, g?.gender), dob: pick(r?.dob, m?.dob), age: pick(r?.age, m?.age),
      counselor,
      status, progress: progressFor(status), student_ref: ref, sheet_notes: sourceFromNotes(pick(m?.notes, g?.notes, r?.notes)).notes, source, source_by: sourceBy,
      opp_id: pick(g?.oppId), payment, interview,
      // Form folder first; folders linked by hand in the portal are kept across syncs.
      drive_folder_id: r?.driveFolderId || prev?.extra_folder_ids?.[0] || null,
      drive_folder_url: (r?.driveFolderId || prev?.extra_folder_ids?.[0]) ? `https://drive.google.com/drive/folders/${r?.driveFolderId || prev?.extra_folder_ids?.[0]}` : null,
      extra_folder_ids: prev?.extra_folder_ids || [],
      student_key: skey,
      in_master: !!m, in_regent: !!g, has_raw: !!r, master_data: m, regent_data: g, raw_data: r, synced_at: new Date().toISOString(),
    };
  };

  const rows = raw.map((r) => {
    // After a move the sheet may already say the new school, so look for the student under that name first.
    const to = (known.get(r.applicationId)?.moved as Moved | null)?.school?.to;
    const m = (to ? M.find({ ...r, school: to }) : null) || M.find(r) || null, g = (to ? G.find({ ...r, school: to }) : null) || G.find(r) || null;
    if (m) usedM.add(m); if (g) usedG.add(g);
    return build(r.applicationId, r, m, g);
  });
  const rawKeys = new Set(rows.map((r) => r.student_key));

  // Students with no form submission: one stub per student, gathering Sheet1 + Regent Only together.
  const stubs = new Map<string, ReturnType<typeof build>>();
  // A stub's id comes from its school. If the school changed (a move, then the sheet followed), keep the id it already has
  // so its documents, messages and history stay attached.
  const stubFor = (m: MasterRow | null, g: RegentRow | null) => {
    const key = sKey(pick(m?.email, g?.email), schoolDisplay(pick(m?.school, g?.school)), pick(m?.name, g?.name) || '');
    const std = 'stub:' + createHash('sha1').update(key).digest('hex').slice(0, 16);
    const id = known.has(std) ? std : stubIdByKey.get(key) || std;
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
  if (touched.length) await db.from('portal_applications').update({ last_activity_at: new Date().toISOString() }).in('application_id', touched);

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
    await db.from('portal_assign_log').update({ application_id: target }).eq('application_id', id);
    await db.from('portal_applications').delete().eq('application_id', id);
  }

  // Counselors: make sure each name exists so an email can be attached in Settings.
  const names = new Map<string, string>();
  all.forEach((r) => { const k = counselorKey(r.counselor); if (k && !names.has(k) && !isPlaceholderCounselor(r.counselor)) names.set(k, (r.counselor || '').trim()); });
  if (names.size) {
    await db.from('portal_counselors').upsert([...names].map(([name_key, name]) => ({ name_key, name })),
      { onConflict: 'name_key', ignoreDuplicates: true });
  }

  // Automatic routing: every application seen for the first time goes to whoever the rules make responsible. Best effort: a routing problem
  // is logged and never fails the sync, and an owner the application already has is never replaced.
  try {
    if (ownerChanges.length) await recordSheetOwner(db, ownerChanges);
    if (newIds.length) {
      const routed = await routeApplications(db, { ids: newIds, actor: 'system', mode: 'new' });
      // Put the new owner in the sheet too, so people working from it see the same counselor (a few at a time; the portal already has it).
      for (const a of routed.assigned.slice(0, 10)) { try { await writeBack(a.id, { counselor: a.counselorName }); } catch { /* the sheet can be filled in by hand */ } }
      await notifyRouting(routed);
    }
  } catch (e) { console.error('routing failed', e); }

  const now = Date.now();
  const needFiles = all.map((r) => ({ r, folders: [...new Set([r.drive_folder_id, ...(r.extra_folder_ids || [])].filter(Boolean) as string[])] }))
    .filter(({ r, folders }) => {
      if (!folders.length) return false;
      const prev = known.get(r.application_id);
      return opts.full || !prev?.docs_synced_at || (r.submitted_at && now - new Date(r.submitted_at).getTime() < RECENT_MS);
    }).map(({ r, folders }) => ({ id: r.application_id, folders }));
  await syncFolders(needFiles);

  return {
    total: all.length, created, formSubmissions: rows.length,
    inMaster: all.filter((r) => r.in_master).length, inRegent: all.filter((r) => r.in_regent).length,
    formOnly: rows.filter((r) => !r.in_master).length, noForm: stubs.size,
    statusChangedInSheet: changedBySheet, foldersRefreshed: needFiles.length,
  };
}

/** Syncs every active workspace (country). One country failing never stops the others; the first problem is reported at the end. */
export async function syncAll(opts: { full?: boolean } = {}) {
  const { listWorkspaces } = await import('./workspace');
  const all = (await listWorkspaces()).filter((w) => w.active);
  const results: Awaited<ReturnType<typeof syncWorkspace>>[] = [];
  const warnings: string[] = [];
  const byWorkspace: Record<string, number> = {};
  for (const w of all) {
    try { const r = await syncWorkspace(w, opts); results.push(r); byWorkspace[w.key] = r.total; }
    catch (e) { if (w.key === DEFAULT_WS) throw e; warnings.push(`${w.name}: ${(e as Error).message}`); }
  }
  try { await pushPendingMoves(); } catch { /* moves the sheet missed are tried again next time */ }
  try { for (const w of all) await refreshTasks(undefined, w.key); } catch { /* tasks refresh again when the overview is opened */ }
  const sum = (k: 'total' | 'created' | 'formSubmissions' | 'inMaster' | 'inRegent' | 'formOnly' | 'noForm' | 'statusChangedInSheet' | 'foldersRefreshed') => results.reduce((n, r) => n + r[k], 0);
  return { total: sum('total'), created: sum('created'), formSubmissions: sum('formSubmissions'), inMaster: sum('inMaster'), inRegent: sum('inRegent'), formOnly: sum('formOnly'), noForm: sum('noForm'), statusChangedInSheet: sum('statusChangedInSheet'), foldersRefreshed: sum('foldersRefreshed'), byWorkspace, warnings };
}
