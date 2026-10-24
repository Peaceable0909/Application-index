// The stage operations: move, place, review a requirement, switch conditional stages on or off, add an applicant-only requirement.
// No Next.js and no sign-in here (the server actions in app/stageActions.ts check who is asking); everything takes the database client,
// so it can be run against a test database.
import { progressFor, schoolKey } from './docs';
import { STATUSES } from './constants';
import { checkMove, findStage, readiness, refOf, stageReqs, type CheckState, type ExtraReq, type MoveCheck, type ReqEval, type Role, type Stage, type Workflow, type AppState } from './stageEngine';
import { loadAppState, workflowFor, type Db } from './stages';

export type Mover = { email: string; role: Role };
export type Fail = { ok: false; error: string; check?: MoveSummary };
export type MoveSummary = { direction: MoveCheck['direction']; roleBlocked: boolean; canOverride: boolean; enablesTarget: boolean; blockers: { label: string; stage: string; why: string | null }[]; skipped: string[]; messages: string[] };

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

type AppRow = { application_id: string; name: string; school: string | null; workspace: string; status: string | null; counselor: string | null; stage_key: string | null; stage_at: string | null; email: string | null };
const APP_COLS = 'application_id, name, school, workspace, status, counselor, stage_key, stage_at, email';

export async function loadContext(db: Db, appId: string): Promise<{ app: AppRow; wf: Workflow; st: AppState } | { error: string }> {
  const { data: app } = await db.from('portal_applications').select(APP_COLS).eq('application_id', appId).maybeSingle();
  if (!app) return { error: 'Application not found.' };
  if (!schoolKey(app.school)) return { error: 'Set the application’s school first. Each school has its own stages.' };
  const wf = await workflowFor(db, app.workspace, app.school);
  if (!wf) return { error: `There is no stage workflow for ${app.school} yet. An admin can add one on the Workflows page.` };
  return { app: app as AppRow, wf, st: await loadAppState(db, appId, wf) };
}

async function logActivity(db: Db, appId: string, actor: string, kind: string, detail: object) {
  await db.from('portal_activity').insert({ application_id: appId, actor, kind, detail });
  await db.from('portal_applications').update({ last_activity_at: now() }).eq('application_id', appId);
}

const summarise = (c: MoveCheck): MoveSummary => ({
  direction: c.direction, roleBlocked: c.roleBlocked, canOverride: c.canOverride, enablesTarget: c.enablesTarget, messages: c.messages,
  blockers: c.blockers.map((b) => ({ label: b.label, stage: b.stageName, why: b.why })), skipped: c.skipped.map((s) => s.name),
});

/** The Offer & visa tab follows the stage: entering "CAS Requested" records that the CAS was requested, and so on. Dates already there are kept. */
async function syncOffer(db: Db, appId: string, stage: Stage, by: string) {
  const o = stage.offer_sync;
  if (!o) return;
  const { data: cur } = await db.from('portal_offers').select('*').eq('application_id', appId).maybeSingle();
  const patch: Record<string, unknown> = { application_id: appId, updated_by: by, updated_at: now() };
  if (o.offer_type === 'Conditional' || o.offer_type === 'Unconditional') { patch.offer_type = o.offer_type; if (!cur?.offer_date) patch.offer_date = today(); }
  if (o.cas_status) {
    patch.cas_status = o.cas_status;
    if (o.cas_status === 'Requested' && !cur?.cas_applied_date) patch.cas_applied_date = today();
    if (o.cas_status === 'Received' && !cur?.cas_received_date) patch.cas_received_date = today();
  }
  if (o.visa_status) {
    patch.visa_status = o.visa_status;
    if (o.visa_status === 'Applied' && !cur?.visa_applied_date) patch.visa_applied_date = today();
  }
  await db.from('portal_offers').upsert(patch, { onConflict: 'application_id' });
}

export type MoveOk = { ok: true; from: string | null; to: string; kind: 'move' | 'override'; statusChanged: { from: string | null; to: string } | null; stage: Stage; app: AppRow; missing: string[] };

/**
 * Moves an application to another stage of its school's workflow.
 *  - Forward: everything required on the way must be in order, otherwise it is refused and says what is open.
 *  - Backward: allowed, with a note.
 *  - An admin (or whoever the workflow lists) may override open requirements with a written reason; the history keeps what was open.
 *  - Conditional stages named in `enable` are switched on for this applicant first (and so is a conditional target).
 */
