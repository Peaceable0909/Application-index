'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { admin } from '@/lib/supabase';
import { canAccessApp, requireStaff, requireTeam, type Staff } from '@/lib/auth';
import { writeBack } from '@/lib/sheetWrite';
import { currentWorkspace } from '@/lib/workspace';
import * as Core from '@/lib/stageCore';
import { readiness, suggestPlacement, type CheckState } from '@/lib/stageEngine';
import { loadWorkflows } from '@/lib/stages';
import { notifyEntered, notifyReady } from '@/lib/stageNotify';
import { uploadToStudentFolder } from '@/lib/driveUpload';
import { schoolKey } from '@/lib/docs';
import { nudgeLater } from '@/lib/realtime';
import { draftInform, previewInform, sendInform } from '@/lib/stageInform';

type Fail = { ok: false; error: string; check?: Core.MoveSummary };
const mover = (s: Staff): Core.Mover => ({ email: s.email, role: s.role });
const refresh = (id: string) => { revalidatePath(`/applications/${id}`); revalidatePath('/stages'); revalidatePath('/'); revalidatePath('/pipeline'); revalidatePath('/applications'); revalidatePath('/my'); revalidatePath('/student'); revalidatePath('/student/documents'); };
/** The student's open dashboard looks again at once. This is not an email and carries no content: it only says "something changed". */
async function pingStudent(appId: string) {
  const { data } = await admin().from('portal_applications').select('email').eq('application_id', appId).maybeSingle();
  if (data?.email) nudgeLater([{ role: 'student', email: data.email.toLowerCase() }], 'stage', { app: appId });
}

/** Signed in, and allowed to work on this student (a counselor only on their own, nobody outside a workspace they may open). */
async function gate(appId: string): Promise<{ staff: Staff } | Fail> {
  const staff = await requireStaff();
  if (!(await canAccessApp(staff, appId))) return { ok: false, error: staff.role === 'counselor' ? 'That student is not assigned to you.' : 'You do not have access to that student’s workspace.' };
  return { staff };
}

export type MoveResult = { ok: true; from: string | null; to: string; override: boolean; status: string | null; sheet: 'updated' | 'failed' | 'unchanged'; sheetError?: string; historyId: string | null } | Fail;

/** Moves one application to another stage. Requirements on the way are checked on the server, whatever the screen showed. */
export async function moveStage(appId: string, toKey: string, opts: { note?: string; override?: string; enable?: string[] } = {}): Promise<MoveResult> {
  const g = await gate(appId);
  if ('ok' in g) return g;
  const db = admin();
  const r = await Core.moveApplication(db, { appId, toKey, mover: mover(g.staff), note: opts.note, override: opts.override, enable: opts.enable });
  if (!r.ok) return r;
  // The master sheet shows the pipeline status; keep it in step when this stage stands for a different one.
  let sheet: 'updated' | 'failed' | 'unchanged' = 'unchanged', sheetError: string | undefined;
  if (r.statusChanged) {
    try { await writeBack(appId, { status: r.statusChanged.to }); sheet = 'updated'; }
    catch (e) { sheet = 'failed'; sheetError = (e as Error).message.slice(0, 160); }
  }
  after(async () => {
    const c = await Core.loadContext(admin(), appId);
    if ('error' in c) return;
    await notifyEntered({ app: { application_id: appId, name: c.app.name, workspace: c.app.workspace, school: c.app.school }, stage: r.stage, from: r.from, by: g.staff.email, open: readiness(c.wf, c.st).reqs, override: r.kind === 'override' });
  });
  refresh(appId);
  await pingStudent(appId);
  return { ok: true, from: r.from, to: r.to, override: r.kind === 'override', status: r.statusChanged?.to ?? null, sheet, sheetError, historyId: r.historyId };
}

/** Puts an application into a stage without any checks or status change: for applications that were already under way before stages existed. */
export async function placeStage(appId: string, toKey: string, note?: string): Promise<{ ok: true; to: string; historyId: string | null } | Fail> {
  const g = await gate(appId);
  if ('ok' in g) return g;
  const r = await Core.placeApplication(admin(), { appId, toKey, mover: mover(g.staff), note });
  if (r.ok) { refresh(appId); await pingStudent(appId); }
  return r;
}

export type RequirementInput = { state?: CheckState | null; value?: string | null; note?: string | null; docId?: string | null };
/** Marks a requirement received, reviewed, approved, rejected or accepted by the school; records an outcome; or clears it. */
export async function setRequirement(appId: string, ref: string, input: RequirementInput): Promise<{ ok: true; label: string; ready: boolean } | Fail> {
  const g = await gate(appId);
  if ('ok' in g) return g;
  const r = await Core.setCheck(admin(), { appId, ref, mover: mover(g.staff), ...input });
  if (!r.ok) return r;
  if (r.becameReady) {
    const { becameReady } = r;
    after(() => notifyReady({ app: { application_id: appId, name: r.app.name, workspace: r.app.workspace, school: r.app.school }, stage: becameReady.stage, next: becameReady.next!, by: g.staff.email }));
  }
  refresh(appId);
  return { ok: true, label: r.label, ready: !!r.becameReady };
}

