import { isFormSubmission } from './attention';
import type { SRow } from './overview';

export type SP = Record<string, string | undefined>;
type Pred = (r: SRow) => boolean;

/** Quick "tabs" on the Applications page. */
export const viewPredicates = (lastSeen: string | null): Record<string, Pred> => ({
  attention: (r) => r.reasons.length > 0,
  missing: (r) => r.judged && r.missing.length > 0,
  nofolder: (r) => !r.a.drive_folder_id,
  notmaster: (r) => !r.a.in_master,
  sheet1: (r) => r.a.in_master,
  regent: (r) => r.a.in_regent,
  new: (r) => !!lastSeen && isFormSubmission(r.a) && !!r.a.created_at && new Date(r.a.created_at) > new Date(lastSeen),
});

/** The one place that decides which students match the current search/filters (used by the page and by CSV export). */
export function filterRows(rows: SRow[], sp: SP, lastSeen: string | null): SRow[] {
  const q = (sp.q || '').toLowerCase();
  const views = viewPredicates(lastSeen);
  return rows.filter((row) => {
    const { a, reasons } = row;
    const source: Record<string, boolean> = {
      sheet1: a.in_master, regent: a.in_regent, form: isFormSubmission(a), both: a.in_master && isFormSubmission(a), raw_only: !a.in_master, no_sheet1: !a.in_master,
      master_only: a.in_master && !isFormSubmission(a), sheet1_no_form: a.in_master && !isFormSubmission(a), no_regent: !a.in_regent,
    };
    return (!sp.view || !views[sp.view] || views[sp.view](row)) &&
      (!q || [a.name, a.email, a.school, a.programme, a.phone, a.opp_id].some((v) => v?.toLowerCase().includes(q))) &&
      (!sp.counselor || (sp.counselor === '__none' ? !a.counselor : a.counselor === sp.counselor)) &&
      (!sp.country || a.country?.toLowerCase() === sp.country.toLowerCase()) &&
      (!sp.school || a.school === sp.school) && (!sp.programme || a.programme === sp.programme) &&
      (!sp.status || (sp.status === '__none' ? !a.status : a.status === sp.status)) &&
      (!sp.source || source[sp.source]) &&
      (!sp.payment || (sp.payment === 'paid' ? /^paid/i.test(a.payment || '') : a.in_regent && !/^paid/i.test(a.payment || ''))) &&
      (!sp.interview || (sp.interview === '__none' ? a.in_regent && !a.interview : a.interview === sp.interview)) &&
      (!sp.attention || reasons.length > 0);
  });
}

const cell = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** CSV with a BOM so Excel opens accents and Nigerian names correctly. */
export function toCsv(rows: SRow[]): string {
  const head = ['Name', 'Email', 'Phone', 'University', 'Programme', 'Country', 'City', 'Counselor', 'Status', 'Progress %', 'Payment', 'OPP ID', 'Interview',
    'Documents present', 'Documents missing', 'Needs attention', 'Submitted', 'In Sheet1', 'In Regent Only', 'Drive folder'];
  const lines = rows.map(({ a, have, missing, reasons }) => [
    a.name, a.email, a.phone, a.school, a.programme, a.country, (a as unknown as { city?: string }).city || '', a.counselor, a.status, a.progress ?? '', a.payment, a.opp_id, a.interview,
    [...have].join('; '), missing.join('; '), reasons.join('; '), a.submitted_at ? a.submitted_at.slice(0, 10) : '', a.in_master ? 'yes' : 'no', a.in_regent ? 'yes' : 'no',
    a.drive_folder_id ? `https://drive.google.com/drive/folders/${a.drive_folder_id}` : '',
  ].map(cell).join(','));
  return '﻿' + [head.join(','), ...lines].join('\r\n');
}
