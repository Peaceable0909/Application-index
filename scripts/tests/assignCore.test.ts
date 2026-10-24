// Run with: npx tsx scripts/tests/assignCore.test.ts  (in-memory database)
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { startMock, type Rows } from './mockdb';
import { mayAssign, reassign, reassignMany, recordSheetOwner, routeApplications, waitingIds } from '../../src/lib/assignCore';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const DB: Rows = {};
const rule = (o: Record<string, unknown>) => ({ id: randomUUID(), workspace: 'uk', kind: 'application', school_key: null, location_key: null, role: 'primary', active: true, paused_until: null, ...o });
const app = (id: string, o: Record<string, unknown> = {}) => ({ application_id: id, name: `Student ${id}`, school: 'Canterbury Christ Church University (CCCU)', programme: 'MSc', city: 'Lagos', counselor: null, workspace: 'uk', assign_state: null, assign_reason: null, routed_at: null, doc_handler: null, ...o });
function seed() {
  DB.portal_workspaces = [{ key: 'uk', auto_route: true }, { key: 'jp', auto_route: true }, { key: 'ca', auto_route: false }];
  DB.portal_counselors = [['abraham', 'MR Abraham'], ['robert', 'MR ROBERT'], ['lydia', 'mrs Lydia'], ['paul', 'Mr Paul'], ['tomo', 'Tomo']].map(([name_key, name]) => ({ name_key, name, email: `${name_key}@x.org`, active: true }) as Record<string, unknown>).concat([{ name_key: 'gone', name: 'Mr Gone', email: null, active: false }]);
  DB.portal_assign_rules = [
    rule({ scope: 'school', school_key: 'cccu', school_name: 'CCCU', counselor_key: 'abraham' }),
    rule({ scope: 'school', school_key: 'rcl', school_name: 'Regent', counselor_key: 'robert' }),
    rule({ scope: 'school', school_key: 'cccu', kind: 'documents', counselor_key: 'paul' }),
    rule({ scope: 'school', school_key: 'rcl', kind: 'documents', counselor_key: 'paul' }),
    rule({ scope: 'country', counselor_key: 'lydia' }),
    rule({ scope: 'location', location_key: 'abuja', location_name: 'Abuja', counselor_key: 'robert' }),
    rule({ workspace: 'jp', scope: 'country', counselor_key: 'tomo' }),
  ];
  DB.portal_applications = [];
  DB.portal_assign_log = []; DB.portal_assign_conflicts = [];
}
const A = (id: string) => DB.portal_applications.find((a) => a.application_id === id)!;
const logOf = (id: string) => DB.portal_assign_log.filter((l) => l.application_id === id);

