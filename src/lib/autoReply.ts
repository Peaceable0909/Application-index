import { admin } from './supabase';
import { brainEnabled, suggestReply } from './brain';
import { nudge } from './realtime';
import { addNotice } from './notices';
import { plainBody } from './stickers';

// Automatic replies, the way a business assistant on WhatsApp works:
//  - only when the workspace switched it on (off by default) and the student wrote something a person would answer
//  - only when the Brain is sure: it answers from the student's file, the notes and the uploaded files, otherwise it says a person will reply
//  - it steps back as soon as a person writes in the chat (for 30 minutes), or when a counselor pauses it for that student
//  - every automatic message is labelled "AI assistant" and the student can always ask for a person
export const AI_EMAIL = 'assistant@extravel.ai';
const HUMAN_QUIET_MS = 30 * 60_000, HOLD_EVERY_MS = 3 * 3600_000, MAX_PER_DAY = 6;
const TRIVIAL = /^(ok(ay)?|k|thanks?( you)?|thank u|thx|got it|noted|sure|yes|no|👍|🙏|✅|alright|cool|great|good|fine|hi|hello|hey)[.!\s]*$/i;

async function say(appId: string, studentEmail: string, body: string, kind: 'answer' | 'hold') {
  const db = admin(), now = new Date().toISOString();
  const { error } = await db.from('portal_student_msgs').insert({ student_email: studentEmail, application_id: appId, from_student: false, sender_email: AI_EMAIL, body, by_ai: true, staff_read_at: now });
  if (error) return;
  try { await addNotice({ email: studentEmail, applicationId: appId, kind: 'message', title: 'New message from the Extravel assistant', body: body.slice(0, 140), href: '/student/messages', by: AI_EMAIL }); } catch { /* optional */ }
  await nudge([{ role: 'student', email: studentEmail }], 'msg', { app: appId });
  await db.from('portal_activity').insert({ application_id: appId, actor: 'ai', kind: kind === 'answer' ? 'brain_replied' : 'brain_handoff', detail: {} });
}

/** Called after a student's message is saved. Never throws: if anything is unsure or fails, a person simply answers as before. */
export async function maybeAutoReply(appId: string, studentEmail: string): Promise<void> {
  try {
    if (!brainEnabled()) return;
    const db = admin();
    const { data: app } = await db.from('portal_applications').select('name, workspace').eq('application_id', appId).maybeSingle();
    if (!app) return;
    const { data: w } = await db.from('portal_workspaces').select('auto_reply').eq('key', app.workspace).maybeSingle();
    if (!w?.auto_reply) return;
    const { data: ch } = await db.from('portal_brain_chat').select('paused').eq('student_email', studentEmail).maybeSingle();
    if (ch?.paused) return;

    const { data: recent } = await db.from('portal_student_msgs').select('from_student, by_ai, body, created_at, deleted_at').eq('student_email', studentEmail).is('deleted_at', null).order('created_at', { ascending: false }).limit(12);
    const rows = recent || [];
    const last = rows[0];
    if (!last || !last.from_student) return;                                         // nothing new from the student
    const text = plainBody((last.body || '').trim());
    if (text.length < 4 || TRIVIAL.test(text)) return;                               // "ok", "thanks": nothing to answer
    const human = rows.find((m) => !m.from_student && !m.by_ai);
    if (human && Date.now() - new Date(human.created_at).getTime() < HUMAN_QUIET_MS) return;   // a person is on it
    const dayAgo = Date.now() - 864e5;
    if (rows.filter((m) => m.by_ai && new Date(m.created_at).getTime() > dayAgo).length >= MAX_PER_DAY) return;

    let r;
    try { r = await suggestReply(appId); } catch { r = null; }
    const first = (app.name || '').split(/[\s,]+/).filter(Boolean)[0] || 'there';
    if (r && !r.needsHuman) { await say(appId, studentEmail, r.reply, 'answer'); return; }

    // Not sure: say so once in a while and leave it for the counselor.
    const heldRecently = rows.some((m) => m.by_ai && /passed this to your counselor/i.test(m.body || '') && Date.now() - new Date(m.created_at).getTime() < HOLD_EVERY_MS);
    if (!heldRecently) await say(appId, studentEmail, `Thanks ${first}, I’ve passed this to your counselor and they’ll reply as soon as they can.`, 'hold');
  } catch { /* a person answers instead */ }
}
