// Run with: npx tsx scripts/tests/brainMemory.test.ts  (in-memory database)
// The AI Brain's longer memory: lasting facts, and recall of older messages from a long chat.
import { startMock, type Rows } from './mockdb';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54395';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
process.env.AI_BRAIN = 'on';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

const DB: Rows = {};
const DAY = 864e5, NOW = Date.now();
const at = (daysAgo: number, extraMin = 0) => new Date(NOW - daysAgo * DAY + extraMin * 60_000).toISOString();

(async () => {
  const server = await startMock(DB, 54395);
  const { earlierRelevant, sinceWords } = await import('../../src/lib/brainRecall');
  const { cleanMemory, memoryNote } = await import('../../src/lib/memory');
  const { brainContext } = await import('../../src/lib/brain');

  // ---- recall (pure) ----
  const older = [
    { from: 'student' as const, text: 'My budget for tuition is about 9 thousand pounds a year, my father is sponsoring me', at: at(40) },
    { from: 'team' as const, text: 'Thanks, we noted your sponsor for the bank statement', at: at(40, 5) },
    { from: 'student' as const, text: 'I studied accounting at Lagos State University and finished in 2022', at: at(35) },
    { from: 'student' as const, text: 'Good morning, how are you', at: at(30) },
    { from: 'student' as const, text: 'I prefer to start in January because of my work contract', at: at(20) },
  ];
  const r = earlierRelevant(older, 'who is paying my tuition budget and sponsor', 6, NOW);
  ok(r.length >= 1 && r[0].text.includes('budget'), 'recall: finds the weeks-old message about the budget');
  ok(r.every((m) => !m.text.includes('Good morning')), 'recall: leaves out small talk');
  ok(r.some((m) => m.when.includes('weeks')), 'recall: says how long ago: ' + JSON.stringify(r.map((m) => m.when)));
  eq(earlierRelevant(older, '', 6, NOW), [], 'recall: nothing asked, nothing recalled');
  eq(earlierRelevant(older, 'visa biometrics appointment', 6, NOW), [], 'recall: nothing matches, nothing recalled');
  ok(earlierRelevant(older, 'who pays for my fees', 6, NOW).length === 0, 'recall: no shared word, no guess');
  ok(earlierRelevant(older, 'Can you remind me who pays my tuition', 6, NOW).some((m) => m.text.includes('sponsoring')), 'recall: one rare shared word (tuition) is enough');
  ok(earlierRelevant(older, 'sponsored by my father', 6, NOW).length >= 1, 'recall: sponsor and sponsoring are the same word');
  ok(JSON.stringify(earlierRelevant(older, 'accounting Lagos University January start contract', 6, NOW).map((m) => m.text.slice(0, 12))) === JSON.stringify(['I studied ac', 'I prefer to ']), 'recall: oldest first');
  eq([sinceWords(at(0), NOW), sinceWords(at(1), NOW), sinceWords(at(5), NOW), sinceWords(at(30), NOW), sinceWords(at(120), NOW)], ['today', 'yesterday', '5 days ago', '4 weeks ago', '4 months ago'], 'recall: friendly time words');

  // ---- the profile (pure) ----
  const m = cleanMemory({ summary: 'Wants an MSc in accounting, sponsored by father, prefers a January intake.', facts: ['Studied accounting at a Nigerian university, finished 2022', 'Budget about 9 thousand pounds a year', 'Sponsored by father', 'x'], interests: { programme: 'MSc Accounting' }, needs: ['bank statement'], concerns: ['visa timing'], nextSteps: ['send CAS documents'] });
  ok(m && m.facts.length === 3, 'profile: keeps lasting facts and drops empty ones');
  ok(memoryNote(m!).includes('Good to know') && memoryNote(m!).includes('Sponsored by father'), 'profile: facts shown on the pinned note for the team');
  eq(cleanMemory({ summary: 'ok summary here', facts: Array.from({ length: 30 }, (_, i) => `fact number ${i}`) })!.facts.length, 14, 'profile: at most 14 facts');
  eq(cleanMemory({ summary: 'ok summary here', facts: ['call me on +234 801 234 5678'] }), null, 'profile: a phone number anywhere discards it');
  eq(cleanMemory({ summary: 'ok summary here', facts: ['mail amara@example.org'] }), null, 'profile: an email address anywhere discards it');
  eq(cleanMemory({ summary: 'short' }), null, 'profile: too little is discarded');

  // ---- end to end: a long chat, the answer is in a message from 40 days ago ----
  DB.portal_applications = [{ application_id: 'a1', name: 'Amara Okonkwo', email: 'a1@example.org', school: 'Regent College London (RCL)', programme: 'MSc Accounting', status: 'Offer Received', country: 'Nigeria', interview: null, submitted_at: at(60), student_key: 'a1', counselor: 'Mr Test', payment: null, workspace: 'uk', stage_key: null, stage_at: null }];
  DB.portal_documents = []; DB.portal_doc_scans = []; DB.portal_workspaces = [{ key: 'uk', name: 'the UK', brief: null }]; DB.portal_brain_notes = []; DB.portal_brain_docs = [];
  DB.portal_workflows = []; DB.portal_stages = []; DB.portal_stage_reqs = []; DB.portal_app_flags = []; DB.portal_app_reqs = []; DB.portal_req_checks = []; DB.portal_stage_history = [];
  DB.portal_student_memory = [{ student_email: 'a1@example.org', summary: 'Wants an MSc in accounting.', needs: [], interests: {}, concerns: [], next_steps: [], facts: ['Sponsored by father'], msgs_seen: 3, updated_at: at(1) }];
  const msgs: Record<string, unknown>[] = [];
  msgs.push({ id: 'old1', student_email: 'a1@example.org', from_student: true, body: 'My budget for tuition is about 9 thousand pounds a year, my father is sponsoring me', transcript: null, created_at: at(40), deleted_at: null });
  msgs.push({ id: 'old2', student_email: 'a1@example.org', from_student: true, body: 'This message was deleted but mentions tuition budget sponsor secrets', transcript: null, created_at: at(39), deleted_at: at(38) });
  for (let i = 0; i < 60; i++) msgs.push({ id: 'f' + i, student_email: 'a1@example.org', from_student: i % 2 === 0, body: i % 2 === 0 ? `Question number ${i} about my documents and photos` : `Reply number ${i} from the team`, transcript: null, created_at: at(10, i), deleted_at: null });
  msgs.push({ id: 'new', student_email: 'a1@example.org', from_student: true, body: 'Can you remind me what we said about who pays my tuition?', transcript: null, created_at: at(0), deleted_at: null });
  DB.portal_student_msgs = msgs;
  const ctx: any = await brainContext('a1');
  eq(ctx.chat.length, 16, 'long chat: the live conversation is still the latest 16');
  ok(ctx.chat.at(-1).text.includes('who pays my tuition'), 'long chat: the newest message is last');
  ok(ctx.earlier.some((e: any) => e.text.includes('my father is sponsoring me')), 'long chat: the old message about the sponsor is recalled');
  ok(!JSON.stringify(ctx.earlier).includes('secrets') && !JSON.stringify(ctx.chat).includes('secrets'), 'long chat: a deleted message is never recalled');
  ok(ctx.earlier.every((e: any) => !ctx.chat.some((c: any) => c.text === e.text)), 'long chat: nothing is shown twice');
  eq(ctx.memory.facts, ['Sponsored by father'], 'long chat: the lasting facts reach the Brain');
  ok(!JSON.stringify({ e: ctx.earlier, m: ctx.memory }).includes('Amara'), 'privacy: still no name');

  server.close();
  console.log(`${pass} checks passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
