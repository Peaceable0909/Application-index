// Routing and reassignment, against the database. The rules themselves are in assignEngine.ts (pure).
//
// Three things change who owns an application, and each one is written to the assignment history (portal_assign_log) with who, when and why:
//   - automatic routing: only for an application that has no owner yet. An owner that came with the application (the sheet, the student's choice,
//     a person) is never overwritten;
//   - a person reassigning (one application, a whole selection, or choosing between conflicting counselors);
//   - the master sheet naming a different counselor (recorded, not fought).
import type { SupabaseClient } from '@supabase/supabase-js';
import { counselorKey, schoolKey } from './docs';
import { FINAL_STATUSES } from './constants';
import { inScope, isPlaceholderCounselor, normLocation, resolveAssignment, type AppFacts, type Candidate, type CounselorInfo, type Decision, type Rule, type Scope } from './assignEngine';

export type Db = SupabaseClient;
type Fail = { ok: false; error: string };
export type CounselorRow = CounselorInfo & { email: string | null };

// ---------- reading ----------
export async function loadRules(db: Db, workspace?: string): Promise<Rule[]> {
  const q = db.from('portal_assign_rules').select('id, workspace, kind, scope, school_key, school_name, location_key, location_name, counselor_key, role, active, paused_until, note').order('created_at');
  const { data } = await (workspace ? q.eq('workspace', workspace) : q);
  return (data || []) as Rule[];
}

export async function loadCounselors(db: Db): Promise<Map<string, CounselorRow>> {
  const { data } = await db.from('portal_counselors').select('name_key, name, email, active');
  // the form's "I don't have a counselor yet" is stored as a counselor too; it is a placeholder, never a person who can own an application
  return new Map((data || []).filter((c) => !isPlaceholderCounselor(c.name as string)).map((c) => [c.name_key as string, { name: c.name as string, active: c.active !== false, email: (c.email as string | null) ?? null }]));
}

export async function loadHeadScopes(db: Db, email: string): Promise<Scope[]> {
  const { data } = await db.from('portal_head_scopes').select('workspace, scope, school_key, location_key').eq('email', email.toLowerCase());
  return (data || []) as Scope[];
}

type AppRow = { application_id: string; name: string; school: string | null; programme: string | null; city: string | null; counselor: string | null; workspace: string; assign_state: string | null; assign_reason: string | null; routed_at: string | null; doc_handler: string | null };
const COLS = 'application_id, name, school, programme, city, counselor, workspace, assign_state, assign_reason, routed_at, doc_handler, assigned_at, assigned_by';
const now = () => new Date().toISOString();
const facts = (a: AppRow): AppFacts => ({ workspace: a.workspace, school: a.school, city: a.city });

async function logRow(db: Db, row: { application_id: string; kind: string; from_counselor?: string | null; to_counselor?: string | null; reason?: string | null; level?: string | null; rule_id?: string | null; actor: string; detail?: object | null }) {
  await db.from('portal_assign_log').insert({ from_counselor: null, to_counselor: null, reason: null, level: null, rule_id: null, detail: null, ...row });
}

async function closeConflicts(db: Db, appId: string, by: string, chosen: string | null, note?: string | null) {
  await db.from('portal_assign_conflicts').update({ status: 'resolved', resolved_by: by, resolved_at: now(), chosen, note: note || null }).eq('application_id', appId).eq('status', 'open');
}

// ---------- automatic routing ----------
export type Routed = { id: string; name: string; school: string | null; programme: string | null; workspace: string; city: string | null; counselorKey: string; counselorName: string; reason: string; docHandler?: string | null };
export type RouteResult = {
  assigned: Routed[]; kept: number; unchanged: number;
  queued: { id: string; name: string; workspace: string; school: string | null; city: string | null; reason: string }[];
  conflicts: { id: string; name: string; workspace: string; school: string | null; city: string | null; reason: string }[];
  docHandlers: { id: string; name: string; counselorKey: string; counselorName: string }[];
  skippedOff: number;
};
const empty = (): RouteResult => ({ assigned: [], kept: 0, unchanged: 0, queued: [], conflicts: [], docHandlers: [], skippedOff: 0 });

/**
 * Looks at these applications and gives each one that has no owner to whoever the rules say. Safe to call again and again:
 *  - mode "new": an application is looked at once (routed_at is set), so updating it later never routes it again, and a destination whose
 *    automatic routing is switched off is left alone;
 *  - mode "queue": an admin or Team Head runs the current rules over the applications still waiting; ones still unresolved are not logged twice.
 */
