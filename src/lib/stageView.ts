// What the stage screens need for one application, in one object the browser can also run the engine on (so the panel answers instantly;
// the server still checks everything again when something is saved).
import { admin } from './supabase';
import { loadAppState, loadHistory, workflowFor, type StageHistoryRow } from './stages';
import { effType, schoolShort } from './docs';
import type { AppState, Role, Workflow } from './stageEngine';
import type { Staff } from './auth';
import { latestInformable, type InformInfo } from './stageInform';

export type StageApp = { id: string; name: string; school: string; programme: string | null; counselor: string | null; status: string | null; email: string | null; stage_by: string | null };
export type StageView = {
  ok: true; app: StageApp; wf: Workflow; st: AppState; role: Role; history: StageHistoryRow[];
  /** The application's current stage change, if the student can be told about it (and whether they have been). */
  inform: InformInfo | null;
  files: { id: string; name: string; type: string; at: string }[];
  /** Pipeline status values a stage can stand for, for showing what a move will change. */
  stageByName: string | null;
};
export type NoStage = { ok: false; reason: 'no-school' | 'no-workflow'; school: string | null; app: StageApp };

/** Null when the person may not see this application's stage data. Active stages only: switched-off stages are not part of anyone's route. */
export async function stageViewFor(appId: string, staff: Staff): Promise<StageView | NoStage | null> {
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('application_id, name, school, programme, counselor, status, email, workspace, stage_by, student_key').eq('application_id', appId).maybeSingle();
  if (!a) return null;
  const app: StageApp = { id: a.application_id, name: a.name, school: schoolShort(a.school) || a.school || '', programme: a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : null, counselor: a.counselor, status: a.status, email: a.email, stage_by: a.stage_by };
  if (!a.school) return { ok: false, reason: 'no-school', school: null, app };
  const wf = await workflowFor(db, a.workspace, a.school);
  if (!wf) return { ok: false, reason: 'no-workflow', school: a.school, app };
  const [st, history, { data: fam }] = await Promise.all([
    loadAppState(db, appId, wf), loadHistory(db, appId, 40),
    db.from('portal_applications').select('application_id').eq('student_key', a.student_key),
  ]);
  // switched-off stages are not part of anyone's route, except the one this application is sitting in: it has to stay visible so it can be moved on
  const visible: Workflow = { ...wf, stages: wf.stages.filter((s) => s.active || s.key === st.stage_key).map((s) => ({ ...s, reqs: s.reqs.filter((r) => r.active) })) };
  const ids = (fam || []).map((x) => x.application_id as string);
  const { data: docs } = await db.from('portal_documents').select('drive_file_id, name, doc_type, type_override, created_at').in('application_id', ids.length ? ids : [appId]).order('created_at', { ascending: false });
  let stageByName: string | null = null;
  if (a.stage_by) { const { data: p } = await db.from('portal_staff').select('display_name').eq('email', a.stage_by).maybeSingle(); stageByName = p?.display_name || a.stage_by.split('@')[0]; }
  return { ok: true, app, wf: visible, st, role: staff.role, history, inform: await latestInformable(db, appId, st.stage_key), stageByName, files: (docs || []).map((d) => ({ id: d.drive_file_id as string, name: d.name as string, type: effType(d as { doc_type: string; type_override?: string | null }), at: d.created_at as string })) };
}
