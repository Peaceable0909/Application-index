// What a Team Head (or an admin) sees: every application inside what they oversee, who owns it, what is waiting for a decision and how
// each counselor is doing. Read in a few batched queries. Nothing here changes data.
import type { Staff } from './auth';
import { admin } from './supabase';
import { counselorKey } from './docs';
import { FINAL_STATUSES, STALE_DAYS } from './constants';
import { loadStageBoard } from './stageBoard';
import { loadCounselors, loadRules } from './assignCore';
import { inScope, isPlaceholderCounselor, needsReview, type Candidate, type Review, type Scope } from './assignEngine';
import { mayOpen } from './workspaceCore';

const DAY = 864e5;
export const FRESH_DAYS = 7;

export type HeadApp = {
  id: string; name: string; school: string | null; programme: string | null; city: string | null; workspace: string;
  counselor: string | null; counselorKey: string | null; docHandler: string | null;
  state: 'assigned' | 'queue' | 'conflict' | null; reason: string | null; assignedAt: string | null; assignedBy: string | null;
  status: string | null; submittedAt: string | null; lastActivity: string | null; daysQuiet: number;
  stageName: string | null; stageDelayed: number; openDocs: number; ready: boolean;
  openTasks: number;
  fresh: boolean; awaiting: boolean; stale: boolean; final: boolean;
  review: Review; expected: string | null; candidates: Candidate[];
};
export type Workload = { key: string; name: string; active: boolean; apps: number; fresh: number; stale: number; openDocs: number; tasks: number; docsFor: number };
export type LogEntry = { id: string; at: string; applicationId: string; student: string; kind: string; from: string | null; to: string | null; reason: string | null; actor: string };
export type HeadBoard = {
  apps: HeadApp[]; queue: HeadApp[]; conflicts: HeadApp[]; review: HeadApp[]; fresh: HeadApp[]; stale: HeadApp[];
  workload: Workload[]; recent: LogEntry[];
  counts: { total: number; active: number; queue: number; conflicts: number; review: number; fresh: number; stale: number; openDocs: number };
};

/** What this person may oversee: `scopes: null` means every application in their workspaces (admins). Null result: not a Team Head. */
export type HeadView = { scopes: Scope[] | null; workspaces: string[] };
export async function headViewFor(staff: Staff, allWorkspaces: string[]): Promise<HeadView | null> {
  if (staff.role === 'admin') return { scopes: null, workspaces: allWorkspaces };
  if (!staff.team_head) return null;
  const { data } = await admin().from('portal_head_scopes').select('workspace, scope, school_key, location_key').eq('email', staff.email.toLowerCase());
  const scopes = ((data || []) as Scope[]).filter((s) => allWorkspaces.includes(s.workspace) && mayOpen(staff, s.workspace));
  return scopes.length ? { scopes, workspaces: [...new Set(scopes.map((s) => s.workspace))] } : null;
}

async function pages<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) { const { data } = await q(from, from + 999); out.push(...(data || [])); if (!data || data.length < 1000) break; }
  return out;
}

type Row = { application_id: string; name: string; school: string | null; programme: string | null; city: string | null; workspace: string; counselor: string | null; doc_handler: string | null; assign_state: string | null; assign_reason: string | null; assigned_at: string | null; assigned_by: string | null; status: string | null; submitted_at: string | null; last_activity_at: string | null };
const COLS = 'application_id, name, school, programme, city, workspace, counselor, doc_handler, assign_state, assign_reason, assigned_at, assigned_by, status, submitted_at, last_activity_at';

