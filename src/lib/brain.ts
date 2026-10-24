import { admin } from './supabase';
import { generateOnce, numbersWithin } from './ai';
import { missingDocs, schoolKey, schoolDisplay } from './docs';
import { requiredDocs } from './workspace';
import { relevantPassages } from './brainDocs';
import { loadMemory } from './memory';
import { effType } from './docs';
import { loadContext } from './stageCore';
import { buildTracker } from './studentTracker';
import { latestInformable } from './stageInform';
import { stageFacts, type StageFacts } from './brainStage';

// The AI Brain: reads ONE student's file plus the team's written notes and drafts a reply for a staff member to check and send.
// It never sends anything itself. Opt-in: AI_BRAIN=on in Vercel (the student's chat text and file facts are sent to Qwen).
export const brainEnabled = () => process.env.AI_BRAIN === 'on';

export type BrainReply = { reply: string; needsHuman: boolean; why: string };

const strip = (t: string) => t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]').replace(/https?:\/\/\S+|www\.\S+/g, '[link removed]').replace(/\+?\d[\d\s-]{7,}\d/g, '[number removed]');
const SOFT_DAY = 864e5;

/** Where the student is in their school's stage workflow, in the words and detail the student sees on their own dashboard. Null when the school has no workflow. */
async function applicationStage(appId: string): Promise<StageFacts | null> {
  try {
    const db = admin(), c = await loadContext(db, appId);
    if ('error' in c) return null;
    const { data: a } = await db.from('portal_applications').select('school, programme').eq('application_id', appId).maybeSingle();
    const t = buildTracker({ application_id: appId, school: a?.school ?? null, programme: a?.programme ?? null }, c.wf, c.st);
    const told = await latestInformable(db, appId, c.st.stage_key);
    return stageFacts(t, { emailed: told?.state === 'sent', schoolName: c.wf.school_name });
  } catch { return null; }
}

/** Everything the Brain may use for this student, with no name, email or phone. Returned with the text of what they last wrote. */
export async function brainContext(appId: string, question?: string) {
  const db = admin();
  const { data: app } = await db.from('portal_applications').select('name, school, programme, status, country, interview, submitted_at, student_key, counselor, payment, workspace').eq('application_id', appId).maybeSingle();
  if (!app) return null;
  const { data: sibs } = await db.from('portal_applications').select('application_id').eq('student_key', app.student_key);
  const ids = (sibs || []).map((s) => s.application_id);
  const { data: docs } = await db.from('portal_documents').select('drive_file_id, doc_type, type_override, name').in('application_id', ids.length ? ids : [appId]);
  const have = (docs || []).map(effType);
  const { data: scans } = await db.from('portal_doc_scans').select('detected_type, expiry_date, facts, flags').in('drive_file_id', (docs || []).map((d) => d.drive_file_id));
  const read = (scans || []).filter((s) => s.detected_type).map((s) => ({ document: s.detected_type as string, expires: s.expiry_date as string | null, details: ((s.facts || []) as { label: string; value: string }[]).map((f) => `${f.label}: ${f.value}`) }));
  const { data: wsRow } = await db.from('portal_workspaces').select('name, brief').eq('key', app.workspace).maybeSingle();
  const { data: notes } = await db.from('portal_brain_notes').select('title, body, school').eq('workspace', app.workspace).eq('active', true).limit(80);
  const key = schoolKey(app.school);
  const rel = (notes || []).filter((n) => !n.school || schoolKey(n.school) === key);
  const email = (await db.from('portal_applications').select('email').eq('application_id', appId).maybeSingle()).data?.email?.toLowerCase() || '';
  const { data: msgs } = email ? await db.from('portal_student_msgs').select('from_student, body, transcript, created_at').eq('student_email', email).order('created_at', { ascending: false }).limit(16) : { data: [] as { from_student: boolean; body: string; transcript?: string | null; created_at: string }[] };
  // a voice note counts by what was said in it (written down when voice reading is on); names, numbers and links are stripped like in typed messages
  const chat = (msgs || []).reverse().filter((m) => (m.body || m.transcript || '').trim()).map((m) => ({ from: m.from_student ? 'student' : 'team', text: strip(m.body || `(voice note) ${m.transcript}`).slice(0, 400) }));
  const facts = {
    university: schoolDisplay(app.school) || null, programme: app.programme || null, pipelineStatus: app.status || null, country: app.country || null,
    interviewStatus: app.interview || null, paymentRecorded: !!app.payment,
    daysSinceSubmitted: app.submitted_at ? Math.floor((Date.now() - new Date(app.submitted_at).getTime()) / SOFT_DAY) : null,
    documentsReceived: [...new Set(have)], documentsStillMissing: missingDocs(have, await requiredDocs(app.workspace)), documentDetails: read,
  };
  const memory = email ? await loadMemory(email) : null;
  const stage = await applicationStage(appId);
  const asked = chat.filter((m) => m.from === 'student').slice(-2).map((m) => m.text).join(' ');
  const files = await relevantPassages(app.workspace, app.school, `${asked} ${question || ''}`);
  return { memory, stage, files, first: (app.name || '').split(/[\s,]+/).filter(Boolean)[0] || 'there', country: wsRow?.name || 'the UK', brief: wsRow?.brief || null, facts, notes: rel.map((n) => ({ topic: n.title, info: n.body })), chat };
}

