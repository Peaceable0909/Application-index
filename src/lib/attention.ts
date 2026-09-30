import { FINAL_STATUSES, STALE_DAYS } from './constants';

export type AppRow = {
  application_id: string; name: string; email: string | null; school: string | null; programme: string | null;
  country: string | null; counselor: string | null; status: string | null; submitted_at: string | null;
  last_activity_at: string; student_key: string; in_master: boolean; has_raw: boolean; progress: number | null;
};

export function attentionReasons(a: AppRow, missing: string[], docCount: number): string[] {
  const r: string[] = [];
  const now = Date.now();
  if (!a.in_master) r.push('Not in master sheet');
  if (!a.has_raw) r.push('No form submission');
  else if (docCount === 0) r.push('No documents');
  if (a.has_raw && docCount > 0 && missing.length) r.push(`Missing ${missing.length} doc${missing.length > 1 ? 's' : ''}`);
  if (!a.counselor) r.push('No counselor');
  const final = a.status && FINAL_STATUSES.includes(a.status);
  if (!final) {
    if (!a.status && a.submitted_at && now - new Date(a.submitted_at).getTime() > 2 * 864e5) r.push('No status set');
    if (now - new Date(a.last_activity_at).getTime() > STALE_DAYS * 864e5) r.push(`No activity ${STALE_DAYS}+ days`);
  }
  return r;
}