export async function loadHeadBoard(view: HeadView, now = Date.now()): Promise<HeadBoard> {
  const db = admin();
  const [rules, counselors] = await Promise.all([loadRules(db), loadCounselors(db)]);

  const rows: Row[] = [];
  for (const ws of view.workspaces) {
    const got = await pages<Row>((a, b) => db.from('portal_applications').select(COLS).eq('workspace', ws).or('email.is.null,email.neq.test@example.com').order('application_id').range(a, b));
    rows.push(...got.filter((r) => !view.scopes || inScope(view.scopes, { workspace: r.workspace, school: r.school, city: r.city })));
  }
  const ids = new Set(rows.map((r) => r.application_id));

  const [stageCards, tasks, openConflicts, log] = await Promise.all([
    Promise.all(view.workspaces.map((ws) => loadStageBoard(ws).catch(() => null))),
    pages<{ application_id: string }>((a, b) => db.from('portal_tasks').select('application_id, portal_applications!inner(workspace)').in('portal_applications.workspace', view.workspaces).eq('status', 'open').order('id').range(a, b)),
    db.from('portal_assign_conflicts').select('application_id, candidates').eq('status', 'open').then((r) => r.data || []),
    db.from('portal_assign_log').select('id, at, application_id, kind, from_counselor, to_counselor, reason, actor, portal_applications!inner(name, workspace, school, city)').in('portal_applications.workspace', view.workspaces).order('at', { ascending: false }).limit(200).then((r) => r.data || []),
  ]);
  const card = new Map(stageCards.flatMap((b) => (b ? b.schools.flatMap((s) => s.cards) : [])).map((c) => [c.id, c]));
  const taskBy = new Map<string, number>();
  tasks.forEach((t) => taskBy.set(t.application_id, (taskBy.get(t.application_id) || 0) + 1));
  const candBy = new Map(openConflicts.map((c) => [c.application_id as string, c.candidates as Candidate[]]));

  const apps: HeadApp[] = rows.map((r) => {
    const final = !!r.status && FINAL_STATUSES.includes(r.status);
    const owned = !isPlaceholderCounselor(r.counselor);
    const c = card.get(r.application_id);
    const submitted = r.submitted_at ? Date.parse(r.submitted_at) : null;
    const last = r.last_activity_at ? Date.parse(r.last_activity_at) : submitted;
    const daysQuiet = last ? Math.max(0, Math.floor((now - last) / DAY)) : 0;
    const fresh = submitted !== null && now - submitted < FRESH_DAYS * DAY;
    const rv = owned && !final ? needsReview(rules, { workspace: r.workspace, school: r.school, city: r.city, counselor: r.counselor }, counselors, now) : { review: null as Review, expected: undefined };
    return {
      id: r.application_id, name: r.name, school: r.school, programme: r.programme, city: r.city, workspace: r.workspace,
      counselor: owned ? r.counselor : null, counselorKey: owned ? counselorKey(r.counselor) : null, docHandler: r.doc_handler,
      state: (r.assign_state as HeadApp['state']) ?? null, reason: r.assign_reason, assignedAt: r.assigned_at, assignedBy: r.assigned_by,
      status: r.status, submittedAt: r.submitted_at, lastActivity: r.last_activity_at, daysQuiet,
      stageName: c?.stageName ?? null, stageDelayed: c?.delayed ?? 0, openDocs: c?.openDocs ?? 0, ready: !!c?.ready,
      openTasks: taskBy.get(r.application_id) || 0,
      fresh, awaiting: fresh && (!r.status || r.status === 'New Lead') && !final, stale: !final && daysQuiet >= STALE_DAYS, final,
      review: rv.review, expected: rv.expected ?? null, candidates: candBy.get(r.application_id) || [],
    };
  }).sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

  const live = apps.filter((a) => !a.final);
  const queue = live.filter((a) => !a.counselor && a.state !== 'conflict');
  const conflicts = live.filter((a) => !a.counselor && a.state === 'conflict');
  const review = live.filter((a) => !!a.counselor && (a.review === 'wrong-counselor' || a.review === 'counselor-unavailable'));
  const fresh = live.filter((a) => a.fresh);
  const stale = live.filter((a) => a.stale && !!a.counselor);

  // one line per counselor: how much they carry, and how much of it is waiting
  const load = new Map<string, Workload>();
  const line = (key: string) => { let w = load.get(key); if (!w) { const c = counselors.get(key); w = { key, name: c?.name || key, active: c?.active !== false, apps: 0, fresh: 0, stale: 0, openDocs: 0, tasks: 0, docsFor: 0 }; load.set(key, w); } return w; };
  for (const a of live) {
    if (a.counselorKey) { const w = line(a.counselorKey); w.apps++; if (a.fresh) w.fresh++; if (a.stale) w.stale++; w.openDocs += a.openDocs; w.tasks += a.openTasks; }
    if (a.docHandler) line(a.docHandler).docsFor++;
  }
  for (const r of rules) if (view.workspaces.includes(r.workspace) && r.active && counselors.has(r.counselor_key)) line(r.counselor_key);   // someone with a responsibility but nothing yet still shows

  const recent: LogEntry[] = (log as unknown as { id: string; at: string; application_id: string; kind: string; from_counselor: string | null; to_counselor: string | null; reason: string | null; actor: string; portal_applications: { name: string; workspace: string; school: string | null; city: string | null } }[])
    .filter((l) => ids.has(l.application_id))
    .slice(0, 25)
    .map((l) => ({ id: l.id, at: l.at, applicationId: l.application_id, student: l.portal_applications.name, kind: l.kind, from: l.from_counselor, to: l.to_counselor, reason: l.reason, actor: l.actor }));

  return {
    apps, queue, conflicts, review, fresh, stale, recent,
    workload: [...load.values()].sort((a, b) => b.apps - a.apps || a.name.localeCompare(b.name)),
    counts: { total: apps.length, active: live.length, queue: queue.length, conflicts: conflicts.length, review: review.length, fresh: fresh.length, stale: stale.length, openDocs: live.reduce((n, a) => n + a.openDocs, 0) },
  };
}

/** How many applications are waiting for a decision in one destination, for the badge next to "Team Head". Only counted for admins and Team Heads. */
export async function waitingCount(staff: Staff, workspace: string): Promise<number> {
  if (staff.role !== 'admin' && !staff.team_head) return 0;
  const { data } = await admin().from('portal_applications').select('workspace, school, city, status').eq('workspace', workspace).in('assign_state', ['queue', 'conflict']).limit(500);
  const rows = (data || []).filter((r) => !(r.status && FINAL_STATUSES.includes(r.status as string)));
  if (staff.role === 'admin') return rows.length;
  const { data: sc } = await admin().from('portal_head_scopes').select('workspace, scope, school_key, location_key').eq('email', staff.email.toLowerCase());
  const scopes = (sc || []) as Scope[];
  return rows.filter((r) => inScope(scopes, { workspace: r.workspace as string, school: r.school as string | null, city: r.city as string | null })).length;
}