/** Uploads a file for a requirement. The file is stored under the requirement's kind of document, and still has to be reviewed. */
export async function uploadForRequirement(f: FormData): Promise<{ ok: true; name: string } | Fail> {
  const appId = String(f.get('appId') || ''), kind = String(f.get('kind') || '').trim().slice(0, 60), file = f.get('file');
  const g = await gate(appId);
  if ('ok' in g) return g;
  if (!kind) return { ok: false, error: 'Say what kind of document this is.' };
  if (!(file instanceof File)) return { ok: false, error: 'Choose a file first.' };
  const c = await Core.loadContext(admin(), appId);
  if ('error' in c) return { ok: false, error: c.error };
  const r = await uploadToStudentFolder({ appId, file, kind, by: g.staff.email, source: 'portal' });
  if (!r.ok) return r;
  refresh(appId);
  return { ok: true, name: r.name };
}

export async function switchFlag(appId: string, flag: string, enabled: boolean, note?: string): Promise<{ ok: true } | Fail> {
  const g = await gate(appId);
  if ('ok' in g) return g;
  const r = await Core.setFlag(admin(), { appId, flag, enabled, by: g.staff.email, note });
  if (r.ok) refresh(appId);
  return r;
}

export async function addApplicantRequirement(appId: string, input: { stageKey: string; label: string; kind: 'document' | 'confirmation' | 'outcome'; docType?: string; need: 'mandatory' | 'optional'; satisfiedAt: 'uploaded' | 'approved' | 'accepted' }): Promise<{ ok: true } | Fail> {
  const g = await gate(appId);
  if ('ok' in g) return g;
  const r = await Core.addExtraReq(admin(), { appId, ...input, by: g.staff.email });
  if (r.ok) refresh(appId);
  return r;
}

export async function removeApplicantRequirement(appId: string, id: string): Promise<{ ok: true } | Fail> {
  const g = await gate(appId);
  if ('ok' in g) return g;
  const r = await Core.removeExtraReq(admin(), { appId, id, by: g.staff.email });
  if (r.ok) refresh(appId);
  return r;
}

/** Admin: places every application of the current workspace that has no stage yet and whose pipeline status clearly names one. Applications before the school's first stage are left. */
export async function placeByStatus(): Promise<{ ok: true; placed: number; left: number } | Fail> {
  const staff = await requireTeam();
  if (staff.role !== 'admin') return { ok: false, error: 'Only an admin can place applications in bulk.' };
  const db = admin(), ws = await currentWorkspace();
  const [wfs, { data: apps }] = await Promise.all([loadWorkflows(db, ws, { onlyActive: true }), db.from('portal_applications').select('application_id, school, status').eq('workspace', ws).is('stage_key', null).not('status', 'is', null)]);
  const byKey = new Map(wfs.map((w) => [w.school_key, w]));
  let placed = 0, left = 0;
  for (const a of apps || []) {
    const wf = byKey.get(schoolKey(a.school));
    const hit = wf ? suggestPlacement(wf, a.status) : null;
    if (!wf || !hit) { left++; continue; }
    if (placed >= 60) { left++; continue; }
    const r = await Core.placeApplication(db, { appId: a.application_id, toKey: hit.key, mover: mover(staff), note: `Placed from the pipeline status “${a.status}”` });
    if (r.ok) placed++; else left++;
  }
  revalidatePath('/stages');
  return { ok: true, placed, left };
}

// ---- telling the student (a separate action from moving the stage) ----

/** The email as it would be sent: always to the address on the student's application. Nothing is sent here. */
export async function draftStageEmail(appId: string, historyId: string) {
  const g = await gate(appId);
  if ('ok' in g) return g;
  return draftInform(admin(), appId, historyId);
}

/** The designed email for the text as typed so far, signed by the person sending it. Nothing is sent here. */
export async function previewStageEmail(appId: string, historyId: string, subject: string, body: string) {
  const g = await gate(appId);
  if ('ok' in g) return g;
  return previewInform(admin(), appId, historyId, g.staff.email, subject, body);
}

/** Sends the email the counselor chose to send. The stage itself is never touched by this. */
export async function informStudent(appId: string, historyId: string, input: { subject: string; body: string }) {
  const g = await gate(appId);
  if ('ok' in g) return g;
  const r = await sendInform(admin(), { appId, historyId, by: g.staff.email, subject: input.subject, body: input.body });
  refresh(appId);
  return r;
}
