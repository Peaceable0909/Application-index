'use server';
import { currentWorkspace } from '@/lib/workspace';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { ALL_DOC_TYPES } from '@/lib/constants';
import { audit } from '@/lib/audit';

/** Admins only: lets the Brain answer students by itself in this workspace (it still hands over to a person when it is not sure). */
export async function setAutoReply(f: FormData) {
  const me = await requireTeam();
  if (me.role !== 'admin') return done('Only admins can change automatic replies.', true);
  const on = txt(f, 'on') === '1', ws = await currentWorkspace();
  await admin().from('portal_workspaces').update({ auto_reply: on }).eq('key', ws);
  await audit(me.email, on ? 'brain_auto_on' : 'brain_auto_off', ws);
  done(on ? 'Automatic replies are ON for this country. The Brain answers what it is sure of and hands the rest to a counselor.' : 'Automatic replies are OFF. The Brain only drafts for a person to send.');
}

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

/** The documents students of this country must send, one per line. Standard names are matched ("passport" becomes "Passport"). Empty = the original list. */
export async function saveRequiredDocs(f: FormData) {
  await requireTeam();
  const seen = new Set<string>(), list: string[] = [];
  for (const raw of txt(f, 'docs').split(/[\n,]+/)) {
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    if (t.length > 40) return done('Each document name must be 40 characters or fewer.', true);
    const std = (ALL_DOC_TYPES as readonly string[]).find((x) => x.toLowerCase() === t.toLowerCase() && x !== 'Other');
    const name = std || t.charAt(0).toUpperCase() + t.slice(1);
    if (!seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); list.push(name); }
  }
  if (list.length > 15) return done('Please keep it to 15 documents or fewer.', true);
  await admin().from('portal_workspaces').update({ required_docs: list.length ? list : null }).eq('key', await currentWorkspace());
  done(list.length ? `Saved. Students of this country now need ${list.length} document${list.length === 1 ? '' : 's'}.` : 'Reset to the original list.');
}

export async function toggleBrainDoc(f: FormData) {
  await requireTeam();
  const id = txt(f, 'id'), ws = await currentWorkspace();
  const { data } = await admin().from('portal_brain_docs').select('active').eq('id', id).eq('workspace', ws).maybeSingle();
  if (data) await admin().from('portal_brain_docs').update({ active: !data.active }).eq('id', id).eq('workspace', ws);
  done(data?.active ? 'File switched off. The Brain will stop using it.' : 'File switched on.');
}

export async function deleteBrainDoc(f: FormData) {
  await requireTeam();
  await admin().from('portal_brain_docs').delete().eq('id', txt(f, 'id')).eq('workspace', await currentWorkspace());
  done('File deleted.');
}
