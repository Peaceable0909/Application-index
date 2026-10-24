// Run with: npx tsx scripts/tests/stageInform.test.ts  (in-memory database, no email is really sent)
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { startMock, type Rows } from './mockdb';
import { WORKFLOW_TEMPLATES } from '../../src/lib/stageTemplates';
import * as C from '../../src/lib/stageCore';
import { draftInform, latestInformable, sendInform } from '../../src/lib/stageInform';
import { stageEmailDraft, stageEmailProblem } from '../../src/lib/stageEmailText';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

// ---- the words of the email (pure) ----
{
  const d = stageEmailDraft({ first: 'Amara', school: 'Regent College London (RCL)', programme: 'MSc Marketing', stage: 'Student Documents Pending', note: 'Please send the documents listed below.', asks: [{ label: 'Bank statement', again: false }, { label: 'TB test certificate', again: true }] });
  ok(d.body.includes('Hi Amara,'), 'email: greets the student by name');
  ok(d.body.includes('Regent College London (RCL)') && d.body.includes('MSc Marketing'), 'email: names the school and programme');
  ok(d.body.includes('Student Documents Pending') && d.subject.includes('Student Documents Pending'), 'email: names the stage in the body and the subject');
  ok(d.body.includes('- Bank statement') && d.body.includes('- TB test certificate (please send a new copy)'), 'email: lists what the student must send');
  ok(d.body.includes('Please send the documents listed below.'), 'email: carries the stage instructions');
  const none = stageEmailDraft({ first: 'Amara', school: 'BPP University', stage: 'Offer Received', asks: [] });
  ok(/nothing you need to do/.test(none.body), 'email: says so when the student has nothing to do');
  ok(!/N\/A/.test(stageEmailDraft({ first: 'A', school: 'X', programme: 'N/A', stage: 'S', asks: [] }).body), 'email: no "N/A" programme');
  ok(stageEmailProblem('', 'x'.repeat(40)) !== null && stageEmailProblem('Hi there', 'short') !== null && stageEmailProblem('Hi there', 'x'.repeat(40)) === null, 'email: an empty subject or message is refused');
}

const DB: Rows = {};
function seed() {
  DB.portal_workflows = []; DB.portal_stages = []; DB.portal_stage_reqs = [];
  for (const t of WORKFLOW_TEMPLATES) {
    const wid = randomUUID();
    DB.portal_workflows.push({ id: wid, workspace: 'uk', school_key: t.school_key, school_name: t.school_name, active: true, override_roles: ['admin'], conditions: t.conditions });
    t.stages.forEach((s, i) => {
      const sid = randomUUID();
      DB.portal_stages.push({ id: sid, workflow_id: wid, key: s.key, name: s.name, position: (i + 1) * 10, active: true, conditional: !!s.conditional, maps_status: s.maps ?? null, move_roles: s.roles ?? ['admin', 'staff', 'counselor'], complete_when: s.complete ?? 'manual', notify: s.notify ?? 'counselor', delay_days: s.delay ?? null, offer_sync: s.offer ?? null, hint: s.hint ?? null, student_note: i === 0 ? 'The university has made you an offer.' : null });
      (s.reqs || []).forEach((r, j) => DB.portal_stage_reqs.push({ id: randomUUID(), stage_id: sid, key: r.key, label: r.label, kind: r.kind ?? 'document', doc_type: r.doc_type ?? null, need: r.need ?? 'mandatory', condition_key: r.condition ?? null, upload: r.upload ?? (r.kind ?? 'document') === 'document', satisfied_at: r.satisfied_at ?? 'approved', student_visible: r.student_visible ?? (r.kind ?? 'document') === 'document', position: (j + 1) * 10, active: true, options: r.options ?? null, pass_options: r.pass ?? null, hint: r.hint ?? null }));
    });
  }
  const app = (id: string, email: string | null) => ({ application_id: id, name: `Student ${id}`, preferred_name: null, email, school: 'Regent College London (RCL)', programme: 'MSc Marketing', workspace: 'uk', status: 'Submitted', counselor: 'Mr Test', stage_key: null, stage_at: null, stage_by: null, student_key: id });
  DB.portal_applications = [app('s1', 'student1@example.org'), app('s2', null), app('s3', 'student3@example.org')];
  DB.portal_documents = []; DB.portal_app_flags = []; DB.portal_app_reqs = []; DB.portal_req_checks = []; DB.portal_stage_history = []; DB.portal_activity = []; DB.portal_offers = []; DB.portal_messages = [];
}

