'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { admin } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { CATEGORIES, parseYouTube } from '@/lib/credibility';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const back = (msg: string, bad = false, tab = 'video') => redirect(`/credibility?tab=${tab}&${bad ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
const rethrow = (e: unknown) => { if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')) throw e; };
const done = () => { revalidatePath('/credibility'); revalidatePath('/student/interview/credibility'); };

/** Replace the training video. Any signed-in staff member (team or counselor) may do this. */
export async function saveVideo(f: FormData) {
  const staff = await requireStaff();
  const url = s(f, 'url'), title = s(f, 'title').slice(0, 140), description = s(f, 'description').slice(0, 600);
  const id = parseYouTube(url);
  if (!id) back('That is not a valid YouTube link. Paste a link such as https://youtu.be/… or https://www.youtube.com/watch?v=…', true);
  if (!title) back('Give the video a title.', true);
  try {
    const { error } = await admin().from('portal_cred_settings').upsert({ id: 1, video_url: url, video_id: id, title, description, updated_by: staff.email, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) { rethrow(e); back('Could not save the video. Please try again.', true); }
  done(); back('Video updated. Students see it straight away.');
}

function cleanQuestion(f: FormData) {
  const question = s(f, 'question').slice(0, 400), category = s(f, 'category'), guidance = s(f, 'guidance').slice(0, 1500), model = s(f, 'model_answer').slice(0, 2000);
  if (question.length < 5) return { error: 'Write the question first.' as const };
  return { question, category: (CATEGORIES as readonly string[]).includes(category) ? category : 'general', guidance: guidance || null, model_answer: model || null };
}

export async function addQuestion(f: FormData) {
  const staff = await requireStaff();
  const c = cleanQuestion(f);
  if ('error' in c) back(c.error as string, true, 'questions');
  const db = admin();
  const { data: last } = await db.from('portal_cred_questions').select('position').order('position', { ascending: false }).limit(1);
  const q = c as Exclude<typeof c, { error: string }>;
  const { error } = await db.from('portal_cred_questions').insert({ ...q, position: (last?.[0]?.position || 0) + 1, active: true, created_by: staff.email });
  if (error) back('Could not add the question.', true, 'questions');
  done(); back('Question added.', false, 'questions');
}

export async function updateQuestion(f: FormData) {
  await requireStaff();
  const id = s(f, 'id'), c = cleanQuestion(f);
  if ('error' in c) back(c.error as string, true, 'questions');
  const q = c as Exclude<typeof c, { error: string }>;
  const { error } = await admin().from('portal_cred_questions').update({ ...q, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) back('Could not save the question.', true, 'questions');
  done(); back('Question saved.', false, 'questions');
}

export async function toggleQuestion(id: string, active: boolean): Promise<{ ok: boolean }> {
  await requireStaff();
  const { error } = await admin().from('portal_cred_questions').update({ active, updated_at: new Date().toISOString() }).eq('id', id);
  done(); return { ok: !error };
}

export async function deleteQuestion(id: string): Promise<{ ok: boolean }> {
  await requireStaff();
  const { error } = await admin().from('portal_cred_questions').delete().eq('id', id);
  done(); return { ok: !error };
}

/** Move a question one place up or down by swapping positions with its neighbour. */
export async function moveQuestion(id: string, dir: -1 | 1): Promise<{ ok: boolean }> {
  await requireStaff();
  const db = admin();
  const { data } = await db.from('portal_cred_questions').select('id').order('position').order('created_at');
  const ids = (data || []).map((r) => r.id as string), i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: false };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await Promise.all(ids.map((qid, n) => db.from('portal_cred_questions').update({ position: n + 1 }).eq('id', qid)));
  done(); return { ok: true };
}
