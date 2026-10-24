// Plain words for the assignment history and for where an application stands. No database, so screens and tests can share it.
export const LOG_LABEL: Record<string, string> = {
  auto: 'Routed by the rules', manual: 'Reassigned by a person', bulk: 'Moved with a group', sheet: 'Set in the master sheet',
  queue: 'Waiting for a counselor', conflict: 'Needs a decision', resolved: 'Decision made', documents: 'Documents',
};
export const LEVEL_LABEL: Record<string, string> = { school: 'school rule', country: 'destination rule', location: 'location rule' };

/** "system" and "sheet" are not people; an email is shown as the name before the @. */
export const actorName = (a: string | null | undefined) => (!a || a === 'system' ? 'the portal' : a === 'sheet' ? 'the master sheet' : a.includes('@') ? a.split('@')[0] : a);

export type StateTone = 'green' | 'amber' | 'red' | 'gray';
export function stateLine(state: 'assigned' | 'queue' | 'conflict' | null, owner: string | null): { label: string; tone: StateTone } {
  if (state === 'conflict' && !owner) return { label: 'Needs a decision', tone: 'red' };
  if (!owner) return { label: 'Waiting for a counselor', tone: 'amber' };
  return { label: 'Assigned', tone: 'green' };
}

/** What the Team Head dashboard calls a second look. */
export const REVIEW_LABEL: Record<string, string> = {
  queue: 'No counselor', conflict: 'Needs a decision', 'wrong-counselor': 'Rules point to someone else', 'counselor-unavailable': 'Counselor unavailable',
};
