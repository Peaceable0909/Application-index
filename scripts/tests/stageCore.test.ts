// Run with: npx tsx scripts/tests/stageCore.test.ts  (uses the in-memory database in mockdb.ts, no real database)
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { startMock, type Rows } from './mockdb';
import { WORKFLOW_TEMPLATES } from '../../src/lib/stageTemplates';
import * as C from '../../src/lib/stageCore';
import { loadAppState, loadHistory, workflowFor, loadWorkflows } from '../../src/lib/stages';
import { readiness, studentAsks } from '../../src/lib/stageEngine';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const DB: Rows = {};
function seed() {
  DB.portal_workflows = []; DB.portal_stages = []; DB.portal_stage_reqs = [];
  for (const t of WORKFLOW_TEMPLATES) {
    const wid = randomUUID();
    DB.portal_workflows.push({ id: wid, workspace: 'uk', school_key: t.school_key, school_name: t.school_name, active: true, override_roles: ['admin'], conditions: t.conditions });
    t.stages.forEach((s, i) => {
      const sid = randomUUID();
      DB.portal_stages.push({ id: sid, workflow_id: wid, key: s.key, name: s.name, position: (i + 1) * 10, active: true, conditional: !!s.conditional, maps_status: s.maps ?? null, move_roles: s.roles ?? ['admin', 'staff', 'counselor'], complete_when: s.complete ?? 'manual', notify: s.notify ?? 'counselor', delay_days: s.delay ?? null, offer_sync: s.offer ?? null, hint: s.hint ?? null });
      (s.reqs || []).forEach((r, j) => DB.portal_stage_reqs.push({ id: randomUUID(), stage_id: sid, key: r.key, label: r.label, kind: r.kind ?? 'document', doc_type: r.doc_type ?? null, need: r.need ?? 'mandatory', condition_key: r.condition ?? null, upload: r.upload ?? (r.kind ?? 'document') === 'document', satisfied_at: r.satisfied_at ?? 'approved', student_visible: r.student_visible ?? (r.kind ?? 'document') === 'document', position: (j + 1) * 10, active: true, options: r.options ?? null, pass_options: r.pass ?? null, hint: r.hint ?? null }));
    });
  }
  const app = (id: string, school: string | null, extra: Record<string, unknown> = {}) => ({ application_id: id, name: `Student ${id}`, email: `${id}@example.org`, school, workspace: 'uk', status: 'Submitted', counselor: 'Mr Test', stage_key: null, stage_at: null, student_key: `${id}|k`, ...extra });
  DB.portal_applications = [app('rcl1', 'Regent College London (RCL)'), app('cccu1', 'Canterbury Christ Church University (CCCU)'), app('bpp1', 'BPP University'), app('ysj1', 'York St John University'), app('none1', null), app('other1', 'Some Other College')];
  DB.portal_documents = []; DB.portal_app_flags = []; DB.portal_app_reqs = []; DB.portal_req_checks = []; DB.portal_stage_history = []; DB.portal_activity = []; DB.portal_offers = [];
}
const doc = (app: string, id: string, type: string, name = `${type}.pdf`) => DB.portal_documents.push({ drive_file_id: id, application_id: app, name, doc_type: type === 'Bank statement' ? 'Other' : type, type_override: type === 'Bank statement' || !['Passport', 'Transcript', 'Degree Certificate', 'Offer Letter'].includes(type) ? type : null, created_at: new Date().toISOString() });
const row = (t: string, f: (r: Record<string, unknown>) => boolean) => DB[t].find(f);
const appRow = (id: string) => DB.portal_applications.find((a) => a.application_id === id)!;

