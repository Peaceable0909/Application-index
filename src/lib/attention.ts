import { FINAL_STATUSES, STALE_DAYS } from './constants';

// A real form submission has a submission date. Rows typed into the Applications tab by hand don't.
export const isFormSubmission = (a: { has_raw: boolean; submitted_at: string | null }) => a.has_raw && !!a.submitted_at;

export type AppRow = {
  application_id: string; name: string; email: string | null; school: string | null; programme: string | null;
  country: string | null; counselor: string | null; status: string | null; submitted_at: string | null;
  last_activity_at: string; student_key: string; in_master: boolean; has_raw: boolean; progress: number | null;
  created_at?: string; drive_folder_id: string | null; phone: string | null; in_regent: boolean; payment: string | null; interview: string | null; opp_id: string | null;
};

export function attentionReasons(a: AppRow, missing: string[], docCount: number): string[] {
  const r: string[] = [];
  const now = Date.now();
  if (!a.in_master) r.push('Not in master sheet');
  if (a.interview && /to be booked/i.test(a.interview)) r.push('Interview to book');
  // Documents are judged once a Drive folder exists (form folder or one linked by hand).
  // Students tracked only in the sheets, with no folder, aren't judged.
  if (isFormSubmission(a) || a.drive_folder_id) {
    if (docCount === 0) r.push('No documents');
    else if (missing.length) r.push(`Missing ${missing.length} doc${missing.length > 1 ? 's' : ''}`);
  }
  if (!a.counselor) r.push('No counselor');
  const final = a.status && FINAL_STATUSES.includes(a.status);
  if (!final) {
    if (!a.status && a.submitted_at && now - new Date(a.submitted_at).getTime() > 2 * 864e5) r.push('No status set');
    if (now - new Date(a.last_activity_at).getTime() > STALE_DAYS * 864e5) r.push(`No activity ${STALE_DAYS}+ days`);
  }
  return r;
}
