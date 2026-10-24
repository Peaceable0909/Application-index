// Run with: npx tsx scripts/tests/stageEngine.test.ts  (no database needed)
import { WORKFLOW_TEMPLATES, workflowFromTemplate } from '../../src/lib/stageTemplates';
import * as E from '../../src/lib/stageEngine';
import type { AppState, Check, Doc, ExtraReq, Workflow } from '../../src/lib/stageEngine';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = <T,>(a: T, b: T, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const WF = Object.fromEntries(WORKFLOW_TEMPLATES.map((t) => [t.school_key, workflowFromTemplate(t)])) as Record<string, Workflow>;
const T0 = '2026-10-01T10:00:00Z', T1 = '2026-10-02T10:00:00Z', T2 = '2026-10-03T10:00:00Z', T3 = '2026-10-04T10:00:00Z';
const blank = (stage: string | null = null): AppState => ({ stage_key: stage, stage_at: T0, flags: {}, extras: [], checks: [], docs: [] });
const doc = (id: string, type: string, at = T1): Doc => ({ id, type, name: `${type}.pdf`, created_at: at });
const reqOf = (wf: Workflow, stage: string, key: string) => wf.stages.find((s) => s.key === stage)!.reqs.find((r) => r.key === key)!;
const chk = (wf: Workflow, stage: string, key: string, state: Check['state'], extra: Partial<Check> = {}): Check => ({ ref: E.refOf(reqOf(wf, stage, key), false), state, doc_id: null, value: null, note: null, by: 'x', at: T2, ...extra });
const outcome = (wf: Workflow, stage: string, v: string): Check => chk(wf, stage, 'interview_outcome', 'approved', { value: v });
const labels = (xs: E.ReqEval[]) => xs.map((x) => x.label);
const move = (wf: Workflow, st: AppState, to: string, role: E.Role = 'counselor') => E.checkMove(wf, st, to, { role });

// ---------- shape of every workflow ----------
const expected: Record<string, string[]> = {
  rcl: ['Offer Received', 'Interview to Be Booked', 'Interview Passed', 'Tuition Fee Stage', 'Payment Plan Sent', 'QC Form Sent', 'Payment Plan Signed', 'Tuition Fee Payment Required', 'Student Documents Pending', 'CAS Requested', 'Pending Documents', 'CAS Received', 'Visa Application', 'Visa Decision', 'Enrolment'],
  cccu: ['Offer Received', 'First Interview', 'Documents Required for Unconditional Offer', 'Unconditional Offer Requested', 'Unconditional Offer Received', 'Pre-CAS Interview', 'Pre-CAS Interview Passed', 'CAS Requested', 'CAS Received', 'Visa Application Started', 'Visa Application Submitted', 'Awaiting Visa Decision', 'Visa Decision Received', 'Enrolment'],
  bpp: ['Documents Sent', 'Offer Received', 'Bank Statement Review', 'Application Form Completed', 'CAS Documents Ready', 'CAS Requested', 'Awaiting Pre-CAS Interview', 'Pre-CAS Interview Completed', 'CAS Received', 'Visa Application Submitted', 'Awaiting Visa Decision', 'Enrolment'],
  ysj: ['Offer Received', 'Interview Pending', 'Interview Passed', 'Unconditional Offer Requested', 'Unconditional Offer Received', 'CAS Requested', 'CAS Sent', 'CAS Received', 'Visa Application Started', 'Visa Application Submitted', 'Awaiting Visa Decision', 'Enrolment'],
};
for (const k of Object.keys(expected)) {
  eq(WF[k].stages.map((s) => s.name), expected[k], `${k} stage list and order`);
  const keys = WF[k].stages.map((s) => s.key); ok(new Set(keys).size === keys.length, `${k} stage keys are unique`);
  const positions = WF[k].stages.map((s) => s.position); ok(positions.every((p, i) => i === 0 || p > positions[i - 1]), `${k} positions rise`);
}
ok(WF.rcl.stages.find((s) => s.key === 'tuition_fee_stage')!.conditional && WF.rcl.stages.find((s) => s.key === 'pending_documents')!.conditional, 'rcl: tuition fee stage and pending documents are conditional');
ok(!E.stageApplies(WF.rcl.stages.find((s) => s.key === 'tuition_fee_stage')!, {}), 'conditional stage is off by default');

// ---------- RCL ----------
{
  const wf = WF.rcl;
  eq(E.nextStage(wf, null, {})?.key, 'offer_received', 'rcl: first stage for a new application');
  ok(move(wf, blank(null), 'offer_received').ok, 'rcl: placing a new application in Offer Received is allowed');
  eq(E.nextStage(wf, 'offer_received', {})?.key, 'interview_to_be_booked', 'rcl: after offer');
  ok(move(wf, blank('offer_received'), 'interview_to_be_booked').ok, 'rcl: offer letter is optional, so the move is allowed without it');
  // interview outcome gates "Interview Passed"
  let st = blank('interview_to_be_booked');
  let m = move(wf, st, 'interview_passed');
  ok(!m.ok && labels(m.blockers).includes('Interview outcome'), 'rcl: blocked until an interview outcome is recorded');
  st = { ...st, checks: [outcome(wf, 'interview_to_be_booked', 'Failed')] };
  m = move(wf, st, 'interview_passed'); ok(!m.ok, 'rcl: a failed interview does not let the application pass');
  eq(E.readiness(wf, st).reqs[0].status, 'failed', 'rcl: failed outcome status');
  st = { ...st, checks: [outcome(wf, 'interview_to_be_booked', 'Passed')] };
  ok(move(wf, st, 'interview_passed').ok, 'rcl: a passed interview lets it move on');
  // conditional tuition fee stage
  eq(E.nextStage(wf, 'interview_passed', {})?.key, 'payment_plan_sent', 'rcl: tuition fee stage skipped by default');
  eq(E.nextStage(wf, 'interview_passed', { 'stage:tuition_fee_stage': true })?.key, 'tuition_fee_stage', 'rcl: tuition fee stage included when enabled');
  m = move(wf, blank('interview_passed'), 'tuition_fee_stage'); ok(m.ok && m.enablesTarget, 'rcl: moving straight into a conditional stage switches it on');
  const withFee = { ...blank('tuition_fee_stage'), flags: { 'stage:tuition_fee_stage': true } };
  ok(!move(wf, withFee, 'payment_plan_sent').ok, 'rcl: tuition arrangement must be confirmed when the stage is on');
  // payment steps are confirmations
  ok(!move(wf, blank('payment_plan_signed'), 'tuition_fee_payment_required').ok, 'rcl: signed plan must be confirmed');
  ok(move(wf, { ...blank('payment_plan_signed'), checks: [chk(wf, 'payment_plan_signed', 'plan_signed', 'approved')] }, 'tuition_fee_payment_required').ok, 'rcl: confirmed plan lets it move');
  // student documents pending
  st = blank('student_documents_pending');
  let r = E.readiness(wf, st);
  eq(labels(r.blockers).sort(), ['Bank statement', 'Signed payment plan', 'Tuition fee payment receipt'].sort(), 'rcl: documents checklist without TB');
  r = E.readiness(wf, { ...st, flags: { 'cond:tb_required': true } });
  ok(labels(r.blockers).includes('TB test certificate'), 'rcl: TB certificate joins the checklist when the applicant needs it');
  // upload is not enough
  const docs = [doc('d1', 'Other'), doc('d2', 'Bank statement'), doc('d3', 'Tuition fee payment receipt'), doc('d4', 'Signed payment plan')];
  st = { ...blank('student_documents_pending'), docs };
  r = E.readiness(wf, st);
  eq(r.blockers.length, 3, 'rcl: uploaded documents still block until approved');
  ok(r.reqs.filter((x) => x.docType).every((x) => x.status === 'uploaded' || x.status === 'missing'), 'rcl: uploaded status');
  ok(/still to be (reviewed and )?approved/i.test(r.blockers[0].why || ''), 'rcl: why says it still needs approval');
  m = move(wf, st, 'cas_requested'); ok(!m.ok && m.canOverride === false, 'rcl: counselor cannot override');
  m = move(wf, st, 'cas_requested', 'admin'); ok(!m.ok && m.canOverride, 'rcl: admin can override a blocked move');
  // approve all three
  const approved = ['bank_statement', 'tuition_receipt', 'signed_payment_plan'].map((k, i) => chk(wf, 'student_documents_pending', k, 'approved', { doc_id: ['d2', 'd3', 'd4'][i], at: T2 }));
  st = { ...st, checks: approved };
  r = E.readiness(wf, st); ok(r.complete && r.ready && r.next?.key === 'cas_requested', 'rcl: ready for CAS Requested once documents are approved');
  ok(move(wf, st, 'cas_requested').ok, 'rcl: approved documents let the application move to CAS Requested');
  // rejected
  st = { ...st, checks: [chk(wf, 'student_documents_pending', 'bank_statement', 'rejected', { doc_id: 'd2', note: 'Blurry', at: T2 }), ...approved.slice(1)] };
  r = E.readiness(wf, st); eq(labels(r.blockers), ['Bank statement'], 'rcl: rejected document blocks');
  ok(/Blurry/.test(r.blockers[0].why || ''), 'rcl: rejection reason is shown');
  // a new file after the rejection goes back to "uploaded", still blocking
  st = { ...st, docs: [...docs, doc('d5', 'Bank statement', T3)] };
  r = E.readiness(wf, st); eq(r.blockers[0].status, 'uploaded', 'rcl: a new file after rejection resets to uploaded');
  // approved then replaced
  const st2 = { ...blank('student_documents_pending'), docs: [...docs, doc('d6', 'Bank statement', T3)], checks: approved };
  eq(E.readiness(wf, st2).blockers.map((b) => b.label), ['Bank statement'], 'rcl: a file uploaded after approval needs review again');
  // tuition receipt stops being required when the payment stage is made conditional and left off
  const wf2: Workflow = JSON.parse(JSON.stringify(wf)); wf2.stages.find((s) => s.key === 'tuition_fee_payment_required')!.conditional = true;
  ok(!labels(E.readiness(wf2, blank('student_documents_pending')).blockers).includes('Tuition fee payment receipt'), 'rcl: receipt not required when tuition payment stage is off for the applicant');
  ok(labels(E.readiness(wf2, { ...blank('student_documents_pending'), flags: { 'stage:tuition_fee_payment_required': true } }).blockers).includes('Tuition fee payment receipt'), 'rcl: receipt required once tuition payment stage is on');
  // optional document never blocks
  ok(!E.readiness(wf, blank('student_documents_pending')).blockers.some((b) => b.label.startsWith('Any additional')), 'rcl: optional documents do not block');
  // jumping forward lists blockers of every stage on the way
  m = move(wf, blank('payment_plan_sent'), 'cas_requested');
  ok(!m.ok && m.skipped.length >= 3 && m.blockers.length >= 5, 'rcl: a long jump collects everything missing on the way');
  // backwards is always allowed
  m = move(wf, blank('cas_requested'), 'interview_passed'); ok(m.ok && m.direction === 'backward', 'rcl: moving back is allowed');
  // pending documents (conditional)
  eq(E.nextStage(wf, 'cas_requested', {})?.key, 'cas_received', 'rcl: pending documents skipped by default');
  eq(E.nextStage(wf, 'cas_requested', { 'stage:pending_documents': true })?.key, 'pending_documents', 'rcl: pending documents included when required');
  const pd = { ...blank('pending_documents'), flags: { 'stage:pending_documents': true }, docs: [doc('p1', 'Additional document')] };
  ok(!move(wf, { ...pd, checks: [chk(wf, 'pending_documents', 'school_requested_doc', 'approved', { doc_id: 'p1' })] }, 'cas_received').ok, 'rcl: school-requested document must be accepted by the school, approval is not enough');
  ok(move(wf, { ...pd, checks: [chk(wf, 'pending_documents', 'school_requested_doc', 'accepted', { doc_id: 'p1' })] }, 'cas_received').ok, 'rcl: accepted by the school satisfies it');
  // CAS received -> visa
  ok(!move(wf, blank('cas_received'), 'visa_application').ok, 'rcl: CAS statement needed before the visa stage');
  ok(move(wf, { ...blank('cas_received'), docs: [doc('c1', 'CAS statement')], checks: [chk(wf, 'cas_received', 'cas_statement', 'approved', { doc_id: 'c1' })] }, 'visa_application').ok, 'rcl: approved CAS statement lets it move');
  // visa requirements confirmed before submission
  ok(!move(wf, blank('visa_application'), 'visa_decision').ok, 'rcl: visa requirements must be confirmed before it is marked submitted');
  ok(move(wf, { ...blank('visa_application'), checks: [chk(wf, 'visa_application', 'visa_requirements', 'approved')] }, 'visa_decision').ok, 'rcl: confirmed visa requirements let it move');
  // progress
  const p = E.progress(wf, 'student_documents_pending', {}); eq([p.index, p.total], [8, 13], 'rcl: progress counts only the stages on this applicant’s route');
  const p2 = E.progress(wf, 'student_documents_pending', { 'stage:tuition_fee_stage': true, 'stage:pending_documents': true }); eq([p2.index, p2.total], [9, 15], 'rcl: progress with conditional stages on');
  // delay
  const stg = wf.stages.find((s) => s.key === 'payment_plan_sent')!;
  eq(E.delayedDays(stg, '2026-10-01T00:00:00Z', Date.parse('2026-10-20T00:00:00Z')), 12, 'rcl: 19 days in a 7-day stage is 12 days late');
  eq(E.delayedDays(stg, '2026-10-01T00:00:00Z', Date.parse('2026-10-05T00:00:00Z')), 0, 'rcl: not late inside the allowance');
  // role limits on a stage
  const wf3: Workflow = JSON.parse(JSON.stringify(wf)); wf3.stages.find((s) => s.key === 'cas_received')!.move_roles = ['admin'];
  m = move(wf3, { ...blank('cas_requested') }, 'cas_received', 'counselor'); ok(m.roleBlocked && !m.ok && !m.canOverride, 'rcl: a stage limited to admins blocks a counselor, with no override');
  ok(move(wf3, { ...blank('cas_requested'), checks: [chk(wf3, 'cas_requested', 'cas_request_sent', 'approved')] }, 'cas_received', 'admin').ok, 'rcl: admin may enter an admin-only stage');
  // student asks
  const asks = E.studentAsks(wf, { ...blank('student_documents_pending'), docs: [doc('d2', 'Bank statement')] }).map((a) => a.label);
  ok(asks.includes('Signed payment plan') && !asks.includes('Any additional document the school asks for'), 'rcl: the student is asked for missing mandatory documents only');
  // placement from an existing status
  eq(E.suggestPlacement(wf, 'Interview Passed')?.key, 'interview_passed', 'rcl: placement from status');
  eq(E.suggestPlacement(wf, 'CAS Received')?.key, 'cas_received', 'rcl: placement from status CAS Received');
  eq(E.suggestPlacement(wf, 'Submitted'), null, 'rcl: a pre-offer status has no stage yet');
}

// ---------- CCCU ----------
{
  const wf = WF.cccu;
  ok(!move(wf, blank('first_interview'), 'documents_for_unconditional_offer').ok, 'cccu: first interview outcome needed');
  ok(move(wf, { ...blank('first_interview'), checks: [chk(wf, 'first_interview', 'interview_outcome', 'approved', { value: 'Passed' })] }, 'documents_for_unconditional_offer').ok, 'cccu: passed first interview moves on');
  let st = blank('documents_for_unconditional_offer');
  eq(labels(E.readiness(wf, st).blockers).sort(), ['Degree certificate', 'Passport', 'Transcript'], 'cccu: documents needed before the unconditional offer is requested');
  const docs = [doc('a', 'Passport'), doc('b', 'Degree Certificate'), doc('c', 'Transcript')];
  st = { ...st, docs, checks: [chk(wf, 'documents_for_unconditional_offer', 'passport', 'approved', { doc_id: 'a' }), chk(wf, 'documents_for_unconditional_offer', 'degree_certificate', 'reviewed', { doc_id: 'b' })] };
  eq(labels(E.readiness(wf, st).blockers).sort(), ['Degree certificate', 'Transcript'], 'cccu: reviewed is not approved; uploaded is not approved');
  const all = ['passport', 'degree_certificate', 'transcript'].map((k, i) => chk(wf, 'documents_for_unconditional_offer', k, 'approved', { doc_id: ['a', 'b', 'c'][i] }));
  st = { ...st, checks: all };
  ok(move(wf, st, 'unconditional_offer_requested').ok, 'cccu: all verified, the request can be made');
  // passport approved earlier covers the CAS checklist
  const cas = blank('precas_interview_passed'); cas.docs = [doc('a', 'Passport'), doc('x', 'Bank statement')]; cas.checks = [...all];
  eq(labels(E.readiness(wf, cas).blockers).sort(), ['Bank statement', 'The school’s CAS requirements have been checked'].sort(), 'cccu: a passport approved earlier is not asked for again (carried over)');
  ok(E.readiness(wf, cas).reqs.find((x) => x.label === 'Passport')!.carriedFrom !== null, 'cccu: carried-over requirement says where it came from');
  // deposit receipt conditional
  ok(!labels(E.readiness(wf, cas).reqs.map((x) => x) as never).includes('Tuition deposit receipt'), 'cccu: deposit receipt not listed by default');
  ok(E.readiness(wf, { ...cas, flags: { 'cond:deposit_required': true } }).reqs.some((x) => x.label === 'Tuition deposit receipt'), 'cccu: deposit receipt listed when the applicant pays a deposit');
  // visa: started -> submitted needs confirmation
  ok(!move(wf, blank('visa_application_started'), 'visa_application_submitted').ok, 'cccu: visa requirements need confirming before submission');
  ok(move(wf, { ...blank('visa_application_started'), checks: [chk(wf, 'visa_application_started', 'visa_requirements', 'approved')] }, 'visa_application_submitted').ok, 'cccu: confirmed visa requirements allow submission');
  eq(wf.stages.find((s) => s.key === 'cas_requested')!.maps_status, 'CAS Applied', 'cccu: stage maps to a pipeline status');
}

// ---------- BPP ----------
{
  const wf = WF.bpp;
  eq(E.nextStage(wf, null, {})?.key, 'documents_sent', 'bpp: starts at Documents Sent');
  let st = blank('bank_statement_review'); st.docs = [doc('b', 'Bank statement')];
  eq(labels(E.readiness(wf, st).blockers).sort(), ['Bank statement', 'Financial requirement checked and met'].sort(), 'bpp: financial documents must be verified');
  st.checks = [chk(wf, 'bank_statement_review', 'bank_statement', 'approved', { doc_id: 'b' }), chk(wf, 'bank_statement_review', 'funds_verified', 'approved')];
  ok(move(wf, st, 'application_form_completed').ok, 'bpp: verified finances let it move on');
  ok(!move(wf, blank('awaiting_precas_interview'), 'precas_interview_completed').ok, 'bpp: interview outcome must be recorded');
  ok(move(wf, { ...blank('awaiting_precas_interview'), checks: [chk(wf, 'awaiting_precas_interview', 'interview_outcome', 'approved', { value: 'Passed' })] }, 'precas_interview_completed').ok, 'bpp: recorded outcome moves it on');
  ok(!move(wf, { ...blank('awaiting_precas_interview'), checks: [chk(wf, 'awaiting_precas_interview', 'interview_outcome', 'approved', { value: 'Rescheduled' })] }, 'precas_interview_completed').ok, 'bpp: a rescheduled interview is not a pass');
  const ready = blank('cas_documents_ready'); ready.docs = [doc('p', 'Passport')];
  eq(labels(E.readiness(wf, ready).blockers).sort(), ['All CAS documents are ready', 'Passport'].sort(), 'bpp: CAS readiness checklist');
  ok(!move(wf, blank('cas_received'), 'visa_application_submitted').ok, 'bpp: CAS statement and visa requirements are needed before the visa is submitted');
  eq(E.suggestPlacement(wf, 'Submitted')?.key, 'documents_sent', 'bpp: a student whose documents are in is placed at Documents Sent');
}

// ---------- YSJ + applicant-specific extras and workflow extension ----------
{
  const wf = WF.ysj;
  ok(!move(wf, blank('interview_pending'), 'interview_passed').ok, 'ysj: interview outcome needed');
  const extra: ExtraReq = { id: 'e1', stage_key: 'interview_passed', label: 'Portfolio', kind: 'document', doc_type: 'Portfolio', need: 'mandatory', satisfied_at: 'approved', options: null, pass_options: null };
  let st: AppState = { ...blank('interview_passed'), docs: [doc('a', 'Passport'), doc('b', 'Degree Certificate'), doc('c', 'Transcript')] };
  const base = ['passport', 'degree_certificate', 'transcript'].map((k, i) => chk(wf, 'interview_passed', k, 'approved', { doc_id: ['a', 'b', 'c'][i] }));
  st.checks = base;
  ok(move(wf, st, 'unconditional_offer_requested').ok, 'ysj: standard documents are enough for a standard applicant');
  st = { ...st, extras: [extra] };
  const m = move(wf, st, 'unconditional_offer_requested'); ok(!m.ok && labels(m.blockers).includes('Portfolio'), 'ysj: an extra requirement added for one applicant blocks that applicant');
  ok(move(wf, { ...st, extras: [] }, 'unconditional_offer_requested').ok, 'ysj: another applicant is not affected by it');
  st = { ...st, docs: [...st.docs, doc('f', 'Portfolio')], checks: [...base, { ref: E.refOf(extra, true), state: 'approved', doc_id: 'f', value: null, note: null, by: 'x', at: T2 }] };
  ok(move(wf, st, 'unconditional_offer_requested').ok, 'ysj: the extra requirement is satisfied once approved');
  // a stage deactivated by an admin disappears from the route; another school is untouched
  const wf2: Workflow = JSON.parse(JSON.stringify(wf)); wf2.stages.find((s) => s.key === 'cas_sent')!.active = false;
  eq(E.nextStage(wf2, 'cas_requested', {})?.key, 'cas_received', 'ysj: a deactivated stage is skipped');
  ok(WF.ysj.stages.find((s) => s.key === 'cas_sent')!.active && WF.rcl.stages.every((s) => s.active), 'changes to one workflow copy do not touch the others');
  // a new stage inserted by an admin is placed in order
  wf2.stages.push({ ...JSON.parse(JSON.stringify(wf.stages.find((s) => s.key === 'cas_sent'))), id: 'new', key: 'portfolio_review', name: 'Portfolio Review', position: 65, active: true, reqs: [] });
  eq(E.nextStage(wf2, 'cas_requested', {})?.key, 'portfolio_review', 'ysj: a stage added between two others is reached in order');
eq(E.nextStage(wf2, 'portfolio_review', {})?.key, 'cas_received', 'ysj: and the stage after it follows (CAS Sent was deactivated)');
  // an unknown current stage (for example a stage that was removed) behaves like "no stage yet"
  eq(E.nextStage(wf, 'something_old', {})?.key, 'offer_received', 'ysj: an unknown stage restarts at the beginning');
  ok(!E.checkMove(wf, blank(null), 'not_a_stage', { role: 'admin' }).ok, 'ysj: an unknown target is refused');
  ok(E.checkMove(wf, blank('enrolment'), 'enrolment', { role: 'admin' }).direction === 'same', 'ysj: moving to the same stage is a no-op');
}

// ---------- a stage an admin switched off while an application sits in it ----------
{
  const wf: Workflow = JSON.parse(JSON.stringify(WF.rcl));
  const st: AppState = blank('student_documents_pending');
  wf.stages.find((s) => s.key === 'student_documents_pending')!.active = false;
  const rd = E.readiness(wf, st);
  eq(rd.current?.key, 'student_documents_pending', 'switched-off stage: the application still knows where it is');
  ok(rd.reqs.length === 0 && rd.blockers.length === 0, 'switched-off stage: it asks for nothing');
  ok(rd.ready && rd.next?.key === 'cas_requested', 'switched-off stage: it can be moved straight on');
  ok(E.studentAsks(wf, st).length === 0, 'switched-off stage: the student is not asked for its documents');
  ok(move(wf, st, 'cas_requested').ok, 'switched-off stage: moving on needs nothing from it');
  // the same stage, still on, does ask the student
  const on: Workflow = JSON.parse(JSON.stringify(WF.rcl));
  ok(E.studentAsks(on, blank('student_documents_pending')).length > 0, 'switched-on stage: the student is asked for the documents');
  // a conditional stage that is off for this student asks for nothing either
  ok(E.readiness(on, blank('tuition_fee_stage')).reqs.length === 0, 'conditional stage not used for this student: nothing asked');
}

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