export async function moveApplication(db: Db, o: { appId: string; toKey: string; mover: Mover; note?: string; override?: string; enable?: string[] }): Promise<MoveOk | Fail> {
  const c = await loadContext(db, o.appId);
  if ('error' in c) return { ok: false, error: c.error };
  const { app, wf } = c;
  let st = c.st;
  // switches for conditional stages the person ticked in the panel
  const turnOn = (o.enable || []).filter((k) => wf.stages.some((s) => s.key === k && s.conditional && s.active) && st.flags[`stage:${k}`] !== true);
  if (turnOn.length) st = { ...st, flags: { ...st.flags, ...Object.fromEntries(turnOn.map((k) => [`stage:${k}`, true])) } };
  const check = checkMove(wf, st, o.toKey, { role: o.mover.role });
  const target = findStage(wf, o.toKey), from = findStage(wf, st.stage_key);
  if (!target) return { ok: false, error: 'That stage does not exist in this school’s workflow.' };
  if (check.direction === 'same') return { ok: false, error: 'The application is already in that stage.' };
  if (check.roleBlocked) return { ok: false, error: `Your role is not allowed to move an application into “${target.name}”.`, check: summarise(check) };
  const note = (o.note || '').trim().slice(0, 500);
  let kind: 'move' | 'override' = 'move';
  let missing: string[] = [];
  if (check.direction === 'backward') {
    if (note.length < 3) return { ok: false, error: 'Add a short note saying why the application goes back.', check: summarise(check) };
  } else if (!check.ok) {
    const reason = (o.override || '').trim();
    if (!(reason && check.canOverride)) {
      return { ok: false, error: check.canOverride ? 'Some requirements are still open. Complete them, or override with a written reason.' : 'Some requirements are still open, so the application cannot move on yet.', check: summarise(check) };
    }
    if (reason.length < 5) return { ok: false, error: 'Write a reason for overriding (at least a few words).', check: summarise(check) };
    kind = 'override'; missing = check.blockers.map((b) => `${b.stageName}: ${b.label}`);
  }
  const at = now();
  // switches first, so a failure part-way never leaves the stage changed with the switches missing
  const flagRows = [...turnOn, ...(check.enablesTarget && !turnOn.includes(target.key) ? [target.key] : [])].map((k) => ({ application_id: o.appId, flag: `stage:${k}`, enabled: true, note: 'Switched on while moving the application', set_by: o.mover.email, set_at: at }));
  if (flagRows.length) await db.from('portal_app_flags').upsert(flagRows, { onConflict: 'application_id,flag' });
  const patch: Record<string, unknown> = { stage_key: target.key, stage_at: at, stage_by: o.mover.email };
  let statusChanged: MoveOk['statusChanged'] = null;
  if (target.maps_status && (STATUSES as readonly string[]).includes(target.maps_status) && target.maps_status !== app.status) {
    patch.status = target.maps_status; patch.progress = progressFor(target.maps_status);
    statusChanged = { from: app.status, to: target.maps_status };
  }
  const { error } = await db.from('portal_applications').update(patch).eq('application_id', o.appId);
  if (error) return { ok: false, error: `Could not save the new stage: ${error.message}` };
  await db.from('portal_stage_history').insert({ application_id: o.appId, from_key: from?.key ?? null, from_name: from?.name ?? null, to_key: target.key, to_name: target.name, kind, actor: o.mover.email, note: [note, kind === 'override' ? `Override: ${(o.override || '').trim()}` : ''].filter(Boolean).join(' · ') || null, missing: missing.length ? missing : null, moved_at: at });
  await logActivity(db, o.appId, o.mover.email, 'stage_change', { from: from?.name ?? '', to: target.name, override: kind === 'override' ? 'yes' : '', note });
  if (statusChanged) await logActivity(db, o.appId, o.mover.email, 'status_change', { from: statusChanged.from ?? '', to: statusChanged.to, via: 'stage' });
  try { await syncOffer(db, o.appId, target, o.mover.email); } catch { /* the Offer & visa tab can be edited by hand */ }
  return { ok: true, from: from?.name ?? null, to: target.name, kind, statusChanged, stage: target, app: { ...app, stage_key: target.key }, missing };
}