(async () => {
  seed();
  const server = await startMock(DB, 54399);
  const db = createClient('http://127.0.0.1:54399', 'x', { auth: { persistSession: false } }) as never;
  const counselor = { email: 'c@x.org', role: 'counselor' as const }, admin = { email: 'a@x.org', role: 'admin' as const }, staff = { email: 's@x.org', role: 'staff' as const };

  // ---- workflow lookup is per school ----
  eq((await workflowFor(db, 'uk', 'Regent College London (RCL)'))?.school_key, 'rcl', 'lookup: RCL full name');
  eq((await workflowFor(db, 'uk', 'RCL'))?.school_key, 'rcl', 'lookup: RCL short name');
  eq((await workflowFor(db, 'uk', 'Canterbury Christ Church University (CCCU)'))?.stages.length, 14, 'lookup: CCCU has 14 stages');
  eq((await workflowFor(db, 'uk', 'BPP University'))?.stages.length, 12, 'lookup: BPP has 12 stages');
  eq((await workflowFor(db, 'uk', 'York St John University'))?.stages.length, 12, 'lookup: YSJ has 12 stages');
  eq(await workflowFor(db, 'uk', 'Some Other College'), null, 'lookup: a school with no workflow');
  eq(await workflowFor(db, 'canada', 'RCL'), null, 'lookup: another workspace does not see the UK workflows');
  let r: any = await C.moveApplication(db, { appId: 'none1', toKey: 'offer_received', mover: counselor });
  ok(!r.ok && /school/i.test(r.error), 'no school: refuses and explains');
  r = await C.moveApplication(db, { appId: 'other1', toKey: 'offer_received', mover: counselor });
  ok(!r.ok && /no stage workflow/i.test(r.error), 'unknown school: explains there is no workflow');

  // ---- RCL end to end ----
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'offer_received', mover: counselor });
  ok(r.ok, 'rcl: first stage'); eq(appRow('rcl1').stage_key, 'offer_received', 'rcl: stage saved'); eq(appRow('rcl1').status, 'Offer Received', 'rcl: status follows the stage');
  eq(DB.portal_stage_history.length, 1, 'rcl: history row'); eq(DB.portal_stage_history[0].to_name, 'Offer Received', 'rcl: history names the stage'); eq(DB.portal_stage_history[0].actor, 'c@x.org', 'rcl: history names the person');
  ok(DB.portal_activity.some((a) => a.kind === 'stage_change') && DB.portal_activity.some((a) => a.kind === 'status_change'), 'rcl: activity timeline updated');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'interview_to_be_booked', mover: counselor }); ok(r.ok, 'rcl: to interview to be booked');
  eq(appRow('rcl1').status, 'Offer Received', 'rcl: a stage with no mapped status leaves the status alone');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'interview_passed', mover: counselor });
  ok(!r.ok && r.check?.blockers.some((b: any) => b.label === 'Interview outcome'), 'rcl: refuses without an interview outcome and says so'); eq(appRow('rcl1').stage_key, 'interview_to_be_booked', 'rcl: refused move changes nothing');
  const wf = (await workflowFor(db, 'uk', 'RCL'))!;
  const outcomeRef = `std:${wf.stages.find((s) => s.key === 'interview_to_be_booked')!.reqs[0].id}`;
  r = await C.setCheck(db, { appId: 'rcl1', ref: outcomeRef, mover: counselor, value: 'Maybe' }); ok(!r.ok, 'rcl: an outcome must be one of the choices');
  r = await C.setCheck(db, { appId: 'rcl1', ref: outcomeRef, mover: counselor, value: 'Failed' }); ok(r.ok, 'rcl: record a failed outcome');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'interview_passed', mover: counselor }); ok(!r.ok, 'rcl: a failed interview does not pass');
  r = await C.setCheck(db, { appId: 'rcl1', ref: outcomeRef, mover: counselor, value: 'Passed' }); ok(r.ok, 'rcl: record a passed outcome (updates the same row)');
  eq(DB.portal_req_checks.length, 1, 'rcl: one check row, updated in place');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'interview_passed', mover: counselor }); ok(r.ok, 'rcl: now it moves'); eq(appRow('rcl1').status, 'Interview Passed', 'rcl: status Interview Passed');
  // jump over many stages
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_requested', mover: counselor });
  ok(!r.ok && !r.check.canOverride && r.check.blockers.length >= 5, 'rcl: a jump is refused and lists what is open'); ok(/cannot move on/.test(r.error), 'rcl: counselor is told it cannot move on');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_requested', mover: admin });
  ok(!r.ok && r.check.canOverride, 'rcl: admin is offered an override');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_requested', mover: admin, override: 'ok' }); ok(!r.ok && /reason/.test(r.error), 'rcl: override needs a proper reason');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_requested', mover: counselor, override: 'I am sure about this one' }); ok(!r.ok, 'rcl: a counselor cannot override even with a reason');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_requested', mover: admin, override: 'Plan agreed in person with the school, paperwork follows' });
  ok(r.ok && r.kind === 'override' && r.missing.length >= 5, 'rcl: admin override works and records what was open');
  eq(appRow('rcl1').status, 'CAS Applied', 'rcl: CAS Requested stands for CAS Applied');
  const hist = await loadHistory(db, 'rcl1'); eq(hist[0].kind, 'override', 'rcl: history marks the override'); ok((hist[0].missing || []).length >= 5 && /agreed in person/.test(hist[0].note || ''), 'rcl: history keeps the reason and the open items');
  eq(DB.portal_offers[0].cas_status, 'Requested', 'rcl: offer tab follows (CAS requested)'); ok(!!DB.portal_offers[0].cas_applied_date, 'rcl: CAS applied date set');
  // backwards
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'payment_plan_sent', mover: counselor }); ok(!r.ok && /note/.test(r.error), 'rcl: going back needs a note');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'payment_plan_sent', mover: counselor, note: 'School reopened the payment plan' }); ok(r.ok, 'rcl: going back with a note works');
  // same stage
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'payment_plan_sent', mover: counselor }); ok(!r.ok, 'rcl: moving to the same stage is refused');

  // ---- documents: student documents pending ----
  r = await C.placeApplication(db, { appId: 'rcl1', toKey: 'student_documents_pending', mover: staff, note: 'Test' }); ok(r.ok, 'rcl: place without validation');
  let st = await loadAppState(db, 'rcl1', wf); let rd = readiness(wf, st);
  eq(rd.blockers.map((b) => b.label).sort(), ['Bank statement', 'Signed payment plan', 'Tuition fee payment receipt'], 'rcl: checklist without TB');
  const ref = (key: string) => { const s = wf.stages.find((x) => x.key === 'student_documents_pending')!; return `std:${s.reqs.find((q) => q.key === key)!.id}`; };
  r = await C.setCheck(db, { appId: 'rcl1', ref: ref('bank_statement'), mover: counselor, state: 'approved' }); ok(!r.ok && /no file/i.test(r.error), 'rcl: cannot approve a document nobody uploaded');
  doc('rcl1', 'f-bank', 'Bank statement'); doc('rcl1', 'f-rcpt', 'Tuition fee payment receipt'); doc('rcl1', 'f-plan', 'Signed payment plan');
  st = await loadAppState(db, 'rcl1', wf); rd = readiness(wf, st); eq(rd.blockers.length, 3, 'rcl: uploads alone still block'); ok(rd.blockers.every((b) => b.status === 'uploaded'), 'rcl: all three show as uploaded');
  r = await C.setCheck(db, { appId: 'rcl1', ref: ref('bank_statement'), mover: counselor, state: 'rejected' }); ok(!r.ok, 'rcl: a rejection needs a reason');
  r = await C.setCheck(db, { appId: 'rcl1', ref: ref('bank_statement'), mover: counselor, state: 'rejected', note: 'Statement is older than 28 days' }); ok(r.ok, 'rcl: reject with a reason');
  st = await loadAppState(db, 'rcl1', wf); eq(readiness(wf, st).blockers.find((b) => b.label === 'Bank statement')!.status, 'rejected', 'rcl: shown as rejected');
  for (const k of ['bank_statement', 'tuition_receipt', 'signed_payment_plan']) { r = await C.setCheck(db, { appId: 'rcl1', ref: ref(k), mover: counselor, state: k === 'bank_statement' ? 'reviewed' : 'approved' }); ok(r.ok, `rcl: ${k} reviewed/approved`); }
  st = await loadAppState(db, 'rcl1', wf); eq(readiness(wf, st).blockers.map((b) => b.label), ['Bank statement'], 'rcl: reviewed is not approved');
  r = await C.setCheck(db, { appId: 'rcl1', ref: ref('bank_statement'), mover: counselor, state: 'approved' }); ok(r.ok, 'rcl: bank statement approved');
  ok(r.becameReady && r.becameReady.next?.key === 'cas_requested', 'rcl: finishing the checklist tells the counselor the next stage is ready');
  // a conditional circumstance
  r = await C.setFlag(db, { appId: 'rcl1', flag: 'cond:tb_required', enabled: true, by: 'c@x.org' }); ok(r.ok, 'rcl: switch TB on');
  st = await loadAppState(db, 'rcl1', wf); ok(readiness(wf, st).blockers.some((b) => b.label === 'TB test certificate'), 'rcl: TB certificate now required');
  r = await C.setFlag(db, { appId: 'rcl1', flag: 'cond:nonsense', enabled: true, by: 'c@x.org' }); ok(!r.ok, 'rcl: an unknown circumstance is refused');
  r = await C.setFlag(db, { appId: 'rcl1', flag: 'stage:cas_requested', enabled: true, by: 'c@x.org' }); ok(!r.ok, 'rcl: a normal stage cannot be switched');
  r = await C.setFlag(db, { appId: 'rcl1', flag: 'cond:tb_required', enabled: false, by: 'c@x.org' }); ok(r.ok, 'rcl: switch TB off again');
  // conditional stage chosen in the panel
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_requested', mover: counselor, enable: ['pending_documents'] }); ok(r.ok, 'rcl: move on with a conditional stage switched on');
  ok(DB.portal_app_flags.some((f) => f.flag === 'stage:pending_documents' && f.enabled === true), 'rcl: the switch was saved');
  r = await C.setFlag(db, { appId: 'rcl1', flag: 'stage:pending_documents', enabled: false, by: 'c@x.org' }); ok(r.ok, 'rcl: can switch the conditional stage off while not in it');
  // role restriction stored in the database
  DB.portal_stages.find((s) => s.key === 'cas_received' && s.workflow_id === wf.id)!.move_roles = ['admin'];
  const casReceived = wf.stages.find((s) => s.key === 'cas_received')!;
  r = await C.setCheck(db, { appId: 'rcl1', ref: `std:${wf.stages.find((s) => s.key === 'cas_requested')!.reqs[0].id}`, mover: counselor, state: 'approved' }); ok(r.ok, 'rcl: confirm the CAS request');
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_received', mover: counselor }); ok(!r.ok && /not allowed/.test(r.error), 'rcl: an admin-only stage refuses a counselor'); void casReceived;
  r = await C.moveApplication(db, { appId: 'rcl1', toKey: 'cas_received', mover: admin }); ok(r.ok, 'rcl: and accepts an admin');
  eq(appRow('rcl1').status, 'CAS Received', 'rcl: status CAS Received'); eq(DB.portal_offers[0].cas_status, 'Received', 'rcl: offer tab says CAS received');

  // ---- CCCU ----
  r = await C.moveApplication(db, { appId: 'cccu1', toKey: 'offer_received', mover: counselor }); ok(r.ok, 'cccu: start');
  const cw = (await workflowFor(db, 'uk', 'CCCU'))!;
  r = await C.moveApplication(db, { appId: 'cccu1', toKey: 'first_interview', mover: counselor }); ok(r.ok, 'cccu: first interview');
  eq(appRow('cccu1').status, 'Interview Taken', 'cccu: Interview Taken');
  r = await C.setCheck(db, { appId: 'cccu1', ref: `std:${cw.stages.find((s) => s.key === 'first_interview')!.reqs[0].id}`, mover: counselor, value: 'Passed' }); ok(r.ok, 'cccu: outcome');
  r = await C.moveApplication(db, { appId: 'cccu1', toKey: 'documents_for_unconditional_offer', mover: counselor }); ok(r.ok, 'cccu: documents stage');
  r = await C.moveApplication(db, { appId: 'cccu1', toKey: 'unconditional_offer_requested', mover: counselor }); ok(!r.ok && r.check.blockers.length === 3, 'cccu: three documents block the unconditional offer request');
  doc('cccu1', 'c-pass', 'Passport'); doc('cccu1', 'c-deg', 'Degree Certificate'); doc('cccu1', 'c-tr', 'Transcript');
  const dst = cw.stages.find((s) => s.key === 'documents_for_unconditional_offer')!;
  for (const k of ['passport', 'degree_certificate', 'transcript']) { r = await C.setCheck(db, { appId: 'cccu1', ref: `std:${dst.reqs.find((q) => q.key === k)!.id}`, mover: counselor, state: 'approved' }); ok(r.ok, `cccu: ${k} approved`); }
  r = await C.moveApplication(db, { appId: 'cccu1', toKey: 'unconditional_offer_requested', mover: counselor }); ok(r.ok, 'cccu: verified documents let the request go');
  // the RCL workflow was not touched by any of it
  ok(DB.portal_stages.filter((s) => s.workflow_id === wf.id).length === 15 && DB.portal_stages.filter((s) => s.workflow_id === cw.id).length === 14, 'isolation: stage counts per school unchanged');

  // ---- BPP ----
  r = await C.moveApplication(db, { appId: 'bpp1', toKey: 'documents_sent', mover: counselor }); ok(r.ok, 'bpp: starts at documents sent'); eq(appRow('bpp1').status, 'Submitted', 'bpp: status unchanged (already Submitted)');
  const bw = (await workflowFor(db, 'uk', 'BPP'))!;
  r = await C.placeApplication(db, { appId: 'bpp1', toKey: 'bank_statement_review', mover: staff }); ok(r.ok, 'bpp: placed at bank statement review');
  doc('bpp1', 'b-bank', 'Bank statement');
  const bs = bw.stages.find((s) => s.key === 'bank_statement_review')!;
  r = await C.setCheck(db, { appId: 'bpp1', ref: `std:${bs.reqs.find((q) => q.key === 'bank_statement')!.id}`, mover: counselor, state: 'approved' }); ok(r.ok, 'bpp: statement approved');
  r = await C.moveApplication(db, { appId: 'bpp1', toKey: 'application_form_completed', mover: counselor }); ok(!r.ok && r.check.blockers.length === 1, 'bpp: financial check still open');
  r = await C.setCheck(db, { appId: 'bpp1', ref: `std:${bs.reqs.find((q) => q.key === 'funds_verified')!.id}`, mover: counselor, state: 'approved' }); ok(r.ok, 'bpp: funds verified');
  r = await C.moveApplication(db, { appId: 'bpp1', toKey: 'application_form_completed', mover: counselor }); ok(r.ok, 'bpp: moves on');

  // ---- YSJ: extra requirement for one applicant and the shared workflow ----
  const yw = (await workflowFor(db, 'uk', 'York St John University'))!;
  r = await C.placeApplication(db, { appId: 'ysj1', toKey: 'interview_passed', mover: staff }); ok(r.ok, 'ysj: placed');
  r = await C.addExtraReq(db, { appId: 'ysj1', stageKey: 'interview_passed', label: 'Portfolio of work', kind: 'document', need: 'mandatory', satisfiedAt: 'approved', by: 'c@x.org' }); ok(r.ok, 'ysj: extra requirement added for this applicant');
  st = await loadAppState(db, 'ysj1', yw); ok(readiness(yw, st).blockers.some((b) => b.label === 'Portfolio of work'), 'ysj: it blocks this applicant');
  ok(!(readiness(yw, { ...(await loadAppState(db, 'ysj1', yw)), extras: [] }).blockers.some((b) => b.label === 'Portfolio of work')), 'ysj: workflow itself is unchanged');
  ok(studentAsks(yw, st).some((a) => a.label === 'Portfolio of work'), 'ysj: the student is asked for it');
  r = await C.removeExtraReq(db, { appId: 'ysj1', id: DB.portal_app_reqs[0].id as string, by: 'c@x.org' }); ok(r.ok && DB.portal_app_reqs.length === 0, 'ysj: extra requirement removed');
  // cannot touch another application's extra requirement
  r = await C.addExtraReq(db, { appId: 'ysj1', stageKey: 'interview_passed', label: 'Writing sample', kind: 'document', need: 'optional', satisfiedAt: 'approved', by: 'c@x.org' });
  const other = await C.removeExtraReq(db, { appId: 'rcl1', id: DB.portal_app_reqs[0].id as string, by: 'c@x.org' }); ok(!other.ok, 'ysj: an extra requirement cannot be removed through another application');

  // ---- school change resets the stage ----
  await C.resetStage(db, 'rcl1', 'staff@x.org', 'School changed from RCL to BPP'); eq(appRow('rcl1').stage_key, null, 'school change: stage cleared'); ok((await loadHistory(db, 'rcl1')).some((h) => h.kind === 'school_changed'), 'school change: history keeps it');
  const nw = await loadWorkflows(db, 'uk'); eq(nw.map((w) => w.school_key).sort(), ['bpp', 'cccu', 'rcl', 'ysj'], 'workflows listed');

  server.close();
  console.log(`${pass} checks passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
