// Run with: npx tsx scripts/tests/brainStage.test.ts  (in-memory database)
// What the AI Brain is told about a student's stage, and what it must never be told.
import { randomUUID } from 'node:crypto';
import { startMock, type Rows } from './mockdb';
import { WORKFLOW_TEMPLATES, STUDENT_NOTES } from '../../src/lib/stageTemplates';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54396';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
process.env.AI_BRAIN = 'on';

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
      DB.portal_stages.push({ id: sid, workflow_id: wid, key: s.key, name: s.name, position: (i + 1) * 10, active: true, conditional: !!s.conditional, maps_status: s.maps ?? null, move_roles: ['admin', 'staff', 'counselor'], complete_when: 'manual', notify: 'counselor', delay_days: s.delay ?? null, offer_sync: null, hint: 'STAFF-ONLY HINT', student_note: STUDENT_NOTES[s.key] ?? null });
      (s.reqs || []).forEach((r, j) => DB.portal_stage_reqs.push({ id: randomUUID(), stage_id: sid, key: r.key, label: r.label, kind: r.kind ?? 'document', doc_type: r.doc_type ?? null, need: r.need ?? 'mandatory', condition_key: r.condition ?? null, upload: r.upload ?? (r.kind ?? 'document') === 'document', satisfied_at: r.satisfied_at ?? 'approved', student_visible: r.student_visible ?? (r.kind ?? 'document') === 'document', position: (j + 1) * 10, active: true, options: r.options ?? null, pass_options: r.pass ?? null, hint: 'STAFF-ONLY HINT' }));
    });
  }
  const app = (id: string, school: string | null, stage: string | null) => ({ application_id: id, name: 'Amara Okonkwo', email: `${id}@example.org`, school, programme: 'MSc Marketing', status: 'Offer Received', country: 'Nigeria', interview: null, submitted_at: T(30), student_key: id, counselor: 'Mr Test', payment: null, workspace: 'uk', stage_key: stage, stage_at: stage ? T(4) : null, stage_by: 'c@x.org', preferred_name: null });
  DB.portal_applications = [app('a1', 'Regent College London (RCL)', 'student_documents_pending'), app('a2', 'Regent College London (RCL)', null), app('a3', 'Some Other College', null)];
  DB.portal_documents = []; DB.portal_doc_scans = []; DB.portal_app_flags = []; DB.portal_app_reqs = []; DB.portal_req_checks = []; DB.portal_stage_history = []; DB.portal_workspaces = [{ key: 'uk', name: 'the UK', brief: null }]; DB.portal_brain_notes = []; DB.portal_brain_docs = []; DB.portal_student_msgs = []; DB.portal_student_memory = [];
}
const reqId = (stageKey: string, key: string) => {
  const wf = DB.portal_workflows.find((w) => w.school_key === 'rcl')!, st = DB.portal_stages.find((s) => s.workflow_id === wf.id && s.key === stageKey)!;
  return DB.portal_stage_reqs.find((r) => r.stage_id === st.id && r.key === key)!.id as string;
};

