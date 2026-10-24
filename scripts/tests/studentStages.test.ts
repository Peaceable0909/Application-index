// Run with: npx tsx scripts/tests/studentStages.test.ts  (in-memory database)
// What a student sees of their own application stages, and what they must never see.
import { randomUUID } from 'node:crypto';
import { startMock, type Rows } from './mockdb';
import { WORKFLOW_TEMPLATES, STUDENT_NOTES } from '../../src/lib/stageTemplates';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54397';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const DB: Rows = {};
const T = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
function seed() {
  DB.portal_workflows = []; DB.portal_stages = []; DB.portal_stage_reqs = [];
  for (const t of WORKFLOW_TEMPLATES) {
    const wid = randomUUID();
    DB.portal_workflows.push({ id: wid, workspace: 'uk', school_key: t.school_key, school_name: t.school_name, active: true, override_roles: ['admin'], conditions: t.conditions });
    t.stages.forEach((s, i) => {
      const sid = randomUUID();
      DB.portal_stages.push({ id: sid, workflow_id: wid, key: s.key, name: s.name, position: (i + 1) * 10, active: true, conditional: !!s.conditional, maps_status: s.maps ?? null, move_roles: ['admin', 'staff', 'counselor'], complete_when: 'manual', notify: 'counselor', delay_days: s.delay ?? null, offer_sync: null, hint: s.hint ?? null, student_note: STUDENT_NOTES[s.key] ?? null });
      (s.reqs || []).forEach((r, j) => DB.portal_stage_reqs.push({ id: randomUUID(), stage_id: sid, key: r.key, label: r.label, kind: r.kind ?? 'document', doc_type: r.doc_type ?? null, need: r.need ?? 'mandatory', condition_key: r.condition ?? null, upload: r.upload ?? (r.kind ?? 'document') === 'document', satisfied_at: r.satisfied_at ?? 'approved', student_visible: r.student_visible ?? (r.kind ?? 'document') === 'document', position: (j + 1) * 10, active: true, options: r.options ?? null, pass_options: r.pass ?? null, hint: 'STAFF-ONLY HINT' }));
    });
  }
  const app = (id: string, key: string, school: string | null, stage: string | null) => ({ application_id: id, name: `Student ${id}`, preferred_name: null, email: `${id}@example.org`, school, programme: 'MSc Marketing', workspace: 'uk', status: 'Offer Received', counselor: 'Mr Test', stage_key: stage, stage_at: stage ? T(3) : null, stage_by: 'c@x.org', student_key: key });
  DB.portal_applications = [
    app('a1', 'amara', 'Regent College London (RCL)', 'student_documents_pending'),
    app('a2', 'amara', 'York St John University', 'interview_pending'),
    app('b1', 'bola', 'Canterbury Christ Church University (CCCU)', 'first_interview'),
    app('c1', 'chi', 'BPP University', null),
    app('d1', 'dee', 'Some Other College', null),
  ];
  DB.portal_documents = []; DB.portal_app_flags = []; DB.portal_app_reqs = []; DB.portal_req_checks = []; DB.portal_stage_history = [];
}
const reqId = (stageKey: string, key: string, school = 'rcl') => {
  const wf = DB.portal_workflows.find((w) => w.school_key === school)!, st = DB.portal_stages.find((s) => s.workflow_id === wf.id && s.key === stageKey)!;
  return DB.portal_stage_reqs.find((r) => r.stage_id === st.id && r.key === key)!.id as string;
};
const check = (app: string, req: string, state: string, extra: Record<string, unknown> = {}) => DB.portal_req_checks.push({ id: randomUUID(), application_id: app, req_id: req, app_req_id: null, state, doc_id: null, value: null, note: null, checked_by: 'reviewer@x.org', checked_at: T(1), ...extra });
const me = (email: string, ids: string[]) => ({ email, name: 'X', apps: DB.portal_applications.filter((a) => ids.includes(a.application_id as string)) as never[], docs: [], ids, avatar_url: null });

