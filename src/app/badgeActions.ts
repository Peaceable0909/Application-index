'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { admin } from '@/lib/supabase';
import { requireStaff, type Staff } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { MAX_BADGES, cleanBadge, mayHold, toDef, type BadgeDef } from '@/lib/staffBadges';
import { LOCK_KEYS } from '@/lib/profileRules';
import { LOCKS_SETTING } from '@/lib/profileLocks';

// Badges: defining them, giving them to people, taking them back, and choosing which profile fields people may edit themselves. Admin only,
// every change is written to the audit log, and none of it touches access: a badge is a label, not a permission.
// Safe to repeat: saving, giving and taking back all set a state rather than add to it, and a badge name can exist only once.
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const SAFE = (p: string) => (/^\/(?!\/)/.test(p) ? p : '');
const PAGE = '/badges';

function done(f: FormData, msg: string, err = false, fallback = PAGE): never {
  revalidatePath(PAGE); revalidatePath('/team'); revalidatePath('/profile'); revalidatePath('/', 'layout');
  const to = SAFE(s(f, 'returnTo')) || fallback;
  redirect(`${to}${to.includes('?') ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
}

async function adminOnly(): Promise<Staff> {
  const me = await requireStaff();
  if (me.role !== 'admin') redirect('/?err=' + encodeURIComponent('Only an admin can manage badges.'));
  return me;
}

const loadDef = async (id: string): Promise<BadgeDef | null> => {
  const { data } = await admin().from('portal_badges').select('id, name, description, color, enabled, eligible_roles, show_students, sort').eq('id', id).maybeSingle();
  return data ? toDef(data) : null;
};

/** Create (no id) or update (id) a badge. */
export async function saveBadge(f: FormData) {
  const me = await adminOnly(), id = s(f, 'id'), db = admin();
  const c = cleanBadge({ name: s(f, 'name'), description: s(f, 'description'), color: s(f, 'color'), roles: f.getAll('roles').map(String), enabled: f.get('enabled') === 'on', show_students: f.get('show_students') === 'on' });
  if (!c.ok) done(f, c.error, true);
  const v = (c as Extract<typeof c, { ok: true }>).value;
  const row = { name: v.name, description: v.description || null, color: v.color, enabled: v.enabled, eligible_roles: v.eligible_roles, show_students: v.show_students, updated_by: me.email, updated_at: new Date().toISOString() };
  if (id) {
    if (!(await loadDef(id))) done(f, 'That badge no longer exists.', true);
    const { error } = await db.from('portal_badges').update(row).eq('id', id);
    if (error) done(f, error.code === '23505' ? 'Another badge already has that name.' : `Could not save: ${error.message}`, true);
    await audit(me.email, 'badge_saved', v.name, { id, color: v.color, enabled: v.enabled, roles: v.eligible_roles });
    done(f, `“${v.name}” saved.`);
  }
  const { data: all } = await db.from('portal_badges').select('sort');
  if ((all || []).length >= MAX_BADGES) done(f, `There can be at most ${MAX_BADGES} badges. Switch one off or delete one you no longer use.`, true);
  const { error } = await db.from('portal_badges').insert({ ...row, sort: Math.max(0, ...(all || []).map((r) => Number(r.sort) || 0)) + 1, created_by: me.email });
  if (error) done(f, error.code === '23505' ? 'A badge with that name already exists.' : `Could not create it: ${error.message}`, true);
  await audit(me.email, 'badge_created', v.name, { color: v.color, enabled: v.enabled, roles: v.eligible_roles });
  done(f, `“${v.name}” created.`);
}

/** Deleting a badge removes it from everyone who holds it. */
export async function deleteBadge(f: FormData) {
  const me = await adminOnly(), id = s(f, 'id');
  const def = await loadDef(id);
  if (!def) done(f, 'That badge was already deleted.');
  const { count } = await admin().from('portal_staff_badges').select('email', { count: 'exact', head: true }).eq('badge_id', id);
  const { error } = await admin().from('portal_badges').delete().eq('id', id);
  if (error) done(f, `Could not delete: ${error.message}`, true);
  await audit(me.email, 'badge_deleted', def!.name, { id, heldBy: count ?? 0 });
  done(f, `“${def!.name}” deleted${count ? ` and taken from ${count} ${count === 1 ? 'person' : 'people'}` : ''}.`);
}

/** Give one badge to one or more people. People whose role the badge is not open to are skipped, and the message says who. */
export async function assignBadge(f: FormData) {
  const me = await adminOnly(), db = admin();
  const def = await loadDef(s(f, 'badge_id'));
  if (!def) done(f, 'That badge no longer exists.', true);
  const emails = [...new Set(f.getAll('emails').map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) done(f, 'Choose at least one person.', true);
  const { data: people } = await db.from('portal_staff').select('email, role').in('email', emails);
  const ok: string[] = [], blocked: string[] = [];
  for (const p of people || []) (mayHold(def!, p.role as string) ? ok : blocked).push(String(p.email));
  if (ok.length) {
    const { error } = await db.from('portal_staff_badges').upsert(ok.map((email) => ({ badge_id: def!.id, email, assigned_by: me.email })), { onConflict: 'badge_id,email', ignoreDuplicates: true });
    if (error) done(f, `Could not give the badge: ${error.message}`, true);
    for (const email of ok) await audit(me.email, 'badge_assigned', email, { badge: def!.name });
  }
  const text = ok.length ? `“${def!.name}” given to ${ok.length} ${ok.length === 1 ? 'person' : 'people'}.` : 'Nobody was given the badge.';
  done(f, blocked.length ? `${text} ${blocked.join(', ')} ${blocked.length === 1 ? 'was' : 'were'} skipped because this badge is not open to their role.` : text, !ok.length && blocked.length > 0);
}

export async function revokeBadge(f: FormData) {
  const me = await adminOnly();
  const def = await loadDef(s(f, 'badge_id')), email = s(f, 'email').toLowerCase();
  if (!def) done(f, 'That badge no longer exists.', true);
  await admin().from('portal_staff_badges').delete().eq('badge_id', def!.id).eq('email', email);
  await audit(me.email, 'badge_revoked', email, { badge: def!.name });
  done(f, `“${def!.name}” taken back.`);
}

/** The badges section of one person's profile: exactly the ticked badges afterwards. */
export async function setPersonBadges(f: FormData) {
  const me = await adminOnly(), db = admin();
  const email = s(f, 'email').toLowerCase(), back = `/team/${encodeURIComponent(email)}`;
  const { data: person } = await db.from('portal_staff').select('email, role').eq('email', email).maybeSingle();
  if (!person) done(f, 'That person is not on the team.', true, back);
  const [{ data: defs }, { data: held }] = await Promise.all([
    db.from('portal_badges').select('id, name, description, color, enabled, eligible_roles, show_students, sort'),
    db.from('portal_staff_badges').select('badge_id').eq('email', email),
  ]);
  const byId = new Map((defs || []).map((d) => [d.id as string, toDef(d)]));
  const want = new Set(f.getAll('badge').map(String).filter((id) => byId.has(id)));
  const have = new Set((held || []).map((h) => h.badge_id as string));
  const add = [...want].filter((id) => !have.has(id) && mayHold(byId.get(id)!, person!.role as string));
  const drop = [...have].filter((id) => !want.has(id));
  if (add.length) await db.from('portal_staff_badges').upsert(add.map((badge_id) => ({ badge_id, email, assigned_by: me.email })), { onConflict: 'badge_id,email', ignoreDuplicates: true });
  if (drop.length) await db.from('portal_staff_badges').delete().eq('email', email).in('badge_id', drop);
  for (const id of add) await audit(me.email, 'badge_assigned', email, { badge: byId.get(id)!.name });
  for (const id of drop) await audit(me.email, 'badge_revoked', email, { badge: byId.get(id)?.name });
  done(f, add.length || drop.length ? `Badges updated: ${add.length} given, ${drop.length} taken back.` : 'Nothing was different, so nothing changed.', false, back);
}

/** Which profile fields people may change themselves. */
export async function saveProfileLocks(f: FormData) {
  const me = await adminOnly();
  const locked = LOCK_KEYS.filter((k) => f.getAll('lock').map(String).includes(k));
  const { error } = await admin().from('portal_settings').upsert({ key: LOCKS_SETTING, value: { locked }, updated_by: me.email, updated_at: new Date().toISOString() });
  if (error) done(f, `Could not save: ${error.message}`, true);
  await audit(me.email, 'profile_rules_saved', null, { locked });
  done(f, locked.length ? `Saved. Only an admin can change: ${locked.length} field${locked.length === 1 ? '' : 's'}.` : 'Saved. Everyone can edit all of their own profile fields.');
}
