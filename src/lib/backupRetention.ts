// How many nightly backups are kept. An admin picks the number on the Settings page (portal_settings key "backup_keep"); older files are deleted
// after every backup and straight away when the number is lowered. Pure, so the rule is tested.

export const KEEP_DEFAULT = 14, KEEP_MIN = 3, KEEP_MAX = 90;
export const KEEP_SETTING = 'backup_keep';

/** A usable number: whole, between 3 and 90 (never zero, so a bad value can not delete every backup). */
export const clampKeep = (v: unknown): number => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return KEEP_DEFAULT;   // an empty box is "not set", never zero
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(KEEP_MAX, Math.max(KEEP_MIN, n)) : KEEP_DEFAULT;
};
export const readKeep = (value: unknown): number => clampKeep((value as { keep?: unknown } | null)?.keep ?? KEEP_DEFAULT);

/** Only files the backup job itself made are ever counted or deleted: portal-YYYY-MM-DD.json.gz. */
export const isBackupName = (n: string) => /^portal-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n);

/** The files to delete: everything older than the newest `keep` (the date is in the name, so newest = largest name). */
export function expiredBackups(names: string[], keep: number): string[] {
  return names.filter(isBackupName).sort().reverse().slice(clampKeep(keep)).sort();
}
