// Protects against the double click and the repeated tap: the same thing done a moment ago is not done a second time.
// (The buttons lock while they work, but a second tab, a repeated Enter or a slow connection can still send the same request twice.)
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

/** A cookie of the form "tag:timestamp" says this same thing (for example "a reset link for this address") was just done in this browser. */
export function justDid(cookie: string | undefined, tag: string, now = Date.now(), windowMs = 60_000): boolean {
  const [t, ts] = (cookie || '').split(':'), at = Number(ts);
  return t === tag && Number.isFinite(at) && now - at >= -1000 && now - at < windowMs;
}

/** Is this moment inside the last `windowMs` (default two minutes)? Used to see whether an email to the same person was only just sent. */
export function isRecent(iso: string | null | undefined, now = Date.now(), windowMs = 120_000): boolean {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && now - t >= -5000 && now - t < windowMs;
}

/** A reorder click carries the place the item was in when it was clicked. If the list has moved since, the click is stale or repeated and must not move it again. */
export function isStaleMove(clickedFrom: string | null | undefined, current: number): boolean {
  return clickedFrom !== null && clickedFrom !== undefined && clickedFrom !== '' && Number(clickedFrom) !== current;
}
