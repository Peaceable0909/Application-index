'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { admin } from '@/lib/supabase';
import { canAccessApp, headScopes, requireStaff, requireTeam, type Staff } from '@/lib/auth';
import { schoolDisplay, schoolKey } from '@/lib/docs';
import { audit } from '@/lib/audit';
import { listWorkspaces, workspacesFor } from '@/lib/workspace';
import { mayOpen } from '@/lib/workspaceCore';
import { writeBack } from '@/lib/sheetWrite';
import { applyDocHandlers, bulkCandidates, loadCounselors, loadRules, mayAssign, reassign, reassignMany, routeApplications, waitingIds } from '@/lib/assignCore';
import { inScope, normLocation, ruleProblems, type Level } from '@/lib/assignEngine';
import { notifyOwnerByKey, notifyRouting } from '@/lib/assignNotify';
import { headViewFor } from '@/lib/headBoard';

// Responsibilities (rules), Team Heads and reassignment. Rules and Team Head scopes are admin-only. Reassigning is open to the team and to a Team Head
// inside what they oversee, and every change goes through assignCore so it lands in the assignment history with who did it and why.
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const SAFE = (p: string) => (/^\/(?!\/)/.test(p) ? p : '');

const done = (to: string, msg: string, err = false): never => {
  revalidatePath('/assignments'); revalidatePath('/head'); revalidatePath('/applications');
  redirect(`${to}${to.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
};
const home = (f: FormData, fallback: string) => SAFE(s(f, 'returnTo')) || fallback;

async function adminOnly(): Promise<Staff> {
  const staff = await requireTeam();
  if (staff.role !== 'admin') redirect('/?err=' + encodeURIComponent('Only an admin can change who is responsible for what.'));
  return staff;
}

async function known(workspace: string) {
  const w = (await listWorkspaces()).find((x) => x.key === workspace && x.active);
  return w || null;
}

// ---------- responsibilities ----------
const RULES = '/assignments';

export async function addRule(f: FormData) {
  const staff = await adminOnly();
  const workspace = s(f, 'workspace'), kind = s(f, 'kind') === 'documents' ? 'documents' : 'application', scope = s(f, 'scope') as Level;
  const role = s(f, 'role') === 'backup' ? 'backup' : 'primary', ckey = s(f, 'counselor'), note = s(f, 'note').slice(0, 300) || null;
  const paused = /^\d{4}-\d{2}-\d{2}$/.test(s(f, 'paused_until')) ? s(f, 'paused_until') : null;
  if (!(await known(workspace))) return done(RULES, 'Choose a destination first.', true);
  if (!['school', 'country', 'location'].includes(scope)) return done(RULES, 'Choose what the counselor is responsible for: a school, a whole destination or a location.', true);
  const counselors = await loadCounselors(admin());
  if (!counselors.has(ckey)) return done(RULES, 'Choose a counselor from the list.', true);
  if (!counselors.get(ckey)!.active) return done(RULES, `${counselors.get(ckey)!.name} is switched off as a counselor. Switch them on under Counselors first.`, true);

  let school_key: string | null = null, school_name: string | null = null, location_key: string | null = null, location_name: string | null = null;
  if (scope === 'school') {
    const typed = s(f, 'school');
    if (typed.length < 2) return done(RULES, 'Type or pick the school.', true);
    school_key = schoolKey(typed); school_name = schoolDisplay(typed) || typed;
  } else if (scope === 'location') {
    const typed = s(f, 'location');
    location_key = normLocation(typed); location_name = typed;
    if (!location_key) return done(RULES, 'Type or pick the location (a city or office).', true);
  }
  if (kind === 'documents' && scope === 'location') return done(RULES, 'Document responsibilities are set per school or per destination.', true);

  const db = admin();
  const { data: same } = await db.from('portal_assign_rules').select('id, school_key, location_key').eq('workspace', workspace).eq('kind', kind).eq('scope', scope).eq('counselor_key', ckey);
  if ((same || []).some((r) => (r.school_key ?? null) === school_key && (r.location_key ?? null) === location_key)) return done(RULES, `${counselors.get(ckey)!.name} already has this responsibility. Change it from the list instead.`, true);

  const { data: row, error } = await db.from('portal_assign_rules').insert({ workspace, kind, scope, school_key, school_name, location_key, location_name, counselor_key: ckey, role, active: true, paused_until: paused, note, created_by: staff.email }).select('id').single();
  if (error || !row) return done(RULES, `Could not save it: ${error?.message || 'unknown error'}`, true);
  await audit(staff.email, 'assign_rule_added', ckey, { workspace, kind, scope, school_key, location_key, role });
  // tell the admin straight away if this made two primaries for one target
  const problems = ruleProblems(await loadRules(db, workspace), counselors).filter((p) => p.rule_ids.includes(row.id) && p.level === 'conflict');
  done(RULES, `${counselors.get(ckey)!.name} added as ${role}. Existing applications keep their counselor; this applies to new ones.${problems.length ? ' ' + problems[0].text : ''}`, problems.length > 0);
}

export async function saveRule(f: FormData) {
  const staff = await adminOnly();
  const id = s(f, 'id');
  const role = s(f, 'role') === 'backup' ? 'backup' : 'primary', note = s(f, 'note').slice(0, 300) || null;
  const paused = /^\d{4}-\d{2}-\d{2}$/.test(s(f, 'paused_until')) ? s(f, 'paused_until') : null;
  const { error } = await admin().from('portal_assign_rules').update({ role, note, paused_until: paused, active: f.get('active') === 'on' }).eq('id', id);
  if (error) return done(RULES, `Could not save it: ${error.message}`, true);
  await audit(staff.email, 'assign_rule_changed', id, { role, paused_until: paused });
  done(RULES, 'Saved. Applications that already have a counselor were not touched.');
}

/** Switch one responsibility off or on without deleting it (for example while a counselor is away). */
export async function toggleRule(f: FormData) {
  const staff = await adminOnly();
  const id = s(f, 'id'), on = s(f, 'to') === 'on';
  await admin().from('portal_assign_rules').update({ active: on, ...(on ? { paused_until: null } : {}) }).eq('id', id);
  await audit(staff.email, on ? 'assign_rule_on' : 'assign_rule_off', id);
  done(RULES, on ? 'Switched on.' : 'Switched off. It stays in the list and can be switched back on.');
}

export async function removeRule(f: FormData) {
  const staff = await adminOnly();
  await admin().from('portal_assign_rules').delete().eq('id', s(f, 'id'));
  await audit(staff.email, 'assign_rule_removed', s(f, 'id'));
  done(RULES, 'Removed. Applications that already have a counselor were not touched.');
}

export async function setAutoRoute(f: FormData) {
  const staff = await adminOnly();
  const workspace = s(f, 'workspace'), on = s(f, 'to') === 'on';
  if (!(await known(workspace))) return done(RULES, 'That destination was not found.', true);
  await admin().from('portal_workspaces').update({ auto_route: on }).eq('key', workspace);
  await audit(staff.email, on ? 'auto_route_on' : 'auto_route_off', workspace);
  done(RULES, on ? 'New applications will be given to the responsible counselor automatically.' : 'Automatic routing is off. New applications wait in the queue until a person assigns them.');
}

/** A new destination (for example Japan) with the counselor responsible for it, routing switched on, in one step. */
export async function addDestination(f: FormData) {
  const staff = await adminOnly();
  const name = s(f, 'name'), tab = s(f, 'tab'), ckey = s(f, 'counselor');
  const key = (s(f, 'key') || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  if (name.length < 2 || !/^[a-z][a-z0-9-]{1,23}$/.test(key)) return done(RULES, 'Give the destination a name, for example “Japan”.', true);
  if (!tab) return done(RULES, 'Tell me the Google Sheet tab that lists this destination’s students.', true);
  if ((await listWorkspaces()).some((w) => w.key === key)) return done(RULES, 'A destination with that name already exists.', true);
  const counselors = await loadCounselors(admin());
  if (ckey && !counselors.get(ckey)?.active) return done(RULES, 'Choose an active counselor from the list, or leave it empty and add the responsibility later.', true);
  const db = admin();
  const { error } = await db.from('portal_workspaces').insert({ key, name, master_tab: tab, auto_route: true });
  if (error) return done(RULES, `Could not create it: ${error.message}`, true);
  if (ckey) await db.from('portal_assign_rules').insert({ workspace: key, kind: 'application', scope: 'country', counselor_key: ckey, role: 'primary', active: true, created_by: staff.email, note: 'Set when the destination was created' });
  await audit(staff.email, 'workspace_created', key, { name, tab, counselor: ckey || null });
  done(RULES, `${name} added${ckey ? ` with ${counselors.get(ckey)!.name} responsible for it` : ''}. New applications there are routed automatically. Add its sheet tab “${tab}” and give people access under Settings.`);
}

// ---------- Team Heads ----------
export async function addHeadScope(f: FormData) {
  const staff = await adminOnly();
  const email = s(f, 'email').toLowerCase(), workspace = s(f, 'workspace'), scope = s(f, 'scope') as Level;
  const db = admin();
  const { data: person } = await db.from('portal_staff').select('email, role, workspaces').eq('email', email).maybeSingle();
  if (!person) return done(RULES, 'That person is not on the team yet. Add them under Team or Settings first, then make them a Team Head.', true);
  if (!(await known(workspace))) return done(RULES, 'Choose a destination first.', true);
  if (!['school', 'country', 'location'].includes(scope)) return done(RULES, 'Choose what they oversee: a school, a whole destination or a location.', true);
  let school_key: string | null = null, school_name: string | null = null, location_key: string | null = null, location_name: string | null = null;
  if (scope === 'school') { const t = s(f, 'school'); if (t.length < 2) return done(RULES, 'Type or pick the school.', true); school_key = schoolKey(t); school_name = schoolDisplay(t) || t; }
  if (scope === 'location') { const t = s(f, 'location'); location_key = normLocation(t); location_name = t; if (!location_key) return done(RULES, 'Type or pick the location.', true); }
  const { data: dup } = await db.from('portal_head_scopes').select('id, school_key, location_key').eq('email', email).eq('workspace', workspace).eq('scope', scope);
  if ((dup || []).some((r) => (r.school_key ?? null) === school_key && (r.location_key ?? null) === location_key)) return done(RULES, 'They already oversee that.', true);
  const { error } = await db.from('portal_head_scopes').insert({ email, workspace, scope, school_key, school_name, location_key, location_name, created_by: staff.email });
  if (error) return done(RULES, `Could not save it: ${error.message}`, true);
  await db.from('portal_staff').update({ team_head: true }).eq('email', email);
  // they can only open students of destinations they have access to
  let note = '';
  if (person.role !== 'admin' && !mayOpen({ role: person.role as Staff['role'], workspaces: person.workspaces as string[] | null }, workspace)) {
    await db.from('portal_staff').update({ workspaces: [...((person.workspaces as string[] | null) || ['uk']), workspace] }).eq('email', email);
    note = ` They were also given access to the ${workspace.toUpperCase()} destination.`;
  }
  await audit(staff.email, 'team_head_scope_added', email, { workspace, scope, school_key, location_key });
  done(RULES, `${email} now oversees that.${note}`);
}

export async function removeHeadScope(f: FormData) {
  const staff = await adminOnly();
  const db = admin();
  const { data: row } = await db.from('portal_head_scopes').select('email').eq('id', s(f, 'id')).maybeSingle();
  if (!row) return done(RULES, 'That was already removed.', true);
  await db.from('portal_head_scopes').delete().eq('id', s(f, 'id'));
  const { count } = await db.from('portal_head_scopes').select('id', { count: 'exact', head: true }).eq('email', row.email);
  if (!count) await db.from('portal_staff').update({ team_head: false }).eq('email', row.email);
  await audit(staff.email, 'team_head_scope_removed', row.email as string);
  done(RULES, count ? 'Removed.' : `Removed. ${row.email} no longer has a Team Head dashboard.`);
}

// ---------- reassigning ----------
/** May this person reassign this application? Team and admins in their destinations; a Team Head inside their scope. */
async function allowed(staff: Staff, appId: string): Promise<boolean> {
  if (!(await canAccessApp(staff, appId))) return false;
  if (staff.role !== 'counselor') return true;
  const { data: a } = await admin().from('portal_applications').select('workspace, school, city').eq('application_id', appId).maybeSingle();
  return !!a && mayAssign(staff, await headScopes(staff.email), a);
}

const sheetFor = async (id: string, name: string | null) => { try { await writeBack(id, { counselor: name ?? '' }); return true; } catch { return false; } };

/** Gives one application to a counselor, or settles a conflict by choosing one of the candidates. */
export async function assignApp(f: FormData) {
  const staff = await requireStaff();
  const id = s(f, 'id'), to = s(f, 'counselor'), back = home(f, `/applications/${encodeURIComponent(id)}`);
  if (!to && s(f, 'unassign') !== '1') return done(back, 'Choose a counselor.', true);
  if (!(await allowed(staff, id))) return done(back, 'You can only assign students inside what you oversee.', true);
  const r = await reassign(admin(), { appId: id, toKey: to || null, actor: staff.email, reason: s(f, 'reason') });
  if (!r.ok) return done(back, r.error, true);
  if (!r.changed) return done(back, 'No change: that is already the counselor.');
  await db_activity(id, staff.email, r.from, r.to);
  if (r.toKey) { const key = r.toKey, student = r.student; after(() => notifyOwnerByKey(key, [student], staff.email)); }
  const sheet = await sheetFor(id, r.to);
  done(back, `${r.to ? `Assigned to ${r.to}` : 'Taken off the counselor and put back in the queue'}.${r.overrode ? ` The rules pointed to ${r.overrode}; your choice is recorded.` : ''}${sheet ? '' : ' The sheet could not be updated, so the portal and the sheet differ until it is.'}`, !sheet);
}

async function db_activity(id: string, actor: string, from: string | null, to: string | null) {
  const db = admin();
  await db.from('portal_activity').insert({ application_id: id, actor, kind: 'counselor_change', detail: { from, to: to ?? '' } });
  await db.from('portal_applications').update({ last_activity_at: new Date().toISOString() }).eq('application_id', id);
}

/** Several applications from the Team Head queue to one counselor. Each is checked against what the person may touch. */
export async function assignSelected(f: FormData) {
  const staff = await requireStaff();
  const back = home(f, '/head'), to = s(f, 'counselor');
  const picked = f.getAll('ids').map(String).filter(Boolean);
  if (!picked.length) return done(back, 'Tick the applications first.', true);
  if (!to) return done(back, 'Choose a counselor.', true);
  const ids: string[] = [];
  for (const id of picked) if (await allowed(staff, id)) ids.push(id);
  const skipped = picked.length - ids.length;
  const r = await reassignMany(admin(), { ids, toKey: to, actor: staff.email, reason: s(f, 'reason') });
  let sheetFail = 0;
  for (const c of r.changed) { await db_activity(c.student.id, staff.email, c.from, c.to); if (!(await sheetFor(c.student.id, c.to))) sheetFail++; }
  if (r.changed.length) { const students = r.changed.map((c) => c.student); after(() => notifyOwnerByKey(to, students, staff.email)); }
  done(back, `${r.changed.length} assigned${r.unchanged ? `, ${r.unchanged} already theirs` : ''}${skipped ? `, ${skipped} outside what you oversee` : ''}${r.failed ? `, ${r.failed} could not be changed` : ''}${sheetFail ? `. ${sheetFail} could not be written to the sheet` : ''}.`, !r.changed.length || sheetFail > 0);
}

/** Runs the current responsibilities over the applications still waiting (no counselor, or a flagged conflict), for the destinations and scope the person oversees. */
export async function routeWaiting(f: FormData) {
  const staff = await requireStaff();
  const back = home(f, '/head');
  const all = (await workspacesFor(staff)).map((w) => w.key);
  const view = await headViewFor(staff, all);
  if (!view && staff.role !== 'staff') return done(back, 'Only an admin or a Team Head can do that.', true);
  const db = admin();
  const ids: string[] = [];
  for (const ws of view?.workspaces || all) {
    const waiting = await waitingIds(db, ws);
    if (!waiting.length) continue;
    const { data } = await db.from('portal_applications').select('application_id, workspace, school, city').in('application_id', waiting.slice(0, 500));
    for (const a of data || []) if (!view?.scopes || inScope(view.scopes, { workspace: a.workspace, school: a.school, city: a.city })) ids.push(a.application_id);
  }
  // applications whose open conflict is still unresolved are waiting too
  const { data: conf } = await db.from('portal_assign_conflicts').select('application_id').eq('status', 'open');
  for (const c of conf || []) if (!ids.includes(c.application_id) && (await canAccessApp(staff, c.application_id))) ids.push(c.application_id);
  if (!ids.length) return done(back, 'Nothing is waiting.');
  const r = await routeApplications(db, { ids, actor: staff.email, mode: 'queue' });
  for (const a of r.assigned.slice(0, 20)) await sheetFor(a.id, a.counselorName);
  after(() => notifyRouting(r));
  done(back, `${r.assigned.length} assigned by the rules${r.queued.length ? `, ${r.queued.length} still need a person (no rule covers them)` : ''}${r.conflicts.length ? `, ${r.conflicts.length} have more than one possible counselor` : ''}.`);
}

// ---------- when responsibilities change ----------
/** Moves one counselor's applications (optionally one school or location) to another counselor. The preview on the page lists exactly what this will move. */
export async function bulkReassign(f: FormData) {
  const staff = await adminOnly();
  const workspace = s(f, 'workspace'), from = s(f, 'from'), to = s(f, 'to');
  const school = s(f, 'school') ? schoolKey(s(f, 'school')) : null, location = s(f, 'location') ? normLocation(s(f, 'location')) || null : null;
  const back = `${RULES}?bulk=1`;
  if (!(await known(workspace)) || !from || !to || from === to) return done(back, 'Choose the destination, who it moves from and who it moves to.', true);
  const ids = (await bulkCandidates(admin(), { workspace, from, school, location })).map((a) => a.id);
  if (!ids.length) return done(RULES, 'Nothing matched, so nothing was moved.');
  const r = await reassignMany(admin(), { ids, toKey: to, actor: staff.email, reason: s(f, 'reason') || 'Responsibilities changed' });
  let sheetFail = 0;
  for (const c of r.changed) { await db_activity(c.student.id, staff.email, c.from, c.to); if (!(await sheetFor(c.student.id, c.to))) sheetFail++; }
  if (r.changed.length) { const students = r.changed.map((c) => c.student); after(() => notifyOwnerByKey(to, students, staff.email)); }
  await audit(staff.email, 'assign_bulk', to, { workspace, from, school, location, moved: r.changed.length });
  done(RULES, `${r.changed.length} application${r.changed.length === 1 ? '' : 's'} moved. Each one has its own history entry.${r.failed ? ` ${r.failed} could not be changed.` : ''}${sheetFail ? ` ${sheetFail} could not be written to the sheet.` : ''}`, sheetFail > 0);
}

/** Updates who receives the documents on applications that already exist, to match the document responsibilities as they are now. */
export async function refreshDocHandlers(f: FormData) {
  const staff = await adminOnly();
  const workspace = s(f, 'workspace');
  if (!(await known(workspace))) return done(RULES, 'Choose a destination first.', true);
  const db = admin();
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('portal_applications').select('application_id, status').eq('workspace', workspace).order('application_id').range(from, from + 999);
    (data || []).forEach((r) => { if (!['Enrolled', 'Rejected', 'Withdrawn'].includes(String(r.status))) ids.push(r.application_id as string); });
    if (!data || data.length < 1000) break;
  }
  const r = await applyDocHandlers(db, { ids, actor: staff.email });
  await audit(staff.email, 'doc_handlers_refreshed', workspace, { changed: r.changed.length });
  done(RULES, r.changed.length ? `Document handling updated on ${r.changed.length} application${r.changed.length === 1 ? '' : 's'}. Owners were not touched.` : 'Document handling already matches the responsibilities.');
}
