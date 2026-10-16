'use server';
import { currentWorkspace } from '@/lib/workspace';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';

const txt = (f: FormData, k: string) => String(f.get(k) || '').trim();
const done = (msg: string, err = false) => { revalidatePath('/brain'); redirect(`/brain?${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`); };

export async function addBrainNote(f: FormData) {
  const me = await requireTeam();
  const title = txt(f, 'title'), body = txt(f, 'body'), school = txt(f, 'school') || null;
  if (title.length < 2 || title.length > 80) return done('Give the note a short title (2 to 80 characters).', true);
  if (body.length < 2 || body.length > 1500) return done('Write the note itself (up to 1,500 characters).', true);
  if (/\+?\d[\d\s-]{9,}\d/.test(body) && !f.get('okNumbers')) return done('That note contains a long number (a phone number or an ID?). Notes are shared with the AI, so leave those out.', true);
  await admin().from('portal_brain_notes').insert({ title, body, school, created_by: me.email, workspace: await currentWorkspace() });
  done('Saved. The Brain will use it from the next reply.');
}

export async function toggleBrainNote(f: FormData) {
  await requireTeam();
  const id = txt(f, 'id');
  const { data } = await admin().from('portal_brain_notes').select('active').eq('id', id).eq('workspace', await currentWorkspace()).maybeSingle();
  if (data) await admin().from('portal_brain_notes').update({ active: !data.active, updated_at: new Date().toISOString() }).eq('id', id);
  done(data?.active ? 'Note switched off.' : 'Note switched on.');
}

export async function deleteBrainNote(f: FormData) {
  await requireTeam();
  await admin().from('portal_brain_notes').delete().eq('id', txt(f, 'id')).eq('workspace', await currentWorkspace());
  done('Note deleted.');
}

export async function saveCountryBrief(f: FormData) {
  await requireTeam();
  const brief = txt(f, 'brief').slice(0, 3000) || null;
  await admin().from('portal_workspaces').update({ brief }).eq('key', await currentWorkspace());
  done('Saved. The Brain will use this for every student in this workspace.');
}
