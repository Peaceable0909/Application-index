'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { admin } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { COVER_KEYS, COVER_MAX_BYTES, clampPos, coverPathFromUrl, sniffImage } from '@/lib/covers';
import { isLocked, profileTextPatch, type TextFields } from '@/lib/profileRules';
import { profileLocks } from '@/lib/profileLocks';

// Cover photos and admin edits of someone else's profile. A person changes their own cover (unless an admin locked it); an admin can change anyone's.
// Nothing here touches access: a cover, a title or a list of duties is only text and a picture. Access comes from the role, the workspaces,
// the assignment rules and Team Head scopes.
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const SAFE = (p: string) => (/^\/(?!\/)/.test(p) ? p : '');

function back(f: FormData, fallback: string, msg: string, err = false): never {
  revalidatePath('/', 'layout');
  const to = SAFE(s(f, 'returnTo')) || fallback;
  redirect(`${to}${to.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
}

/** Whose profile this is about (their own unless an admin names someone), after checking that the signed-in person may change it. */
async function target(f: FormData, field: 'cover' | null = 'cover') {
  const me = await requireStaff();
  const email = (s(f, 'email') || me.email).toLowerCase(), mine = email === me.email.toLowerCase();
  const fallback = mine ? '/profile' : `/team/${encodeURIComponent(email)}`;
  if (!mine && me.role !== 'admin') back(f, '/profile', 'Only an admin can change someone else’s profile.', true);
  const { data: row } = await admin().from('portal_staff').select('email, role, cover_url').eq('email', email).maybeSingle();
  if (!row) back(f, fallback, 'That person is not on the team.', true);
  if (mine && field && isLocked(await profileLocks(), field, me.role)) back(f, fallback, 'An admin looks after cover photos, so it cannot be changed here.', true);
  return { me, email, mine, fallback, oldUrl: (row!.cover_url as string | null) ?? null };
}

const dropFile = async (url: string | null) => { const old = coverPathFromUrl(url); if (old) await admin().storage.from('covers').remove([old]); };
const stamp = () => new Date().toISOString();

export async function saveCover(f: FormData) {
  const t = await target(f);
  const file = f.get('cover');
  if (!(file instanceof File) || !file.size) back(f, t.fallback, 'Choose a picture first.', true);
  if ((file as File).size > COVER_MAX_BYTES) back(f, t.fallback, 'That picture is too large (max 2 MB). Try a smaller one.', true);
  const buf = Buffer.from(await (file as File).arrayBuffer());
  const kind = sniffImage(buf);
  if (!kind) back(f, t.fallback, 'Please use a JPG, PNG or WebP picture.', true);
  const db = admin(), path = `${randomUUID()}.${kind!.ext}`;
  const up = await db.storage.from('covers').upload(path, buf, { contentType: kind!.mime, upsert: false });
  if (up.error) back(f, t.fallback, `Upload failed: ${up.error.message}`, true);
  const url = db.storage.from('covers').getPublicUrl(path).data.publicUrl;
  const { error } = await db.from('portal_staff').update({ cover_url: url, cover_pos: clampPos(f.get('pos')), updated_at: stamp() }).eq('email', t.email);
  if (error) { await db.storage.from('covers').remove([path]); back(f, t.fallback, `Could not save the cover: ${error.message}`, true); }
  await dropFile(t.oldUrl);
  if (!t.mine) await audit(t.me.email, 'cover_changed', t.email, { how: 'photo' });
  back(f, t.fallback, t.mine ? 'Cover photo updated.' : 'Cover photo updated for them.');
}

export async function removeCover(f: FormData) {
  const t = await target(f);
  await admin().from('portal_staff').update({ cover_url: null, cover_pos: 50, updated_at: stamp() }).eq('email', t.email);
  await dropFile(t.oldUrl);
  if (!t.mine) await audit(t.me.email, 'cover_changed', t.email, { how: 'removed' });
  back(f, t.fallback, 'Cover photo removed.');
}

/** Pick one of the built-in covers (or "match my colour" with an empty choice). It replaces a photo, so what is shown is never unclear. */
export async function setCoverPreset(f: FormData) {
  const t = await target(f);
  const preset = s(f, 'preset');
  if (preset && !COVER_KEYS.includes(preset)) back(f, t.fallback, 'That cover does not exist.', true);
  await admin().from('portal_staff').update({ cover_preset: preset || null, cover_url: null, cover_pos: 50, updated_at: stamp() }).eq('email', t.email);
  await dropFile(t.oldUrl);
  if (!t.mine) await audit(t.me.email, 'cover_changed', t.email, { how: preset || 'accent colour' });
  back(f, t.fallback, 'Cover updated.');
}

export async function setCoverPos(f: FormData) {
  const t = await target(f);
  await admin().from('portal_staff').update({ cover_pos: clampPos(f.get('pos')), updated_at: stamp() }).eq('email', t.email);
  back(f, t.fallback, 'Cover position saved.');
}

/** An admin edits what a teammate wrote about their work (role, bio, responsibilities, duties). Locks do not apply to admins. */
export async function adminSaveProfile(f: FormData) {
  const t = await target(f, null);
  if (t.me.role !== 'admin') back(f, '/profile', 'Only an admin can change someone else’s profile.', true);
  const db = admin();
  const { data: cur } = await db.from('portal_staff').select('display_name, title, bio, responsibilities, duties, also_supports').eq('email', t.email).maybeSingle();
  const { patch } = profileTextPatch((cur || {}) as TextFields, { title: s(f, 'title'), bio: String(f.get('bio') ?? ''), responsibilities: String(f.get('responsibilities') ?? ''), duties: String(f.get('duties') ?? ''), also_supports: s(f, 'also_supports') }, { role: 'admin', locks: [] });
  const name = s(f, 'display_name').replace(/\s+/g, ' ').slice(0, 60);
  const next = { ...patch, display_name: name || (cur?.display_name as string | null) || null };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => ((cur as Record<string, string | null> | null)?.[k] ?? null) !== next[k]);
  if (!changed.length) back(f, t.fallback, 'Nothing was different, so nothing changed.');
  const { error } = await db.from('portal_staff').update({ ...next, updated_at: stamp() }).eq('email', t.email);
  if (error) back(f, t.fallback, `Could not save: ${error.message}`, true);
  if (!t.mine) await audit(t.me.email, 'profile_edited', t.email, { fields: changed });
  back(f, t.fallback, t.mine ? 'Profile saved.' : 'Their profile was saved.');
}
