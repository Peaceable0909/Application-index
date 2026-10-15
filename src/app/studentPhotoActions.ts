'use server';
import { revalidatePath } from 'next/cache';
import { admin } from '@/lib/supabase';
import { currentStudent } from '@/lib/student';

const isImage = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 ? ['jpg', 'image/jpeg'] : b.subarray(1, 4).toString() === 'PNG' ? ['png', 'image/png'] : b.subarray(8, 12).toString() === 'WEBP' ? ['webp', 'image/webp'] : null);
const fileOf = (url: string | null) => (url ? url.split('/avatars/')[1] || null : null);

/** A student sets their own profile picture. The browser has already squared it and shrunk it. */
export async function uploadStudentPhoto(f: FormData): Promise<{ ok: boolean; error?: string; url?: string }> {
  const me = await currentStudent();
  if (!me) return { ok: false, error: 'Please sign in again.' };
  const file = f.get('photo');
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'Choose a photo first.' };
  if (file.size > 1_000_000) return { ok: false, error: 'That photo is too large (max 1 MB).' };
  const buf = Buffer.from(await file.arrayBuffer()), kind = isImage(buf);
  if (!kind) return { ok: false, error: 'Please use a JPG, PNG or WebP photo.' };
  const db = admin();
  const path = `stu-${me.email.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.${kind[0]}`;
  const up = await db.storage.from('avatars').upload(path, buf, { contentType: kind[1], upsert: true });
  if (up.error) return { ok: false, error: 'Upload failed. Please try again.' };
  const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  const { error } = await db.from('portal_student_profiles').upsert({ email: me.email, avatar_url: url, updated_at: new Date().toISOString() });
  if (error) { await db.storage.from('avatars').remove([path]); return { ok: false, error: 'Could not save your photo. Please try again.' }; }
  const old = fileOf(me.avatar_url); if (old) await db.storage.from('avatars').remove([old]);
  revalidatePath('/', 'layout');
  return { ok: true, url };
}

export async function removeStudentPhoto(): Promise<{ ok: boolean; error?: string }> {
  const me = await currentStudent();
  if (!me) return { ok: false, error: 'Please sign in again.' };
  const db = admin();
  const old = fileOf(me.avatar_url); if (old) await db.storage.from('avatars').remove([old]);
  await db.from('portal_student_profiles').upsert({ email: me.email, avatar_url: null, updated_at: new Date().toISOString() });
  revalidatePath('/', 'layout');
  return { ok: true };
}
