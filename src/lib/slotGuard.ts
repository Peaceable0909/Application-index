// Protects against the double click: a session someone has just made is not made a second time.
export type RecentSlot = { starts_at: string; trainer: string | null; created_by: string | null; created_at: string };

/**
 * Splits the requested start times into new ones and ones that were already created a moment ago by the same person for the same trainer.
 * (A second click, a second tab or Enter pressed twice must never make a second session, a second Meet link or a second round of emails.)
 */
export function splitDuplicates(starts: string[], recent: RecentSlot[], o: { who: string; trainer: string; now?: number; windowMs?: number }): { fresh: string[]; dupes: string[] } {
  const now = o.now ?? Date.now(), win = o.windowMs ?? 150_000;
  const made = new Set(recent
    .filter((r) => r.created_by === o.who && (r.trainer || '') === o.trainer && now - Date.parse(r.created_at) <= win && Date.parse(r.created_at) <= now + 5000)
    .map((r) => new Date(r.starts_at).getTime()));
  const fresh: string[] = [], dupes: string[] = [];
  for (const s of starts) (made.has(new Date(s).getTime()) ? dupes : fresh).push(s);
  return { fresh, dupes };
}
