import { admin } from './supabase';
import { generateOnce } from './ai';
import { brainEnabled } from './brain';

// What the Brain remembers about each student. After a student has written a few new messages, the whole conversation is read again and a
// short profile is kept: what they want, what they need, what worries them, what is still open. It is used to personalise replies and is
// written as one pinned note on the student's page (replaced each time, never piled up) so a counselor sees it too.
const MIN_NEW = 2, EVERY_MS = 15 * 60_000;
const strip = (t: string) => t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]').replace(/\+?\d[\d\s().-]{7,17}\d/g, '[number]').replace(/https?:\/\/\S+|www\.\S+/g, '[link]');

export type Memory = { summary: string; needs: string[]; interests: Record<string, string>; concerns: string[]; next_steps: string[] };
const list = (v: unknown, n: number, len = 120) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 2).map((x) => x.trim().slice(0, len)).slice(0, n) : []);

export const memoryNote = (m: Memory, at = new Date()) =>
  [`What the assistant remembers (updated ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`, m.summary,
    Object.keys(m.interests).length ? `Interested in: ${Object.entries(m.interests).map(([k, v]) => `${k} ${v}`).join(' · ')}` : '',
    m.needs.length ? `Needs:\n${m.needs.map((x) => `- ${x}`).join('\n')}` : '', m.concerns.length ? `Concerns:\n${m.concerns.map((x) => `- ${x}`).join('\n')}` : '',
    m.next_steps.length ? `Open next steps:\n${m.next_steps.map((x) => `- ${x}`).join('\n')}` : ''].filter(Boolean).join('\n\n');

export async function loadMemory(studentEmail: string): Promise<Memory | null> {
  const { data } = await admin().from('portal_student_memory').select('summary, needs, interests, concerns, next_steps').eq('student_email', studentEmail).maybeSingle();
  if (!data || !data.summary) return null;
  return { summary: data.summary, needs: (data.needs as string[]) || [], interests: (data.interests as Record<string, string>) || {}, concerns: (data.concerns as string[]) || [], next_steps: (data.next_steps as string[]) || [] };
}

const SYSTEM =
  'You keep a short private profile of ONE student of an education-advice company, from their chat with the team, so the next reply can be personal and the counselor can see what the student needs. ' +
  'Use ONLY what is said in the conversation or already in the previous profile. Do not guess, do not invent, do not include names, emails, phone numbers or ID numbers. Keep it factual and kind. ' +
  'Merge the new messages into the previous profile: keep what is still true, remove what has been resolved. ' +
  'Reply as JSON: {"summary": "<at most 450 characters: who they are, their goals, where things stand>", "interests": {"<short key like programme, country, intake, budget>": "<short value>"}, "needs": ["<up to 8 things the student needs or asked for>"], "concerns": ["<up to 5 worries or blockers they raised>"], "nextSteps": ["<up to 5 things still open, for the team or the student>"]}.';

/** Re-reads the conversation and refreshes the profile and the pinned note. Never throws; cheap checks first so most messages cost nothing. */
export async function maybeUpdateMemory(appId: string, studentEmail: string): Promise<void> {
  try {
    if (!brainEnabled()) return;
    const db = admin();
    const { data: prev } = await db.from('portal_student_memory').select('summary, needs, interests, concerns, next_steps, msgs_seen, updated_at').eq('student_email', studentEmail).maybeSingle();
    const { count } = await db.from('portal_student_msgs').select('id', { count: 'exact', head: true }).eq('student_email', studentEmail).eq('from_student', true).is('deleted_at', null);
    const n = count || 0;
    if (n - (prev?.msgs_seen || 0) < (prev ? MIN_NEW : 1) || (prev && Date.now() - new Date(prev.updated_at).getTime() < EVERY_MS)) return;

    const { data: rows } = await db.from('portal_student_msgs').select('from_student, by_ai, body, transcript, created_at').eq('student_email', studentEmail).is('deleted_at', null).order('created_at', { ascending: false }).limit(40);
    const convo = (rows || []).reverse().filter((m) => (m.body || m.transcript || '').trim()).map((m) => ({ from: m.from_student ? 'student' : m.by_ai ? 'assistant' : 'counselor', text: strip(m.body || `(voice note) ${m.transcript}`).slice(0, 400) }));
    if (!convo.some((m) => m.from === 'student')) return;
    const user = JSON.stringify({ previousProfile: prev ? { summary: prev.summary, needs: prev.needs, interests: prev.interests, concerns: prev.concerns, nextSteps: prev.next_steps } : null, conversation: convo });
    const out = await generateOnce<Memory>({
      kind: 'memory', maxTokens: 600, system: SYSTEM, user,
      validate: (raw) => {
        const d = raw as Record<string, unknown>;
        const summary = typeof d?.summary === 'string' ? d.summary.trim().slice(0, 500) : '';
        if (summary.length < 10) return null;
        const interests: Record<string, string> = {};
        if (d.interests && typeof d.interests === 'object') for (const [k, v] of Object.entries(d.interests as Record<string, unknown>).slice(0, 6)) if (typeof v === 'string' && v.trim() && k.length <= 30) interests[k.slice(0, 30)] = v.trim().slice(0, 80);
        const m: Memory = { summary, interests, needs: list(d.needs, 8), concerns: list(d.concerns, 5), next_steps: list(d.nextSteps, 5) };
        // no contact details or ID numbers in a note everyone on the team can read
        return /[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s().-]{7,17}\d/.test(JSON.stringify(m)) ? null : m;
      },
    });
    const now = new Date();
    await db.from('portal_student_memory').upsert({ student_email: studentEmail, summary: out.summary, needs: out.needs, interests: out.interests, concerns: out.concerns, next_steps: out.next_steps, msgs_seen: n, updated_at: now.toISOString() }, { onConflict: 'student_email' });
    await db.from('portal_notes').upsert({ application_id: appId, author: 'ai', body: memoryNote(out, now), pinned: true, ai_key: 'memory' }, { onConflict: 'application_id,ai_key' });
  } catch { /* the profile simply stays as it was */ }
}