export async function routeApplications(db: Db, o: { ids: string[]; actor: string; mode: 'new' | 'queue' }): Promise<RouteResult> {
  const out = empty();
  const ids = [...new Set(o.ids)];
  if (!ids.length) return out;
  const apps: AppRow[] = [];
  for (let i = 0; i < ids.length; i += 100) { const { data } = await db.from('portal_applications').select(COLS).in('application_id', ids.slice(i, i + 100)); apps.push(...((data || []) as AppRow[])); }
  const [rules, counselors, { data: wss }] = await Promise.all([loadRules(db), loadCounselors(db), db.from('portal_workspaces').select('key, auto_route')]);
  const auto = new Map((wss || []).map((w) => [w.key as string, w.auto_route !== false]));

  for (const a of apps) {
    if (o.mode === 'new' && (a.routed_at || auto.get(a.workspace) === false)) { if (!a.routed_at) out.skippedOff++; else out.unchanged++; continue; }
    const at = now();

    // who receives and processes its documents (a separate responsibility; never a conflict flag, an admin sees it on the rules page)
    const dd = resolveAssignment(rules, facts(a), counselors, { kind: 'documents' });
    const docKey = dd.kind === 'assigned' ? dd.counselor_key : null;
    if (docKey !== (a.doc_handler || null)) {
      await db.from('portal_applications').update({ doc_handler: docKey }).eq('application_id', a.application_id);
      if (docKey && dd.kind === 'assigned') { await logRow(db, { application_id: a.application_id, kind: 'documents', to_counselor: dd.name, reason: dd.reason, level: dd.level, rule_id: dd.rule_id, actor: o.actor }); out.docHandlers.push({ id: a.application_id, name: a.name, counselorKey: docKey, counselorName: dd.name }); }
    }

    // an owner that is already there is kept, whoever put it there
    if (!isPlaceholderCounselor(a.counselor)) {
      out.kept++;
      const patch: Record<string, unknown> = { routed_at: a.routed_at || at };
      if (a.assign_state !== 'assigned') patch.assign_state = 'assigned';
      if (!a.routed_at || a.assign_state !== 'assigned') {
        await db.from('portal_applications').update(patch).eq('application_id', a.application_id);
        if (!a.routed_at && !a.assign_state) {
          const byPerson = o.actor !== 'system';
          await logRow(db, { application_id: a.application_id, kind: byPerson ? 'manual' : 'sheet', to_counselor: a.counselor, reason: byPerson ? `${o.actor} chose ${a.counselor} as the counselor, so the rules were not applied` : `Arrived with ${a.counselor} as the counselor, so the rules were not applied`, actor: o.actor });
        }
        if (a.assign_state === 'conflict' || a.assign_state === 'queue') await closeConflicts(db, a.application_id, o.actor, a.counselor, 'An owner was set another way');
      }
      continue;
    }

    const d: Decision = resolveAssignment(rules, facts(a), counselors, { kind: 'application' });
    if (d.kind === 'assigned') {
      const name = counselors.get(d.counselor_key)?.name || d.name;
      const reason = `${d.reason}`;
      await db.from('portal_applications').update({ counselor: name, assign_state: 'assigned', assign_reason: reason, assigned_at: at, assigned_by: o.actor, routed_at: at }).eq('application_id', a.application_id);
      await logRow(db, { application_id: a.application_id, kind: 'auto', from_counselor: a.counselor, to_counselor: name, reason, level: d.level, rule_id: d.rule_id, actor: o.actor });
      if (a.assign_state === 'conflict') await closeConflicts(db, a.application_id, o.actor, name, 'The rules were changed and now give one answer');
      out.assigned.push({ id: a.application_id, name: a.name, school: a.school, programme: a.programme, workspace: a.workspace, city: a.city, counselorKey: d.counselor_key, counselorName: name, reason, docHandler: docKey });
    } else if (d.kind === 'conflict') {
      const same = a.assign_state === 'conflict' && a.assign_reason === d.reason;
      await db.from('portal_applications').update({ assign_state: 'conflict', assign_reason: d.reason, routed_at: a.routed_at || at }).eq('application_id', a.application_id);
      if (same) { out.unchanged++; continue; }
      await db.from('portal_assign_conflicts').update({ status: 'resolved', resolved_by: 'system', resolved_at: at, note: 'Replaced by a newer check' }).eq('application_id', a.application_id).eq('status', 'open');
      await db.from('portal_assign_conflicts').insert({ application_id: a.application_id, level: d.level, candidates: d.candidates, status: 'open', created_at: at });
      await logRow(db, { application_id: a.application_id, kind: 'conflict', reason: d.reason, level: d.level, actor: o.actor, detail: { candidates: d.candidates } });
      out.conflicts.push({ id: a.application_id, name: a.name, workspace: a.workspace, school: a.school, city: a.city, reason: d.reason });
    } else {
      const same = a.assign_state === 'queue' && a.assign_reason === d.reason;
      await db.from('portal_applications').update({ assign_state: 'queue', assign_reason: d.reason, routed_at: a.routed_at || at }).eq('application_id', a.application_id);
      if (same) { out.unchanged++; continue; }
      await logRow(db, { application_id: a.application_id, kind: 'queue', reason: d.reason, actor: o.actor });
      out.queued.push({ id: a.application_id, name: a.name, workspace: a.workspace, school: a.school, city: a.city, reason: d.reason });
    }
  }
  return out;
}