(async () => {
  seed();
  const server = await startMock(DB, 54394);
  const db = createClient('http://127.0.0.1:54394', 'x', { auth: { persistSession: false } }) as never;

  // ---- new applications are routed at once ----
  DB.portal_applications.push(app('n1'), app('n2', { school: 'Regent College London (RCL)' }), app('n3', { school: 'BPP University', city: 'Ibadan' }), app('n4', { school: 'BPP University', city: 'Abuja' }), app('n5', { workspace: 'jp', school: 'Keio', city: 'Tokyo' }));
  let r = await routeApplications(db, { ids: ['n1', 'n2', 'n3', 'n4', 'n5'], actor: 'system', mode: 'new' });
  eq(A('n1').counselor, 'MR Abraham', 'a new CCCU application goes to the CCCU counselor'); eq(A('n2').counselor, 'MR ROBERT', 'a new Regent application goes to the Regent counselor');
  eq(A('n3').counselor, 'mrs Lydia', 'a school with no rule falls to the destination counselor'); eq(A('n5').counselor, 'Tomo', 'a destination added later routes with no code change');
  eq(A('n4').counselor, 'mrs Lydia', 'the destination rule is next, before a location rule');
  eq(A('n1').assign_state, 'assigned', 'state recorded'); ok(/school rule/.test(String(A('n1').assign_reason)) && /CCCU/.test(String(A('n1').assign_reason)), 'the reason is recorded: ' + A('n1').assign_reason);
  ok(A('n1').routed_at && A('n1').assigned_by === 'system', 'routed_at and assigned_by recorded');
  eq(r.assigned.length, 5, 'five assigned'); eq(A('n1').doc_handler, 'paul', 'the documents counselor is set for CCCU'); eq(A('n3').doc_handler, null, 'no documents rule: no documents counselor');
  const h = logOf('n1'); ok(h.some((l) => l.kind === 'auto' && l.to_counselor === 'MR Abraham' && l.level === 'school' && l.actor === 'system' && l.rule_id), 'history: who received it, why, which rule, when, by whom'); ok(h.some((l) => l.kind === 'documents' && l.to_counselor === 'Mr Paul'), 'history: the documents counselor');
  ok(h.every((l) => typeof l.at === 'string' || l.at === undefined), 'history has timestamps (set by the database)');

  // ---- running again changes nothing and tells nobody ----
  A('n1').name = 'Student n1 (edited)';
  r = await routeApplications(db, { ids: ['n1', 'n2'], actor: 'system', mode: 'new' });
  eq([r.assigned.length, r.unchanged], [0, 2], 'an application that was updated is not routed again'); eq(logOf('n1').length, h.length, 'and nothing new is written to its history');

  // ---- an existing owner is never overwritten ----
  DB.portal_applications.push(app('e1', { counselor: 'MR ROBERT' }), app('e2', { counselor: "I don't have a counselor yet" }), app('e3', { counselor: 'Someone Not In The Portal' }));
  r = await routeApplications(db, { ids: ['e1', 'e2', 'e3'], actor: 'system', mode: 'new' });
  eq(A('e1').counselor, 'MR ROBERT', 'a counselor that came with the application stays, even when the rules say CCCU is Abraham'); eq(r.kept, 2, 'two kept');
  eq(A('e2').counselor, 'MR Abraham', 'the form placeholder is not an owner: routed'); eq(A('e3').counselor, 'Someone Not In The Portal', 'an unknown name is kept as it is (a review flag, not an overwrite)');
  ok(logOf('e1').some((l) => l.kind === 'sheet' && /kept|not applied/.test(String(l.reason))), 'history says the rules were not applied and why');

  // ---- conflicts are flagged, not decided ----
  DB.portal_assign_rules.push(rule({ scope: 'school', school_key: 'ysj', school_name: 'York St John', counselor_key: 'abraham' }), rule({ scope: 'school', school_key: 'ysj', school_name: 'York St John', counselor_key: 'lydia' }));
  DB.portal_applications.push(app('c1', { school: 'York St John University' }));
  r = await routeApplications(db, { ids: ['c1'], actor: 'system', mode: 'new' });
  eq(A('c1').counselor, null, 'a conflict assigns nobody'); eq(A('c1').assign_state, 'conflict', 'and is flagged'); eq(r.conflicts.length, 1, 'reported for notification');
  eq(DB.portal_assign_conflicts.length, 1, 'a conflict record exists'); eq(DB.portal_assign_conflicts[0].status, 'open', 'open'); eq((DB.portal_assign_conflicts[0].candidates as unknown[]).length, 2, 'with both candidates');
  ok(logOf('c1').some((l) => l.kind === 'conflict'), 'history: conflict');
  r = await routeApplications(db, { ids: ['c1'], actor: 'admin@x.org', mode: 'queue' });
  eq([r.conflicts.length, r.unchanged], [0, 1], 'running the rules again on an unresolved conflict does not notify or log twice'); eq(DB.portal_assign_conflicts.length, 1, 'still one record'); eq(logOf('c1').filter((l) => l.kind === 'conflict').length, 1, 'still one history row');

  // ---- resolving a conflict ----
  const rs: any = await reassign(db, { appId: 'c1', toKey: 'lydia', actor: 'head@x.org', reason: 'Lydia knows York' });
  ok(rs.ok && rs.changed && rs.to === 'mrs Lydia', 'a person chooses'); eq(A('c1').counselor, 'mrs Lydia', 'assigned'); eq(A('c1').assign_state, 'assigned', 'state'); eq(DB.portal_assign_conflicts[0].status, 'resolved', 'the conflict is closed');
  ok(DB.portal_assign_conflicts[0].resolved_by === 'head@x.org' && DB.portal_assign_conflicts[0].chosen === 'mrs Lydia', 'with who and what was chosen');
  ok(logOf('c1').some((l) => l.kind === 'resolved' && l.actor === 'head@x.org' && l.to_counselor === 'mrs Lydia'), 'history: resolved by whom');

  // ---- no owner at all: the queue ----
  DB.portal_applications.push(app('q1', { school: 'Some School', workspace: 'ca', city: null }), app('q2', { school: 'Another', city: null, workspace: 'uk' }));
  DB.portal_assign_rules = DB.portal_assign_rules.filter((x) => x.scope !== 'country' || x.workspace !== 'uk');
  r = await routeApplications(db, { ids: ['q1', 'q2'], actor: 'system', mode: 'new' });
  eq(A('q1').routed_at, null, 'a destination with automatic routing switched off is left alone'); eq(r.skippedOff, 1, 'counted as skipped');
  eq([A('q2').assign_state, A('q2').counselor], ['queue', null], 'no rule: the queue'); eq(r.queued.length, 1, 'reported'); ok(/No assignment rule/.test(String(A('q2').assign_reason)), 'with the reason');
  // the admin adds a rule and runs the queue
  DB.portal_assign_rules.push(rule({ scope: 'country', counselor_key: 'lydia' }));
  const ids = await waitingIds(db, 'uk'); ok(ids.includes('q2') && !ids.includes('n1'), 'the waiting list holds only applications without an owner');
  r = await routeApplications(db, { ids, actor: 'admin@x.org', mode: 'queue' });
  eq(A('q2').counselor, 'mrs Lydia', 'the queue is worked through with the new rule'); ok(logOf('q2').some((l) => l.kind === 'auto' && l.actor === 'admin@x.org'), 'history names who ran it');
  const q1 = await routeApplications(db, { ids: ['q1'], actor: 'admin@x.org', mode: 'queue' }); eq(q1.queued.length, 1, 'an admin can still run a switched-off destination by hand');

  // ---- rules changes do not touch existing applications ----
  DB.portal_assign_rules = DB.portal_assign_rules.filter((x) => x.counselor_key !== 'abraham');
  eq(A('n1').counselor, 'MR Abraham', 'deleting a rule leaves existing applications where they are');

  // ---- manual reassignment: history, override, no duplicates ----
  const m1: any = await reassign(db, { appId: 'n2', toKey: 'lydia', actor: 'head@x.org', reason: 'Robert is overloaded' });
  ok(m1.ok && m1.changed && m1.from === 'MR ROBERT' && m1.to === 'mrs Lydia', 'reassigned with from and to'); ok(String(m1.overrode).includes('MR ROBERT'), 'recorded as an override of the rule: ' + m1.overrode);
  const lg = logOf('n2').at(-1)!; ok(lg.kind === 'manual' && lg.actor === 'head@x.org' && lg.from_counselor === 'MR ROBERT' && lg.to_counselor === 'mrs Lydia' && /overloaded/.test(String(lg.reason)), 'history: previous, new, who, why');
  const before = logOf('n2').length; const again: any = await reassign(db, { appId: 'n2', toKey: 'lydia', actor: 'head@x.org' });
  ok(again.ok && !again.changed, 'giving it to the same counselor again changes nothing'); eq(logOf('n2').length, before, 'no history row, so no notification');
  ok(!(await reassign(db, { appId: 'n2', toKey: 'gone', actor: 'x' }) as any).ok, 'a switched-off counselor cannot be chosen'); ok(!(await reassign(db, { appId: 'n2', toKey: 'nobody', actor: 'x' }) as any).ok, 'nor one the portal does not know'); ok(!(await reassign(db, { appId: 'nope', toKey: 'lydia', actor: 'x' }) as any).ok, 'nor an application that does not exist');
  const un: any = await reassign(db, { appId: 'n2', toKey: null, actor: 'admin@x.org', reason: 'Wrong school' }); ok(un.ok && un.changed && un.to === null, 'an owner can be taken away'); eq([A('n2').counselor, A('n2').assign_state], [null, 'queue'], 'back in the queue');

  // ---- bulk ----
  DB.portal_applications.push(app('b1', { counselor: 'MR ROBERT' }), app('b2', { counselor: 'MR ROBERT' }), app('b3', { counselor: 'mrs Lydia' }));
  const bulk = await reassignMany(db, { ids: ['b1', 'b2', 'b3'], toKey: 'lydia', actor: 'admin@x.org', reason: 'Robert is on leave' });
  eq([bulk.changed.length, bulk.unchanged, bulk.failed], [2, 1, 0], 'bulk: two moved, one already hers'); ok(logOf('b1').at(-1)!.kind === 'bulk' && /on leave/.test(String(logOf('b1').at(-1)!.reason)), 'bulk: each application gets its own history row');

  // ---- the sheet names someone ----
  await recordSheetOwner(db, [{ id: 'n1', from: 'MR Abraham', to: 'Mr Paul' }, { id: 'n1', from: 'MR Abraham', to: 'mr abraham' }, { id: 'n3', from: 'x', to: null }]);
  ok(logOf('n1').some((l) => l.kind === 'sheet' && l.to_counselor === 'Mr Paul'), 'a sheet change is recorded'); eq(logOf('n1').filter((l) => l.kind === 'sheet' && l.to_counselor === 'mr abraham').length, 0, 'a spelling change of the same counselor is not');

  // ---- who may reassign ----
  const scopes = [{ workspace: 'uk', scope: 'school' as const, school_key: 'cccu', location_key: null }];
  ok(mayAssign({ role: 'admin' }, [], { workspace: 'uk', school: 'X', city: null }), 'admin: anything'); ok(mayAssign({ role: 'staff' }, [], { workspace: 'uk', school: 'X', city: null }), 'team member: as before');
  ok(mayAssign({ role: 'counselor', team_head: true }, scopes, { workspace: 'uk', school: 'CCCU', city: null }), 'a Team Head: inside their scope'); ok(!mayAssign({ role: 'counselor', team_head: true }, scopes, { workspace: 'uk', school: 'RCL', city: null }), 'but not outside it');
  ok(!mayAssign({ role: 'counselor', team_head: false }, scopes, { workspace: 'uk', school: 'CCCU', city: null }), 'an ordinary counselor: never'); ok(!mayAssign({ role: 'counselor', team_head: true }, [], { workspace: 'uk', school: 'CCCU', city: null }), 'a Team Head with no scope: nothing');

  server.close();
  console.log(`${pass} checks passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