(async () => {
  seed();
  const server = await startMock(DB, 54397);
  const { studentTrackers } = await import('../../src/lib/studentStages');

  // Amara has two applications: RCL (documents pending) and York St John (interview pending)
  DB.portal_app_flags.push({ application_id: 'a1', flag: 'cond:tb_required', enabled: true });
  DB.portal_documents.push({ drive_file_id: 'f1', application_id: 'a1', name: 'bank.pdf', doc_type: 'Other', type_override: 'Bank statement', created_at: T(2) });
  check('a1', reqId('student_documents_pending', 'signed_payment_plan'), 'approved');
  check('a1', reqId('student_documents_pending', 'tb_certificate'), 'rejected', { note: 'INTERNAL: looks edited' });
  let t = await studentTrackers(me('amara@example.org', ['a1', 'a2']));
  eq(t.length, 2, 'two schools, two trackers');
  const rcl = t.find((x) => x.appId === 'a1')!, ysj = t.find((x) => x.appId === 'a2')!;
  eq(rcl.current, 'Student Documents Pending', 'rcl: the current stage'); eq(rcl.stages.filter((s) => s.state === 'current').length, 1, 'rcl: exactly one current stage');
  ok(rcl.stages.slice(0, rcl.index - 1).every((s) => s.state === 'done'), 'rcl: stages before it are completed');
  eq(rcl.stages[rcl.index].state, 'next', 'rcl: the stage after it is up next'); ok(rcl.stages.slice(rcl.index + 1).every((s) => s.state === 'later'), 'rcl: the rest are coming up');
  ok(!rcl.stages.some((s) => s.name === 'Tuition Fee Stage'), 'rcl: a conditional stage this student does not need is not shown');
  eq(rcl.note, STUDENT_NOTES.student_documents_pending, 'rcl: the stage explained in plain words');
  const ask = (l: string) => rcl.asks.find((a) => a.label === l)!;
  eq(ask('Signed payment plan').state, 'done', 'asks: an approved document is done'); eq(ask('Bank statement').state, 'checking', 'asks: an uploaded one is being checked');
  eq(ask('TB test certificate').state, 'again', 'asks: a rejected one asks for a new copy'); eq(ask('Tuition fee payment receipt').state, 'needed', 'asks: a missing one is needed');
  ok(ask('Any additional document the school asks for').optional, 'asks: optional ones are marked optional');
  eq(ysj.school, 'York St John University', 'ysj: its own school'); eq(ysj.current, 'Interview Pending', 'ysj: its own workflow and stage'); ok(ysj.total === 12 && rcl.total >= 13, 'each school has its own length');
  // nothing staff-only leaks
  const json = JSON.stringify(t);
  ok(!json.includes('STAFF-ONLY HINT') && !json.includes('INTERNAL') && !json.includes('reviewer@x.org') && !json.includes('c@x.org'), 'privacy: no staff notes, review comments or staff emails reach the student');

  // another student sees only their own
  t = await studentTrackers(me('bola@example.org', ['b1']));
  eq(t.length, 1, 'bola: one tracker'); eq(t[0].appId, 'b1', 'bola: only her own application'); eq(t[0].total, 14, 'cccu: its own 14 stages'); eq(t[0].current, 'First Interview', 'cccu: current');
  ok(!JSON.stringify(t).includes('a1'), 'bola: nothing of amara');

  // not started, no workflow
  t = await studentTrackers(me('chi@example.org', ['c1']));
  eq(t.length, 1, 'bpp: a tracker even before the first stage'); eq(t[0].started, false, 'bpp: not started'); eq(t[0].current, null, 'bpp: no current stage'); eq(t[0].stages[0].state, 'next', 'bpp: the first stage is up next'); ok(t[0].stages.slice(1).every((s) => s.state === 'later'), 'bpp: the rest later'); eq(t[0].total, 12, 'bpp: 12 stages');
  t = await studentTrackers(me('dee@example.org', ['d1']));
  eq(t.length, 0, 'a school with no workflow has no tracker (the dashboard keeps its usual steps)');

  // the student's dashboard follows the team: move the application and the tracker moves with it
  const a1 = DB.portal_applications.find((a) => a.application_id === 'a1')!; a1.stage_key = 'cas_requested';
  t = await studentTrackers(me('amara@example.org', ['a1']));
  eq(t[0].current, 'CAS Requested', 'follows a move straight away'); ok(t[0].stages.find((s) => s.name === 'Student Documents Pending')!.state === 'done', 'the old stage is now completed');

  // a stage switched off by an admin while the student is in it still shows where they are
  const st = DB.portal_stages.find((s) => s.key === 'cas_requested' && DB.portal_workflows.find((w) => w.id === s.workflow_id)!.school_key === 'rcl')!; st.active = false;
  t = await studentTrackers(me('amara@example.org', ['a1']));
  eq(t[0].current, 'CAS Requested', 'a switched-off stage still shows as current');

  server.close();
  console.log(`${pass} checks passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