/** Puts an application that has no stage yet (or a stage that no longer exists) into a stage, without checking requirements and without changing its status. */
export async function placeApplication(db: Db, o: { appId: string; toKey: string; mover: Mover; note?: string }): Promise<{ ok: true; to: string } | Fail> {
  const c = await loadContext(db, o.appId);
  if ('error' in c) return { ok: false, error: c.error };
  const target = findStage(c.wf, o.toKey);
  if (!target || !target.active) return { ok: false, error: 'That stage does not exist in this school’s workflow.' };
  const from = findStage(c.wf, c.st.stage_key);
  const at = now();
  const flag = target.conditional && c.st.flags[`stage:${target.key}`] !== true ? [{ application_id: o.appId, flag: `stage:${target.key}`, enabled: true, note: 'Switched on when placed', set_by: o.mover.email, set_at: at }] : [];
  if (flag.length) await db.from('portal_app_flags').upsert(flag, { onConflict: 'application_id,flag' });
  const { error } = await db.from('portal_applications').update({ stage_key: target.key, stage_at: at, stage_by: o.mover.email }).eq('application_id', o.appId);
  if (error) return { ok: false, error: error.message };
  await db.from('portal_stage_history').insert({ application_id: o.appId, from_key: from?.key ?? null, from_name: from?.name ?? null, to_key: target.key, to_name: target.name, kind: 'placed', actor: o.mover.email, note: (o.note || '').trim().slice(0, 300) || 'Placed in the school’s workflow', moved_at: at });
  await logActivity(db, o.appId, o.mover.email, 'stage_change', { from: from?.name ?? '', to: target.name, placed: 'yes' });
  return { ok: true, to: target.name };
}

/** A school change takes an application out of the old school's workflow. Keeps the history and asks for a fresh placement. */
export async function resetStage(db: Db, appId: string, actor: string, why: string) {
  const { data: app } = await db.from('portal_applications').select('stage_key').eq('application_id', appId).maybeSingle();
  if (!app?.stage_key) return;
  await db.from('portal_applications').update({ stage_key: null, stage_at: null, stage_by: null }).eq('application_id', appId);
  await db.from('portal_stage_history').insert({ application_id: appId, from_key: app.stage_key, from_name: app.stage_key.replace(/_/g, ' '), to_key: null, to_name: null, kind: 'school_changed', actor, note: why, moved_at: now() });
}

/** The school went back (an undo, or a correction): if the stage it had there is still in that school's workflow, put the application back in it. */
export async function restoreStage(db: Db, appId: string, actor: string) {
  const { data: app } = await db.from('portal_applications').select('stage_key, school, workspace').eq('application_id', appId).maybeSingle();
  if (!app || app.stage_key) return;
  const { data: h } = await db.from('portal_stage_history').select('kind, from_key, from_name').eq('application_id', appId).order('moved_at', { ascending: false }).limit(1);
  const last = h?.[0];
  if (!last || last.kind !== 'school_changed' || !last.from_key) return;
  const wf = await workflowFor(db, app.workspace, app.school);
  const back = wf?.stages.find((s) => s.key === last.from_key && s.active);
  if (!wf || !back) return;
  const at = now();
  await db.from('portal_applications').update({ stage_key: back.key, stage_at: at, stage_by: actor }).eq('application_id', appId);
  await db.from('portal_stage_history').insert({ application_id: appId, from_key: null, from_name: null, to_key: back.key, to_name: back.name, kind: 'reset', actor, note: 'Back at the school it was at: its stage was restored', moved_at: at });
}

// ---- requirements ----
export type CheckInput = { appId: string; ref: string; mover: Mover; state?: CheckState | null; docId?: string | null; value?: string | null; note?: string | null };
export type CheckOk = { ok: true; label: string; becameReady: { stage: Stage; next: Stage | null } | null; app: AppRow };

