// Every application of one workspace with its stage, read in a handful of queries (not one per student), for the tracker page and the task job.
import { admin } from './supabase';
import { effType, schoolKey, schoolShort } from './docs';
import { loadWorkflows, toDocs } from './stages';
import { readiness, refOf, suggestPlacement, type AppState, type Check, type ExtraReq, type Workflow } from './stageEngine';
import { FINAL_STATUSES } from './constants';
import type { TaskDraft } from './overview';

export type BoardCard = {
  id: string; name: string; school: string; programme: string | null; counselor: string | null; status: string | null;
  stageKey: string | null; stageName: string | null; at: string | null; days: number;
  /** Days beyond what the stage allows. */
  delayed: number;
  /** Requirements still blocking a move, and how many of them are documents. */
  open: number; openDocs: number; ready: boolean; labels: string[];
  /** How many requirements the current stage has, and the name of the stage after it. */
  reqCount: number; next: string | null;
  /** For an application with no stage: the stage its pipeline status points at. */
  suggest: { key: string; name: string } | null;
};
export type SchoolBoard = { key: string; name: string; stages: { key: string; name: string; conditional: boolean; delay_days: number | null }[]; cards: BoardCard[] };
export type Board = { schools: SchoolBoard[]; noWorkflow: { school: string; count: number }[]; noSchool: number; workflows: Workflow[] };

async function pages<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await q(from, from + 999);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type AppRow = { application_id: string; name: string; school: string | null; programme: string | null; counselor: string | null; status: string | null; stage_key: string | null; stage_at: string | null; student_key: string };
const DAY = 864e5;