const system = (country: string) =>
  `You write chat replies, for a human counselor to review, to a student of WhiteRock, an education-advice company that helps students apply to universities in: ${country}. ` +
  'Use ONLY the "facts", "applicationStage", "studentMemory", "countryBrief", "teamNotes" and "fileExcerpts" in the JSON, and the conversation. "applicationStage" is where the student is in the step-by-step process for the school they applied to, exactly as they see it on their dashboard: when they ask where their application is, what happens next or what they still need to send, answer from it (the stage name, what it means, the next stage, and the documents listed with where each one stands). Never describe a stage as faster, slower or more certain than it says, and never suggest an outcome from it. If applicationStage is null or not started, say the team will update them rather than naming a stage. "studentMemory" is what we already know about this student from earlier chats: use it to make the reply personal (their goals, what they asked before, what is still open) without reciting it back. If the answer is not there, do not guess: set needsHuman to true and write a short, kind holding reply that says the team will check and come back. ' +
  'Write like a warm, clear text message: plain English, at most 80 words, no signature, no headings, at most one emoji. Address the student as {{FIRST_NAME}} only when it feels natural. ' +
  'NEVER invent dates, deadlines, fees, links, phone numbers or email addresses, and NEVER promise or hint at admission, an offer, a visa or any outcome. Do not give legal or immigration advice. ' +
  'If the student sounds upset, unwell, unsafe or mentions money problems, set needsHuman to true. When asked for a document, name it exactly as in the facts. ' +
  'Reply as JSON: {"reply": "<the message>", "needsHuman": true|false, "why": "<one short line for the counselor: what you based this on, or what you could not answer>"}.';

export async function suggestReply(appId: string, o: { question?: string; instruction?: string; mustMention?: string[] } = {}): Promise<BrainReply> {
  const ctx = await brainContext(appId, o.question);
  if (!ctx) throw new Error('Student not found.');
  const chat = o.question ? [...ctx.chat, { from: 'student', text: strip(o.question).slice(0, 400) }] : ctx.chat;
  const userJson = JSON.stringify({ studentMemory: ctx.memory, applicationStage: ctx.stage, facts: ctx.facts, countryBrief: ctx.brief, teamNotes: ctx.notes, fileExcerpts: ctx.files, conversation: chat, counselorInstruction: o.instruction ? strip(o.instruction).slice(0, 600) : null });
  // Numbers the reply may contain: those already in the file, the notes or the conversation (so it can't invent a figure).
  const allowed = (userJson.match(/\d+/g) || []).map(Number);
  const r = await generateOnce<BrainReply>({
    kind: 'brain', maxTokens: 400, system: system(ctx.country), user: userJson,
    validate: (raw) => {
      const d = raw as { reply?: unknown; needsHuman?: unknown; why?: unknown };
      if (typeof d?.reply !== 'string') return null;
      const reply = d.reply.trim();
      if (reply.length < 8 || reply.length > 900) return null;
      if (/https?:\/\/|www\.|@|\+?\d[\d\s-]{7,}/.test(reply)) return null;
      if (/guarantee|you (have been|are) (admitted|accepted)|offer (has been|is) (approved|granted)|visa (is|will be) (approved|granted)|definitely (get|receive)/i.test(reply)) return null;
      if (!numbersWithin(reply, allowed)) return null;
      // when the message is a request for documents, every one of them must be named so the student knows what to send
      if (o.mustMention?.length) { const low = reply.toLowerCase(); if (!o.mustMention.every((m) => m.toLowerCase().split('/').every((part) => low.includes(part.trim())))) return null; }
      if ((reply.match(/\{\{[^}]+\}\}/g) || []).some((t) => t !== '{{FIRST_NAME}}')) return null;
      return { reply: reply.replaceAll('{{FIRST_NAME}}', ctx.first), needsHuman: d.needsHuman === true, why: typeof d.why === 'string' ? d.why.trim().slice(0, 200) : '' };
    },
  });
  return r;
}