function findReq(wf: Workflow, st: AppState, ref: string): { req: ReqEval; stage: Stage; extra: boolean; id: string } | null {
  const [kind, id] = [ref.slice(0, 3), ref.slice(4)];
  if (kind !== 'std' && kind !== 'app') return null;
  for (const stage of wf.stages) {
    const hit = stageReqs({ ...wf }, stage, { ...st, flags: { ...st.flags, ...Object.fromEntries(wf.stages.filter((s) => s.conditional).map((s) => [`stage:${s.key}`, true])) } }).find((r) => r.ref === ref);
    if (hit) return { req: hit, stage, extra: kind === 'app', id };
  }
  return null;
}

/**
 * Records where a requirement stands: received, reviewed, approved, rejected, accepted by the school, a recorded outcome, or cleared.
 * Uploading a file does not do this: someone has to review it.
 */
export async function setCheck(db: Db, o: CheckInput): Promise<CheckOk | Fail> {
  const c = await loadContext(db, o.appId);
  if ('error' in c) return { ok: false, error: c.error };
  const { wf, app, st } = c;
  const hit = findReq(wf, st, o.ref);
  if (!hit) return { ok: false, error: 'That requirement is not part of this application’s workflow.' };
  const { req, stage } = hit;
  const before = readiness(wf, st).complete;
  const col = hit.extra ? 'app_req_id' : 'req_id';
  const { data: cur } = await db.from('portal_req_checks').select('id').eq('application_id', o.appId).eq(col, hit.id).maybeSingle();
  const note = (o.note || '').trim().slice(0, 300) || null;
  // clearing
  if (o.state == null && !o.value) {
    if (cur) await db.from('portal_req_checks').delete().eq('id', cur.id);
    await logActivity(db, o.appId, o.mover.email, 'req_checked', { label: req.label, state: 'cleared' });
    return { ok: true, label: req.label, becameReady: null, app };
  }
  let state = o.state as CheckState, value: string | null = null, docId = o.docId ?? null;
  if (req.kind === 'outcome') {
    value = (o.value || '').trim();
    const opt = (req.options || []).find((x) => x.toLowerCase() === value!.toLowerCase());
    if (!opt) return { ok: false, error: `Choose one of: ${(req.options || []).join(', ')}.` };
    value = opt;
    state = (req.passOptions || []).some((p) => p.toLowerCase() === opt.toLowerCase()) ? 'approved' : 'rejected';
    docId = null;
  } else if (req.kind === 'confirmation') {
    if (!['requested', 'approved', 'accepted', 'rejected'].includes(state)) return { ok: false, error: 'A confirmation is either confirmed, accepted by the school, or rejected.' };
    docId = null;
  } else {
    if (!['requested', 'received', 'reviewed', 'approved', 'rejected', 'accepted'].includes(state)) return { ok: false, error: 'Unknown state.' };
    if (docId && !st.docs.some((d) => d.id === docId)) return { ok: false, error: 'That file does not belong to this student.' };
    if (!docId) docId = req.doc?.id ?? null;
    // a review needs something to review: the file, or a note saying the original was seen
    if (['reviewed', 'approved', 'accepted'].includes(state) && !docId && !(note && note.length >= 3)) return { ok: false, error: 'There is no file to review. Upload or link one, or add a note saying how you checked it.' };
    if (state === 'rejected' && !(note && note.length >= 3)) return { ok: false, error: 'Say why it is rejected, so the student knows what to send instead.' };
    // file it under the right kind so every view agrees on what it is
    if (docId && req.docType) {
      const d = st.docs.find((x) => x.id === docId);
      if (d && d.type.toLowerCase() !== req.docType.toLowerCase()) await db.from('portal_documents').update({ type_override: req.docType }).eq('drive_file_id', docId);
    }
  }
  const row = { application_id: o.appId, [col]: hit.id, state, doc_id: docId, value, note, checked_by: o.mover.email, checked_at: now() };
  const { error } = cur ? await db.from('portal_req_checks').update(row).eq('id', cur.id) : await db.from('portal_req_checks').insert(row);
  if (error) return { ok: false, error: error.message };
  await logActivity(db, o.appId, o.mover.email, 'req_checked', { label: req.label, state: value ? `${value}` : state, stage: stage.name });
  // did that finish the stage the application is in?
  let becameReady: CheckOk['becameReady'] = null;
  if (stage.key === st.stage_key && stage.complete_when === 'requirements' && !before) {
    const st2 = await loadAppState(db, o.appId, wf), r2 = readiness(wf, st2);
    if (r2.complete && r2.next) becameReady = { stage, next: r2.next };
  }
  return { ok: true, label: req.label, becameReady, app };
}