(async () => {
  seed();
  const server = await startMock(DB, 54398);
  const db = createClient('http://127.0.0.1:54398', 'x', { auth: { persistSession: false } }) as never;
  const counselor = { email: 'c@x.org', role: 'counselor' as const };
  const sent: { to: string; subject: string; body: string; by: string }[] = [], notices: unknown[] = [];
  let failNext = 0, slow = false;
  const io = {
    send: async (m: { to: string; subject: string; body: string; by: string }) => { if (slow) await new Promise((r) => setTimeout(r, 80)); if (failNext > 0) { failNext--; throw new Error('Apps Script is busy'); } sent.push(m); },
    notice: async (m: unknown) => { notices.push(m); },
  };
  const text = 'Hi Student s1,\n\nYour application has moved to a new stage: Offer Received.\n\nWe will keep you updated.';

  // ---- moving never sends anything ----
  const r: any = await C.moveApplication(db, { appId: 's1', toKey: 'offer_received', mover: counselor });
  ok(r.ok && r.historyId, 'move: returns the history row it wrote');
  eq(sent.length, 0, 'move: no email is sent by moving');
  eq(DB.portal_messages.length, 0, 'move: nothing is logged as an email');
  eq(DB.portal_stage_history[0].inform_state ?? null, null, 'move: the change is marked as not told to the student');
  const info = await latestInformable(db, 's1', 'offer_received');
  ok(info && info.historyId === r.historyId && info.state === null, 'inform: the latest change can be announced');
  eq(await latestInformable(db, 's1', 'interview_to_be_booked'), null, 'inform: a stage the application is not in cannot be announced');

  // ---- the draft ----
  const d: any = await draftInform(db, 's1', r.historyId);
  ok(d.ok && d.to === 'student1@example.org', 'draft: goes to the registered email address');
  ok(d.body.includes('Hi Student,') || d.body.includes('Hi Student'), 'draft: greets the student');
  ok(d.body.includes('Regent College London (RCL)') && d.body.includes('Offer Received') && d.body.includes('The university has made you an offer.'), 'draft: school, stage and the stage instructions');
  const dn: any = await draftInform(db, 's1', 'not-a-real-id'); ok(!dn.ok, 'draft: an unknown stage change is refused');
  const dx: any = await draftInform(db, 's3', r.historyId); ok(!dx.ok, 'draft: a stage change of another student is refused');

  // ---- sending ----
  let s: any = await sendInform(db, { appId: 's1', historyId: r.historyId, by: 'c@x.org', subject: 'Your application update', body: text }, io);
  ok(s.ok && s.to === 'student1@example.org', 'send: succeeds');
  eq(sent.length, 1, 'send: one email'); eq(sent[0].to, 'student1@example.org', 'send: to the address on the application, nobody else');
  const h = DB.portal_stage_history[0];
  eq(h.inform_state, 'sent', 'record: marked sent'); eq(h.informed_by, 'c@x.org', 'record: who sent it'); ok(typeof h.informed_at === 'string', 'record: when'); eq(h.inform_to, 'student1@example.org', 'record: where it went');
  eq(DB.portal_messages.length, 1, 'record: logged with the other sent emails'); eq(DB.portal_messages[0].to_kind, 'student', 'record: as a student email'); eq(h.inform_message_id, DB.portal_messages[0].id, 'record: linked to that log entry');
  ok(DB.portal_activity.some((a) => a.kind === 'stage_informed'), 'record: on the activity timeline'); eq(notices.length, 1, 'record: the student also gets an in-portal notice');
  // ---- no duplicates ----
  s = await sendInform(db, { appId: 's1', historyId: r.historyId, by: 'c@x.org', subject: 'Your application update', body: text }, io);
  ok(!s.ok && /already informed/.test(s.error), 'duplicate: a second send is refused and says why'); eq(sent.length, 1, 'duplicate: nothing more was sent');
  const m2: any = await C.moveApplication(db, { appId: 's1', toKey: 'interview_to_be_booked', mover: counselor });
  s = await sendInform(db, { appId: 's1', historyId: r.historyId, by: 'c@x.org', subject: 'Your application update', body: text }, io);
  ok(!s.ok, 'old: an earlier stage change can no longer be announced once the application moved on'); eq(sent.length, 1, 'old: nothing sent');
  eq(DB.portal_stage_history.find((x) => x.id === m2.historyId)!.inform_state ?? null, null, 'the next move starts as not informed');

  // ---- two at once: only one wins ----
  slow = true;
  const race = await Promise.all([1, 2, 3].map(() => sendInform(db, { appId: 's1', historyId: m2.historyId, by: 'c@x.org', subject: 'Your application update', body: text }, io)));
  slow = false;
  eq(race.filter((x: any) => x.ok).length, 1, 'race: exactly one of three simultaneous sends wins'); eq(sent.length, 2, 'race: one more email in total');

  // ---- failure keeps the stage, and can be retried ----
  seed(); (await C.moveApplication(db, { appId: 's1', toKey: 'offer_received', mover: counselor }));
  const hid = DB.portal_stage_history[0].id as string; sent.length = 0;
  failNext = 1;
  s = await sendInform(db, { appId: 's1', historyId: hid, by: 'c@x.org', subject: 'Your application update', body: text }, io);
  ok(!s.ok && /could not be sent/.test(s.error) && /try again/i.test(s.error), 'failure: says the email failed and that it can be retried');
  eq(DB.portal_applications[0].stage_key, 'offer_received', 'failure: the stage update is intact'); eq(DB.portal_stage_history[0].inform_state, 'failed', 'failure: recorded as failed'); ok(String(DB.portal_stage_history[0].inform_error).includes('busy'), 'failure: keeps the reason');
  eq(DB.portal_messages.length, 0, 'failure: nothing logged as sent');
  s = await sendInform(db, { appId: 's1', historyId: hid, by: 'c2@x.org', subject: 'Your application update', body: text }, io);
  ok(s.ok, 'retry: works after a failure'); eq(sent.length, 1, 'retry: sent once'); eq(DB.portal_stage_history[0].inform_state, 'sent', 'retry: now sent'); eq(DB.portal_stage_history[0].informed_by, 'c2@x.org', 'retry: records who finally sent it'); eq(DB.portal_stage_history[0].inform_error, null, 'retry: the old error is cleared');

  // ---- a lost "sending" claim is retried only after it has gone stale ----
  seed(); (await C.moveApplication(db, { appId: 's1', toKey: 'offer_received', mover: counselor })); sent.length = 0;
  const h2 = DB.portal_stage_history[0]; h2.inform_state = 'sending'; h2.informed_at = new Date().toISOString();
  s = await sendInform(db, { appId: 's1', historyId: h2.id as string, by: 'c@x.org', subject: 'Your application update', body: text }, io);
  ok(!s.ok && /already being sent/.test(s.error), 'sending: a send in progress blocks another'); eq(sent.length, 0, 'sending: nothing sent');
  h2.informed_at = new Date(Date.now() - 10 * 60_000).toISOString();
  s = await sendInform(db, { appId: 's1', historyId: h2.id as string, by: 'c@x.org', subject: 'Your application update', body: text }, io);
  ok(s.ok, 'sending: a send lost ten minutes ago can be redone');

  // ---- no registered email ----
  seed(); const m4: any = await C.moveApplication(db, { appId: 's2', toKey: 'offer_received', mover: counselor }); sent.length = 0;
  const dd: any = await draftInform(db, 's2', m4.historyId); ok(dd.ok && dd.to === null, 'no email: the draft shows there is nobody to send it to');
  s = await sendInform(db, { appId: 's2', historyId: m4.historyId, by: 'c@x.org', subject: 'Your application update', body: text }, io);
  ok(!s.ok && /no email address/.test(s.error), 'no email: refused with a clear reason'); eq(sent.length, 0, 'no email: nothing sent'); eq(DB.portal_stage_history[0].inform_state ?? null, null, 'no email: not marked as anything');

  // ---- bad text ----
  s = await sendInform(db, { appId: 's2', historyId: m4.historyId, by: 'c@x.org', subject: '', body: text }, io); ok(!s.ok, 'text: no subject is refused');
  s = await sendInform(db, { appId: 's2', historyId: m4.historyId, by: 'c@x.org', subject: 'Hello there', body: 'hi' }, io); ok(!s.ok, 'text: a tiny message is refused');

  // ---- placing is announcable too, a reset is not ----
  seed(); const p: any = await C.placeApplication(db, { appId: 's3', toKey: 'cas_received', mover: counselor }); ok(p.ok && p.historyId, 'place: returns the history row');
  ok((await latestInformable(db, 's3', 'cas_received'))?.historyId === p.historyId, 'place: can be announced');

  server.close();
  console.log(`${pass} checks passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
