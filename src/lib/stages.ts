// Reads the stage workflows and one application's stage state from the database, in the shapes the engine (stageEngine.ts) works on.
import type { SupabaseClient } from '@supabase/supabase-js';
import { effType, schoolKey } from './docs';
import { refOf, type AppState, type Check, type Doc, type ExtraReq, type Stage, type Req, type Workflow, type Role } from './stageEngine';

export type Db = SupabaseClient;

type StageRow = Omit<Stage, 'reqs'> & { workflow_id: string };
type ReqRow = Req & { stage_id: string };

const asRoles = (x: unknown): Role[] => (Array.isArray(x) ? (x.filter((r) => r === 'admin' || r === 'staff' || r === 'counselor') as Role[]) : []);

/** Every workflow of a workspace with its stages and requirements. Inactive stages and requirements are included (the engine skips them). */
export async function loadWorkflows(db: Db, workspace: string, opts: { onlyActive?: boolean } = {}): Promise<Workflow[]> {
  const q = db.from('portal_workflows').select('id, workspace, school_key, school_name, active, override_roles, conditions').eq('workspace', workspace).order('school_name');
  const { data: wfs } = await (opts.onlyActive ? q.eq('active', true) : q);
  if (!wfs?.length) return [];
  const ids = wfs.map((w) => w.id as string);
  const { data: stages } = await db.from('portal_stages').select('id, workflow_id, key, name, position, active, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint, student_note').in('workflow_id', ids).order('position');
  const sids = (stages || []).map((s) => s.id as string);
  const { data: reqs } = sids.length ? await db.from('portal_stage_reqs').select('id, stage_id, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, active, options, pass_options, hint').in('stage_id', sids).order('position') : { data: [] as ReqRow[] };
  const reqsBy = new Map<string, ReqRow[]>();
  (reqs || []).forEach((r) => reqsBy.set(r.stage_id, [...(reqsBy.get(r.stage_id) || []), r as ReqRow]));
  const stagesBy = new Map<string, Stage[]>();
  (stages || []).forEach((s) => {
    const row = s as unknown as StageRow;
    const st: Stage = { ...row, move_roles: asRoles(row.move_roles), reqs: (reqsBy.get(row.id) || []).map((r) => { const { stage_id, ...rest } = r; void stage_id; return rest; }) };
    delete (st as unknown as { workflow_id?: string }).workflow_id;
    stagesBy.set(row.workflow_id, [...(stagesBy.get(row.workflow_id) || []), st]);
  });
  return wfs.map((w) => ({ ...w, override_roles: asRoles(w.override_roles), conditions: Array.isArray(w.conditions) ? w.conditions : [], stages: stagesBy.get(w.id as string) || [] })) as Workflow[];
}

/** The workflow for a school ("Regent College London (RCL)" and "RCL" are the same school), or null when that school has none (or it is switched off). */
export async function workflowFor(db: Db, workspace: string, school: string | null): Promise<Workflow | null> {
  const key = schoolKey(school);
  if (!key) return null;
  return (await loadWorkflows(db, workspace, { onlyActive: true })).find((w) => w.school_key === key) ?? null;
}

type FamilyDoc = { drive_file_id: string; doc_type: string; type_override: string | null; name: string; created_at: string };
export const toDocs = (rows: FamilyDoc[]): Doc[] => rows.map((d) => ({ id: d.drive_file_id, type: effType(d), name: d.name, created_at: d.created_at }));

/** One application's stage state: its stage, its switches, extra requirements, checks and the student's documents. */
export async function loadAppState(db: Db, appId: string, wf: Workflow): Promise<AppState> {
  const { data: app } = await db.from('portal_applications').select('stage_key, stage_at, student_key').eq('application_id', appId).maybeSingle();
  const { data: sib } = app?.student_key ? await db.from('portal_applications').select('application_id').eq('student_key', app.student_key) : { data: [{ application_id: appId }] };
  const family = [...new Set([appId, ...((sib || []).map((s) => s.application_id as string))])];
  const [{ data: flags }, { data: extras }, { data: checks }, { data: docs }] = await Promise.all([
    db.from('portal_app_flags').select('flag, enabled').eq('application_id', appId),
    db.from('portal_app_reqs').select('id, stage_key, label, kind, doc_type, need, satisfied_at, options, pass_options').eq('application_id', appId).order('created_at'),
    db.from('portal_req_checks').select('req_id, app_req_id, state, doc_id, value, note, checked_by, checked_at').eq('application_id', appId),
    db.from('portal_documents').select('drive_file_id, doc_type, type_override, name, created_at').in('application_id', family).order('created_at', { ascending: false }),
  ]);
  return {
    stage_key: wf.stages.some((s) => s.key === app?.stage_key) ? (app!.stage_key as string) : null,
    stage_at: (app?.stage_at as string | null) ?? null,
    flags: Object.fromEntries((flags || []).map((f) => [f.flag as string, !!f.enabled])),
    extras: (extras || []) as ExtraReq[],
    checks: (checks || []).map((c) => ({ ref: refOf({ id: (c.req_id || c.app_req_id) as string }, !!c.app_req_id), state: c.state, doc_id: c.doc_id, value: c.value, note: c.note, by: c.checked_by, at: c.checked_at }) as Check),
    docs: toDocs((docs || []) as FamilyDoc[]),
  };
}

export type StageHistoryRow = { id: string; from_name: string | null; to_name: string | null; kind: string; actor: string; note: string | null; missing: string[] | null; moved_at: string; inform_state: 'sending' | 'sent' | 'failed' | null; informed_at: string | null; informed_by: string | null };
export async function loadHistory(db: Db, appId: string, limit = 50): Promise<StageHistoryRow[]> {
  const { data } = await db.from('portal_stage_history').select('id, from_name, to_name, kind, actor, note, missing, moved_at, inform_state, informed_at, informed_by').eq('application_id', appId).order('moved_at', { ascending: false }).limit(limit);
  return (data || []) as StageHistoryRow[];
}
