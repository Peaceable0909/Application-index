// Badges are labels an admin defines: a name, a meaning in the admin's own words, one of five colours, and which roles may hold it.
// A badge says only what its description says. It is never read by a permission check: holding one opens no application and no admin page
// (access comes from the role, the workspaces, the assignment rules and Team Head scopes, nothing else). Pure, so the rules are tested.

export const BADGE_COLORS = ['blue', 'red', 'yellow', 'green', 'purple'] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];
export const COLOR_LABEL: Record<BadgeColor, string> = { blue: 'Blue', red: 'Red', yellow: 'Yellow', green: 'Green', purple: 'Purple' };

export const BADGE_ROLES = ['admin', 'staff', 'counselor'] as const;
export type BadgeRole = (typeof BADGE_ROLES)[number];
export const ROLE_LABEL: Record<BadgeRole, string> = { admin: 'Admins', staff: 'Staff', counselor: 'Counselors' };

export const NAME_MAX = 40, DESC_MAX = 240, MAX_BADGES = 30;

/** What a page needs to draw a badge. */
export type BadgeLite = { id: string; name: string; description: string; color: BadgeColor };
/** A badge as the admin page sees it. */
export type BadgeDef = BadgeLite & { enabled: boolean; eligible_roles: BadgeRole[]; show_students: boolean; sort: number };
export type BadgeLink = { badge_id: string; email: string };

export const isColor = (v: unknown): v is BadgeColor => BADGE_COLORS.includes(v as BadgeColor);
export const isRole = (v: unknown): v is BadgeRole => BADGE_ROLES.includes(v as BadgeRole);
const squash = (v: string) => v.replace(/\s+/g, ' ').trim();

export type BadgeInput = { name: string; description: string; color: string; roles: string[]; enabled: boolean; show_students: boolean };
export type Cleaned = { ok: true; value: { name: string; description: string; color: BadgeColor; eligible_roles: BadgeRole[]; enabled: boolean; show_students: boolean } } | { ok: false; error: string };

/** Checks what the admin typed. A badge cannot be switched on without a meaning, so the tooltip is always the admin's own words. */
export function cleanBadge(i: BadgeInput): Cleaned {
  const name = squash(i.name), description = squash(i.description);
  if (!name) return { ok: false, error: 'Give the badge a name.' };
  if (name.length > NAME_MAX) return { ok: false, error: `The name can be at most ${NAME_MAX} characters.` };
  if (description.length > DESC_MAX) return { ok: false, error: `The meaning can be at most ${DESC_MAX} characters.` };
  if (!isColor(i.color)) return { ok: false, error: 'Pick one of the five colours.' };
  const roles = BADGE_ROLES.filter((r) => i.roles.includes(r));
  if (!roles.length) return { ok: false, error: 'Choose at least one role that may hold this badge.' };
  if (i.enabled && !description) return { ok: false, error: 'Write what this badge means before switching it on: that sentence is what people see when they point at it.' };
  return { ok: true, value: { name, description, color: i.color, eligible_roles: roles, enabled: i.enabled, show_students: i.show_students } };
}

export const mayHold = (b: Pick<BadgeDef, 'eligible_roles'>, role: string) => isRole(role) && b.eligible_roles.includes(role);

/** Reads one database row into a BadgeDef (tolerates nulls and unknown values). */
export function toDef(r: { id: string; name: string; description?: string | null; color: string; enabled?: boolean | null; eligible_roles?: string[] | null; show_students?: boolean | null; sort?: number | null }): BadgeDef {
  return {
    id: r.id, name: r.name, description: (r.description || '').trim(), color: isColor(r.color) ? r.color : 'blue',
    enabled: !!r.enabled, eligible_roles: (r.eligible_roles || []).filter(isRole), show_students: !!r.show_students, sort: r.sort ?? 0,
  };
}

const byOrder = (a: BadgeDef, b: BadgeDef) => a.sort - b.sort || a.name.localeCompare(b.name);

/**
 * Who shows which badges. A badge is drawn only while it is switched on and its holder's role is (still) one it is open to; the choice of
 * `students` further limits it to badges the admin allowed students to see.
 */
export function visibleBadges(defs: BadgeDef[], links: BadgeLink[], roles: Map<string, string>, o: { students?: boolean } = {}): Map<string, BadgeLite[]> {
  const live = new Map(defs.filter((d) => d.enabled && (!o.students || d.show_students)).sort(byOrder).map((d) => [d.id, d]));
  const out = new Map<string, BadgeLite[]>();
  for (const l of links) {
    const d = live.get(l.badge_id), email = l.email.toLowerCase();
    if (!d || !mayHold(d, roles.get(email) || '')) continue;
    const list = out.get(email) || [];
    list.push({ id: d.id, name: d.name, description: d.description, color: d.color });
    out.set(email, list);
  }
  for (const [e, list] of out) { const order = [...live.keys()]; list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); out.set(e, list); }
  return out;
}

/** The sentence read out for a badge: exactly the admin's words, never a made-up "verified". */
export const badgeSpeech = (b: Pick<BadgeLite, 'name' | 'description'>) => (b.description ? `${b.name}: ${b.description}` : b.name);

/** Who can be given a badge right now, and who is held back because of their role. */
export function splitEligible(def: Pick<BadgeDef, 'eligible_roles'>, people: { email: string; role: string }[]): { ok: string[]; blocked: string[] } {
  const ok: string[] = [], blocked: string[] = [];
  for (const p of people) (mayHold(def, p.role) ? ok : blocked).push(p.email.toLowerCase());
  return { ok, blocked };
}
