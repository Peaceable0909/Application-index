import { admin } from './supabase';
import { shownName } from './profile';
import { loadBadgeMap } from './badgeData';
import type { BadgeLite } from './staffBadges';

export type Person = { email: string; name: string; avatar_url: string | null; color: string | null; title: string | null; badges: BadgeLite[] };
export type People = Map<string, Person>;

/** Everyone with portal access, keyed by email, so any page can show a name + photo instead of an address. */
export async function loadPeople(): Promise<People> {
  const [{ data }, badges] = await Promise.all([admin().from('portal_staff').select('email, display_name, avatar_url, color, title'), loadBadgeMap()]);
  return new Map((data || []).map((p) => [p.email.toLowerCase(), { email: p.email, name: shownName(p), avatar_url: p.avatar_url, color: p.color, title: p.title, badges: badges.get(p.email.toLowerCase()) || [] }]));
}

const SYSTEM: Record<string, string> = { 'weekly digest': 'Weekly digest', sync: 'Auto-sync', system: 'System', portal: 'Portal', ai: 'AI' };
/** Name to show for an actor/author/sender (a staff email, or a system label like "sync"). */
export function personFor(people: People, who: string | null | undefined): Person {
  const raw = (who || '').trim();
  const hit = people.get(raw.toLowerCase());
  if (hit) return hit;
  const sys = SYSTEM[raw.toLowerCase()];
  const base = raw.includes('@') ? raw.split('@')[0].replace(/[^a-zA-Z]+/g, ' ').trim().split(' ')[0] : raw;
  const name = sys || (base ? base[0].toUpperCase() + base.slice(1).toLowerCase() : 'Someone');
  return { email: raw, name, avatar_url: null, color: sys ? 'slate' : null, title: null, badges: [] };
}
