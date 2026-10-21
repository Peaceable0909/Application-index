import { admin } from './supabase';
import { transcribeAudio, voiceEnabled } from './stt';
import { maybeUpdateMemory } from './memory';

type Result = { ok: true; transcript: string } | { ok: false; error: string };

/** Writes down what is said in one voice note and keeps it with the message. Counts against the daily AI budget. */
export async function transcribeMessage(id: string): Promise<Result> {
  if (!voiceEnabled()) return { ok: false, error: 'Reading voice notes is off. An admin can switch it on in Settings.' };
  const db = admin();
  const { data: m } = await db.from('portal_student_msgs').select('id, student_email, application_id, from_student, att_path, att_mime, transcript, deleted_at').eq('id', id).maybeSingle();
  if (!m || m.deleted_at || !m.att_path || !(m.att_mime || '').startsWith('audio/')) return { ok: false, error: 'That is not a voice note.' };
  if (m.transcript) return { ok: true, transcript: m.transcript };

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const limit = Number(process.env.AI_DAILY_LIMIT || 60);
  const { count } = await db.from('portal_ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());
  if ((count || 0) >= limit) return { ok: false, error: `Today’s AI limit (${limit}) is used up. Try again tomorrow.` };

  const dl = await db.storage.from('chat-files').download(m.att_path);
  if (dl.error || !dl.data) return { ok: false, error: 'Could not open the recording.' };
  try {
    const text = await transcribeAudio(new Uint8Array(await dl.data.arrayBuffer()), m.att_mime || 'audio/webm');
    await db.from('portal_ai_usage').insert({ kind: 'voice', ok: !!text });
    if (!text) return { ok: false, error: 'Nothing could be heard in this recording.' };
    await db.from('portal_student_msgs').update({ transcript: text, transcript_at: new Date().toISOString() }).eq('id', id);
    // a student's words count towards what the portal remembers about them, just like typed messages
    if (m.from_student && m.application_id) { try { await maybeUpdateMemory(m.application_id, m.student_email); } catch { /* memory is a bonus */ } }
    return { ok: true, transcript: text };
  } catch (e) {
    await db.from('portal_ai_usage').insert({ kind: 'voice', ok: false });
    return { ok: false, error: (e as Error).message };
  }
}
