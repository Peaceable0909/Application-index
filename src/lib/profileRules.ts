// Which profile fields a person may change themselves. An admin can lock fields (Badges & profiles → Who can edit what); a locked field is
// then changed by an admin only. Admins are never locked out. Pure.

export const LIMITS = { display_name: 60, title: 80, bio: 400, responsibilities: 600, duties: 600, also_supports: 200 } as const;

/** The fields an admin can lock, with the words used on the screens. */
export const LOCKABLE = {
  title: 'Professional role',
  bio: 'Short bio',
  responsibilities: 'Primary responsibilities',
  duties: 'Additional duties',
  also_supports: 'Also helps with',
  cover: 'Cover photo',
} as const;
export type LockKey = keyof typeof LOCKABLE;
export const LOCK_KEYS = Object.keys(LOCKABLE) as LockKey[];

export const parseLocks = (v: unknown): LockKey[] => {
  const list = (v as { locked?: unknown } | null)?.locked;
  return Array.isArray(list) ? LOCK_KEYS.filter((k) => list.includes(k)) : [];
};
/** True when this person may not change the field on their own profile. */
export const isLocked = (locks: LockKey[], field: LockKey, role: string) => role !== 'admin' && locks.includes(field);

const clean = (v: string, max: number) => v.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max);
const oneLine = (v: string, max: number) => v.replace(/\s+/g, ' ').trim().slice(0, max);

export type TextFields = { title: string | null; bio: string | null; responsibilities: string | null; duties: string | null; also_supports: string | null };

/**
 * What to write after someone saves the "About you" form. Fields they may not change keep their stored value, and are reported in `blocked`
 * when the form tried to change them.
 */
export function profileTextPatch(current: TextFields, input: Partial<Record<keyof TextFields, string>>, o: { role: string; locks: LockKey[] }): { patch: TextFields; blocked: LockKey[] } {
  const fresh: TextFields = {
    title: oneLine(input.title ?? current.title ?? '', LIMITS.title) || null,
    bio: clean(input.bio ?? current.bio ?? '', LIMITS.bio) || null,
    responsibilities: clean(input.responsibilities ?? current.responsibilities ?? '', LIMITS.responsibilities) || null,
    duties: clean(input.duties ?? current.duties ?? '', LIMITS.duties) || null,
    also_supports: oneLine(input.also_supports ?? current.also_supports ?? '', LIMITS.also_supports) || null,
  };
  const patch = { ...fresh }, blocked: LockKey[] = [];
  for (const k of ['title', 'bio', 'responsibilities', 'duties', 'also_supports'] as const) {
    if (!isLocked(o.locks, k, o.role)) continue;
    if ((current[k] || null) !== fresh[k] && input[k] !== undefined) blocked.push(k);
    patch[k] = current[k] || null;
  }
  return { patch, blocked };
}