/** `sees` narrows the list to what one person may open (a counselor: their own students). Jobs with nobody signed in leave it out. */
export async function loadStageBoard(workspace: string, sees?: (counselor: string | null) => boolean, now = Date.now()): Promise<Board> {
  const db = admin();
  const [wfs, apps] = await Promise.all([
    loadWorkflows(db, workspace, { onlyActive: true }),
    pages<AppRow>((a, b) => db.from('portal_applications').select('application_id, name, school, programme, counselor, status, stage_key, stage_at, student_key').eq('workspace', workspace).or('email.is.null,email.neq.test@example.com').order('submitted_at', { ascending: false, nullsFirst: false }).order('application_id').range(a, b)),
  ]);
  const visible = apps.filter((a) => !sees || sees(a.counselor));
  const wfBy = new Map(wfs.map((w) => [w.school_key, w]));
  // a switched-off stage still shows while someone is sitting in it, so they can be moved on
  const occupied = new Set(visible.filter((a) => a.stage_key && a.school).map((a) => `${schoolKey(a.school)}|${a.stage_key}`));
  const live = new Map(wfs.map((w) => [w.school_key, { ...w, stages: w.stages.filter((s) => s.active || occupied.has(`${w.school_key}|${s.key}`)).map((s) => ({ ...s, reqs: s.reqs.filter((r) => r.active) })) } as Workflow]));

  // the same student twice at the same school (a repeated form) is one line: the newest
  const seen = new Set<string>();
  const rows = visible.filter((a) => { const k = `${a.student_key}|${schoolKey(a.school)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const withFlow = rows.filter((a) => a.school && wfBy.has(schoolKey(a.school)));
  const ids = new Set(withFlow.map((a) => a.application_id));

  const [flags, extras, checks, docs] = withFlow.length ? await Promise.all([
    pages<{ application_id: string; flag: string; enabled: boolean }>((a, b) => db.from('portal_app_flags').select('application_id, flag, enabled, portal_applications!inner(workspace)').eq('portal_applications.workspace', workspace).order('application_id').order('flag').range(a, b)),
    pages<ExtraReq & { application_id: string }>((a, b) => db.from('portal_app_reqs').select('id, application_id, stage_key, label, kind, doc_type, need, satisfied_at, options, pass_options, portal_applications!inner(workspace)').eq('portal_applications.workspace', workspace).order('id').range(a, b)),
    pages<{ application_id: string; req_id: string | null; app_req_id: string | null; state: Check['state']; doc_id: string | null; value: string | null; note: string | null; checked_by: string; checked_at: string }>((a, b) => db.from('portal_req_checks').select('id, application_id, req_id, app_req_id, state, doc_id, value, note, checked_by, checked_at, portal_applications!inner(workspace)').eq('portal_applications.workspace', workspace).order('id').range(a, b)),
    pages<{ application_id: string; drive_file_id: string; doc_type: string; type_override: string | null; name: string; created_at: string }>((a, b) => db.from('portal_documents').select('application_id, drive_file_id, doc_type, type_override, name, created_at, portal_applications!inner(workspace)').eq('portal_applications.workspace', workspace).order('drive_file_id').range(a, b)),
  ]) : [[], [], [], []] as [never[], never[], never[], never[]];

  const flagsBy = new Map<string, Record<string, boolean>>(), extrasBy = new Map<string, ExtraReq[]>(), checksBy = new Map<string, Check[]>(), docsByKey = new Map<string, typeof docs>();
  flags.forEach((f) => { if (ids.has(f.application_id)) (flagsBy.get(f.application_id) || flagsBy.set(f.application_id, {}).get(f.application_id)!)[f.flag] = !!f.enabled; });
  extras.forEach((e) => { if (ids.has(e.application_id)) (extrasBy.get(e.application_id) || extrasBy.set(e.application_id, []).get(e.application_id)!).push(e); });
  checks.forEach((c) => { if (ids.has(c.application_id)) (checksBy.get(c.application_id) || checksBy.set(c.application_id, []).get(c.application_id)!).push({ ref: refOf({ id: (c.req_id || c.app_req_id) as string }, !!c.app_req_id), state: c.state, doc_id: c.doc_id, value: c.value, note: c.note, by: c.checked_by, at: c.checked_at }); });
  const keyOf = new Map(apps.map((a) => [a.application_id, a.student_key]));
  docs.forEach((d) => { const k = keyOf.get(d.application_id); if (k) (docsByKey.get(k) || docsByKey.set(k, []).get(k)!).push(d); });

  const schools = new Map<string, SchoolBoard>();
  for (const w of live.values()) schools.set(w.school_key, { key: w.school_key, name: w.school_name, stages: w.stages.map((s) => ({ key: s.key, name: s.name, conditional: s.conditional, delay_days: s.delay_days })), cards: [] });
  const missingFlow = new Map<string, number>();
  let noSchool = 0;

  for (const a of rows) {
    if (!a.school) { noSchool++; continue; }
    const sk = schoolKey(a.school), wf = live.get(sk);
    if (!wf) { missingFlow.set(schoolShort(a.school) || a.school, (missingFlow.get(schoolShort(a.school) || a.school) || 0) + 1); continue; }
    const familyDocs = docsByKey.get(a.student_key) || [];
    const st: AppState = {
      stage_key: wf.stages.some((s) => s.key === a.stage_key) ? a.stage_key : null, stage_at: a.stage_at,
      flags: flagsBy.get(a.application_id) || {}, extras: extrasBy.get(a.application_id) || [], checks: checksBy.get(a.application_id) || [],
      docs: toDocs(familyDocs.map((d) => ({ drive_file_id: d.drive_file_id, doc_type: effType(d), type_override: null, name: d.name, created_at: d.created_at }))),
    };
    const rd = readiness(wf, st, now), sug = !rd.current ? suggestPlacement(wf, a.status) : null;
    schools.get(sk)!.cards.push({
      id: a.application_id, name: a.name, school: schoolShort(a.school) || a.school, programme: a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : null, counselor: a.counselor, status: a.status,
      stageKey: rd.current?.key ?? null, stageName: rd.current?.name ?? null, at: a.stage_at, days: a.stage_at && rd.current ? Math.max(0, Math.floor((now - new Date(a.stage_at).getTime()) / DAY)) : 0,
      delayed: rd.delayed, open: rd.blockers.length, openDocs: rd.blockers.filter((r) => r.kind === 'document').length, ready: rd.ready, labels: rd.blockers.slice(0, 3).map((r) => r.label), reqCount: rd.reqs.length, next: rd.next?.name ?? null,
      suggest: sug ? { key: sug.key, name: sug.name } : null,
    });
  }
  return { schools: [...schools.values()], noWorkflow: [...missingFlow].map(([school, count]) => ({ school, count })).sort((x, y) => y.count - x.count), noSchool, workflows: wfs };
}

/** To-do items for the tasks page and the bell: applications stuck past a stage's time limit, held up by documents, or ready to move on. */
export async function stageTaskDrafts(workspace: string): Promise<TaskDraft[]> {
  const board = await loadStageBoard(workspace);
  const out: TaskDraft[] = [];
  for (const school of board.schools) for (const c of school.cards) {
    if (!c.stageKey || (c.status && FINAL_STATUSES.includes(c.status))) continue;
    const add = (kind: string, title: string, detail: string, priority: number) => out.push({ key: `${kind}:${c.id}`, kind, application_id: c.id, title, detail, priority });
    const where = `${school.name.match(/\(([^)]+)\)/)?.[1] || school.name} · ${c.stageName}`;
    if (c.delayed > 0) add('stage_late', `${c.name} is overdue in “${c.stageName}”`, `${c.days} days here, ${c.days - c.delayed} allowed${c.labels.length ? ` · open: ${c.labels.join(', ')}` : ''}`, c.delayed >= 14 ? 1 : 2);
    else if (c.openDocs > 0 && c.days >= 3) add('stage_docs', `Chase ${c.openDocs} document${c.openDocs === 1 ? '' : 's'} for ${c.name}`, `${where} · ${c.labels.join(', ')}`, 2);
    if (c.ready && c.reqCount > 0 && c.next) add('stage_ready', `${c.name} is ready for “${c.next}”`, `${where} · everything this stage needs is in order`, 3);
  }
  return out;
}