(async () => {
  seed();
  const server = await startMock(DB, 54396);
  const { brainContext } = await import('../../src/lib/brain');

  DB.portal_documents.push({ drive_file_id: 'f1', application_id: 'a1', name: 'bank.pdf', doc_type: 'Other', type_override: 'Bank statement', created_at: T(2) });
  DB.portal_req_checks.push({ id: randomUUID(), application_id: 'a1', req_id: reqId('student_documents_pending', 'signed_payment_plan'), app_req_id: null, state: 'approved', doc_id: null, value: null, note: 'INTERNAL: checked against bank records', checked_by: 'reviewer@x.org', checked_at: T(1) });
  DB.portal_req_checks.push({ id: randomUUID(), application_id: 'a1', req_id: reqId('student_documents_pending', 'tb_certificate'), app_req_id: null, state: 'rejected', doc_id: null, value: null, note: 'INTERNAL: looks edited', checked_by: 'reviewer@x.org', checked_at: T(1) });
  DB.portal_app_flags.push({ application_id: 'a1', flag: 'cond:tb_required', enabled: true });

  const ctx: any = await brainContext('a1');
  ok(ctx && ctx.stage, 'the Brain now has applicationStage');
  const s = ctx.stage;
  eq(s.school, 'Regent College London (RCL)', 'stage: the school workflow'); eq(s.currentStage, 'Student Documents Pending', 'stage: current stage'); eq(s.started, true, 'stage: started');
  eq(s.whatThisStageMeans, STUDENT_NOTES.student_documents_pending, 'stage: what it means, in the words the student reads'); eq(s.nextStage, 'CAS Requested', 'stage: the next stage');
  ok(s.stageNumber >= 8 && s.ofStages >= 13, 'stage: where in the route'); eq(s.daysAtThisStage, 4, 'stage: days at this stage');
  ok(Array.isArray(s.allStagesInOrder) && s.allStagesInOrder[0] === 'Offer Received' && s.allStagesInOrder.at(-1) === 'Enrolment', 'stage: the whole route in order');
  const doc = (n: string) => s.documentsAskedAtThisStage.find((d: any) => d.document === n);
  eq(doc('Bank statement').state, 'received, being checked', 'docs: an uploaded file is "being checked"'); eq(doc('Signed payment plan').state, 'done', 'docs: approved is done');
  eq(doc('TB test certificate').state, 'a new copy is needed', 'docs: a rejected one needs a new copy'); eq(doc('Tuition fee payment receipt').state, 'still needed', 'docs: a missing one is still needed');
  eq(s.studentEmailedAboutThisStage, false, 'stage: not emailed yet');
  eq(ctx.facts.pipelineStatus, 'Offer Received', 'the old pipeline status is still there, now clearly named'); ok(!('stage' in ctx.facts), 'and no longer called "stage", so the two are not confused');

  // it follows what the team does
  DB.portal_stage_history.push({ id: 'h1', application_id: 'a1', from_key: null, from_name: null, to_key: 'student_documents_pending', to_name: 'Student Documents Pending', kind: 'move', actor: 'c@x.org', note: null, moved_at: T(4), inform_state: 'sent', informed_at: T(3), informed_by: 'c@x.org' });
  eq((await brainContext('a1') as any).stage.studentEmailedAboutThisStage, true, 'stage: knows once the student was emailed');
  DB.portal_applications[0].stage_key = 'cas_requested'; DB.portal_applications[0].stage_at = T(1);
  const moved: any = (await brainContext('a1') as any).stage;
  eq(moved.currentStage, 'CAS Requested', 'stage: follows a move'); eq(moved.studentEmailedAboutThisStage, false, 'stage: a new stage has not been emailed about');

  // nothing staff-only, and no personal details, reach the model
  const sent = JSON.stringify({ stage: ctx.stage, facts: ctx.facts, chat: ctx.chat, memory: ctx.memory });
  ok(!sent.includes('STAFF-ONLY HINT') && !sent.includes('INTERNAL') && !sent.includes('reviewer@x.org') && !sent.includes('c@x.org'), 'privacy: no staff hints, review comments or staff emails');
  ok(!sent.includes('Amara') && !sent.includes('Okonkwo') && !sent.includes('a1@example.org'), 'privacy: no name or email');

  // not started, no workflow
  const fresh: any = await brainContext('a2'); eq(fresh.stage.started, false, 'not started: says so'); eq(fresh.stage.currentStage, null, 'not started: no current stage'); eq(fresh.stage.documentsAskedAtThisStage, [], 'not started: nothing asked'); ok(fresh.stage.allStagesInOrder.length >= 13, 'not started: the route is still known');
  eq((await brainContext('a3') as any).stage, null, 'a school with no workflow: null, so the Brain does not name a stage');

  server.close();
  console.log(`${pass} checks passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