/** The ids of applications that still have no owner and are not being waited on elsewhere: the queue an admin or Team Head works through. */
export async function waitingIds(db: Db, workspace?: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const q = db.from('portal_applications').select('application_id, counselor').order('application_id').range(from, from + 999);
    const { data } = await (workspace ? q.eq('workspace', workspace) : q);
    (data || []).forEach((r) => { if (isPlaceholderCounselor(r.counselor as string | null)) out.push(r.application_id as string); });
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** The moment automatic routing started. Applications older than this were never routed and are left as they are; newer ones that slipped through (a routing hiccup) are retried. */
export async function routingSince(db: Db): Promise<string> {
  const { data } = await db.from('portal_settings').select('value').eq('key', 'routing_since').maybeSingle();
  const at = (data?.value as { at?: string } | null)?.at;
  if (at) return at;
  const first = now();
  await db.from('portal_settings').upsert({ key: 'routing_since', value: { at: first } }, { onConflict: 'key', ignoreDuplicates: true });
  return first;
}

// ---------- changing an owner by hand ----------
export type Actor = { email: string; role: 'admin' | 'staff' | 'counselor' };
export type Reassigned = { ok: true; changed: boolean; from: string | null; to: string | null; toKey: string | null; overrode: string | null; student: { id: string; name: string; school: string | null; programme: string | null } } | Fail;

/**
 * Gives one application to a counselor (or takes the owner away, to put it back in the queue). Nothing happens when it already belongs to them:
 * no history row, no notification. A choice that differs from what the rules say is allowed and recorded as an override with who made it.
 */
export async function reassign(db: Db, o: { appId: string; toKey: string | null; actor: string; kind?: 'manual' | 'bulk'; reason?: string | null }): Promise<Reassigned> {
  const { data: a } = await db.from('portal_applications').select(COLS).eq('application_id', o.appId).maybeSingle();
  if (!a) return { ok: false, error: 'Application not found.' };
  const app = a as AppRow;
  const counselors = await loadCounselors(db);
  const to = o.toKey ? counselors.get(o.toKey) : null;
  if (o.toKey && !to) return { ok: false, error: 'That counselor is not in the portal.' };
  if (o.toKey && to && !to.active) return { ok: false, error: `${to.name} is switched off as a counselor.` };
  const fromName = isPlaceholderCounselor(app.counselor) ? null : app.counselor;
  const student = { id: app.application_id, name: app.name, school: app.school, programme: app.programme };
  const { data: open } = await db.from('portal_assign_conflicts').select('id').eq('application_id', o.appId).eq('status', 'open');
  const hadConflict = !!open?.length;
  if (o.toKey && fromName && counselorKey(fromName) === o.toKey && !hadConflict) {
    // already theirs: nothing to record or announce (an older application with no state just gets its state filled in)
    if (app.assign_state !== 'assigned') await db.from('portal_applications').update({ assign_state: 'assigned', routed_at: app.routed_at || now() }).eq('application_id', o.appId);
    return { ok: true, changed: false, from: fromName, to: fromName, toKey: o.toKey, overrode: null, student };
  }

  let overrode: string | null = null;
  if (o.toKey) {
    const rules = await loadRules(db, app.workspace);
    const d = resolveAssignment(rules, facts(app), counselors, { kind: 'application' });
    if (d.kind === 'assigned' && d.counselor_key !== o.toKey) overrode = `${d.name} (${d.level} rule)`;
  }
  const at = now(), note = (o.reason || '').trim().slice(0, 300) || null;
  const reason = o.toKey ? `Assigned to ${to!.name} by ${o.actor}${note ? `: ${note}` : ''}${overrode ? `. The rules pointed to ${overrode}` : ''}` : `Taken off ${fromName || 'its owner'} by ${o.actor}${note ? `: ${note}` : ''}`;
  await db.from('portal_applications').update({ counselor: to?.name ?? null, assign_state: o.toKey ? 'assigned' : 'queue', assign_reason: reason, assigned_at: at, assigned_by: o.actor, routed_at: app.routed_at || at }).eq('application_id', o.appId);
  if (hadConflict) await closeConflicts(db, o.appId, o.actor, to?.name ?? null, note);
  await logRow(db, { application_id: o.appId, kind: hadConflict ? 'resolved' : o.kind || 'manual', from_counselor: fromName, to_counselor: to?.name ?? null, reason, actor: o.actor, detail: overrode ? { overrode } : null });
  return { ok: true, changed: true, from: fromName, to: to?.name ?? null, toKey: o.toKey, overrode, student };
}

/** Reassigns many at once (a counselor leaves, a school changes hands). Each one gets its own history row. */
export async function reassignMany(db: Db, o: { ids: string[]; toKey: string | null; actor: string; reason?: string | null }): Promise<{ changed: Extract<Reassigned, { ok: true }>[]; unchanged: number; failed: number }> {
  const changed: Extract<Reassigned, { ok: true }>[] = [];
  let unchanged = 0, failed = 0;
  for (const id of [...new Set(o.ids)].slice(0, 300)) {
    const r = await reassign(db, { appId: id, toKey: o.toKey, actor: o.actor, kind: 'bulk', reason: o.reason });
    if (!r.ok) failed++; else if (r.changed) changed.push(r); else unchanged++;
  }
  return { changed, unchanged, failed };
}

/** The master sheet named a different counselor than the portal has. Recorded so the history is complete; the sheet's word stands. */
export async function recordSheetOwner(db: Db, changes: { id: string; from: string | null; to: string | null }[]) {
  for (const c of changes) {
    if (!c.to || isPlaceholderCounselor(c.to)) continue;
    if (!isPlaceholderCounselor(c.from) && counselorKey(c.from) === counselorKey(c.to)) continue;
    await db.from('portal_applications').update({ assign_state: 'assigned', assign_reason: `The master sheet names ${c.to} as the counselor`, assigned_at: now(), assigned_by: 'sheet' }).eq('application_id', c.id);
    await closeConflicts(db, c.id, 'sheet', c.to, 'The master sheet named a counselor');
    await logRow(db, { application_id: c.id, kind: 'sheet', from_counselor: isPlaceholderCounselor(c.from) ? null : c.from, to_counselor: c.to, reason: `The master sheet names ${c.to} as the counselor`, actor: 'sheet' });
  }
}

// ---------- when responsibilities change ----------
export type BulkFilter = { workspace: string; from: string | '__none'; school?: string | null; location?: string | null };
export type BulkApp = { id: string; name: string; school: string | null; city: string | null; status: string | null };

/** The applications a bulk reassignment would move: one counselor's (or nobody's) in one destination, optionally one school or location. Finished ones stay put. */
export async function bulkCandidates(db: Db, f: BulkFilter): Promise<BulkApp[]> {
  const out: BulkApp[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('portal_applications').select('application_id, name, school, city, status, counselor').eq('workspace', f.workspace).order('application_id').range(from, from + 999);
    for (const r of data || []) {
      if (r.status && FINAL_STATUSES.includes(r.status as string)) continue;
      const owned = !isPlaceholderCounselor(r.counselor as string | null);
      if (f.from === '__none' ? owned : !owned || counselorKey(r.counselor as string) !== f.from) continue;
      if (f.school && schoolKey(r.school as string | null) !== f.school) continue;
      if (f.location && normLocation(r.city as string | null) !== f.location) continue;
      out.push({ id: r.application_id as string, name: r.name as string, school: r.school as string | null, city: r.city as string | null, status: r.status as string | null });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Brings "who receives the documents" up to date with the current document responsibilities, for applications that already exist. Owners are untouched. */
export async function applyDocHandlers(db: Db, o: { ids: string[]; actor: string }): Promise<{ changed: { id: string; name: string; counselorKey: string | null; counselorName: string | null }[]; unchanged: number }> {
  const changed: { id: string; name: string; counselorKey: string | null; counselorName: string | null }[] = [];
  let unchanged = 0;
  const ids = [...new Set(o.ids)];
  const apps: AppRow[] = [];
  for (let i = 0; i < ids.length; i += 100) { const { data } = await db.from('portal_applications').select(COLS).in('application_id', ids.slice(i, i + 100)); apps.push(...((data || []) as AppRow[])); }
  const [rules, counselors] = await Promise.all([loadRules(db), loadCounselors(db)]);
  for (const a of apps) {
    const d = resolveAssignment(rules, facts(a), counselors, { kind: 'documents' });
    const key = d.kind === 'assigned' ? d.counselor_key : null;
    if (key === (a.doc_handler || null)) { unchanged++; continue; }
    await db.from('portal_applications').update({ doc_handler: key }).eq('application_id', a.application_id);
    await logRow(db, { application_id: a.application_id, kind: 'documents', from_counselor: a.doc_handler ? counselors.get(a.doc_handler)?.name || a.doc_handler : null, to_counselor: d.kind === 'assigned' ? d.name : null, reason: d.kind === 'assigned' ? d.reason : 'No document responsibility applies to this application any more', level: d.kind === 'assigned' ? d.level : null, rule_id: d.kind === 'assigned' ? d.rule_id : null, actor: o.actor });
    changed.push({ id: a.application_id, name: a.name, counselorKey: key, counselorName: d.kind === 'assigned' ? d.name : null });
  }
  return { changed, unchanged };
}

// ---------- for the application page ----------
export type HistoryRow = { id: string; at: string; kind: string; from: string | null; to: string | null; reason: string | null; actor: string; level: string | null };
export type AssignInfo = {
  state: 'assigned' | 'queue' | 'conflict' | null; reason: string | null; assignedAt: string | null; assignedBy: string | null;
  owner: string | null; docHandler: string | null; candidates: Candidate[]; expected: { name: string; level: string } | null; history: HistoryRow[];
};

/** Everything the Assignment card on an application shows: who owns it and why, who receives its documents, any open conflict, and the history. */
export async function loadAssignInfo(db: Db, appId: string): Promise<AssignInfo | null> {
  const { data: a } = await db.from('portal_applications').select(COLS).eq('application_id', appId).maybeSingle();
  if (!a) return null;
  const app = a as AppRow;
  const [counselors, rules, { data: conf }, { data: log }] = await Promise.all([
    loadCounselors(db), loadRules(db, app.workspace),
    db.from('portal_assign_conflicts').select('candidates').eq('application_id', appId).eq('status', 'open').maybeSingle(),
    db.from('portal_assign_log').select('id, at, kind, from_counselor, to_counselor, reason, actor, level').eq('application_id', appId).order('at', { ascending: false }).limit(30),
  ]);
  const owned = !isPlaceholderCounselor(app.counselor);
  const d = resolveAssignment(rules, facts(app), counselors, { kind: 'application' });
  return {
    state: (app.assign_state as AssignInfo['state']) ?? null, reason: app.assign_reason, assignedAt: (a as { assigned_at?: string | null }).assigned_at ?? null, assignedBy: (a as { assigned_by?: string | null }).assigned_by ?? null,
    owner: owned ? app.counselor : null, docHandler: app.doc_handler ? counselors.get(app.doc_handler)?.name || app.doc_handler : null,
    candidates: ((conf?.candidates as Candidate[] | undefined) || []),
    expected: d.kind === 'assigned' && (!owned || d.counselor_key !== counselorKey(app.counselor)) ? { name: d.name, level: d.level } : null,
    history: (log || []).map((l) => ({ id: l.id as string, at: l.at as string, kind: l.kind as string, from: (l.from_counselor as string | null) ?? null, to: (l.to_counselor as string | null) ?? null, reason: (l.reason as string | null) ?? null, actor: l.actor as string, level: (l.level as string | null) ?? null })),
  };
}

// ---------- scope and permission ----------
/** May this person reassign this application? Admins and team members in the workspace, and a Team Head inside their scope. */
export function mayAssign(who: { role: 'admin' | 'staff' | 'counselor'; team_head?: boolean | null }, scopes: Scope[], app: AppFacts): boolean {
  if (who.role === 'admin' || who.role === 'staff') return true;
  return !!who.team_head && inScope(scopes, app);
}

export { inScope, normLocation };
