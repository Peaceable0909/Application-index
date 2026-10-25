// Badge definitions and who holds them, read once per request. A missing table or a failed read gives "no badges", never an error page:
// badges are decoration, so nothing else may break because of them.
import { cache } from 'react';
import { admin } from './supabase';
import { toDef, visibleBadges, type BadgeDef, type BadgeLite } from './staffBadges';

export type Holder = { badge_id: string; email: string; assigned_by: string | null; assigned_at: string | null };

export const loadBadgeDefs = cache(async (): Promise<BadgeDef[]> => {
  const { data } = await admin().from('portal_badges').select('id, name, description, color, enabled, eligible_roles, show_students, sort').order('sort').order('name');
  return (data || []).map(toDef);
});

export const loadHolders = cache(async (): Promise<Holder[]> => {
  const { data } = await admin().from('portal_staff_badges').select('badge_id, email, assigned_by, assigned_at').order('assigned_at');
  return (data || []).map((r) => ({ badge_id: r.badge_id as string, email: String(r.email).toLowerCase(), assigned_by: (r.assigned_by as string | null) ?? null, assigned_at: (r.assigned_at as string | null) ?? null }));
});

const loadRoles = cache(async () => {
  const { data } = await admin().from('portal_staff').select('email, role');
  return new Map((data || []).map((p) => [String(p.email).toLowerCase(), p.role as string]));
});

/** Every team member's badges as staff see them: only badges that are switched on and that the member's role may hold. */
export const loadBadgeMap = cache(async (): Promise<Map<string, BadgeLite[]>> => {
  const [defs, links, roles] = await Promise.all([loadBadgeDefs(), loadHolders(), loadRoles()]);
  return visibleBadges(defs, links, roles);
});

/** The same, limited to the badges an admin allowed students to see (shown next to their counselor's name). */
export const loadStudentBadgeMap = cache(async (): Promise<Map<string, BadgeLite[]>> => {
  const [defs, links, roles] = await Promise.all([loadBadgeDefs(), loadHolders(), loadRoles()]);
  return visibleBadges(defs, links, roles, { students: true });
});

export const badgesOf = async (email: string | null | undefined): Promise<BadgeLite[]> => (email ? (await loadBadgeMap()).get(email.toLowerCase()) || [] : []);