/** Switch a conditional stage ("stage:<key>") or a circumstance ("cond:<key>") on or off for one applicant. */
export async function setFlag(db: Db, o: { appId: string; flag: string; enabled: boolean; by: string; note?: string }): Promise<{ ok: true } | Fail> {
  const c = await loadContext(db, o.appId);
  if ('error' in c) return { ok: false, error: c.error };
  const kind = o.flag.startsWith('stage:') ? 'stage' : o.flag.startsWith('cond:') ? 'cond' : null;
  if (!kind) return { ok: false, error: 'Unknown switch.' };
  return setFlagOn(db, c, { ...o, key: o.flag.slice(kind.length + 1), kind });
}
async function setFlagOn(db: Db, c: { app: AppRow; wf: Workflow; st: AppState }, o: { appId: string; flag: string; enabled: boolean; by: string; note?: string; key: string; kind: 'stage' | 'cond' }): Promise<{ ok: true } | Fail> {
  if (o.kind === 'stage') {
    const s = c.wf.stages.find((x) => x.key === o.key);
    if (!s || !s.conditional) return { ok: false, error: 'Only conditional stages can be switched on or off.' };
    if (!o.enabled && c.st.stage_key === s.key) return { ok: false, error: 'The application is in that stage right now. Move it on first.' };
  } else if (!c.wf.conditions.some((x) => x.key === o.key)) return { ok: false, error: 'That circumstance is not defined for this school.' };
  await db.from('portal_app_flags').upsert({ application_id: o.appId, flag: o.flag, enabled: o.enabled, note: (o.note || '').slice(0, 200) || null, set_by: o.by, set_at: now() }, { onConflict: 'application_id,flag' });
  await logActivity(db, o.appId, o.by, 'stage_flag', { flag: o.kind === 'stage' ? (c.wf.stages.find((x) => x.key === o.key)?.name || o.key) : (c.wf.conditions.find((x) => x.key === o.key)?.label || o.key), on: o.enabled ? 'yes' : 'no' });
  return { ok: true };
}

/** A requirement for this applicant only (a school asked for something extra). */
export async function addExtraReq(db: Db, o: { appId: string; stageKey: string; label: string; kind: ExtraReq['kind']; docType?: string | null; need: 'mandatory' | 'optional'; satisfiedAt: ExtraReq['satisfied_at']; by: string }): Promise<{ ok: true } | Fail> {
  const c = await loadContext(db, o.appId);
  if ('error' in c) return { ok: false, error: c.error };
  if (!c.wf.stages.some((s) => s.key === o.stageKey)) return { ok: false, error: 'Choose a stage of this school’s workflow.' };
  const label = o.label.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (label.length < 2) return { ok: false, error: 'Name the requirement.' };
  const docType = o.kind === 'document' ? ((o.docType || label).replace(/\s+/g, ' ').trim().slice(0, 60) || label) : null;
  const options = o.kind === 'outcome' ? ['Passed', 'Failed', 'Rescheduled'] : null;
  const { error } = await db.from('portal_app_reqs').insert({ application_id: o.appId, stage_key: o.stageKey, label, kind: o.kind, doc_type: docType, need: o.need, satisfied_at: o.satisfiedAt, options, pass_options: options ? ['Passed'] : null, created_by: o.by });
  if (error) return { ok: false, error: error.message };
  await logActivity(db, o.appId, o.by, 'req_added', { label, stage: c.wf.stages.find((s) => s.key === o.stageKey)?.name || '' });
  return { ok: true };
}

export async function removeExtraReq(db: Db, o: { appId: string; id: string; by: string }): Promise<{ ok: true } | Fail> {
  const { data: r } = await db.from('portal_app_reqs').select('id, label').eq('id', o.id).eq('application_id', o.appId).maybeSingle();
  if (!r) return { ok: false, error: 'Requirement not found.' };
  await db.from('portal_app_reqs').delete().eq('id', o.id);
  await logActivity(db, o.appId, o.by, 'req_removed', { label: r.label });
  return { ok: true };
}

export { refOf };
